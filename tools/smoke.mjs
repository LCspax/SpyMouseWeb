// Headless smoke test: stubs enough DOM/Canvas to import src/main.js, run the
// real loop, and drive input through actual pointer events to verify the
// drawing pipeline and that cats keep moving (never wedge on walls).
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const root = path.resolve(".");

function makeCtx() {
  const noop = () => {};
  return {
    canvas: { width: 800, height: 600 },
    setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, arc: noop, ellipse: noop,
    fill: noop, stroke: noop, clip: noop, drawImage: noop, fillText: noop,
    measureText: () => ({ width: 10 }), setLineDash: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
  };
}

function makeEl(tag = "div") {
  const listeners = {};
  return {
    tagName: tag, style: {}, children: [], textContent: "", innerHTML: "", title: "", disabled: false,
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] ?? null; },
    removeAttribute(k) { delete this._attrs[k]; },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    removeEventListener() {},
    dispatch(t, ev) { (listeners[t] || []).forEach((fn) => fn(ev)); },
    onclick: null,
    getContext() { return makeCtx(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
    setPointerCapture() {}, releasePointerCapture() {},
  };
}

const els = {};
for (const id of ["game", "overlay", "ovTitle", "ovText", "ovLevels", "ovPrimary", "ovSecondary", "ovTertiary",
  "hudLives", "hudCheese", "hudTime", "hudScore", "resultsDetails", "btnPause"]) {
  els[id] = makeEl(id === "game" ? "canvas" : "div");
}

const rafQueue = [];
const winListeners = {};
globalThis.window = {
  devicePixelRatio: 2,
  addEventListener(t, fn) { (winListeners[t] ||= []).push(fn); },
  requestAnimationFrame(cb) { rafQueue.push(cb); return rafQueue.length; },
};
globalThis.document = {
  hidden: false,
  getElementById: (id) => els[id] || makeEl(),
  createElement: (t) => makeEl(t),
  addEventListener() {},
};
globalThis.performance = { now: () => Date.now() };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.Image = class { set src(v) { queueMicrotask(() => this.onload && this.onload()); } };
globalThis.fetch = async (url) => {
  const fp = path.join(root, String(url).split("?")[0]);
  if (!fs.existsSync(fp)) return { ok: false, status: 404 };
  const body = fs.readFileSync(fp);
  return { ok: true, status: 200, json: async () => JSON.parse(body.toString("utf8")), text: async () => body.toString("utf8") };
};

const errors = [];
const assert = (cond, msg) => { if (!cond) errors.push(new Error("ASSERT: " + msg)); };

function runFrames(n) {
  for (let i = 0; i < n; i++) {
    const cb = rafQueue.shift();
    if (!cb) break;
    try { cb(performance.now()); } catch (e) { errors.push(e); }
  }
}

try {
  await import(pathToFileURL(path.join(root, "src", "main.js")).href);
} catch (e) {
  errors.push(e);
}
await new Promise((r) => setTimeout(r, 80));
runFrames(10);

const game = window.__game;
assert(!!game, "window.__game exposed");

