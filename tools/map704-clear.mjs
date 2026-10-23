// map704 (1-3) diagnosis + verifiable safe clear under the NORMAL level timer.
//
//   node tools/map704-clear.mjs trace   -> runs the bot, dumps the caught trace
//   node tools/map704-clear.mjs plan    -> brute-forces a wait time T, executes
//                                          a single-stroke dash via real pointer
//                                          events, verifies caught=0/levelclear
//   node tools/map704-clear.mjs replay  -> re-runs the saved input and verifies
//
// The cats, their vision and the timer are NOT modified.
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

const def = JSON.parse(fs.readFileSync("assets/levels/map704.json", "utf8"));
def.mask = JSON.parse(fs.readFileSync(def.mask, "utf8"));
const DT = 1 / 60;

function freshGame() {
  const game = new Game(canvas);
  game.loadLevel(def, 0);
  game.state = "playing";
  return game;
}

function catWorld(game) {
  return game.level.catWorld || game.level.world;
}

// Advance only the cats (no mouse), optionally with a trace hook.
function advanceCats(game, seconds, trace = null, t0 = 0) {
  const world = catWorld(game);
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    for (const c of game.level.cats) c.update(DT, world, null, []);
    if (trace) trace.push(snapshot(game, t0 + (i + 1) * DT, null));
  }
}

function snapshot(game, t, mouse) {
  const world = game.level.world;
  return {
    t: +t.toFixed(2),
    mouse: mouse ? { x: +mouse.x.toFixed(1), y: +mouse.y.toFixed(1), hidden: !!mouse.hidden } : null,
    cats: game.level.cats.map((c) => ({
      tag: c.tag,
      x: +c.x.toFixed(1),
      y: +c.y.toFixed(1),
      state: c.state,
      angle: +c.angle.toFixed(3),
      dist: mouse ? +Math.hypot(c.x - mouse.x, c.y - mouse.y).toFixed(1) : null,
      los: mouse ? world.lineClear(c.x, c.y, mouse.x, mouse.y) : null,
    })),
  };
}

// Real pointer pipeline: draw one stroke along a world-space route.
function drawRoute(game, route) {
  const s0 = game.worldToScreen(game.mouse.x, game.mouse.y);
  game.onPointerDown(s0);
  for (const p of route) game.onPointerMove(game.worldToScreen(p.x, p.y));
  const strokePoints = game.stroke ? game.stroke.points.length : 0;
  game.onPointerUp();
  return { strokePoints, live: strokePoints >= 2 };
}

function runUntil(game, pred, seconds, trace = null, t0 = 0) {
  let t = 0;
  while (t < seconds) {
    game.update(DT);
    t += DT;
    if (trace) trace.push(snapshot(game, t0 + t, game.mouse));
    if (pred()) return +t.toFixed(2);
    if (game.state !== "playing") return null;
  }
  return null;
}

const mode = process.argv[2] || "trace";

