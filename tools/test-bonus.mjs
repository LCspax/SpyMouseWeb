// Reward-room entrance regression (src/bonus.js + Game.beginBonus/finishBonus).
// Covers: appearance gating, tap entry, failed run keeps the entrance usable,
// single payout per parent level, 2x settlement, and the crack-claim rule.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Game} from '../src/game.js';
import {loadContent} from '../src/content.js';
import {EXIT_BONUS_MULTIPLIER, bonusTargetFor} from '../src/bonus.js';

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

function load(id) {
  const game = new Game(canvas, {intro: false});
  game.levelCatalog = levels;
  const index = indexOf(id);
  game.loadLevel(levels[index], index);
  return game;
}

/** Walk up to the portal, tap it and let the enter beat play out. */
function enterRoom(game) {
  const portal = game.bonusPortal;
  const u = game.level.world.cell;
  // A tap further than one reach radius makes the hero walk there first, which
  // is the normal player path: tap the portal from anywhere on the floor.
  const open = game.level.world.closestOpen(portal.x + u * 1.6, portal.y, game.mouse.radius);
  game.mouse.x = open.x;
  game.mouse.y = open.y;
  game.mouse.clearPath();
  game.mouse.moving = false;
  assert.equal(game.handleTap({ x: portal.x, y: portal.y }), undefined);
  let frames = 0;
  while (portal.state !== 'entering' && frames < 900) {
    game.update(1 / 60);
    frames += 1;
  }
  assert.equal(portal.state, 'entering', 'the tap routes the hero in and starts the enter beat');
  runFrames(game, 40); // BONUS_ENTER_SECONDS = 0.42s
  return portal;
}

check('a normal chapter level points at its secret "S" room, bosses never do', () => {
  const map10 = levels[indexOf('map10')];
  const target = bonusTargetFor(map10, levels);
  assert(target, 'map10 must find a reward room');
  assert.equal(target.level.id, 'map798');
  assert.equal(target.level.secret, true);
  assert.equal(target.index, indexOf('map798'));
  // Boss arenas, scroll entrances and the secret levels themselves are excluded.
  for (const id of ['map791', 'map736', 'map798']) {
    assert.equal(bonusTargetFor(levels[indexOf(id)], levels), null, `${id} must not get a portal`);
  }
});

check('the portal only appears once the level has nothing left to collect', () => {
  const game = load('map10');
  const portal = game.bonusPortal;
  assert(portal, 'map10 has a portal');
  assert.equal(portal.state, 'hidden');
  assert(game.cheeseLeft > 0, 'the level still has cheese');
  runFrames(game, 10);
  assert.equal(portal.state, 'hidden', 'cheese left keeps the portal away');
  // A tap on nothing must not be consumed by the hidden portal.
  assert.equal(portal.tryTap(game, { x: portal.x, y: portal.y }), false);
  game.cheeseLeft = 0;
  assert.equal(game.pendingMachineCheese, 0, 'no machine cheese outstanding');
  runFrames(game, 3);
  assert.equal(portal.state, 'appearing');
  runFrames(game, 60);
  assert.equal(portal.state, 'ready');
});

check('a close tap enters the reward room and stashes the parent level', () => {
  const game = load('map10');
  game.cheeseLeft = 0;
  assert.equal(game.pendingMachineCheese, 0, 'no machine cheese outstanding');
  runFrames(game, 60);
  const portal = enterRoom(game);
  assert.equal(game.level.id, 'map798', 'the reward room is loading');
  assert.equal(game.levelIndex, indexOf('map798'));
  assert(game.bonusReturn, 'the parent level is stashed');
  assert.equal(game.bonusReturn.level.id, 'map10');
  assert.equal(game.bonusReturn.targetId, 'map798');
  assert.equal(game.bonusReturn.origin.kind, 'portal');
  assert.equal(portal.state, 'ready', 'Game owns the level swap from here');
});

check('a failed reward run returns to the spot with the entrance still usable', () => {
  const game = load('map10');
  game.cheeseLeft = 0;
  assert.equal(game.pendingMachineCheese, 0, 'no machine cheese outstanding');
  runFrames(game, 60);
  const portal = enterRoom(game);
  const exited = () => assert.equal(game.finishBonus(false), true);
  exited();
  assert.equal(game.level.id, 'map10', 'back in the parent level');
  assert.equal(game.levelIndex, indexOf('map10'));
  assert.equal(game.bonusReturn, null);
  assert.equal(portal.state, 'ready', 'the entrance stays claimable');
  assert.equal(portal.claimed, false);
  assert.equal(game.secretsFound.has('map798'), false, 'nothing was recorded');
  assert.equal(game.bonusMultiplier, 1, 'no payout on a failed run');
  // The hero is restored beside the entrance, not at the level start.
  const u = game.level.world.cell;
  assert(Math.hypot(game.mouse.x - portal.x, game.mouse.y - portal.y) < u * 3);
  // …and the room can be entered again.
  enterRoom(game);
  assert.equal(game.level.id, 'map798');
});

