// Boss level flow regression: entrance scroll run, arena hand-over, fight
// win/lose, retry, resume and run persistence. Uses the real imported levels.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Game} from '../src/game.js';
import {loadContent} from '../src/content.js';
import {BOSS_LINKS, arenaLink, entranceLink, chainNext} from '../src/boss-links.js';
import {normaliseBossRun, newBossRun} from '../src/boss-flow.js';

const ctx = new Proxy({}, {
  get: (t, k) => {
    if (k === 'measureText') return () => ({width: 40});
    if (k === 'createLinearGradient') return () => ({addColorStop: () => {}});
    if (k === 'canvas') return {width: 960, height: 640};
    return () => {};
  },
  set: () => true,
});
const canvas = {getContext: () => ctx, getBoundingClientRect: () => ({width: 960, height: 640})};
globalThis.window = {devicePixelRatio: 1};
globalThis.Image = class { set src(v) {} };
globalThis.fetch = async (url) => ({
  ok: fs.existsSync(url),
  json: async () => JSON.parse(await fs.promises.readFile(url, 'utf8')),
});

const {levels} = await loadContent();
const results = [];
function check(name, fn) {
  fn();
  results.push(name);
}
const indexOf = (id) => levels.findIndex((level) => level.id === id);
const runFrames = (game, frames) => {
  for (let i = 0; i < frames; i++) {
    game.update(1 / 60);
    game.draw();
  }
};

function loadBoss(id, resume = null) {
  const game = new Game(canvas, {intro: false});
  game.levelCatalog = levels;
  game.bossResume = resume;
  const index = indexOf(id);
  game.loadLevel(levels[index], index);
  return game;
}

check('every authored boss link points at real imported levels', () => {
  for (const link of BOSS_LINKS) {
    const entrance = levels[indexOf(link.entrance)];
    const arena = levels[indexOf(link.arena)];
    assert(entrance, `${link.entrance} missing`);
    assert(arena, `${link.arena} missing`);
    assert.equal(entrance.mode, 'infinite', `${link.entrance} must be the scroll entrance`);
    assert.equal(arena.mode, 'boss', `${link.arena} must be the fight arena`);
    assert.equal(entrance.num, arena.num, 'entrance/arena share the chapter num');
    assert(entranceLink(link.entrance) === link && arenaLink(link.arena) === link);
    assert(link.hits >= 1, 'a fight needs at least one hit');
  }
  assert.equal(chainNext('map781', BOSS_LINKS.find((l) => l.arena === 'map781')), 'map769');
  assert.equal(chainNext('map791', BOSS_LINKS.find((l) => l.arena === 'map791')), null);
});

check('the entrance advance runs on its own and owns the left edge of the view', () => {
  const game = loadBoss('map736');
  assert.equal(game.bossFlow?.kind, 'approach');
  const world = game.level.world;
  const scale = game.cam.scale;
  // The whole map HEIGHT is on screen, the width is not: the run is horizontal.
  assert(world.h * scale <= game.cssH + 0.5, `map height must fit (${world.h * scale} > ${game.cssH})`);
  assert(world.w * scale > game.cssW * 2, 'entrance map is several screens wide');
  // No input at all: the advance still moves and the camera goes with it.
  game.mouse.clearPath();
  const startOx = game.cam.ox;
  const startTrail = game.bossFlow.trail;
  runFrames(game, 90);
  assert(game.bossFlow.trail > startTrail + 40, `advance must move without input (${startTrail} -> ${game.bossFlow.trail})`);
  assert(game.cam.ox < startOx - 20, 'the camera follows the advance');
  // The trailing edge IS the left edge of the view, which is what makes
  // "falling behind" readable. One frame of lag: updateCamera() runs before the
  // step advances the edge.
  const leftEdge = -game.cam.ox / game.cam.scale;
  assert(Math.abs(leftEdge - game.bossFlow.trail) < 3, `view left ${leftEdge} vs trail ${game.bossFlow.trail}`);
});

check('the scroll camera never pans vertically', () => {
  const game = loadBoss('map736');
  const world = game.level.world;
  runFrames(game, 3);
  const cam = { ...game.cam };
  // The hero moving between floor lanes must not move the view up or down.
  for (const y of [world.h * 0.2, world.h * 0.5, world.h * 0.8]) {
    game.mouse.y = y;
    runFrames(game, 4);
    assert.equal(game.cam.oy, cam.oy, `vertical camera moved at y=${Math.round(y)}`);
    assert.equal(game.cam.scale, cam.scale, 'vertical fit must not change with the hero lane');
    assert(world.h * game.cam.scale <= game.cssH + 0.5, 'full height stays visible');
  }
});

