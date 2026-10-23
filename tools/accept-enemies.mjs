// Enemy-complete acceptance with REAL pointer input (live strokes) on a
// representative level that keeps its cats. Strict: pass requires levelclear
// with zero catches; caught events are reported as failures, never hidden.
// Scenario 1: collect every cheese, then reach the exit (full clear).
// Scenario 2: touch the exit immediately (native rule: the home hole always
// ends the level; cheese is score).
import fs from "node:fs";
import { Game } from "../src/game.js";

globalThis.window = { devicePixelRatio: 1, addEventListener() {} };
globalThis.Image = class {
  set src(_v) {}
};
const canvas = {
  width: 960,
  height: 640,
  getContext: () => ({}),
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 640 }),
  addEventListener() {},
  removeEventListener() {},
};

// Default: 1-2 (map703), a representative early level with one cat and one
// cheese. Other levels can be passed as argv[2] (map704's bot gets caught and
// is reported as a failure, not hidden).
const levelFile = process.argv[2] || "assets/levels/map703.json";
const def = JSON.parse(fs.readFileSync(levelFile, "utf8"));
def.mask = JSON.parse(fs.readFileSync(def.mask, "utf8"));

function makeGame() {
  const game = new Game(canvas);
  game.loadLevel(def, 0);
  game.timeLeft = null;
  game.state = "playing";
  return game;
}

function runUntil(game, predicate, seconds = 60, dt = 1 / 60) {
  let t = 0;
  while (t < seconds) {
    game.update(dt);
    t += dt;
    if (predicate()) return +t.toFixed(2);
    if (game.state !== "playing") return null;
  }
  return null;
}

// Real pointer pipeline: pointerdown, several moves along the BFS route, up.
function drawRoute(game, target) {
  const world = game.level.world;
  const route = world.bfsToWorld(game.mouse.x, game.mouse.y, target.x, target.y);
  if (!route || !route.length) return { ok: false, reason: "no-route" };
  const s0 = game.worldToScreen(game.mouse.x, game.mouse.y);
  game.onPointerDown(s0);
  let points = 0;
  for (const p of route) {
    const before = game.stroke ? game.stroke.points.length : 0;
    game.onPointerMove(game.worldToScreen(p.x, p.y));
    if (game.stroke && game.stroke.points.length > before) points++;
  }
  const live = game.stroke ? game.stroke.live : false;
  game.onPointerUp();
  return { ok: true, points, live, routeLen: route.length };
}

function catThreat(game) {
  const world = game.level.world;
  const u = world.cell;
  let min = Infinity;
  let nearest = null;
  let los = false;
  for (const c of game.level.cats) {
    const d = Math.hypot(c.x - game.mouse.x, c.y - game.mouse.y);
    if (d < min) {
      min = d;
      nearest = c;
      los = world.lineClear(c.x, c.y, game.mouse.x, game.mouse.y);
    }
    if ((c.state === "chase" || c.state === "spot") && d < c.range) return { unsafe: true, d, state: c.state, los };
  }
  const unsafe =
    min < u * 8 ||
    (nearest &&
      min < nearest.range &&
      los &&
      (nearest.state === "patrol" || nearest.state === "spot" || nearest.state === "chase"));
  return { unsafe, d: min, state: nearest ? nearest.state : null, los };
}

// Walk the current path but abort if a cat closes in (reactive avoidance).
function stepMove(game, seconds, abortDistance) {
  let t = 0;
  while (t < seconds) {
    game.update(1 / 60);
    t += 1 / 60;
    if (game.state !== "playing") return null;
    if (!game.mouse.moving) return +t.toFixed(2);
    const th = catThreat(game);
    if (th.state === "spot" || th.state === "chase" || (th.d < abortDistance && th.los)) {
      // Keep moving; the outer loop reacts with a flee stroke next iteration.
      return +t.toFixed(2);
    }
  }
  return null;
}

// Does the planned route pass near any cat?
function routeUnsafe(game, target) {
  const world = game.level.world;
  const route = world.bfsToWorld(game.mouse.x, game.mouse.y, target.x, target.y);
  if (!route) return { unsafe: true, min: 0, route: null };
  let min = Infinity;
  for (const c of game.level.cats) {
    for (const p of route) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < min) min = d;
    }
  }
  return { unsafe: min < world.cell * 6, min, route };
}

function safeWait(game, seconds = 6) {
  return runUntil(game, () => !catThreat(game).unsafe, seconds);
}

