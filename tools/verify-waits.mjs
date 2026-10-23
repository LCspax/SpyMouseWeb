// Behaviour regression for native per-waypoint waits and stationary stubs.
// Runs cats with nonzero wait (and stationary cats) at 30/60/120 Hz and checks
// pause duration, loop closure / turn-around, and wall safety.
import fs from "node:fs";
import path from "node:path";
import { Level } from "../src/level.js";

const levelsDir = "assets/levels";
const defs = [];
for (const f of fs.readdirSync(levelsDir)) {
  if (!f.endsWith(".json") || f === "index.json") continue;
  const def = JSON.parse(fs.readFileSync(path.join(levelsDir, f), "utf8"));
  if (!def.cats || !def.cats.length) continue;
  const interesting = def.cats.some(
    (c) => c.routeMode === "stationary" || (c.route || []).some((p) => (p.wait || 0) > 0)
  );
  if (!interesting) continue;
  defs.push(def);
}

function fresh(def) {
  const d = JSON.parse(JSON.stringify(def));
  d.mask = JSON.parse(fs.readFileSync(def.mask, "utf8"));
  return new Level(d);
}

const results = [];
for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
  for (const def of defs) {
    const level = fresh(def);
    // Cat navigation uses the hazard-aware world (painted lava is walkable for
    // cats in the native graph walk; parallel-J2).
    const world = level.catWorld || level.world;
    const cell = world.cell;
    const n = world.cols * world.rows;
    const comp = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const tx = i % world.cols;
      const ty = (i / world.cols) | 0;
      if (comp[i] !== -1 || world.isWall(tx, ty)) continue;
      comp[i] = i;
      const stack = [i];
      while (stack.length) {
        const c = stack.pop();
        const cx = c % world.cols;
        const cy = (c / world.cols) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= world.cols || ny >= world.rows) continue;
          const ni = ny * world.cols + nx;
          if (comp[ni] !== -1 || world.isWall(nx, ny)) continue;
          comp[ni] = i;
          stack.push(ni);
        }
      }
    }
    const compAt = (p) => {
      const t = world.nearestOpen(p.x, p.y);
      return comp[t.ty * world.cols + t.tx];
    };
    level.cats.forEach((cat, ci) => {
      const crossComponent = new Set(cat.route.map((p) => compAt(p))).size > 1;
      const waits = cat.route.map((p) => p.wait || 0);
      const maxWait = Math.max(0, ...waits);
      const stationary = cat.routeMode === "stationary";
      // Native endpoint pause (follower 0x9fe70-0x9fe7c / 0xa01a4) is the last
      // waypoint's wait for modes 0-2; there is no default 0.4s pause.
      const expectedPause = stationary ? 0 : maxWait;
      const startX = cat.x, startY = cat.y;
      let maxPause = 0;
      let pauseStart = null;
      let pauseCount = 0;
      let maxDisplacement = 0;
      let wallFrames = 0;
      let minDistToStart = Infinity;
      let minDistToEnd = Infinity;
      let turned = false;
      let blocked = null;
      let stillTime = 0;
      let lastX = cat.x;
      let lastY = cat.y;
      const initialDir = cat.routeDir;
      const far = { x: -9999, y: -9999 };
      let routeLen = 0;
      for (let i = 0; i < cat.route.length - 1; i++) {
        routeLen += Math.hypot(cat.route[i + 1].x - cat.route[i].x, cat.route[i + 1].y - cat.route[i].y);
      }
      if (cat.routeMode === "loop" && cat.route.length > 1) {
        routeLen += Math.hypot(
          cat.route[0].x - cat.route[cat.route.length - 1].x,
          cat.route[0].y - cat.route[cat.route.length - 1].y
        );
      }
      const speed = Math.max(1, cat.patrolSpeed);
      const period = (routeLen / speed) * (cat.routeMode === "loop" ? 1 : 2);
      const T = Math.min(900, Math.max(60, period * 2.5 + expectedPause * 3 + 20));
      for (let t = 0; t < T; t += dt) {
        cat.update(dt, world, far);
        const pause = Math.max(cat.waypointTimer || 0, cat.endpointTimer || 0);
        if (pause > 0) {
          if (pauseStart == null) pauseStart = t;
          maxPause = Math.max(maxPause, pause);
        } else if (pauseStart != null) {
          pauseCount++;
          pauseStart = null;
        }
        const moved = Math.hypot(cat.x - lastX, cat.y - lastY);
        // Native mode 0 ends at the last waypoint; resting there is the
        // expected terminal state, not a blocked waypoint.
        const endPoint = cat.route[cat.route.length - 1];
        const atStopEnd =
          cat.routeMode === "stop" &&
          cat.route.length > 1 &&
          Math.hypot(cat.x - endPoint.x, cat.y - endPoint.y) < cell * 1.5;
        if (!stationary && !atStopEnd && pause === 0 && moved < 0.01) stillTime += dt;
        else stillTime = 0;
        if (stillTime > 5 && !blocked) {
          blocked = {
            index: cat.routeIndex,
            x: +cat.x.toFixed(1),
            y: +cat.y.toFixed(1),
            target: cat.route[cat.routeIndex]
              ? { x: cat.route[cat.routeIndex].x, y: cat.route[cat.routeIndex].y }
              : null,
            atSec: +t.toFixed(1),
          };
        }
        lastX = cat.x;
        lastY = cat.y;
        if (world.circleHitsWall(cat.x, cat.y, cat.radius)) wallFrames++;
        maxDisplacement = Math.max(maxDisplacement, Math.hypot(cat.x - startX, cat.y - startY));
        if (!stationary && cat.route.length > 1) {
          minDistToStart = Math.min(minDistToStart, Math.hypot(cat.x - cat.route[0].x, cat.y - cat.route[0].y));
          const end = cat.route[cat.route.length - 1];
          minDistToEnd = Math.min(minDistToEnd, Math.hypot(cat.x - end.x, cat.y - end.y));
        }
        if (cat.routeMode !== "loop" && cat.routeDir !== initialDir) turned = true;
      }
      const verified =
        !blocked &&
        !crossComponent &&
        wallFrames === 0 &&
        (stationary
          ? maxDisplacement < 0.5 && maxPause === 0
          : Math.abs(maxPause - expectedPause) <= Math.max(0.15, dt * 2.5) &&
            (cat.routeMode === "loop" || cat.routeMode === "regenerate"
              ? minDistToStart < cell * 2
              : cat.routeMode === "stop"
                ? minDistToEnd < cell * 1.5
                : turned));
      const status = blocked || crossComponent ? "blocked" : verified ? "completed" : "failed";
      results.push({
        dt: +dt.toFixed(5),
        map: def.id,
        cat: ci,
        tag: def.cats[ci] ? def.cats[ci].tag : null,
        mode: cat.routeMode,
        stationary,
        expectedPauseSec: +expectedPause.toFixed(3),
        maxPauseSec: +maxPause.toFixed(3),
        pauseCount,
        wallFrames,
        maxDisplacementPx: +maxDisplacement.toFixed(2),
        loopClosed: cat.routeMode === "loop" || cat.routeMode === "regenerate" ? minDistToStart < cell * 1.5 : null,
        reachedEnd: cat.routeMode === "stop" ? minDistToEnd < cell * 1.5 : null,
        turned,
        crossComponent,
        blocked,
        status,
        reason: blocked
          ? "blocked at unreachable waypoint (world model gap)"
          : crossComponent
            ? "cross-component route (portals/hide not fully modeled)"
            : undefined,
        pass: status === "completed",
      });
    });
  }
}

const completed = results.filter((r) => r.status === "completed");
const blockedCases = results.filter((r) => r.status === "blocked");
const failures = results.filter((r) => r.status === "failed");
console.log(
  JSON.stringify(
    {
      cases: results.length,
      completed: completed.length,
      blocked: blockedCases.length,
      failures: failures.length,
      failuresDetail: failures.slice(0, 10),
      blockedCases: [...new Map(blockedCases.map((b) => [`${b.map}:${b.tag}`, b])).values()],
      crossComponentCount: results.filter((r) => r.crossComponent).length,
      sample: results.slice(0, 6),
    },
    null,
    2
  )
);
