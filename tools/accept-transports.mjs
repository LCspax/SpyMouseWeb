// Cross-domain Game acceptance for map575 using REAL pointer input.
// Starts from the level's original mouse start, keeps all candidate transports
// (no coordinate injection, no link filtering), draws every stroke through
// game.onPointerDown/Move/Up, collects all cheese and reaches the exit.
// Candidate pairing is still marked UNVERIFIED; this validates the implemented
// behavior only, not native fidelity.
import fs from "node:fs";
import { Game } from "../src/game.js";

globalThis.window = { devicePixelRatio: 1, addEventListener() {} };
globalThis.Image = class {
  set src(_v) {}
};
const canvas = {
  width: 800,
  height: 600,
  getContext: () => ({}),
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  addEventListener() {},
  removeEventListener() {},
};

const def = JSON.parse(fs.readFileSync("assets/levels/map575.json", "utf8"));
def.mask = JSON.parse(fs.readFileSync(def.mask, "utf8"));
const game = new Game(canvas);
game.loadLevel(def, 0);
game.level.cats = [];
game.timeLeft = null;
game.state = "playing";
const world = game.level.world;
const cell = world.cell;
const n = world.cols * world.rows;

// component labels (4-connected floor)
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
const compOf = (p) => {
  const t = world.nearestOpen(p.x, p.y);
  return comp[t.ty * world.cols + t.tx];
};
const allTransports = game.level.transports.slice();
const compAdj = new Map();
for (const t of allTransports) {
  const ca = compOf(t.aExit);
  const cb = compOf(t.bExit);
  if (ca < 0 || cb < 0 || ca === cb) continue;
  if (!compAdj.has(ca)) compAdj.set(ca, []);
  if (!compAdj.has(cb)) compAdj.set(cb, []);
  compAdj.get(ca).push({ to: cb, edge: t, from: t.aExit });
  compAdj.get(cb).push({ to: ca, edge: t, from: t.bExit });
}

function runUntil(predicate, seconds = 45, dt = 1 / 60) {
  let t = 0;
  while (t < seconds) {
    game.update(dt);
    t += dt;
    if (predicate()) return t;
  }
  return null;
}

// Real pointer tap (short stroke = interaction).
function tapPoint(p) {
  game.onPointerDown(game.worldToScreen(p.x, p.y));
  game.onPointerUp();
}

// Two-tap hole travel fallback (parallel-G1 candidate): while hidden in hole
// A, tapping a same-Tag hole B emerges at B. Used only when the transport
// graph cannot reach the target component.
function hopViaHoles(targetComp, maxHops = 10) {
  const groups = new Map();
  for (const h of game.level.hideables) {
    const k = Math.abs(h.tag ?? 0);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(h);
  }
  const edges = [];
  for (const g of groups.values()) {
    for (const a of g) {
      for (const b of g) {
        if (a === b) continue;
        const ca = compOf(a);
        const cb = compOf(b);
        if (ca < 0 || cb < 0 || ca === cb) continue;
        edges.push({ from: a, to: b, fromComp: ca, toComp: cb, tag: a.tag });
      }
    }
  }
  const hops = [];
  for (let i = 0; i < maxHops; i++) {
    const cur = compOf(game.mouse);
    if (cur === targetComp) return { ok: true, hops };
    const prev = new Map([[cur, null]]);
    const q = [cur];
    let found = null;
    while (q.length && found === null) {
      const c = q.shift();
      for (const e of edges) {
        if (e.fromComp !== c || prev.has(e.toComp)) continue;
        prev.set(e.toComp, e);
        if (e.toComp === targetComp) {
          found = e.toComp;
          break;
        }
        q.push(e.toComp);
      }
    }
    if (found === null) return { ok: false, hops, reason: "no-hole-path" };
    let node = found;
    let edge = null;
    while (prev.get(node)) {
      edge = prev.get(node);
      node = edge.fromComp;
    }
    const dr = walkTo({ x: edge.from.x, y: edge.from.y });
    tapPoint(edge.from);
    const hideSeconds = runUntil(() => game.mouse.hidden, 60);
    const hid = game.mouse.hidden;
    tapPoint(edge.to);
    runUntil(() => !game.mouse.hidden, 10);
    const changed = compOf(game.mouse) !== cur;
    hops.push({
      kind: "hole",
      tag: edge.tag,
      from: { x: edge.from.x, y: edge.from.y },
      to: { x: edge.to.x, y: edge.to.y },
      draw: dr,
      hideSeconds,
      hid,
      landed: changed,
      mouse: { x: +game.mouse.x.toFixed(1), y: +game.mouse.y.toFixed(1) },
    });
    if (!changed) return { ok: false, hops, reason: "hole-hop-failed" };
  }
  return { ok: false, hops, reason: "max-hops" };
}

