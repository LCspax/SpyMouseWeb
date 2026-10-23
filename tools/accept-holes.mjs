// Cross-domain Game acceptance for the hole two-tap travel mechanic (map575)
// using REAL pointer input. The mechanic is evidence-backed by parallel-G1
// disassembly (0xb8e00 tag assignment, 0xdbbd4 same-Tag scan, 0x9e990 facing
// placement) but the scan reference is still unverified; this validates the
// implemented behavior, not native equivalence.
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
const catCount = game.level.cats.length;
game.level.cats = [];
game.timeLeft = null;
game.state = "playing";
const world = game.level.world;
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
const compOf = (p) => {
  const t = world.nearestOpen(p.x, p.y);
  return comp[t.ty * world.cols + t.tx];
};

function runUntil(predicate, seconds = 60, dt = 1 / 60) {
  let t = 0;
  while (t < seconds) {
    game.update(dt);
    t += dt;
    if (predicate()) return +t.toFixed(2);
  }
  return null;
}

// Real pointer pipeline: a short stroke is a tap (interaction).
function tap(worldPoint) {
  const s = game.worldToScreen(worldPoint.x, worldPoint.y);
  game.onPointerDown(s);
  game.onPointerUp();
}

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

// Long routes exceed the per-stroke trail cap; draw several strokes.
function walkTo(target, maxStrokes = 40) {
  const u = world.cell;
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

const hole = (id) => game.level.hideables.find((h) => h.id === id);
const results = {
  level: def.id,
  mechanicEvidence: "parallel-G1: 0xb8e00 tag assignment, 0xdbbd4 same-Tag scan, 0x9e990 facing placement",
  unverified: "scan reference (touch point vs hidden player) not runtime-confirmed",
  usedPointerInput: true,
  catsRemovedForNavigation: catCount,
  importedCounts: {
    cheese: def.cheeses.length,
    cats: catCount,
    exit: def.exit ? 1 : 0,
    hideables: game.level.hideables.length,
    dropped: def.diagnostics?.droppedUnreachable,
  },
  steps: [],
};
const step = (name, ok, detail) => results.steps.push({ name, ok, ...detail });

const startComp = compOf(game.mouse);
step("original-start", Math.hypot(game.mouse.x - game.level.mouseStart.x, game.mouse.y - game.level.mouseStart.y) < cell * 2, {
  mouse: { x: +game.mouse.x.toFixed(1), y: +game.mouse.y.toFixed(1) },
  component: startComp,
});

// 1) tap hole 852 (tag1, start pocket C4) -> walk there and hide
const h852 = hole(852);
tap({ x: h852.x, y: h852.y });
const hide1 = runUntil(() => game.mouse.hidden, 60);
step("hide-at-hole-852", game.mouse.hidden, {
  hidden: game.mouse.hidden,
  hiddenTag: game.mouse.hiddenTag,
  seconds: hide1,
  component: compOf(game.mouse),
});

// 2) while hidden, tap hole 873 (tag1, main area C0) -> emerge there
const h873 = hole(873);
const c873 = compOf(h873);
tap({ x: h873.x, y: h873.y });
const emerge1 = runUntil(() => !game.mouse.hidden, 10);
const landedComp = compOf(game.mouse);
step("travel-852-to-873", !game.mouse.hidden && landedComp === c873 && landedComp !== startComp, {
  hidden: game.mouse.hidden,
  seconds: emerge1,
  mouse: { x: +game.mouse.x.toFixed(1), y: +game.mouse.y.toFixed(1) },
  component: landedComp,
  targetComponent: c873,
});

// 3) walk to hole 978 (tag2, C0), hide, then tap hole 979 (tag2, C1) -> emerge
const h978 = hole(978);
const dr978 = drawStroke({ x: h978.x, y: h978.y });
const arrive978 = runUntil(() => game.mouse.cursor >= game.mouse.path.length || game.mouse.hidden, 60);
tap({ x: h978.x, y: h978.y });
const hide2 = runUntil(() => game.mouse.hidden, 60);
step("hide-at-hole-978", game.mouse.hidden, {
  hidden: game.mouse.hidden,
  hiddenTag: game.mouse.hiddenTag,
  draw: dr978,
  arrive: arrive978,
  seconds: hide2,
});

const h979 = hole(979);
const c979 = compOf(h979);
tap({ x: h979.x, y: h979.y });
const emerge2 = runUntil(() => !game.mouse.hidden, 10);
const c1Comp = compOf(game.mouse);
step("travel-978-to-979", !game.mouse.hidden && c1Comp === c979, {
  hidden: game.mouse.hidden,
  seconds: emerge2,
  mouse: { x: +game.mouse.x.toFixed(1), y: +game.mouse.y.toFixed(1) },
  component: c1Comp,
  targetComponent: c979,
});

// 4) traverse room C1. Its old 'cheese' (id 989) is prop 11 (cwmouse, not
// cheese - parallel-K2), so verify the room is walkable to its far corner
// instead of collecting a fabricated pickup.
const c1Target = { x: 6104, y: 312 };
const walkC1 = walkTo(c1Target);
step("walk-in-C1", walkC1.ok, {
  target: c1Target,
  mouse: { x: +game.mouse.x.toFixed(1), y: +game.mouse.y.toFixed(1) },
  walk: walkC1,
  state: game.state,
});

results.pass = results.steps.every((s) => s.ok);
results.limitation =
  "Cats are removed to isolate navigation. The two-tap hole travel is evidence-backed (G1) but not runtime-confirmed against the native build; " +
  "left rooms L1/L2/L3 and alcove A1 remain outside the colour walkmask (art/XML say they are floor) and are not exercised here.";
console.log(JSON.stringify(results, null, 2));
