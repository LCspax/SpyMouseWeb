// Read-only acceptance evidence for 1-3 (map704):
//  - route geometry / mode / direction / period / endpoint pause of the web cats
//  - vision-cone display conditions for normal / blind / ghost cats
// Writes JSON evidence to stdout. Does not modify assets.
import fs from "node:fs";
import path from "node:path";
import { Level } from "../src/level.js";
import { Game } from "../src/game.js";
import { CFG } from "../src/config.js";

const def = JSON.parse(fs.readFileSync("assets/levels/map704.json", "utf8"));
def.mask = JSON.parse(fs.readFileSync(def.mask, "utf8"));
const lvl = new Level(def);
const world = lvl.world;

function segLen(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const cats = lvl.cats.map((c, ci) => {
  let len = 0;
  for (let i = 0; i < c.route.length - 1; i++) len += segLen(c.route[i], c.route[i + 1]);
  if (c.routeMode === "loop") len += segLen(c.route[c.route.length - 1], c.route[0]);
  const speed = c.patrolSpeed;
  // Native endpoint pause (follower 0x9fe70-0x9fe7c / 0xa01a4) is the last
  // waypoint's wait (0 here); there is no default 0.4s pause.
  const endpointPause = c.routeMode === "loop" ? 0 : c.route[c.route.length - 1].wait || 0;
  const period = c.routeMode === "loop" ? len / speed : (2 * len) / speed + 2 * endpointPause;

  let wallPoints = 0;
  let wallSegments = 0;
  const segs = [];
  for (let i = 0; i < c.route.length - 1; i++) segs.push([c.route[i], c.route[i + 1]]);
  if (c.routeMode === "loop") segs.push([c.route[c.route.length - 1], c.route[0]]);
  for (const p of c.route) if (world.isWallAt(p.x, p.y)) wallPoints++;
  for (const [a, b] of segs) if (!world.lineClear(a.x, a.y, b.x, b.y)) wallSegments++;

  const initialAngleDeg = +((c.angle * 180) / Math.PI).toFixed(2);

  // simulate ~3 cycles with dt = 1/60, far-away mouse so nothing triggers
  const far = { x: -9999, y: -9999 };
  const dt = 1 / 60;
  let wallHits = 0;
  const reversals = [];
  const loopMarks = [];
  let prevDir = c.routeDir;
  let prevIndex = c.routeIndex;
  const T = Math.max(period * 3 + 5, 10);
  for (let t = 0; t < T; t += dt) {
    c.update(dt, lvl.catWorld || world, far);
    if (world.circleHitsWall(c.x, c.y, c.radius * 0.8)) wallHits++;
    if (c.routeMode === "loop" && c.routeIndex < prevIndex) loopMarks.push(t);
    prevIndex = c.routeIndex;
    if (c.routeDir !== prevDir) {
      reversals.push({ t, dir: c.routeDir });
      prevDir = c.routeDir;
    }
  }
  let measuredPeriod = null;
  if (c.routeMode === "loop" && loopMarks.length >= 2) measuredPeriod = loopMarks[1] - loopMarks[0];
  if (c.routeMode !== "loop" && reversals.length >= 3) measuredPeriod = reversals[2].t - reversals[0].t;

  return {
    index: ci,
    prop: c.prop,
    type: c.type,
    mode: c.routeMode,
    source: c.routeSource,
    points: c.route.length,
    routeLengthPx: +len.toFixed(2),
    wallPoints,
    wallSegments,
    speedPxPerSec: +speed.toFixed(2),
    expectedPeriodSec: +period.toFixed(2),
    measuredPeriodSec: measuredPeriod == null ? null : +measuredPeriod.toFixed(2),
    firstWaypoint: c.route[0],
    initialAngleDeg,
    finalAngleDeg: +((c.angle * 180) / Math.PI).toFixed(2),
    sim: { seconds: +T.toFixed(2), wallHits, reversals: reversals.slice(0, 8).map((v) => +v.t.toFixed(2)) },
  };
});

// ---- native cat indicator checks (parallel-N3) ---------------------------
// The native engine never draws a cone for ordinary cats; only the prop-53
// bosscat art class draws one (radius 150, arc = cat_vision_arc, 5-degree
// steps, no raycast). Ordinary cats use transient billboards instead.
function fakeCtx() {
  const rec = { beginPath: 0, fill: 0, stroke: 0, rayAngles: [], sprites: [], lineTo: 0 };
  return {
    rec,
    beginPath() { rec.beginPath++; },
    moveTo() {},
    lineTo() { rec.lineTo++; },
    closePath() {},
    fill() { rec.fill++; },
    stroke() { rec.stroke++; },
    save() {},
    restore() {},
    set strokeStyle(v) { rec.strokeStyle = v; },
    set fillStyle(v) { rec.fillStyle = v; },
    set lineWidth(v) {},
    set globalAlpha(v) {},
    set font(v) {},
    set textAlign(v) {},
    fillText() {},
  };
}
function fakeSprites(rec) {
  return {
    frame(ctx, key) {
      rec.sprites.push(key);
      return true;
    },
  };
}
function fakeWorld(rec) {
  return {
    cell: 16,
    rayDistance(x, y, a, max) { rec.rayAngles.push(a); return max; },
  };
}
function indicatorCase(name, cat, stroke) {
  const ctx = fakeCtx();
  const world = fakeWorld(ctx.rec);
  const self = {
    stroke: stroke ? { points: [] } : null,
    level: { world, cats: [cat] },
    time: 0,
    sprites: fakeSprites(ctx.rec),
  };
  Game.prototype.drawCatIndicators.call(self, ctx, 16);
  const angles = ctx.rec.rayAngles;
  const span = angles.length ? (Math.max(...angles) - Math.min(...angles)) * (180 / Math.PI) : 0;
  return {
    name,
    fills: ctx.rec.fill,
    strokes: ctx.rec.stroke,
    rayCalls: angles.length,
    coneSpanDeg: +span.toFixed(1),
    sprites: ctx.rec.sprites,
    coneVertices: ctx.rec.lineTo,
  };
}
const mkCat = (over) =>
  Object.assign(
    { x: 0, y: 0, angle: 0, state: "patrol", type: 0, blind: false, ghost: false, radius: 6.4, range: CFG.cat.rangeCells * 16 },
    over
  );
const vision = [
  indicatorCase("ordinary-idle", mkCat({}), false),
  indicatorCase("ordinary-planning-stroke", mkCat({}), true),
  indicatorCase("ordinary-spot", mkCat({ state: "spot" }), false),
  indicatorCase("ordinary-chase", mkCat({ state: "chase" }), false),
  indicatorCase("ordinary-return", mkCat({ state: "return" }), false),
  indicatorCase("ghost-spot", mkCat({ type: 5, ghost: true, state: "spot" }), false),
  indicatorCase("blind-planning", mkCat({ type: 4, blind: true }), true),
  indicatorCase("bosscat-cone", mkCat({ type: 3 }), false),
];

// ---- real-World occlusion / discovery -----------------------------------
const baseCat = lvl.cats[0];
const probe = Object.assign(Object.create(Object.getPrototypeOf(baseCat)), {
  x: baseCat.x,
  y: baseCat.y,
  angle: baseCat.angle,
  range: baseCat.range,
  cell: world.cell,
  blind: false,
  ghost: false,
  state: "patrol",
});
const half = CFG.cat.fov / 2;
let blockedPair = null;
let clearPair = null;
for (let da = -half; da <= half; da += Math.PI / 36) {
  const a = baseCat.angle + da;
  for (let d = 16; d <= probe.range; d += 16) {
    const mx = baseCat.x + Math.cos(a) * d;
    const my = baseCat.y + Math.sin(a) * d;
    if (world.isWallAt(mx, my)) continue;
    const lineClear = world.lineClear(baseCat.x, baseCat.y, mx, my);
    const sees = probe.canSeeMouse({ x: mx, y: my }, world);
    if (!lineClear && !blockedPair) {
      blockedPair = {
        angleDeg: +((a * 180) / Math.PI).toFixed(1),
        distPx: d,
        lineClear,
        canSeeMouse: sees,
        rayDistancePx: +world.rayDistance(baseCat.x, baseCat.y, a, probe.range).toFixed(1),
      };
    }
    if (lineClear && sees && !clearPair) {
      clearPair = {
        angleDeg: +((a * 180) / Math.PI).toFixed(1),
        distPx: d,
        lineClear,
        canSeeMouse: sees,
        rayDistancePx: +world.rayDistance(baseCat.x, baseCat.y, a, probe.range).toFixed(1),
      };
    }
    if (blockedPair && clearPair) break;
  }
  if (blockedPair && clearPair) break;
}

// Native check on the real world: an ordinary cat draws NO cone and performs
// NO raycast, whatever the state (planning stroke included).
function indicatorRealAt(x, y, angle) {
  probe.x = x;
  probe.y = y;
  probe.angle = angle;
  probe.type = 0;
  const ctx = fakeCtx();
  const origRay = world.rayDistance.bind(world);
  const rays = [];
  world.rayDistance = (px, py, a, max) => {
    const v = origRay(px, py, a, max);
    rays.push(v);
    return v;
  };
  Game.prototype.drawCatIndicators.call(
    { stroke: { points: [] }, time: 0, level: { world, cats: [probe] }, sprites: fakeSprites(ctx.rec) },
    ctx,
    world.cell
  );
  world.rayDistance = origRay;
  return {
    fills: ctx.rec.fill,
    rayCount: rays.length,
    sprites: ctx.rec.sprites,
  };
}
const coneReal = Object.assign({ position: { x: baseCat.x, y: baseCat.y } }, indicatorRealAt(baseCat.x, baseCat.y, baseCat.angle));

console.log(JSON.stringify({
  level: def.id,
  num: def.num,
  cats,
  vision,
  visionOcclusion: { blockedPair, clearPair, coneReal },
  config: { catFovDeg: +((CFG.cat.fov * 180) / Math.PI).toFixed(1), catRangeCells: CFG.cat.rangeCells },
}, null, 2));
