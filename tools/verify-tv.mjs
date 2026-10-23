// TV presentation checks: wall-facing orientation, native 128px frame, and
// hypnotised cats sitting with the cat_stun billboard.
//   node tools/verify-tv.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { Game } from "../src/game.js";

const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: 960, height: 640 }) };
globalThis.window = { devicePixelRatio: 1 };
globalThis.Image = class { set src(_v) {} };

const level = JSON.parse(fs.readFileSync("assets/levels/map728.json", "utf8"));
level.mask = JSON.parse(fs.readFileSync("assets/masks/map728.json", "utf8"));
level.mechanisms = JSON.parse(fs.readFileSync("assets/mechanisms.json", "utf8"))[level.id];
const game = new Game(canvas, { intro: false });
game.loadLevel(level, 0);
const mech = game.level.mechanisms;
const tvs = mech.objects.filter((o) => o.kind === "tv");
assert.equal(tvs.length, 4, "map728 has four TVs");

// map728: bottom-wall TV opens right, left-wall TVs open down/left/up.
assert.deepEqual(tvs.map((tv) => mech.tvFacing(tv)), ["r", "d", "l", "u"]);

const frames = [];
game.sprites.frame = (_ctx, key, frame, x, y, w, h) => { frames.push({ key, frame, w, h }); return true; };
mech.draw(game, ctx);
const tvFrames = frames.filter((f) => f.key.startsWith("tv_"));
assert.equal(tvFrames.length, 4);
assert(tvFrames.every((f) => f.w === 128 && f.h === 128), "TV frame is one full 128px sheet frame (native SetScale 64 design units = 128 web px)");
// Suffix is the wall/back side: facing right => tv_l, facing down => tv_u.
assert.deepEqual(tvFrames.map((f) => f.key), ["tv_l", "tv_u", "tv_r", "tv_d"]);

// Place a cat at the right TV's viewing point and hypnotise it.
const tv = tvs[0];
tv.active = true;
const view = mech.tvViewPoint(tv);
const cat = game.level.cats[0];
cat.x = view.x; cat.y = view.y; cat.distraction = null; cat.rest = null;
game.mouse.x = tv.x; game.mouse.y = tv.y + 90;
game.updateCamera();
mech.update(game, 1 / 60, game.mouse);
cat.update(1 / 60, game.level.world, game.mouse);
assert.equal(cat.state, "hypnotized");
assert.equal(cat.distraction.kind, "tv");
assert.equal(cat.moving, false, "hypnotised cat must sit still");

// drawCatIndicators must use the cat_stun billboard for the hypnotised cat.
frames.length = 0;
game.drawCatIndicators(ctx, game.level.world.cell);
assert(frames.some((f) => f.key === "cat_stun"), "cat_stun icon over the head");

console.log("TV verification OK (facing, 128px frame, sitting hypnosis + icon)");