check('the advance IS the white cat horizontal displacement, not a clock', () => {
  const game = loadBoss('map736');
  const world = game.level.world;
  game.mouse.clearPath();
  const cat = game.level.cats.find((c) => c.type === 3);
  assert(cat, 'map736 authors the white boss cat');
  const before = game.bossFlow.trail;
  const catX0 = cat.x;
  runFrames(game, 120); // 2 s
  const moved = game.bossFlow.trail - before;
  const catDx = cat.x - catX0;
  assert(Math.abs(moved - catDx) <= 1, `advance moved ${moved.toFixed(1)}, cat dx ${catDx.toFixed(1)}`);
  const catWalk = 3.75 * world.cell; // bosscat (type 3) patrol speed, cells/s
  assert(catDx > 0 && catDx < catWalk * 2, 'the route has vertical legs, so dx is smaller than elapsed time x speed');
  assert(moved < 9 * world.cell * 2 * 0.6, 'the advance must stay well under the hero top speed');
});

check('a vertical cat leg freezes the scroll; a horizontal leg moves it by dx', () => {
  // map816's first authored route leg is straight down; it is the exact case
  // the user reported ("white cat walking down should stop the camera").
  const game = loadBoss('map816');
  const flow = game.bossFlow;
  const cat = game.level.cats.find((c) => c.type === 3);
  assert(cat, 'map816 authors the white boss cat');
  cat.update = () => {}; // take manual control of the authored driver
  game.mouse.clearPath();
  const x0 = cat.x, y0 = cat.y;
  const trail0 = flow.trail;
  for (let i = 1; i <= 60; i++) {
    cat.y = y0 + i; // 60 px straight down, x unchanged
    game.update(1 / 60);
  }
  assert(Math.abs(flow.trail - trail0) < 0.01, `vertical leg must not advance the camera (${trail0} -> ${flow.trail})`);
  assert.equal(game.state, 'playing');
  for (let i = 1; i <= 40; i++) {
    cat.x = x0 + i; // 40 px of horizontal motion
    game.update(1 / 60);
  }
  assert(Math.abs(flow.trail - trail0 - 40) <= 0.01, `horizontal leg must move exactly dx (${flow.trail - trail0})`);
  // A backward step is absorbed by the ratchet, it never rewinds the view.
  const held = flow.trail;
  for (let i = 1; i <= 20; i++) {
    cat.x = x0 + 40 - i;
    game.update(1 / 60);
  }
  assert(Math.abs(flow.trail - held) < 0.01, 'a cat turning back cannot rewind the camera');
});

check('an entrance without a white cat falls back to the authored walk pace', () => {
  // No shipped entrance map takes this branch; it keeps a broken/edited level
  // from dead-locking the run (and isolates the advance in the tests below).
  const game = loadBoss('map736');
  game.level.cats.length = 0;
  game.mouse.clearPath();
  const before = game.bossFlow.trail;
  runFrames(game, 120);
  const moved = game.bossFlow.trail - before;
  const catWalk = 3.75 * game.level.world.cell;
  assert(Math.abs(moved - catWalk * 2) <= 2, `fallback moved ${moved.toFixed(1)}, expected ${(catWalk * 2).toFixed(1)}`);
});

check('the hero may lead the advance but the advance never waits or rewinds', () => {
  const game = loadBoss('map736');
  const flow = game.bossFlow;
  const viewW = flow.viewWidth(game);
  // Sprint far ahead: the edge is dragged along, keeping the hero on screen.
  game.mouse.x = game.level.world.w * 0.6;
  runFrames(game, 30);
  const lead = game.mouse.x - flow.trail;
  assert(lead <= viewW * 0.78 + 1, `advance follows a sprinting hero (lead ${Math.round(lead)})`);
  const at = flow.trail;
  // Dropping back inside the view cannot rewind the advance either.
  game.mouse.x = at + 140;
  runFrames(game, 30);
  assert(flow.trail > at, 'the advance is a ratchet, it never moves backwards');
  assert(flow.trail <= at + 140, 'the advance still moves at its own pace, not the hero pace');
  assert.equal(game.state, 'playing', 'the hero is still inside the view');
});