if (mode === "trace") {
  // Replay the accept-enemies style bot on map704 with a trace buffer.
  const game = freshGame();
  const world = game.level.world;
  const cell = world.cell;
  const trace = [];
  const moves = [];
  const threat = () => {
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
    }
    return { min, nearest, los, state: nearest ? nearest.state : null };
  };
  const target = game.level.cheeses[0];
  let guard = 0;
  while (game.state === "playing" && guard++ < 20) {
    const th = threat();
    const route = world.bfsToWorld(game.mouse.x, game.mouse.y, target.x, target.y);
    if (!route) break;
    drawRoute(game, route);
    const t = runUntil(game, () => !game.mouse.moving, 45, trace, game.time);
    moves.push({ seconds: t, threat: { min: +th.min.toFixed(1), state: th.state, los: th.los } });
    if (t == null) break;
    if (th.min < cell * 6) {
      // flee to the farthest cell
      let best = null;
      let bestD = -1;
      for (let ty = 1; ty < world.rows; ty += 2) {
        for (let tx = 1; tx < world.cols; tx += 2) {
          if (world.isWall(tx, ty)) continue;
          const x = (tx + 0.5) * cell;
          const y = (ty + 0.5) * cell;
          let dMin = Infinity;
          for (const c of game.level.cats) dMin = Math.min(dMin, Math.hypot(c.x - x, c.y - y));
          if (dMin > bestD) {
            bestD = dMin;
            best = { x, y };
          }
        }
      }
      if (best) {
        const fr = world.bfsToWorld(game.mouse.x, game.mouse.y, best.x, best.y);
        if (fr) {
          drawRoute(game, fr);
          const ft = runUntil(game, () => !game.mouse.moving, 30, trace, game.time);
          moves.push({ flee: true, seconds: ft, catDistance: +bestD.toFixed(1) });
        }
      }
    }
  }
  const caught = game.state === "caught" || game.caughtCount > 0;
  const catchFrames = caught ? trace.slice(-Math.min(trace.length, 240)) : [];
  const out = {
    level: def.id,
    num: def.num,
    timer: def.times ? def.times.start : null,
    state: game.state,
    caught: game.caughtCount,
    cheeseLeft: game.cheeseLeft,
    moves,
    catchTrace: catchFrames,
  };
  fs.writeFileSync("analysis/map704-caught-trace.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ state: game.state, caught: game.caughtCount, cheeseLeft: game.cheeseLeft, moves: moves.length, catchFrames: catchFrames.length }, null, 2));
  process.exit(0);
}