// Draw one stroke through the real pointer pipeline (no coordinate injection).
function drawStroke(target) {
  const route = world.bfsToWorld(game.mouse.x, game.mouse.y, target.x, target.y);
  if (route == null) return { ok: false, reason: "no-route" };
  const pts = route.length ? route : [target];
  game.onPointerDown(game.worldToScreen(game.mouse.x, game.mouse.y));
  for (const p of pts) game.onPointerMove(game.worldToScreen(p.x, p.y));
  const strokePoints = game.stroke ? game.stroke.points.length : 0;
  game.onPointerUp();
  return { ok: strokePoints >= 2, strokePoints, routeLen: pts.length };
}

// A stroke is capped by the game's trail length, so long routes need several
// strokes (like a player drawing repeatedly). Real pointer input throughout.
function walkTo(target, maxStrokes = 40) {
  const u = game.level.world.cell;
  for (let i = 0; i < maxStrokes; i++) {
    const d = Math.hypot(target.x - game.mouse.x, target.y - game.mouse.y);
    if (d < u * 2) return { ok: true, strokes: i, reason: "arrived" };
    const before = { x: game.mouse.x, y: game.mouse.y };
    const dr = drawStroke(target);
    if (!dr.ok) return { ok: false, strokes: i, reason: dr.reason };
    runUntil(() => game.mouse.cursor >= game.mouse.path.length || game.mouse.hidden, 60);
    if (game.mouse.hidden) return { ok: true, strokes: i + 1, reason: "hidden" };
    const moved = Math.hypot(game.mouse.x - before.x, game.mouse.y - before.y);
    if (moved < u) return { ok: false, strokes: i, reason: "no-progress", d: +d.toFixed(1) };
  }
  return { ok: false, reason: "max-strokes" };
}

// Hop toward a target component using candidate links and real input.
function hopToComponent(targetComp, maxHops = 10) {
  const hops = [];
  for (let i = 0; i < maxHops; i++) {
    const cur = compOf(game.mouse);
    if (cur === targetComp) return { ok: true, hops };
    const prev = new Map([[cur, null]]);
    const q = [cur];
    let found = null;
    while (q.length && found === null) {
      const c = q.shift();
      for (const e of compAdj.get(c) || []) {
        if (prev.has(e.to)) continue;
        prev.set(e.to, { from: c, edge: e });
        if (e.to === targetComp) {
          found = e.to;
          break;
        }
        q.push(e.to);
      }
    }
    if (found === null) return { ok: false, hops, reason: "no-component-path" };
    let node = found;
    let edge = null;
    while (node !== cur) {
      const p = prev.get(node);
      edge = p.edge;
      node = p.from;
    }
    const nextComp = edge.to;
    // All candidate links connecting the current component to the next one on
    // the path, nearest endpoint first. Retry if the nearest-endpoint policy
    // fires a same-component pair first (all links are retained).
    const candidates = allTransports
      .filter((t) => {
        const ca = compOf(t.aExit);
        const cb = compOf(t.bExit);
        return (ca === cur && cb === nextComp) || (cb === cur && ca === nextComp);
      })
      .map((t) => ({
        t,
        from: compOf(t.aExit) === cur ? t.aExit : t.bExit,
        to: compOf(t.aExit) === cur ? t.bExit : t.aExit,
      }))
      .sort(
        (a, b) =>
          Math.hypot(game.mouse.x - a.from.x, game.mouse.y - a.from.y) -
          Math.hypot(game.mouse.x - b.from.x, game.mouse.y - b.from.y)
      );
    if (!candidates.length) return { ok: false, hops, reason: "no-candidate-edge" };
    let landed = false;
    let attempt = 0;
    for (const c of candidates.slice(0, 5)) {
      attempt++;
      const dr = drawStroke(c.from);
      if (!dr.ok) continue;
      runUntil(() => compOf(game.mouse) !== cur || game.state !== "playing", 45);
      const changed = compOf(game.mouse) !== cur;
      let nearest = null;
      for (const t of allTransports) {
        for (const key of ["aExit", "bExit"]) {
          const d = Math.hypot(game.mouse.x - t[key].x, game.mouse.y - t[key].y);
          if (!nearest || d < nearest.d) nearest = { d: +d.toFixed(1), kind: t.kind, tag: t.tag, key };
        }
      }
      hops.push({
        fromComp: cur,
        toComp: compOf(game.mouse),
        kind: c.t.kind,
        tag: c.t.tag,
        attempt,
        landed: changed,
        draw: dr,
        mouse: { x: +game.mouse.x.toFixed(1), y: +game.mouse.y.toFixed(1) },
        target: { x: c.from.x, y: c.from.y },
        nearest,
        cooldown: +game.pipeCooldown.toFixed(2),
        used: game.pipesUsed + game.transportsUsed,
      });
      if (changed) {
        landed = true;
        break;
      }
    }
    if (!landed) return { ok: false, hops, reason: "no-teleport" };
  }
  return { ok: false, hops, reason: "max-hops" };
}