check('a hero who stops moving is left behind and loses the run', () => {
  const game = loadBoss('map736');
  const ends = [];
  game.onLevelEnd = (event) => ends.push(event);
  runFrames(game, 10);
  assert.equal(game.state, 'playing');
  let frames = 0;
  while (game.state === 'playing' && frames < 900) {
    game.update(1 / 60);
    frames += 1;
  }
  assert.equal(game.state, 'caught', 'standing still must lose');
  assert.equal(game.death?.cause, 'scroll');
  assert.equal(game.level.id, 'map736');
  runFrames(game, 130);
  assert(ends.some((event) => event.type === 'caught'), 'the shell gets the fail event');
  // Keep moving and the same run stays alive: the advance is beatable.
  const safe = loadBoss('map736');
  safe.level.cats.length = 0; // isolate the advance from the level's cat
  const walk = 3.75 * safe.level.world.cell; // the cat the advance mirrors
  const from = safe.bossFlow.trail;
  for (let i = 0; i < 900; i++) {
    // Stay a third of a view ahead of the edge, the way a player running with
    // the advance does.
    safe.mouse.x = safe.bossFlow.trail + 320;
    safe.update(1 / 60);
    if (safe.state !== 'playing') break;
  }
  assert.equal(safe.state, 'playing', `a hero who keeps moving keeps up (cause ${safe.death?.cause})`);
  // 900 frames = 15 s of running: the edge covers exactly the cat's walk, and the
  // hero staying ahead of it never gets dragged backwards.
  const gained = safe.bossFlow.trail - from;
  assert(gained > walk * 12, `the run keeps advancing while the hero keeps up (${gained.toFixed(0)} px)`);
  assert(
    Math.abs(gained - walk * 15) <= 3,
    `the advance covers the cat walk in 15 s (${gained.toFixed(1)} vs ${(walk * 15).toFixed(1)})`,
  );
});

check('the scroll HUD draws progress pips only: no danger band, no keep-up text', () => {
  const game = loadBoss('map736');
  runFrames(game, 5);
  const calls = [];
  const spy = new Proxy({}, {
    get: (t, k) => {
      if (k === 'measureText') return () => ({ width: 40 });
      if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} });
      return (...args) => { calls.push({ k, args }); };
    },
    set: (t, k, v) => { calls.push({ k, args: [v] }); return true; },
  });
  game.bossFlow.drawHud(spy, game);
  assert.equal(calls.filter((c) => c.k === 'fillText').length, 0, 'the run HUD prints no words');
  const styles = calls.filter((c) => c.k === 'fillStyle').map((c) => String(c.args[0]));
  for (const style of styles) {
    const m = style.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) continue;
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    assert(!(r > 170 && g < 130 && b < 130), `the HUD must not paint a danger red (${style})`);
  }
  // One pip per stage, and nothing else.
  assert.equal(calls.filter((c) => c.k === 'fill').length, 4, 'exactly one pip per stage');
});

check('retrying a lost scroll run starts the advance over instead of failing at once', () => {
  const game = loadBoss('map736');
  let frames = 0;
  while (game.state === 'playing' && frames < 1200) {
    game.update(1 / 60);
    frames += 1;
  }
  assert.equal(game.state, 'caught', 'standing still loses the run');
  const lostAt = game.bossFlow.trail;
  assert(lostAt > 60, `the advance had moved before it caught the hero (${lostAt.toFixed(1)})`);

  game.retryLevel();
  assert.equal(game.state, 'playing', 'retry reopens the run');
  assert.equal(game.death, null);
  assert.equal(game.bossFlow.advanceDone, false);
  const viewW = game.bossFlow.viewWidth(game);
  assert(
    Math.abs(game.bossFlow.trail - Math.max(0, game.mouse.x - viewW * 0.3)) < 1,
    `the edge is rebuilt behind the respawned hero (trail ${game.bossFlow.trail.toFixed(1)}, hero ${game.mouse.x.toFixed(1)})`,
  );
  assert(game.bossFlow.trail < lostAt, 'the advance no longer starts ahead of the hero');
  assert.equal(game.bossFlow.revealed, false);
  assert.equal(game.bossFlow.bossActor, null);
  assert.equal(game.bossFlow.cinematic, null);
  // And the run is playable again: it keeps its own pace, it does not insta-fail.
  runFrames(game, 120);
  assert.equal(game.state, 'playing', `retry must not resume in the caught state (cause ${game.death?.cause})`);
  assert(game.bossFlow.trail > 60, 'the advance is running again after the retry');
});