if (mode === "plan" || mode === "replay" || mode === "dtReplay") {
  const saved = fs.existsSync("analysis/map704-safe-clear.json")
    ? JSON.parse(fs.readFileSync("analysis/map704-safe-clear.json", "utf8"))
    : null;

  // Instrument a fresh game: track spot/chase transitions (the 'spotted' goal
  // counts the native 'seen' stat) and expose a waiter that uses the FULL game
  // loop (cats, timer, everything) for the whole wait - no manual time math.
  function preparedGame() {
    const game = freshGame();
    const spotted = { count: 0 };
    for (const c of game.level.cats) {
      const orig = c.update.bind(c);
      c.update = (...args) => {
        const before = c.state;
        orig(...args);
        if (before !== "spot" && before !== "chase" && (c.state === "spot" || c.state === "chase")) {
          spotted.count++;
        }
      };
    }
    return { game, spotted };
  }

  function waitFullGame(game, seconds, dt) {
    let t = 0;
    while (t < seconds) {
      game.update(dt);
      t += dt;
      if (game.state !== "playing") return false;
    }
    return true;
  }

  function feedRoute(game, route) {
    const s0 = game.worldToScreen(game.mouse.x, game.mouse.y);
    const events = [{ type: "down", screen: { x: +s0.x.toFixed(2), y: +s0.y.toFixed(2) }, world: { x: +game.mouse.x.toFixed(2), y: +game.mouse.y.toFixed(2) } }];
    game.onPointerDown(s0);
    for (const p of route) {
      const s = game.worldToScreen(p.x, p.y);
      events.push({ type: "move", screen: { x: +s.x.toFixed(2), y: +s.y.toFixed(2) }, world: { x: +p.x.toFixed(2), y: +p.y.toFixed(2) } });
      game.onPointerMove(s);
    }
    const strokePoints = game.stroke ? game.stroke.points.length : 0;
    const live = game.stroke ? game.stroke.live : false;
    game.onPointerUp();
    events.push({ type: "up", screen: { x: events[events.length - 1].screen.x, y: events[events.length - 1].screen.y } });
    return { events, strokePoints, live };
  }

  function replayFixed(savedInput, dt) {
    const { game, spotted } = preparedGame();
    const waited = waitFullGame(game, savedInput.waitSeconds, dt);
    if (!waited) {
      return { ok: false, reason: "caught-during-wait", state: game.state, caught: game.caughtCount, spotted: spotted.count, dt };
    }
    const fed = feedRoute(game, savedInput.worldRoute);
    let t = 0;
    while (t < 60) {
      game.update(dt);
      t += dt;
      if (game.state !== "playing") break;
      if (!game.mouse.moving && game.mouse.cursor >= game.mouse.path.length) break;
    }
    const elapsed = +(savedInput.waitSeconds + t).toFixed(2);
    const ok = game.state === "levelclear" && game.caughtCount === 0 && game.cheeseLeft === 0;
    return {
      dt: +dt.toFixed(5),
      ok,
      state: game.state,
      caught: game.caughtCount,
      cheeseLeft: game.cheeseLeft,
      spotted: spotted.count,
      elapsed,
      score: game.lastSettlement ? game.lastSettlement.final : null,
      goals: game.lastSettlement ? game.lastSettlement.goals : null,
      events: fed.events.length,
    };
  }

  if (mode === "replay" || mode === "dtReplay") {
    if (!saved) {
      console.error("no saved safe-clear input; run plan first");
      process.exit(1);
    }
    const dts = mode === "dtReplay" ? [1 / 30, 1 / 60, 1 / 120] : [1 / 60];
    const results = dts.map((dt) => replayFixed(saved, dt));
    const out = {
      level: def.id,
      num: def.num,
      mode,
      waitSeconds: saved.waitSeconds,
      results,
      allOk: results.every((r) => r.ok),
    };
    fs.writeFileSync(mode === "dtReplay" ? "analysis/map704-dt-replay.json" : "analysis/map704-replay.json", JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.allOk ? 0 : 1);
  }

  // plan: brute force the wait with the FULL game loop, then save the fixed
  // input (wait seconds + world route + explicit pointer events).
  const attempts = [];
  const candidates = [];
  for (let T = 0; T <= 40; T += 0.25) candidates.push(+T.toFixed(2));
  const world0 = freshGame().level.world;
  let success = null;
  for (const T of candidates) {
    const { game, spotted } = preparedGame();
    if (!waitFullGame(game, T, DT)) {
      attempts.push({ T, ok: false, reason: "caught-during-wait", state: game.state, caught: game.caughtCount, spotted: spotted.count });
      continue;
    }
    const start = { x: game.mouse.x, y: game.mouse.y };
    const w = game.level.world;
    const r1 = w.bfsToWorld(start.x, start.y, def.cheeses[0].x, def.cheeses[0].y);
    const r2 = r1 ? w.bfsToWorld(def.cheeses[0].x, def.cheeses[0].y, def.exit.x, def.exit.y) : null;
    if (!r1 || !r2) {
      attempts.push({ T, ok: false, reason: "no-route" });
      continue;
    }
    const route = r1.concat(r2);
    const fed = feedRoute(game, route);
    const t = runUntil(game, () => game.state !== "playing", 60);
    const elapsed = +(T + (t || 0)).toFixed(2);
    const ok = game.state === "levelclear" && game.caughtCount === 0 && game.cheeseLeft === 0;
    attempts.push({
      T,
      ok,
      state: game.state,
      caught: game.caughtCount,
      cheeseLeft: game.cheeseLeft,
      spotted: spotted.count,
      elapsed,
      score: game.lastSettlement ? game.lastSettlement.final : null,
    });
    if (ok && !success) {
      success = {
        level: def.id,
        num: def.num,
        waitSeconds: T,
        worldRoute: route.map((p) => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) })),
        events: fed.events,
        dt: DT,
        elapsed,
        score: game.lastSettlement ? game.lastSettlement.final : null,
        goals: game.lastSettlement ? game.lastSettlement.goals : null,
        spottedDuringRun: spotted.count,
        caught: game.caughtCount,
        state: game.state,
      };
      break;
    }
  }
  const out = {
    level: def.id,
    num: def.num,
    timerSeconds: def.times ? def.times.start : null,
    mode,
    attempts: attempts.slice(0, 200),
    success,
  };
  if (success) fs.writeFileSync("analysis/map704-safe-clear.json", JSON.stringify(success, null, 2));
  fs.writeFileSync("analysis/map704-plan.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ mode, attempts: attempts.length, success: success ? { waitSeconds: success.waitSeconds, elapsed: success.elapsed, score: success.score, goals: success.goals, spotted: success.spottedDuringRun, events: success.events.length } : null }, null, 2));
  process.exit(success ? 0 : 1);
}
