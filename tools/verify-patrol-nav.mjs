// Verification for the shared navigation fix (src/entities.js).
// Covers: dt robustness, endpoint pauses, chase -> return -> patrol, obstacle
// avoidance. Read-only; no asset changes. Prints JSON evidence.
import fs from "node:fs";
import { Level } from "../src/level.js";

const def = JSON.parse(fs.readFileSync("assets/levels/map704.json", "utf8"));
def.mask = JSON.parse(fs.readFileSync(def.mask, "utf8"));

function fresh() {
  const d = JSON.parse(JSON.stringify(def));
  d.mask = def.mask;
  return new Level(d);
}

function wallHits(level, cat) {
  return level.world.circleHitsWall(cat.x, cat.y, cat.radius) ? 1 : 0;
}

const dtResults = [];
for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
  const level = fresh();
  level.cats.forEach((cat, index) => {
    const initialAngleDeg = (cat.angle * 180) / Math.PI;
    const far = { x: -9999, y: -9999 };
    let walls = 0;
    let endpointFrames = 0;
    let unintended = 0;
    let oldIndex = cat.routeIndex;
    let oldDir = cat.routeDir;
    const marks = [];
    const frames = Math.round(120 / dt);
    for (let f = 0; f < frames; f++) {
      const bx = cat.x, by = cat.y;
      cat.update(dt, level.world, far);
      if (level.world.circleHitsWall(cat.x, cat.y, cat.radius)) walls++;
      if (cat.endpointTimer > 0) endpointFrames++;
      if (
        Math.hypot(cat.x - bx, cat.y - by) < 1e-8 &&
        !cat.navPath &&
        cat.repathTimer > 0 &&
        cat.endpointTimer <= 0
      ) unintended++;
      if (cat.routeMode === "loop" ? cat.routeIndex < oldIndex : cat.routeDir !== oldDir) {
        marks.push(f * dt);
      }
      oldIndex = cat.routeIndex;
      oldDir = cat.routeDir;
    }
    const stride = cat.routeMode === "loop" ? 1 : 2;
    const periods = marks.slice(stride).map((t, i) => +(t - marks[i]).toFixed(3));
    dtResults.push({
      dt: +dt.toFixed(5),
      index,
      mode: cat.routeMode,
      initialAngleDeg: +initialAngleDeg.toFixed(2),
      periodsSec: periods.slice(0, 3),
      wallFrames: walls,
      unintendedWaitFrames: unintended,
      endpointFrames,
    });
  });
}

// chase -> lose -> return -> patrol
function chaseReturnCase(index) {
  const level = fresh();
  const cat = level.cats[index];
  const world = level.world;
  // Put the mouse in front of the cat until it is actually visible.
  let mouse = null;
  const fovHalf = Math.PI / 2 - 0.1;
  for (let aofs = 0; aofs <= fovHalf && !mouse; aofs += Math.PI / 24) {
    for (const sign of [1, -1]) {
      for (let d = 24; d <= cat.range; d += 8) {
        const a = cat.angle + aofs * sign;
        const mx = cat.x + Math.cos(a) * d;
        const my = cat.y + Math.sin(a) * d;
        if (world.isWallAt(mx, my)) continue;
        if (!world.lineClear(cat.x, cat.y, mx, my)) continue;
        if (cat.canSeeMouse({ x: mx, y: my }, world)) {
          mouse = { x: mx, y: my };
          break;
        }
      }
      if (mouse) break;
    }
  }
  const far = { x: -9999, y: -9999 };
  const dt = 1 / 60;
  let sawChase = false;
  let sawReturn = false;
  let walls = 0;
  let t = 0;
  if (mouse) {
    for (; t < 8; t += dt) {
      cat.update(dt, level.catWorld || world, mouse);
      if (world.circleHitsWall(cat.x, cat.y, cat.radius)) walls++;
      if (cat.state === "chase" || cat.state === "spot" || cat.state === "pounceWait" || cat.state === "pounceRun") sawChase = true;
      if (sawChase && cat.state === "return") { sawReturn = true; break; }
    }
    for (; t < 20; t += dt) {
      cat.update(dt, level.catWorld || world, far);
      if (world.circleHitsWall(cat.x, cat.y, cat.radius)) walls++;
      if (cat.state === "return") sawReturn = true;
      if (sawReturn && cat.state === "patrol") break;
    }
  }
  return { index, foundVisibleMouse: !!mouse, sawChase, sawReturn, backToPatrol: cat.state === "patrol", wallFrames: walls, finalState: cat.state };
}

// obstacle avoidance: goal behind the central obstacle
function obstacleCase(index) {
  const level = fresh();
  const cat = level.cats[index];
  const world = level.world;
  let goal = null;
  for (let ty = 0; ty < world.rows && !goal; ty++) {
    for (let tx = 0; tx < world.cols; tx++) {
      const gx = (tx + 0.5) * world.cell;
      const gy = (ty + 0.5) * world.cell;
      if (world.isWallAt(gx, gy)) continue;
      const d = Math.hypot(gx - cat.x, gy - cat.y);
      if (d < world.cell * 6 || d > world.cell * 40) continue;
      if (world.lineClear(cat.x, cat.y, gx, gy)) continue;
      if (!world.bfsToWorld(cat.x, cat.y, gx, gy)) continue;
      goal = { x: gx, y: gy };
      break;
    }
  }
  const dt = 1 / 60;
  let walls = 0;
  let minDist = Infinity;
  const startDist = goal ? Math.hypot(goal.x - cat.x, goal.y - cat.y) : null;
  const blockedLine = goal ? !world.lineClear(cat.x, cat.y, goal.x, goal.y) : null;
  const routeExists = goal ? !!world.bfsToWorld(cat.x, cat.y, goal.x, goal.y) : null;
  if (goal) {
    cat.navPath = null;
    for (let t = 0; t < 10; t += dt) {
      // Exercise the shared navigate() directly so the cat must route around
      // the blocking obstacle with grid BFS.
      cat.navigate(dt, world, goal, cat.chaseSpeed, 0.25);
      if (world.circleHitsWall(cat.x, cat.y, cat.radius)) walls++;
      minDist = Math.min(minDist, Math.hypot(goal.x - cat.x, goal.y - cat.y));
    }
  }
  return {
    index,
    goalFound: !!goal,
    blockedLine,
    routeExists,
    startDist: startDist == null ? null : +startDist.toFixed(1),
    minDist: minDist === Infinity ? null : +minDist.toFixed(1),
    reached: minDist !== Infinity && minDist <= world.cell * 1.5,
    wallFrames: walls,
  };
}

console.log(JSON.stringify({ dtResults, chaseReturn: [chaseReturnCase(0), chaseReturnCase(1)], obstacle: [obstacleCase(0), obstacleCase(1)] }, null, 2));