check('sector banners advance, the boss appears, and progress is checkpointed', () => {
  const game = loadBoss('map736');
  const snapshots = [];
  game.onBossRun = (run) => snapshots.push(run);
  const world = game.level.world;
  assert.equal(game.bossFlow.sector, 0);
  // The sectors mark where the ADVANCE is, not where the hero is.
  game.mouse.x = world.w * 0.6;
  runFrames(game, 30);
  assert.equal(game.bossFlow.sector, 1);
  // No on-screen "SECTOR n" wording any more (user request): only the pips.
  assert.equal(game.bossFlow.banner.text, '');
  assert.equal(game.bossFlow.banner.t, 0);
  const checkpoint = snapshots.at(-1);
  assert.equal(checkpoint.stage, 'approach');
  assert.equal(checkpoint.sector, 1);
  assert(Math.abs(checkpoint.x - game.mouse.x) < 2, 'checkpoint stores the hero position');
  // The last sector spawns the boss and plays the run-in/roar/exit beats.
  game.mouse.x = world.w * 0.92;
  let frames = 0;
  while (game.bossFlow.sector < 3 && frames < 1200) {
    // Keep the hero ahead of the edge so the advance is not the thing under test.
    game.mouse.x = Math.max(game.mouse.x, game.bossFlow.trail + 320);
    game.update(1 / 60);
    game.draw();
    frames += 1;
  }
  assert.equal(game.bossFlow.sector, 3);
  assert(game.bossFlow.bossActor, 'boss actor exists during the reveal');
  assert.equal(game.inputLocked, false, 'the reveal is a camera beat, not an input lock');
  runFrames(game, 240);
  assert.equal(game.bossFlow.revealed, true);
  assert.equal(game.bossFlow.bossActor, null);
  assert.equal(game.bossFlow.cinematic, null);
});

check('the gate hands over to the arena instead of opening results', () => {
  const game = loadBoss('map736');
  const world = game.level.world;
  game.mouse.x = world.w * 0.9;
  let frames = 0;
  while (!game.bossFlow.revealed && frames < 900) {
    game.update(1 / 60);
    game.draw();
    frames += 1;
  }
  assert.equal(game.bossFlow.revealed, true, 'the advance reaches the reveal sector');
  // Still crossing the map: no hand-over, no clear.
  assert.equal(game.bossFlow.atGate(game), false, 'mid-map is not the gate');
  assert.equal(game.bossTransition, null);
  // The exit prop sits inside the wall, so the hero ends up on the walkable
  // cell in front of it - that is what "reaching the gate" means here.
  game.mouse.x = game.level.exit.x;
  game.mouse.y = game.level.exit.y;
  let transition = false;
  for (let i = 0; i < 400; i++) {
    game.update(1 / 60);
    if (game.bossTransition) transition = true;
    if (game.level.id === 'map791') break;
  }
  assert(transition, 'a fade transition covers the map swap');
  assert.equal(game.state, 'boss_transition');
  assert.equal(game.level.id, 'map791');
  assert.equal(game.bossFlow.kind, 'arena');
  assert.equal(game.inputLocked, true, 'input stays locked through the intro');
  runFrames(game, 220);
  assert.equal(game.state, 'playing');
  assert.equal(game.bossFlow.phase, 'fight');
  assert.equal(game.inputLocked, false);
  assert.equal(game.levelIndex, indexOf('map791'));
});

check('L1 arena: the boss charges, crashes count as hits and the win path fires', () => {
  const game = loadBoss('map791');
  const ends = [];
  game.onLevelEnd = (event) => ends.push(event);
  runFrames(game, 200); // intro
  const flow = game.bossFlow;
  assert.equal(flow.phase, 'fight');
  const boss = flow.boss;
  // Hide in a corner: the charge target is the hero, the boss rams the wall.
  game.mouse.hidden = true;
  game.mouse.hiddenTag = 0;
  game.mouse.x = 40;
  game.mouse.y = 40;
  let frames = 0;
  while (game.state === 'playing' && frames < 6000) {
    game.update(1 / 60);
    frames += 1;
  }
  assert.equal(game.state, 'levelclear', 'the win path reached the clear presentation');
  assert.equal(flow.totalHits, flow.required);
  assert.equal(boss.dead, true);
  assert.equal(boss.levelPhase, 8, 'native levelPhase stays below the win value');
  assert.equal(game.bossWin, true);
  assert.equal(game.bossWorldComplete, true);
  assert(game.lastBossDefeat && game.lastBossDefeat.worldComplete);
  runFrames(game, 180);
  assert(ends.some((event) => event.type === 'clear'), 'clear is announced to the shell');
});