const results = {
  level: def.id,
  pairingEvidence: "flipflap-portal-rule (proven); hole two-tap travel (parallel-G1 candidate)",
  startedFromOriginalStart: true,
  linksRetained: allTransports.length,
  usedPointerInput: true,
  steps: [],
};
const step = (name, ok, detail) => results.steps.push({ name, ok, ...detail });

// 0) confirm the mouse is at the authored start without injection
const startDist = Math.hypot(game.mouse.x - game.level.mouseStart.x, game.mouse.y - game.level.mouseStart.y);
step("original-start", startDist < cell * 2, {
  mouse: { x: +game.mouse.x.toFixed(1), y: +game.mouse.y.toFixed(1) },
  start: game.level.mouseStart,
});

// 1) collect every cheese, hopping with real input
const cheeseResults = [];
for (const cheese of game.level.cheeses) {
  if (cheese.taken) continue;
  const cComp = compOf(cheese);
  if (compOf(game.mouse) !== cComp) {
    let hop = hopToComponent(cComp);
    if (!hop.ok) hop = hopViaHoles(cComp);
    if (!hop.ok) {
      cheeseResults.push({ cheese: { x: cheese.x, y: cheese.y }, ok: false, reason: hop.reason, hop });
      continue;
    }
  }
  // Direct stroke, then try approaching from an open neighbour if the cheese
  // sits in a tight spot (still real pointer input, no coordinate injection).
  let collected = false;
  let mode = "direct";
  const dr = walkTo(cheese);
  runUntil(() => cheese.taken || game.state !== "playing", 45);
  collected = cheese.taken;
  if (!collected) {
    const t = world.nearestOpen(cheese.x, cheese.y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = t.tx + dx;
      const ny = t.ty + dy;
      if (world.isWall(nx, ny)) continue;
      drawStroke({ x: (nx + 0.5) * cell, y: (ny + 0.5) * cell });
      runUntil(() => game.mouse.cursor >= game.mouse.path.length || game.state !== "playing", 45);
      drawStroke(cheese);
      runUntil(() => cheese.taken || game.state !== "playing", 45);
      if (cheese.taken) {
        collected = true;
        mode = `neighbor(${dx},${dy})`;
        break;
      }
    }
  }
  cheeseResults.push({ cheese: { x: cheese.x, y: cheese.y }, ok: collected, taken: cheese.taken, mode, draw: dr });
}
step("collect-all-cheese", game.cheeseLeft === 0, {
  cheeseLeft: game.cheeseLeft,
  results: cheeseResults,
  state: game.state,
});

// 2) reach the exit
if (game.state === "playing" && game.level.exit) {
  const exitComp = compOf(game.level.exit);
  let hop = compOf(game.mouse) === exitComp ? { ok: true, hops: [] } : hopToComponent(exitComp);
  if (!hop.ok) hop = hopViaHoles(exitComp);
  const dr = hop.ok ? walkTo(game.level.exit) : { ok: false, reason: "hop-failed" };
  runUntil(() => game.state !== "playing", 10);
  // The exit can sit in a tight spot; try an open neighbour approach once.
  if (game.state === "playing" && hop.ok) {
    const t = world.nearestOpen(game.level.exit.x, game.level.exit.y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = t.tx + dx;
      const ny = t.ty + dy;
      if (world.isWall(nx, ny)) continue;
      drawStroke({ x: (nx + 0.5) * cell, y: (ny + 0.5) * cell });
      runUntil(() => game.mouse.cursor >= game.mouse.path.length || game.state !== "playing", 45);
      drawStroke(game.level.exit);
      runUntil(() => game.state !== "playing", 10);
      if (game.state !== "playing") break;
    }
  }
  step("reach-exit", game.state === "levelclear", {
    reached: dr.ok,
    state: game.state,
    position: { x: +game.mouse.x.toFixed(1), y: +game.mouse.y.toFixed(1) },
    exit: game.level.exit,
    hop,
    draw: dr,
  });
} else {
  step("reach-exit", false, { reason: "game not playing or no exit" });
}

results.fullCrossDomainPass = results.steps.every((s) => s.ok) && game.state === "levelclear";
results.partial = {
  cheeseCollected: game.level.cheeses.length - game.cheeseLeft,
  cheeseTotal: game.level.cheeses.length,
  exitReached: game.state === "levelclear",
  state: game.state,
};
results.limitation =
  "Transports use the proven flipflap-portal rule; the C1/C2/C3 rooms are reached through the parallel-G1 two-tap hole travel, " +
  "whose scan reference (touch point vs hidden player) is not runtime-confirmed. Cats are removed to isolate navigation; " +
  "left rooms L1/L2/L3 and alcove A1 remain outside the colour walkmask (art/XML say they are floor) and are not exercised.";
results.pass = results.fullCrossDomainPass;
console.log(JSON.stringify(results, null, 2));