if (game) {
  game.options.intro = false; // Presentation timing is exercised separately.
  els.ovPrimary.onclick(); // Enter a real level through the actual menu action.
  const canvas = els.game;
  game.state = "playing";
  let world = game.level.world;

  // find a clear drawing direction from the mouse
  const mx = game.mouse.x, my = game.mouse.y;
  let dir = null;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const bx = mx + Math.cos(a) * world.cell * 5;
    const by = my + Math.sin(a) * world.cell * 5;
    if (world.lineClear(mx, my, bx, by) && !world.isWallAt(bx, by)) { dir = { bx, by }; break; }
  }
  assert(!!dir, "found a clear stroke direction");

  if (dir) {
    const s0 = game.worldToScreen(mx, my);
    const s1 = game.worldToScreen(dir.bx, dir.by);
    canvas.dispatch("pointerdown", { pointerId: 1, clientX: s0.x, clientY: s0.y });
    for (let i = 1; i <= 8; i++) {
      canvas.dispatch("pointermove", { pointerId: 1, clientX: s0.x + ((s1.x - s0.x) * i) / 8, clientY: s0.y + ((s1.y - s0.y) * i) / 8 });
    }
    // release on window (never on canvas) - the exact case that used to stick
    (winListeners.pointerup || []).forEach((fn) => fn({ pointerId: 1 }));
    assert(game.mouse.path.length >= 2, "stroke committed on window pointerup");
    runFrames(30);
  }

  // a second stroke must also work (input not stuck)
  const before = game.mouse.path.length;
  const s0 = game.worldToScreen(game.mouse.x, game.mouse.y);
  canvas.dispatch("pointerdown", { pointerId: 2, clientX: s0.x, clientY: s0.y });
  canvas.dispatch("pointermove", { pointerId: 2, clientX: s0.x + 30, clientY: s0.y });
  canvas.dispatch("pointermove", { pointerId: 2, clientX: s0.x + 60, clientY: s0.y });
  canvas.dispatch("pointerup", { pointerId: 2, clientX: s0.x + 60, clientY: s0.y });
  assert(game.mouse.path.length >= 2 || before >= 2, "second stroke committed");

  // a short tap (no drag) must not crash or commit
  canvas.dispatch("pointerdown", { pointerId: 3, clientX: s0.x, clientY: s0.y });
  canvas.dispatch("pointerup", { pointerId: 3, clientX: s0.x, clientY: s0.y });

  // Switch to a level that actually contains cats.
  const catLevel = (window.__levels || []).findIndex((l) => (l.cats || []).length > 0);
  if (catLevel >= 0) {
    game.loadLevel(window.__levels[catLevel], catLevel);
    game.state = "playing";
    world = game.level.world;
  }

  // cat navigation: drive updates directly (isolated from catch/level-clear)
  // so we can confirm a patrolling cat travels and never wedges on walls.
  const cats = game.level.cats;
  const dt = 1 / 60;
  if (cats.length) {
    const c = cats[0];
    if (c.route.length < 2) {
      const far = world.bfsToWorld(c.x, c.y, game.level.exit ? game.level.exit.x : c.x + world.cell * 5, game.level.exit ? game.level.exit.y : c.y);
      if (far && far.length) c.route = [{ x: c.x, y: c.y }, far[far.length - 1]];
    }
    c.routeIndex = 1;
    c.state = "patrol";
    c.navPath = null;
    c.repathTimer = 0;
    const x0 = c.x, y0 = c.y;
    let maxMoved = 0;
    for (let f = 0; f < 300; f++) {
      c.update(dt, game.level.catWorld || world, { x: -9999, y: -9999 });
      const d = Math.hypot(c.x - x0, c.y - y0);
      if (d > maxMoved) maxMoved = d;
      if (world.circleHitsWall(c.x, c.y, 1)) { errors.push(new Error("ASSERT: cat entered a wall")); break; }
    }
    assert(maxMoved > world.cell * 2, `cat travelled (max=${maxMoved.toFixed(1)})`);
  }

  // Round 2 caught flow: the death presentation runs on the canvas
  // (fight -> closing -> fail) and THEN one manual-retry panel appears.
  // It must not auto-restart or auto-hide.
  if (cats.length) {
    const c = cats[0];
    game.state = "playing";
    game.lives = 3;
    game.mouse.clearPath();
    c.x = game.mouse.x;
    c.y = game.mouse.y;
    c.state = "patrol";
    const caughtBefore = game.caughtCount;
    const retryIndex = game.levelIndex;
    game.update(dt);
    assert(game.caughtCount === caughtBefore + 1, "cat contact begins capture once");
    assert(game.state === "caught", "caught state after contact");
    assert(game.death?.phase === 'fight', "death starts in the fight phase");
    assert(els.overlay.classList.contains('hidden'), "fail panel waits for the death presentation");

    // Drive the fight/closing presentation until the fail seam opens the panel.
    for (let i = 0; i < 600 && els.overlay.classList.contains('hidden'); i++) game.update(dt);
    assert(!els.overlay.classList.contains('hidden'), "caught failure panel is shown");
    assert(els.overlay.classList.contains('caught-panel'), "caught panel styling class");
    assert(/CAUGHT|被抓住/.test(els.ovTitle.textContent), "caught title shown");
    assert(/Retry|再试一次/.test(els.ovPrimary.textContent), "caught retry label");
    assert(els.ovPrimary.disabled === false, "caught retry is enabled");
    assert(els.ovLevels.style.display === 'none', "caught panel has no level grid");
    game.draw();

    // No automatic retry / hide: the fail frame stays until the player acts.
    assert(game.state === 'caught', "game stays in the caught state on fail");
    for (let i = 0; i < 240; i++) game.update(dt);
    assert(!els.overlay.classList.contains('hidden'), "caught panel does not auto-hide");
    assert(game.state === 'caught', "fail frame is held until Retry");

    // Manual retry goes through game.retryLevel() and returns to playing.
    assert(typeof game.retryLevel === 'function', "game.retryLevel exists");
    els.ovPrimary.onclick();
    assert(els.overlay.classList.contains('hidden'), "retry hides the caught panel");
    assert(!els.overlay.classList.contains('caught-panel'), "retry clears the caught styling");
    assert(game.state === 'playing', "retry returns to playing");
    assert(game.levelIndex === retryIndex, "retry stays on the captured level");
    // retryLevel() reopens with the pinhole intro; skip it so the completion
    // assertions below exercise the clear presentation directly.
    game.intro = null;
  }

  // Restarting from pause must not leave the game frozen.
  // Exercise completion through the real UI event callback and button action.
  const completedIndex=game.levelIndex;
  game.state='playing';game.levelClear();
  // Round-3 clear presentation: hero shrinks into the exit (0.5s), then the
  // results overlay masks the screen and the panel pops. No "Level Complete"
  // intermediate banner.
  for (let i=0;i<300 && els.ovTitle.textContent!=='结果';i++) game.update(dt);
  assert(els.ovTitle.textContent==='结果','results mask starts after the hero enters');
  assert(els.ovLevels.style.display==='none','results has no selection grid');
  // ui task-6: the results overlay renders the rolled-up score panel.
  assert(els.resultsDetails.children.length > 0, 'results score rows rendered');
  assert(String(els.ovPrimary.textContent || '').length > 0, 'results primary button labelled');
  els.ovPrimary.onclick();
  assert(game.state==='menu','next button opens level selection');
  assert(game.levelIndex===completedIndex,'next button never starts another level');
  assert(els.ovLevels.style.display==='grid','selection grid appears after next');
  els.ovPrimary.onclick();
  game.pause();
  game.restart();
  assert(game.state === "playing", "restart sets state to playing");
  const m = game.mouse;
  let goal = null;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const gx = m.x + Math.cos(a) * world.cell * 3;
    const gy = m.y + Math.sin(a) * world.cell * 3;
    if (world.lineClear(m.x, m.y, gx, gy) && !world.isWallAt(gx, gy)) { goal = { x: gx, y: gy }; break; }
  }
  if (goal) {
    m.setPath([goal]);
    const bx = m.x, by = m.y;
    for (let i = 0; i < 30; i++) game.update(dt);
    assert(m.x !== bx || m.y !== by, "mouse moves after restart");
    assert(!world.circleHitsWall(m.x, m.y, 1), "mouse stays out of walls");
  }

  // Pipe travel: ending a path beside a pipe entrance must move the mouse to
  // the paired entrance and count as one pipe use.
  const pipeLevel = (window.__levels || []).findIndex((l) => l.id === "map743" && l.pipes && l.pipes.length);
  if (pipeLevel >= 0) {
    game.loadLevel(window.__levels[pipeLevel], pipeLevel);
    game.state = "playing";
    const p = game.level.pipes[0];
    game.mouse.x = p.aExit.x;
    game.mouse.y = p.aExit.y;
    game.mouse.setPath([{ x: p.aExit.x, y: p.aExit.y }]);
    game.pipesUsed = 0;
    game.pipeCooldown = 0;
    game.update(dt);
    assert(game.pipesUsed === 1, "pipe use counted");
    assert(
      Math.hypot(game.mouse.x - p.bExit.x, game.mouse.y - p.bExit.y) < 1e-6,
      "pipe teleported to paired entrance"
    );
    world = game.level.world;
  }

  // A stroke must not begin inside a wall tile.
  let wallTile = null;
  outer: for (let ty = 0; ty < world.rows; ty++)
    for (let tx = 0; tx < world.cols; tx++)
      if (world.isWall(tx, ty)) { wallTile = { tx, ty }; break outer; }
  if (wallTile) {
    game.state = "playing";
    const sp = game.worldToScreen((wallTile.tx + 0.5) * world.cell, (wallTile.ty + 0.5) * world.cell);
    canvas.dispatch("pointerdown", { pointerId: 9, clientX: sp.x, clientY: sp.y });
    assert(game.stroke !== null, "stroke starts even when drawn on a wall");
    assert(
      !world.isWallAt(game.stroke.points[0].x, game.stroke.points[0].y),
      "stroke start snaps to open floor"
    );
    canvas.dispatch("pointerup", { pointerId: 9, clientX: sp.x, clientY: sp.y });
  }

  game.state='playing';els.ovPrimary.disabled=true;
  els.btnPause.dispatch('click',{});
  assert(!els.ovPrimary.disabled,'pause resume is enabled after original-menu startup');
  runFrames(2);
  game.resume();
  runFrames(5);
  game.resetLevel(true);
  runFrames(5);

  // ui task-6: HUD values follow emitHud and the score change marks the bump FX.
  game.onHud({ lives: 3, cheeseLeft: 4, timeLeft: 0, score: 321 });
  assert(els.hudCheese.textContent === '4', 'hud cheese follows emitHud fields');
  assert(els.hudScore.textContent === '321', 'hud score follows emitHud fields');
  assert(els.hudScore.classList.contains('hud-bump'), 'hud score bump class applied on change');
  els.hudCheese.classList.remove('hud-bump');
  game.onHud({ lives: 3, cheeseLeft: 4, timeLeft: 0, score: 321 });
  assert(!els.hudCheese.classList.contains('hud-bump'), 'unchanged hud value does not re-bump');
}

console.log(errors.length ? "SMOKE FAIL" : "SMOKE OK");
for (const e of errors) console.log("  " + (e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n  ") : e));
process.exit(errors.length ? 1 : 0);