check('clearing the room pays the 2x bonus exactly once', () => {
  const game = load('map10');
  const rewards = [];
  game.onBonusReward = (event) => rewards.push(event);
  game.cheeseLeft = 0;
  assert.equal(game.pendingMachineCheese, 0, 'no machine cheese outstanding');
  runFrames(game, 60);
  const portal = enterRoom(game);
  game.cheeseCounts = { 110: 3 };
  const before = game.settle();
  assert.equal(before.bonusMultiplier, 1);
  assert.equal(game.finishBonus(true), true);
  assert.equal(rewards.length, 1, 'the reward is announced once');
  assert.deepEqual(rewards[0], { levelId: 'map10', targetId: 'map798', multiplier: EXIT_BONUS_MULTIPLIER });
  assert.equal(game.bonusMultiplier, EXIT_BONUS_MULTIPLIER);
  assert.equal(game.bonusClaims.map10, true);
  assert.equal(portal.state, 'used');
  assert.equal(portal.claimed, true);
  assert.equal(game.secretsFound.has('map798'), true);
  const after = game.settle();
  assert.equal(after.banked, before.banked * EXIT_BONUS_MULTIPLIER, 'settlement doubles');
  // A second finish has nothing stashed: the claim can never be paid twice.
  assert.equal(game.finishBonus(true), false);
  assert.equal(rewards.length, 1);
  assert.equal(portal.available(game), false, 'a claimed portal cannot reappear');
});

check('a persisted claim keeps the portal spent after a reload', () => {
  const game = new Game(canvas, {intro: false});
  game.levelCatalog = levels;
  game.bonusClaims = { map10: true };
  game.loadLevel(levels[indexOf('map10')], indexOf('map10'));
  assert.equal(game.bonusPortal.state, 'used');
  assert.equal(game.bonusClaimed, true);
  game.cheeseLeft = 0;
  assert.equal(game.pendingMachineCheese, 0, 'no machine cheese outstanding');
  runFrames(game, 30);
  assert.equal(game.bonusPortal.state, 'used', 'no second portal for a paid level');
});

check('the authored H-level cracks still open on their own level', () => {
  for (const [id, target] of [['map724', 'map584'], ['map709', 'map522'], ['map525', 'map756']]) {
    const game = new Game(canvas, {intro: false});
    game.levelCatalog = levels;
    game.loadLevel(levels[indexOf(id)], indexOf(id));
    assert.equal(game.cracks.length, 1, `${id} keeps its painted crack`);
    assert.equal(game.cracks[0].target, target);
    assert.equal(game.cracks[0].used, false);
  }
});

check('1-7 exposes its painted crack, and it leads into 1-S', () => {
  const game = new Game(canvas, {intro: false});
  game.levelCatalog = levels;
  game.loadLevel(levels[indexOf('map98')], indexOf('map98'));
  assert.equal(game.level.id, 'map98');
  assert.equal(game.cracks.length, 1, '1-7 must expose the crack painted on its wall');
  assert.equal(game.cracks[0].target, 'map798');
  assert.equal(game.cracks[0].used, false);
  // 1-S can also be found through map10's reward room. That must not close the
  // 1-7 entrance: an entrance is spent per parent level, not per target.
  game.secretsFound.add('map798');
  game.loadLevel(levels[indexOf('map98')], indexOf('map98'));
  assert.equal(game.cracks[0].used, false, 'another door must not close this one');
  // Walking onto the open floor beside the crack pushes the hero through.
  const crack = game.cracks[0];
  game.mouse.x = crack.trigger.x;
  game.mouse.y = crack.trigger.y;
  game.mouse.clearPath();
  game.mouse.moving = false;
  runFrames(game, 3);
  assert(game.crackEnter, 'the crack starts its transit');
  assert.equal(crack.used, false, 'entering alone must not spend the entrance');
  runFrames(game, 40);
  assert.equal(game.level.id, 'map798', 'the crack loads the hidden level');
  assert(game.bonusReturn, 'the parent level is stashed');
  // Clearing it pays once and closes that entrance.
  assert.equal(game.finishBonus(true), true);
  assert.equal(game.level.id, 'map98');
  assert.equal(game.cracks[0].used, true, 'a cleared crack is spent');
  assert.equal(game.crackClaims['1-S-crack'], true, 'the entrance itself is recorded');
  assert.equal(game.bonusClaims.map98, true);
  // With the entrance recorded, a reload keeps that crack closed - while a
  // level whose 1-S was cleared elsewhere keeps its own crack open.
  const again = new Game(canvas, {intro: false});
  again.levelCatalog = levels;
  again.crackClaims = { '1-S-crack': true };
  again.loadLevel(levels[indexOf('map98')], indexOf('map98'));
  assert.equal(again.cracks[0].used, true);
  const otherDoor = new Game(canvas, {intro: false});
  otherDoor.levelCatalog = levels;
  otherDoor.bonusClaims = { map10: true };
  otherDoor.secretsFound.add('map798');
  otherDoor.loadLevel(levels[indexOf('map98')], indexOf('map98'));
  assert.equal(otherDoor.cracks[0].used, false, 'map10`s reward room must not close 1-7`s crack');
});