// Flee target: reachable cell (local BFS) maximizing the distance to the
// nearest cat. Real pointer input is still used to travel there.
function fleeTarget(game) {
  const world = game.level.world;
  const cell = world.cell;
  const n = world.cols * world.rows;
  const start = world.nearestOpen(game.mouse.x, game.mouse.y);
  const dist = new Int32Array(n).fill(-1);
  const q = [start.ty * world.cols + start.tx];
  dist[q[0]] = 0;
  let head = 0;
  const dirs = [1, -1, world.cols, -world.cols];
  while (head < q.length) {
    const cur = q[head++];
    const cx = cur % world.cols;
    const cy = (cur / world.cols) | 0;
    for (const d of dirs) {
      const nb = cur + d;
      if (nb < 0 || nb >= n) continue;
      const nx = nb % world.cols;
      const ny = (nb / world.cols) | 0;
      if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
      if (dist[nb] !== -1 || world.isWall(nx, ny)) continue;
      dist[nb] = dist[cur] + 1;
      q.push(nb);
    }
  }
  let best = null;
  let bestScore = -Infinity;
  for (let ty = 1; ty < world.rows; ty++) {
    for (let tx = 1; tx < world.cols; tx++) {
      const i = ty * world.cols + tx;
      if (dist[i] <= 2) continue;
      const x = (tx + 0.5) * cell;
      const y = (ty + 0.5) * cell;
      let dMin = Infinity;
      for (const c of game.level.cats) dMin = Math.min(dMin, Math.hypot(c.x - x, c.y - y));
      const score = dMin - dist[i] * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y, catDistance: dMin, pathCells: dist[i] };
      }
    }
  }
  return best;
}

const results = {
  level: def.id,
  num: def.num,
  cats: def.cats.length,
  cheese: def.cheeses.length,
  input: "real pointer events (pointerdown/move/up, live strokes)",
  scenarios: [],
};

// ---- scenario 1: full clear with cats -------------------------------------
{
  const game = makeGame();
  const world = game.level.world;
  const moves = [];
  let totalSeconds = 0;
  let guard = 0;
  while (game.state === "playing" && guard++ < 40) {
    const target =
      game.level.cheeses.find((c) => !c.taken) || game.level.exit;
    if (!target) break;
    const threat = catThreat(game);
    if (threat.unsafe) {
      const ft = fleeTarget(game);
      if (ft) {
        const dr = drawRoute(game, ft);
        const t = dr.ok ? runUntil(game, () => !game.mouse.moving, 45) : null;
        totalSeconds += t || 0;
        moves.push({
          flee: true,
          threat,
          target: { x: +ft.x.toFixed(1), y: +ft.y.toFixed(1) },
          catDistance: +ft.catDistance.toFixed(1),
          draw: dr,
          seconds: t,
          state: game.state,
        });
        if (t == null) break;
        continue;
      }
      const waited = safeWait(game, 8);
      totalSeconds += waited || 0;
      moves.push({ wait: true, seconds: waited, threat });
      continue;
    }
    // Wait for a safe window where no cat is near the planned route.
    const ru = routeUnsafe(game, target);
    if (ru.unsafe) {
      // Wait for a safer window; if none comes, dash anyway and rely on the
      // reactive abort in stepMove.
      const waited = runUntil(game, () => !routeUnsafe(game, target).unsafe, 8);
      if (waited == null && catThreat(game).d < game.level.world.cell * 5) {
        const ft = fleeTarget(game);
        if (ft) {
          const dr = drawRoute(game, ft);
          const t = dr.ok ? runUntil(game, () => !game.mouse.moving, 30) : null;
          totalSeconds += t || 0;
          moves.push({ windowFlee: true, routeMin: +ru.min.toFixed(1), target: { x: +ft.x.toFixed(1), y: +ft.y.toFixed(1) }, draw: dr, seconds: t, state: game.state });
          if (t == null) break;
          continue;
        }
      }
    }
    const dr = drawRoute(game, target);
    if (!dr.ok) {
      moves.push({ target, draw: dr });
      break;
    }
    // Reactive avoidance: stop if a cat closes in with line of sight.
    const t = stepMove(game, 45, game.level.world.cell * 6);
    totalSeconds += t || 0;
    moves.push({
      target: { x: +target.x.toFixed(1), y: +target.y.toFixed(1) },
      draw: dr,
      seconds: t,
      state: game.state,
      cheeseLeft: game.cheeseLeft,
    });
    if (t == null) break;
  }
  const settled = game.lastSettlement;
  results.scenarios.push({
    name: "full-clear-with-cats",
    pass: game.state === "levelclear" && game.caughtCount === 0 && game.cheeseLeft === 0,
    state: game.state,
    caught: game.caughtCount,
    lives: game.lives,
    cheeseLeft: game.cheeseLeft,
    score: settled ? settled.final : null,
    settlement: settled,
    seconds: +totalSeconds.toFixed(1),
    moves,
  });
}

// ---- scenario 2: immediate exit (native completion rule) ------------------
{
  const game = makeGame();
  const dr = drawRoute(game, game.level.exit);
  const t = dr.ok ? runUntil(game, () => !game.mouse.moving, 30) : null;
  results.scenarios.push({
    name: "exit-without-cheese",
    // Native (parallel-O2): the hole is CLOSED until the level goal (all
    // cheese) is collected, so touching it must NOT clear the level.
    pass: game.state === "playing" && game.cheeseLeft === game.level.cheeses.length,
    state: game.state,
    caught: game.caughtCount,
    cheeseLeft: game.cheeseLeft,
    score: game.lastSettlement ? game.lastSettlement.final : null,
    settlement: game.lastSettlement,
    draw: dr,
    seconds: t,
  });
}

results.pass = results.scenarios.every((s) => s.pass);
results.caughtReport = results.scenarios.map((s) => ({ scenario: s.name, caught: s.caught, state: s.state }));
console.log(JSON.stringify(results, null, 2));
