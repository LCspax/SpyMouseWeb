import fs from "fs";
import path from "path";
import { Level } from "../src/level.js";
import { World } from "../src/world.js";
import { Mouse } from "../src/entities.js";
import { LEVELS as ASCII } from "../src/levels.js";

function snapAll(def, world) {
  const snap = (p) => world.closestOpen(p.x, p.y);
  if (def.mouseStart) def.mouseStart = snap(def.mouseStart);
  if (def.exit) def.exit = snap(def.exit);
  if (def.cheeses) def.cheeses = def.cheeses.map(snap);
  if (def.cats)
    for (const c of def.cats) {
      const s = snap(c);
      c.x = s.x;
      c.y = s.y;
      if (c.route) c.route = c.route.map(snap);
    }
}

// Connectivity check for multi-room levels: walkable components plus the
// teleport links (mouse holes, pipes, pipe pieces). This does not simulate
// movement; it verifies that every entity is reachable from the start.
function transportReach(world, start, transports) {
  const n = world.cols * world.rows;
  const comp = new Int32Array(n).fill(-1);
  const comps = [];
  for (let i = 0; i < n; i++) {
    const tx = i % world.cols;
    const ty = (i / world.cols) | 0;
    if (comp[i] !== -1 || world.isWall(tx, ty)) continue;
    const id = comps.length;
    const cells = [i];
    const stack = [i];
    comp[i] = id;
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
        comp[ni] = id;
        stack.push(ni);
        cells.push(ni);
      }
    }
    comps.push(cells);
  }
  const adj = new Map();
  for (const t of transports) {
    const ta = world.nearestOpen(t.aExit.x, t.aExit.y);
    const tb = world.nearestOpen(t.bExit.x, t.bExit.y);
    const ca = comp[ta.ty * world.cols + ta.tx];
    const cb = comp[tb.ty * world.cols + tb.tx];
    if (ca < 0 || cb < 0 || ca === cb) continue;
    if (!adj.has(ca)) adj.set(ca, new Set());
    if (!adj.has(cb)) adj.set(cb, new Set());
    adj.get(ca).add(cb);
    adj.get(cb).add(ca);
  }
  const s = world.nearestOpen(start.x, start.y);
  const startComp = comp[s.ty * world.cols + s.tx];
  const seen = new Set([startComp]);
  const q = [startComp];
  while (q.length) {
    const c = q.pop();
    for (const nb of adj.get(c) || []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        q.push(nb);
      }
    }
  }
  return (p) => {
    const t = world.nearestOpen(p.x, p.y);
    const ci = comp[t.ty * world.cols + t.tx];
    return ci >= 0 && seen.has(ci);
  };
}

// Two-tap hole travel (parallel-G1, candidate): while hidden in hole A, a tap
// on a same-Tag hole B pops the mouse out at B. Every member of a Tag group is
// therefore reachable from any other member.
function holeLinks(hideables) {
  const groups = new Map();
  for (const h of hideables || []) {
    const k = Math.abs(h.tag ?? 0);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(h);
  }
  const links = [];
  for (const g of groups.values()) {
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++)
        links.push({
          aExit: { x: g[i].x, y: g[i].y },
          bExit: { x: g[j].x, y: g[j].y },
          kind: "hole",
          tag: g[i].tag,
          pairingEvidence: "g1-two-tap-candidate",
        });
  }
  return links;
}

function routeThrough(world, points) {
  const out = [];
  let cur = world.nearestOpen(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const to = world.nearestOpen(points[i].x, points[i].y);
    const seg = world.bfs(cur.tx, cur.ty, to.tx, to.ty);
    if (!seg) return null;
    for (const p of seg) out.push(p);
    cur = to;
  }
  return out;
}