check('every painted crack opens from the floor beside it, not only its exact trigger', () => {
  // Regression for the "the crack is right there but nothing happens" bug: the
  // trigger point is a guess at the open floor next to the painted decal, and on
  // map98 it ended up 22.8 px from the only standable tile (> the old 17.6 px
  // reach). Every crack must be enterable from wherever the hero can actually
  // stand next to the decal.
  for (const [id, target] of [
    ['map98', 'map798'],
    ['map724', 'map584'],
    ['map709', 'map522'],
    ['map525', 'map756'],
  ]) {
    const game = new Game(canvas, {intro: false});
    game.levelCatalog = levels;
    game.loadLevel(levels[indexOf(id)], indexOf(id));
    assert.equal(game.cracks.length, 1, `${id} exposes its painted crack`);
    const crack = game.cracks[0];
    const world = game.level.world;
    const cell = world.cell;
    // Where the hero can actually stand next to the painted crack: nearest cell
    // centre that still fits the body. The authored `trigger` point is only a
    // hint - on map98 it sits 22 px away from that tile, past the old 17.6 px
    // reach, which is exactly why the crack felt dead.
    const stand = world.closestOpen(crack.x, crack.y, game.mouse.radius);
    const toDecal = Math.hypot(stand.x - crack.x, stand.y - crack.y);
    assert(toDecal <= cell * 2 + 0.01, `${id}: the painted crack must be within decal reach (${toDecal.toFixed(1)} px)`);
    const from = world.nearestNavOpen(game.mouse.x, game.mouse.y);
    const to = world.nearestNavOpen(stand.x, stand.y);
    const path = world.bfs(from.tx, from.ty, to.tx, to.ty);
    assert(path, `${id}: the tile beside the crack must be walkable from the spawn`);
    game.mouse.x = stand.x;
    game.mouse.y = stand.y;
    game.mouse.clearPath();
    game.mouse.moving = false;
    runFrames(game, 3);
    assert(game.crackEnter, `${id}: standing beside the crack pushes the hero through`);
    runFrames(game, 45);
    assert.equal(game.level.id, target, `${id}: the crack leads to ${target}`);
  }
});

check('the reward entrance has no dashed ring or detached light beam', () => {
  const game = new Game(canvas, {intro: false});
  game.levelCatalog = levels;
  game.loadLevel(levels[indexOf('map10')], indexOf('map10'));
  const portal = game.bonusPortal;
  assert(portal && portal.x != null, 'map10 has a reachable reward-room entrance');
  portal.state = 'ready';
  const calls = [];
  const recording = new Proxy({}, {
    get: (_t, k) => (...args) => {
      calls.push(k);
      if (k === 'createLinearGradient') return {addColorStop: () => {}};
      return undefined;
    },
    set: () => true,
  });
  portal.draw(recording, game);
  assert(!calls.includes('setLineDash'), 'no dashed chevron circle next to the open exit');
  assert(!calls.includes('createLinearGradient'), 'no second vertical light beam');
  assert(!calls.includes('fillRect'), 'no detached ground-glow rectangle');
  assert(calls.includes('arc'), 'a bounded solid medallion is still drawn');
});

console.log(`Reward room regressions: ${results.length} groups passed`);
for (const name of results) console.log(`  ok ${name}`);