check('touching a live boss kills and costs an attempt; retry rebuilds the fight', () => {
  const game = loadBoss('map791');
  runFrames(game, 200);
  const flow = game.bossFlow;
  const boss = flow.boss;
  const startAttempts = flow.attempt;
  // Stand on the boss while it is idle.
  Object.assign(game.mouse, {x: boss.x, y: boss.y, hidden: false});
  game.update(1 / 60);
  assert.equal(game.state, 'caught');
  assert.equal(flow.attempt, startAttempts + 1);
  assert.equal(game.bossRun.stage, 'lose');
  assert.equal(game.bossRun.hits, 0);
  game.retryLevel();
  assert.equal(game.state, 'playing');
  assert.equal(flow.totalHits, 0);
  assert.equal(flow.phase, 'fight', 'a repeat attempt skips the long intro');
  assert.equal(boss.dead, false);
});

check('an interrupted fight resumes with its hit count and attempts', () => {
  const saved = normaliseBossRun({
    arena: 'map791', entrance: 'map736', stage: 'fight', hits: 4, attempts: 3, sector: 0,
  });
  assert(saved);
  const game = loadBoss('map791', saved);
  assert.equal(game.bossFlow.phase, 'fight', 'resume skips the intro');
  assert.equal(game.inputLocked, false);
  assert.equal(game.bossFlow.totalHits, 4);
  assert.equal(game.bossFlow.attempt, 3);
  assert.equal(game.bossRun.hits, 4);
  // Corrupt / foreign saves are rejected instead of wedging the level.
  assert.equal(normaliseBossRun({arena: 'nope'}), null);
  assert.equal(normaliseBossRun('garbage'), null);
  const fresh = newBossRun(BOSS_LINKS[0], {stage: 'approach'});
  assert.equal(fresh.arena, 'map791');
  assert.equal(fresh.attempts, 1);
  // Quitting inside the win presentation resumes one hit short of the kill
  // instead of replaying the entrance or restarting a won fight.
  const late = normaliseBossRun({arena: 'map791', entrance: 'map736', stage: 'win', hits: 9});
  const lateGame = loadBoss('map791', late);
  assert.equal(lateGame.bossFlow.phase, 'fight');
  assert.equal(lateGame.bossFlow.totalHits, 8);
  assert.equal(lateGame.bossFlow.boss.dead, false);
});

check('resuming the entrance restores the checkpoint position and sector', () => {
  const saved = normaliseBossRun({
    arena: 'map791', entrance: 'map736', stage: 'approach', sector: 2, x: 1700, y: 420,
  });
  const game = loadBoss('map736', saved);
  assert.equal(game.bossFlow.kind, 'approach');
  assert.equal(game.bossFlow.sector, 2);
  assert(Math.abs(game.mouse.x - 1700) < 900, 'hero spawns at the saved checkpoint area');
  // The resume no longer re-announces the sector on screen (user request).
  assert.equal(game.bossFlow.banner.text, '');
});

check('normal levels are never turned into boss runs', () => {
  const game = loadBoss('map10');
  assert.equal(game.bossFlow, null);
  assert.equal(game.bossRun, null);
  game.mouse.x = game.level.exit.x;
  game.mouse.y = game.level.exit.y;
  runFrames(game, 5);
  assert.notEqual(game.state, 'boss_transition');
});

check('4-Boss gets a synthetic body from its turret parts', () => {
  const game = loadBoss('map789');
  assert.equal(game.bossFlow.kind, 'arena');
  assert.equal(game.level.bosses.length, 1);
  const boss = game.level.bosses[0];
  assert.equal(boss.prop, 283);
  assert(boss.radius > 0);
  assert.equal(game.bossFlow.encounters[0].required, 5);
});

console.log(`Boss flow regressions: ${results.length} groups passed`);
for (const name of results) console.log(`  ok ${name}`);