function simulate(name, def) {
  const errs = [];
  const lvl = new Level(def);
  const world = lvl.world;

  if (!lvl.mouseStart) errs.push("no mouse start");
  if (!lvl.exit) errs.push("no exit");
  // Native levels may have no authored cheese (completion is the home hole).

  // Multi-room levels connected by mouse holes/pipes: verify component
  // connectivity through the teleport links instead of a single BFS route.
  const holes = holeLinks(lvl.hideables);
  if (lvl.transports.length || holes.length) {
    const reach = transportReach(world, lvl.mouseStart, [...lvl.transports, ...holes]);
    if (!reach(lvl.mouseStart)) errs.push("start unreachable via transports");
    for (const c of lvl.cheeses) if (!reach(c)) errs.push("cheese unreachable via transports");
    for (const c of lvl.cats) if (!reach(c)) errs.push("cat unreachable via transports");
    if (lvl.exit && !reach(lvl.exit)) errs.push("exit unreachable via transports");
    const tag = `${name}`;
    if (errs.length) {
      console.log(`FAIL ${tag} (${def.id})`);
      errs.forEach((e) => console.log("   - " + e));
      return 1;
    }
    const unverified = lvl.transports.filter((t) => t.pairingEvidence === "unverified").length;
    console.log(
      `ok   ${tag} (transports: ${lvl.transports.length} links, ${unverified} UNVERIFIED pairing; hole links: ${holes.length} G1-candidate)`
    );
    return 0;
  }

  const smooth = routeThrough(world, [
    { x: lvl.mouseStart.x, y: lvl.mouseStart.y },
    ...lvl.cheeses.map((c) => ({ x: c.x, y: c.y })),
    lvl.exit ? { x: lvl.exit.x, y: lvl.exit.y } : { x: lvl.mouseStart.x, y: lvl.mouseStart.y },
  ]);

  let reached = false;
  let caughtFrames = 0;
  if (smooth) {
    const mouse = new Mouse(lvl.mouseStart.x, lvl.mouseStart.y, 0, world);
    mouse.setPath(smooth);
    const dt = 1 / 60;
    let t = 0;
    while (t < 400) {
      t += dt;
      mouse.update(dt, world);
      if (world.circleHitsWall(mouse.x, mouse.y, 0.5)) {
        errs.push("mouse entered a wall");
        break;
      }
      for (const c of lvl.cats) c.update(dt, lvl.catWorld || world, mouse);
      for (const ch of lvl.cheeses)
        if (!ch.taken && Math.hypot(ch.x - mouse.x, ch.y - mouse.y) < world.cell * 0.7) ch.taken = true;
      for (const c of lvl.cats)
        if (Math.hypot(c.x - mouse.x, c.y - mouse.y) < c.catchDist + mouse.radius) caughtFrames++;
      const left = lvl.cheeses.filter((c) => !c.taken).length;
      if (left === 0 && lvl.exit && Math.hypot(lvl.exit.x - mouse.x, lvl.exit.y - mouse.y) < world.cell * 0.6) {
        reached = true;
        break;
      }
      if (mouse.cursor >= mouse.path.length) break;
    }
  } else {
    errs.push("no BFS route");
  }

  if (!reached) errs.push("did not reach exit");
  const tag = `${name}`;
  if (errs.length) {
    console.log(`FAIL ${tag} (${def.id})`);
    errs.forEach((e) => console.log("   - " + e));
    return 1;
  }
  console.log(
    `ok   ${tag}  (${world.cols}x${world.rows} cell=${world.cell}, ${lvl.cheeses.length} cheese, ${lvl.cats.length} cats)`
  );
  return 0;
}

let bad = 0;

console.log("--- built-in ASCII levels ---");
for (const def of ASCII) bad += simulate(def.name, def);

console.log("\n--- imported levels ---");
const levelsDir = path.resolve("assets/levels");
if (fs.existsSync(levelsDir)) {
  for (const f of fs.readdirSync(levelsDir)) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    const def = JSON.parse(fs.readFileSync(path.join(levelsDir, f), "utf8"));
    if (def.mask) {
      const mask = JSON.parse(fs.readFileSync(path.resolve(def.mask), "utf8"));
      snapAll(def, World.fromMask(mask));
      def.mask = mask;
    }
    bad += simulate(`${def.num || ""} ${def.name || f}`, def);
  }
} else {
  console.log("(no assets/levels)");
}

console.log(bad ? `\n${bad} failed` : "\nAll levels passed");
process.exit(bad ? 1 : 0);







