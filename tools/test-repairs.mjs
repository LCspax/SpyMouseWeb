import assert from "node:assert/strict";
import fs from "node:fs";
import { Cat } from "../src/entities.js";
import { World } from "../src/world.js";
import { Level } from "../src/level.js";
import { Game } from "../src/game.js";
import { CFG } from '../src/config.js';
import { resultsModel } from '../src/results.js';
import {normaliseSettings,worldNodes,FrontEnd} from '../src/menu.js';
import {snapMapPath,advanceMapWalk,mapRoadPath,projectMapRoad,extendMapRoadPath,nodePoint} from '../src/map-walk.js';
import { mouthPosition, playerSpawnPoint, carriedCheeseFrame } from "../src/props.js";
import { updateCarried, resetCarried } from '../src/carried.js';
import { PLAYER_SEQUENCES } from '../src/player-animations.js';
import {CAT_REST_PROFILES,catRestFrameIndex,updateCatRest} from '../src/cat-rest.js';
import { loadContent } from "../src/content.js";
import { Sprites, catFacing, playerIdleRow } from "../src/sprites.js";
import { parseMbn } from "./decode-mbn.mjs";

const results = [];
function check(name, fn) { fn(); results.push({ name, pass: true }); }
const world = World.fromRows(Array.from({ length: 20 }, (_, y) => y === 0 || y === 19 ? "#".repeat(32) : "#" + ".".repeat(30) + "#"), 16);
const cat = (type = 0) => new Cat(80, 80, [{ x: 80, y: 80 }, { x: 320, y: 80 }], 0, world, type);
check("hidden target is safe in every active AI state", () => {
  for (const type of [0, 4, 5, 6, 7, 10]) {
    for (const state of ["patrol", "spot", "chase", "search", "return", "attackWindup", "attackThrow", "pounceWait", "pounceRun", "stunned"]) {
      const c = cat(type);
      Object.assign(c, { state, lastSeen: { x: 240, y: 80 }, searchTimer: 2, attackTarget: { x: 200, y: 80 }, pounceTarget: { x: 200, y: 80 }, burstLeft: 1 });
      for (let i = 0; i < 360; i++) c.update(1 / 60, world, null, []);
      assert(Number.isFinite(c.x) && Number.isFinite(c.y));
      assert.equal(c.canSeeMouse({ x: c.x, y: c.y, hidden: true, vx: 100 }, world), false);
    }
  }
});
check("unseen player position and velocity cannot change pursuit", () => {
  const a = cat(), b = cat();
  for (const c of [a, b]) {
    c.state = "chase";
    c.lastSeen = { x: 240, y: 80 };
    c.canSeeMouse = () => false;
  }
  let searched = false, returned = false;
  for (let i = 0; i < 1000; i++) {
    a.update(1 / 60, world, { x: 300, y: 80, vx: 140, vy: 0 });
    b.update(1 / 60, world, { x: 100, y: 250, vx: -140, vy: 50 });
    assert.deepEqual([a.x, a.y, a.state], [b.x, b.y, b.state]);
    searched ||= a.state === "search";
    returned ||= a.state === "return";
  }
  assert(searched && returned);
  assert.equal(a.state, "patrol");
});
check("ranged attacks retain last observed aim after hiding", () => {
  const c = cat(6), shots = [];
  Object.assign(c, { state: "attackThrow", burstLeft: 1, attackTarget: { x: 240, y: 80 } });
  c.update(1 / 60, world, { x: 99, y: 200, hidden: true }, shots);
  assert.deepEqual([shots[0].tx, shots[0].ty], [240, 80]);
});
const defs = (map) => {
  const d = JSON.parse(fs.readFileSync(`assets/levels/${map}.json`, "utf8"));
  d.mask = JSON.parse(fs.readFileSync(d.mask, "utf8"));
  return d;
};
check("map98 spawns authored large cheese and five independent crumbs", () => {
  const l = new Level(defs("map98"));
  assert.equal(l.cheeses.length, 1);
  assert.equal(l.cheeses[0].prop, 8);
  assert.equal(l.crumbs.length, 5);
  assert(l.crumbs.every(c => c.prop === 260 && c.id != null && c.x === c.ox && c.y === c.oy));
  assert.equal(l.cheeses[0].x, l.cheeses[0].ox);
});
check("all hole and pipe mouths match their opening, not the suffix name", () => {
  // Holes/exit holes and pipe pieces use the native convention: the sprite
  // suffix names the WALL/RIM side, so the mouth opens opposite. For flipflaps
  // this is PROVEN by 0x8f4b0 (204 d -> engine +y -> world up, 205 r -> left,
  // 206 u -> world down, 207 l -> right); the pipe pieces 200-203 follow the
  // same suffix convention. Hole props 20-23/240-247 are unchanged.
  for (const [prop, dx, dy] of [[20,0,1],[21,1,0],[22,0,-1],[23,-1,0],[240,0,1],[241,1,0],[242,0,-1],[243,-1,0],
    [244,0,1],[245,1,0],[246,0,-1],[247,-1,0],[200,0,-1],[201,-1,0],[202,0,1],[203,1,0],[204,0,-1],[205,-1,0],[206,0,1],[207,1,0]]) {
    assert.deepEqual(mouthPosition({ prop, x: 100, y: 100 }, 32), { x: 100 + dx * 32, y: 100 + dy * 32 });
  }
});

// Record semantic sprite calls without depending on a browser's canvas API.
const draws = [];
const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: 960, height: 640 }) };
globalThis.window = { devicePixelRatio: 1 };
globalThis.Image = class { set src(v) {} };
function game(def) {
  const g = new Game(canvas, { intro: false });
  g.loadLevel(def, 0);
  g.sprites.frame = (_ctx, key, frame, x, y, w, h) => { draws.push({ key, frame, x, y, w, h }); return true; };
  return g;
}
check("surface reflection is separate from pickup-only burst; crumbs retain a stable size variant", () => {
  const g = game(defs("map98"));
  g.level.cats = [];
  draws.length = 0;
  g.drawCheeses(ctx, 16);
  g.drawPickupEffects(ctx,16);
  assert(!draws.some(d => d.key === "cheesetrail_effect"));
  assert.equal(g.pickupEffects.length,0);
  g.state = "playing";
  for (let i = 0; i < 240; i++) g.update(1 / 60);
  draws.length = 0;
  g.drawCheeses(ctx, 16);
  g.drawCrumbs(ctx, 16);
  assert(!draws.some(d => d.key === "cheesetrail_effect"));
  assert(draws.filter(d => d.key === "cheese_inf").every(d => d.frame === 0 && d.w === 32));
  assert(draws.some(d => d.key === "cheese03" && d.w === 48));
  g.restart();
  assert.equal(g.pickupEffects.length,0);
  assert(g.level.crumbs.every(c => !c.taken));
  g.mouse.x=g.level.cheeses[0].x;g.mouse.y=g.level.cheeses[0].y;
  g.step(1/60);
  assert.equal(g.pickupEffects.length,1);
  draws.length=0;g.drawPickupEffects(ctx,16);
  assert.equal(draws.find(d=>d.key==='cheesetrail_effect').frame,0);
  g.step(.075);draws.length=0;g.drawPickupEffects(ctx,16);
  assert.equal(draws.find(d=>d.key==='cheesetrail_effect').frame,1);
  g.step(.3);assert.equal(g.pickupEffects.length,0);
  g.restart();assert.equal(g.pickupEffects.length,0);
});
check("late exit opening plays its first frame instead of jumping to frame 3", () => {
  const g = game(defs("map10"));
  g.cheeseLeft = 0;
  g.time = 30;
  g.exitOpenTime = 30;
  draws.length = 0;
  g.drawExit(ctx, 16);
  assert.equal(draws.find(d => d.key.startsWith("home_mousehole")).frame, 1);
  g.time = 30.25;
  draws.length = 0;
  g.drawExit(ctx, 16);
  assert.equal(draws.find(d => d.key.startsWith("home_mousehole")).frame, 3);
});
check("contact uses visible body extent instead of tiny navigation radii", () => {
  const g = game({ rows: ["############", "#M.........#", "#..........#", "############"], cell: 16 });
  const c = new Cat(g.mouse.x + 32, g.mouse.y, [], Math.PI, g.level.world);
  c.update = () => {};
  g.level.cats = [c];
  g.state = "playing";
  g.step(1 / 60);
  assert.equal(g.state, "playing");
  c.x = g.mouse.x + 24;
  g.step(1 / 60);
  assert.equal(g.state, "caught");
});
check("larger body contact still respects walls, hidden mouse and stunned cats", () => {
  const make=()=>{
    const g=game({rows:['############','#M.........#','#..........#','############'],cell:16});
    const c=new Cat(g.mouse.x+24,g.mouse.y,[],Math.PI,g.level.world);c.update=()=>{};g.level.cats=[c];
    return {g,c};
  };
  for(const condition of ['hidden','stunned','wall']) {
    const {g,c}=make();
    if(condition==='hidden')g.mouse.hidden=true;
    if(condition==='stunned')c.state='stunned';
    if(condition==='wall')g.level.world.lineClear=()=>false;
    g.step(1/60);assert.equal(g.state,'playing',condition);
  }
});
// Exercise the browser's real content loader, not just JSON -> Level. The
// former used to discard prop/ox/oy/wait and silently select fallback art.
const originalFetch = globalThis.fetch;
let loaded;
try {
  globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(url, "utf8")) });
  loaded = await loadContent();
} finally {
  globalThis.fetch = originalFetch;
}
check("browser loader preserves every authored entity's type, anchor and route wait", () => {
  assert.equal(loaded.source, "imported");
  assert.equal(loaded.levels.length, 121);
  for (const def of loaded.levels) {
    const raw = JSON.parse(fs.readFileSync(`assets/levels/${def.id}.json`, "utf8"));
    for (const field of ["mouseStart", "exit"]) {
      if (!raw[field]) continue;
      if(field==='exit'&&raw.exit.source==='synthesized'&&def.mechanisms?.nativeExit){
        for(const key of ['id','prop','tag','ox','oy','source'])assert.equal(def.exit[key],def.mechanisms.nativeExit[key],`${def.id}/native-exit/${key}`);continue;
      }
      if(field==='exit'&&raw.exit.source==='synthesized'&&def.extraFloors?.length){assert.equal(def.exit,null);continue;}
      for (const key of ["id", "prop", "tag", "ox", "oy", "source"]) assert.equal(def[field][key], raw[field][key], `${def.id}/${field}/${key}`);
    }
    for (let i = 0; i < (raw.cheeses || []).length; i++) {
      for (const key of ["id", "prop", "tag", "ox", "oy", "source"]) assert.equal(def.cheeses[i][key], raw.cheeses[i][key], `${def.id}/cheese${i}/${key}`);
    }
    for (let i = 0; i < (raw.cats || []).length; i++) {
      for (let j = 0; j < (raw.cats[i].route || []).length; j++) assert.equal(def.cats[i].route[j].wait, raw.cats[i].route[j].wait);
    }
  }
});
check("real browser load of map98 draws holed wedge and a door opening right from its vertical wall", () => {
  const g = game(loaded.levels.find(d => d.id === "map98"));
  draws.length = 0;
  g.drawCheeses(ctx, 16);
  const anchors = [];
  const exitCtx = new Proxy({}, { get: (_obj, key) => key === "translate" ? (x, y) => anchors.push([x, y]) : () => {} });
  g.drawExit(exitCtx, 16);
  assert(draws.some(d => d.key === "cheese03" && d.x === 376 && d.y === 496));
  assert(draws.some(d => d.key === "home_mousehole_l"));
  assert.deepEqual(anchors, [[476, 422]]);
  assert(!draws.some(d => d.key === "cheese01" || d.key === "home_mousehole_d"));
});
check("cat update and drawing together advance exactly one frame every native 200ms", () => {
  for (const state of ["patrol", "chase"]) {
    for (const hz of [30, 60, 120]) {
      const c = cat();
      c.state = state;
      c.routeMode = "stationary";
      c.canSeeMouse = () => state === "chase";
      c.pounceCooldown = Infinity;
      c.navigate = () => {};
      const sprites = new Sprites();
      sprites.images.browncat_left = { image: {}, cols: 10, fw: 64, fh: 64 };
      let sourceFrame;
      const renderCtx = { save() {}, restore() {}, translate() {}, scale() {}, drawImage: (_image, sx) => { sourceFrame = sx / 64; } };
      const base = state === "chase" ? 5 : 0;
      for (let i = 1; i <= hz; i++) {
        c.update(1 / hz, world, state === "chase" ? { x: 240, y: 80, vx: 0, vy: 0 } : null);
        sprites.catFrame(renderCtx, "browncat", state, c.anim, c.x, c.y, 64, 64, 0);
        assert.equal(sourceFrame, base + Math.floor((i / hz + 1e-9) / 0.2) % 4, `${state} ${hz}Hz frame ${i}`);
      }
      assert(Math.abs(c.anim - 1) < 1e-8);
    }
  }
});
check("cat art covers eight headings and mirrors only the three right-side views", () => {
  const headings = [
    [-Math.PI/2, "up", false], [-Math.PI/4, "upLeft", true], [0, "left", true],
    [Math.PI/4, "downLeft", true], [Math.PI/2, "down", false],
    [3*Math.PI/4, "downLeft", false], [Math.PI, "left", false], [-3*Math.PI/4, "upLeft", false],
  ];
  const sprites = new Sprites();
  for (const dir of ["up", "upLeft", "left", "downLeft", "down"]) sprites.images[`browncat_${dir}`] = { image: { dir }, cols: 10, fw: 64, fh: 64 };
  for (const [angle, dir, flip] of headings) {
    assert.deepEqual(catFacing(angle), { dir, flip });
    const scales = [];
    let sheet;
    const renderCtx = { save() {}, restore() {}, translate() {}, scale: (x,y) => scales.push([x,y]), drawImage: image => { sheet = image.dir; } };
    sprites.catFrame(renderCtx, "browncat", "patrol", 0, 100, 100, 64, 64, angle);
    assert.equal(sheet, dir);
    assert.deepEqual(scales, flip ? [[-1,1]] : []);
  }
});
check("cat faces actual displacement after turns and wall sliding", () => {
  const c = cat();
  c.angle = Math.PI;
  for (let i = 0; i < 60; i++) {
    const x = c.x, y = c.y;
    c.update(1/60, world, null);
    if (c.moving) assert(Math.abs(c.angle - Math.atan2(c.y-y,c.x-x)) < 1e-8);
  }
  // Force an axis-only slide: the requested diagonal is blocked.
  const slider = cat();
  slider.state = "chase";
  const slideWorld = Object.create(world);
  slideWorld.circleHitsWall = (x,y) => x > 80.001 && y > 80.001;
  slider.updateAI = dt => slider.navigate(dt, slideWorld, { x: 160, y: 160 }, 60, 0.2);
  slider.update(1/60, slideWorld, null);
  assert(slider.moving);
  assert.equal(slider.y, 80);
  assert.equal(slider.angle, 0);
});
check("exit snapping and completion use the visible doorway instead of the old lower point", () => {
  const g = game(loaded.levels.find(d => d.id === "map98"));
  g.level.cats = [];
  g.cheeseLeft = 0;
  assert.deepEqual([g.level.exit.x,g.level.exit.y], [476,422]);
  assert.deepEqual(g.snapTarget({x:476,y:422}), {type:"exit",x:476,y:422});
  g.mouse.x = 476;
  g.mouse.y = 438;
  g.state = "playing";
  g.step(1/60);
  assert.equal(g.state, "playing");
  g.mouse.y = 422;
  g.step(1/60);
  assert.equal(g.state, "levelclear");
});
check("snapped door arrow uses a filled tutorial-style head and the final nonzero segment", () => {
  const g = game(loaded.levels.find(d => d.id === "map98"));
  g.cheeseLeft = 0;
  const end = { x:g.level.exit.x, y:g.level.exit.y };
  g.mouse.x = end.x + 64;
  g.mouse.y = end.y;
  g.mouse.path = [{x:g.mouse.x,y:g.mouse.y}, end, {...end}];
  g.mouse.cursor = 1;
  assert.equal(g.exitPathAngle(end), Math.PI);
  const rotations = [];
  const outline = [];
  let fills = 0;
  const pathCtx = new Proxy({}, {get:(_obj,key)=>key==="rotate" ? angle=>rotations.push(angle) : key==="lineTo" ? (x,y)=>outline.push([x,y]) : key==="fill" ? ()=>fills++ : ()=>{}});
  draws.length = 0;
  g.drawPath(pathCtx,16);
  assert(!draws.some(d=>d.key==="arrow"));
  assert.equal(rotations[0], Math.PI);
  assert.equal(fills, 1);
  assert(outline.some(([x,y])=>x===-16*0.7 && y===16*0.58));
  g.mouse.path = [{x:end.x,y:end.y+64},end];
  g.mouse.x = end.x;
  g.mouse.y = end.y + 64;
  assert.equal(g.exitPathAngle(end), -Math.PI/2);
});
check("carried cheese retains world positions while turning and rendering", () => {
  const g = game(loaded.levels.find(d=>d.id==="map98"));
  g.mouse.x = 200;
  g.mouse.y = 200;
  g.mouse.angle = 0;
  g.carried = [{prop:8,x:171.2,y:200},{prop:7,x:151.2,y:200}];
  draws.length = 0;
  g.drawCarried(ctx,16);
  assert(Math.abs(draws[0].x - 171.2) < 1e-8);
  assert(Math.abs(draws[1].x - 151.2) < 1e-8);
  assert(draws.every(d=>Math.abs(d.y-200)<1e-8));
  g.mouse.angle = Math.PI/2;
  g.drawCarried(ctx,16);
  assert.equal(g.carried[0].y,200);
  g.mouse.y = 250;
  updateCarried(g.carried,g.mouse,world,1/60);
  assert(g.carried[0].y>200 && g.carried[0].y<250);
  assert(g.carried[1].y<g.carried[0].y);
  resetCarried(g.carried,g.mouse);
  assert(g.carried.every(c=>c.x===g.mouse.x && c.y===250));
});
check("carry convergence uses elapsed time and remains clear of walls", () => {
  const positions = [30,60,120].map(hz=>{
    const chain=[{x:80,y:80,prop:8}];
    for(let i=0;i<hz;i++) updateCarried(chain,{x:240,y:80},world,1/hz);
    assert(!world.circleHitsWall(chain[0].x,chain[0].y,3.2));
    return chain[0].x;
  });
  assert(Math.max(...positions)-Math.min(...positions)<1e-7);
});
check("all imported spawns apply the native half-frame pivot with floor fallback", () => {
  const audit=[];
  for(const def of loaded.levels) {
    const g=game(def),start=g.level.mouseStart;
    const expected=playerSpawnPoint(start,g.level.world,g.mouse.radius);
    assert.deepEqual({x:g.mouse.x,y:g.mouse.y},expected);
    assert(Number.isFinite(expected.x)&&Number.isFinite(expected.y));
    assert(!g.level.world.circleHitsWall(expected.x,expected.y,g.mouse.radius), `${def.id}: spawn clearance`);
    audit.push({id:def.id,raw:{x:start.ox,y:start.oy},corrected:expected,fallback:expected.y!==start.oy-37});
    g.mouse.y+=40;g.restart();
    assert.deepEqual({x:g.mouse.x,y:g.mouse.y},expected);
  }
  fs.writeFileSync('analysis/player-spawn-audit.json',JSON.stringify(audit,null,2));
  assert.deepEqual(playerSpawnPoint({x:80,y:80},world,4),{x:80,y:80});
});
check("intro freezes gameplay, expands automatically, pauses and varies on retry", () => {
  const g=new Game(canvas);g.loadLevel(loaded.levels.find(d=>d.id==='map98'),0);
  const initial=g.intro.animation, cats=g.level.cats.map(c=>[c.x,c.y]);
  g.update(1);assert.equal(g.time,0);assert(g.intro);
  assert.deepEqual(g.level.cats.map(c=>[c.x,c.y]),cats);
  g.draw();g.state='paused';g.update(1);assert(Math.abs(g.intro.elapsed-1)<1e-8);
  g.state='playing';g.update(2);assert.equal(g.intro,null);
  g.restart();assert.notEqual(g.intro.animation,initial);
  assert(PLAYER_SEQUENCES[g.intro.animation]);
  assert.equal(PLAYER_SEQUENCES.idle1.duration,10400);
  assert.equal(PLAYER_SEQUENCES.checkmap1.frames[0].oy,12);
});
check("carried cheese selects directional frames independently and holds them when stopped", () => {
  const g=game(loaded.levels.find(d=>d.id==='map98'));
  for(const [angle,expected] of [[0,15],[-Math.PI/2,3],[Math.PI,7],[Math.PI/2,11]]) {
    assert.equal(carriedCheeseFrame(angle),expected);
    assert.equal(carriedCheeseFrame(angle+Math.PI*2),expected);
  }
  g.carried=[{prop:8,x:120,y:80,angle:0},{prop:7,x:120,y:120,angle:-Math.PI/2}];
  draws.length=0;g.drawCarried(ctx,16);
  assert.deepEqual(draws.map(d=>d.frame),[15,3]);
  assert.deepEqual(draws.map(d=>d.key),['cheese03','cheese04']);
  const chain=[{x:80,y:80,angle:0}];
  updateCarried(chain,{x:80,y:200},world,1/60);
  assert.equal(chain[0].angle,Math.PI/2);
  const saved=chain[0].angle;
  updateCarried(chain,{x:chain[0].x,y:chain[0].y},world,1/60);
  assert.equal(chain[0].angle,saved);
});
check("idle rendering selects all four authored rows and retains final movement facing", () => {
  const s=new Sprites();
  s.images.sequence_idle1={image:{},cols:8,fw:74,fh:74};
  s.images.playerIdle={image:{},cols:8,fw:74,fh:74};
  const rows=[];
  const renderCtx={drawImage:(_img,_sx,sy)=>rows.push(sy/74)};
  const g=game(loaded.levels.find(d=>d.id==='map98'));
  for(const [angle,row] of [[-Math.PI/2,0],[Math.PI,1],[Math.PI/2,2],[0,3]]) {
    assert.equal(playerIdleRow(angle),row);
    s.playerSequenceFrame(renderCtx,'idle1',550,100,100,74,74,angle);
    s.playerIdleFrame(renderCtx,550,100,100,74,74,angle);
    g.mouse.x=160;g.mouse.y=160;g.mouse.setPath([{x:160+Math.cos(angle)*32,y:160+Math.sin(angle)*32}]);
    for(let i=0;i<120;i++)g.mouse.update(1/60,world);
    assert.equal(g.mouse.moving,false);
    assert.equal(playerIdleRow(g.mouse.angle),row);
    g.mouse.clearPath();g.mouse.update(1/60,world);
    assert.equal(playerIdleRow(g.mouse.angle),row);
  }
  assert.deepEqual(rows,[0,0,1,1,2,2,3,3]);
});
check("authored Y-up player offsets raise sprites without moving the collision pivot", () => {
  const s=new Sprites(), calls=[];
  s.images.sequence_idle1={image:{},cols:8,fw:74,fh:74};
  s.images.playerIdle={image:{},cols:8,fw:74,fh:74};
  const renderCtx={drawImage:(...args)=>calls.push(args)};
  for(const angle of [-Math.PI/2,Math.PI,Math.PI/2,0]) {
    s.playerSequenceFrame(renderCtx,'idle1',0,100,100,74,74,angle);
    s.playerIdleFrame(renderCtx,0,100,100,74,74,angle);
  }
  // Native idle.xml oy=6 design pixels, doubled for 960x640 art.
  // Native adds it before projection: Canvas top = 100 - 37 - 12.
  assert(calls.every(args=>args[5]===63 && args[6]===51));
  const g=game(loaded.levels.find(d=>d.id==='map10'));
  g.intro=null;
  const before={x:g.mouse.x,y:g.mouse.y};
  let idleY,runY;
  g.sprites.playerSequenceFrame=(_ctx,_name,_elapsed,_x,y)=>{idleY=y;return !g.mouse.moving;};
  g.sprites.playerFrame=(_ctx,_time,_x,y)=>{runY=y;return true;};
  g.mouse.moving=false;g.drawMouse(renderCtx,16);
  g.mouse.moving=true;g.drawMouse(renderCtx,16);
  assert.equal(runY,idleY-12);
  assert.deepEqual({x:g.mouse.x,y:g.mouse.y},before);
});
check("all five cheese types retain ground size after pickup in every drag direction", () => {
  for (let prop=6;prop<=10;prop++) {
    const g=game(loaded.levels.find(d=>d.id==='map98'));
    g.level.cats=[];
    const cheese=g.level.cheeses[0];cheese.prop=prop;
    g.mouse.x=cheese.x;g.mouse.y=cheese.y;
    draws.length=0;g.drawCheeses(ctx,16);
    const ground=draws.find(d=>/^cheese0/.test(d.key));
    g.step(1/60);
    assert.equal(cheese.taken,true);
    assert.equal(g.carried.length,1);
    for(let direction=0;direction<16;direction++) {
      g.carried[0].angle=direction*Math.PI/8;
      draws.length=0;g.drawCarried(ctx,16);
      assert.deepEqual([draws[0].key,draws[0].w,draws[0].h],[ground.key,ground.w,ground.h]);
      assert.equal(draws[0].w,48);
    }
  }
});
check("surface reflection masks the moving white highlight to the cheese alpha", () => {
  const sprites=new Sprites();
  sprites.images.cheese03={image:{},cols:16,fw:48,fh:48};
  const compositing=[],sources=[],stops=[];
  const mask=new Proxy({
    clearRect(){},drawImage(...args){sources.push(args);},
    createLinearGradient(){return {addColorStop(...args){stops.push(args);}};},fillRect(){},
  },{set:(obj,key,value)=>{if(key==='globalCompositeOperation')compositing.push(value);obj[key]=value;return true;}});
  sprites.reflectionCanvas={getContext:()=>mask};
  let rendered=0;
  assert.equal(sprites.cheeseReflection({drawImage(){rendered++;}},'cheese03',7,100,100,48,100),true);
  assert.deepEqual(compositing,['source-over','source-in']);
  assert.equal(sources[0][1],7*48);
  assert.equal(rendered,1);assert.equal(stops.length,3);
  assert.equal(sprites.cheeseReflection(ctx,'cheese03',7,100,100,48,200),false);
});
check("only a wall impact stuns a pouncing cat", () => {
  for(const end of ['arrival','timeout','missing-target']) {
    const c=cat();
    Object.assign(c,{state:'pounceRun',pounceTimer:end==='timeout'?.001:1,
      pounceTarget:end==='missing-target'?null:{x:end==='arrival'?81:200,y:80},lastSeen:{x:200,y:80}});
    c.update(1/60,world,null);
    assert.equal(c.state,'chase',end);
    assert.equal(c.stunTimer,0,end);
    assert.equal(c.pounceTarget,null,end);
    assert(c.pounceCooldown>0);
  }
  const walls=World.fromRows(['########','#..#...#','#..#...#','#..#...#','########'],16);
  const c=new Cat(40,40,[{x:40,y:40}],0,walls);
  Object.assign(c,{state:'pounceRun',pounceTimer:1,pounceTarget:{x:100,y:40}});
  for(let i=0;i<10&&c.state==='pounceRun';i++)c.update(1/60,walls,null);
  assert.equal(c.state,'stunned');assert(c.stunTimer>0);
  assert(!walls.circleHitsWall(c.x,c.y,c.radius));
  const ghost=new Cat(40,40,[{x:40,y:40}],0,walls,5);
  Object.assign(ghost,{state:'pounceRun',pounceTimer:1,pounceTarget:{x:100,y:40}});
  for(let i=0;i<10;i++)ghost.update(1/60,walls,null);
  assert.notEqual(ghost.state,'stunned');
});
check("cat warning art uses full width and clears the head and canvas edges", () => {
  const savedImage=globalThis.Image;
  try {
    globalThis.Image=class {set src(value){this.naturalWidth=value.endsWith('cat_angry.png')?60:32;this.onload();}};
    const s=new Sprites();s.load();
    assert.equal(s.images.cat_angry.fw,60);
    assert.equal(s.images.cat_angry.cols,1);
    let source;
    s.frame({drawImage(...args){source=args;}},'cat_angry',0,100,100,66,35.2);
    assert.deepEqual(source.slice(1,5),[0,0,60,32]);
  } finally {globalThis.Image=savedImage;}
  const g=game(loaded.levels.find(d=>d.id==='map98'));
  const c={x:200,y:200,state:'search',radius:6.4,type:0};g.level.cats=[c];
  draws.length=0;g.drawCatIndicators(ctx,16);
  const icon=draws[0];assert.equal(icon.key,'cat_angry');
  assert(Math.abs(icon.w/icon.h-60/32)<1e-9);
  assert(icon.y+icon.h/2<c.y-16*1.7);
  c.x=-100;c.y=-100;
  draws.length=0;g.drawCatIndicators(ctx,16);
  const edge=draws[0],screen=g.worldToScreen(edge.x,edge.y);
  assert(screen.x-edge.w*g.cam.scale/2>=8-1e-8);
  assert(screen.y-edge.h*g.cam.scale/2>=8-1e-8);
});
check("capture plays fight then cat iris and waits at fail for Retry", () => {
  const g=game(loaded.levels.find(d=>d.id==='map98'));
  const level=g.level,index=g.levelIndex,c=level.cats[0],events=[];
  g.onLevelEnd=event=>events.push(event.type);
  g.level.cheeses[0].taken=true;g.cheeseLeft=0;g.score=100;
  g.carried=[{prop:8,x:g.mouse.x,y:g.mouse.y}];
  g.mouse.setPath([{x:g.mouse.x+32,y:g.mouse.y}]);
  const capturedAt={x:g.mouse.x,y:g.mouse.y},catAt={x:c.x,y:c.y};
  g.caught(c);const death=g.death;g.caught(c);
  // Round-2 native fail flow: caught() no longer emits immediately. The event
  // fires exactly once when the phase reaches 'fail' (fight 1.2s -> closing
  // 0.6s -> fail), and the game waits there for UI Retry.
  assert.equal(g.caughtCount,1);assert.deepEqual(events,[]);
  assert.equal(g.state,'caught');assert.equal(death.phase,'fight');
  assert.equal(g.mouse.moving,false);
  const time=g.time;
  g.update(.4);assert.equal(g.time,time);
  assert.deepEqual({x:g.mouse.x,y:g.mouse.y},capturedAt);
  assert.deepEqual({x:c.x,y:c.y},catAt);
  draws.length=0;g.drawFight(ctx);
  assert.equal(draws[0].key,'fight');assert.equal(draws[0].frame,5);
  g.update(CFG.game.caughtFightSeconds-.4+.05);
  assert.equal(g.death.phase,'closing');
  const sizes=[];g.sprites.catIris=(_ctx,_x,_y,size)=>{sizes.push(size);return true;};
  g.drawCaughtMask(ctx);g.update(.3);g.drawCaughtMask(ctx);
  assert(sizes[1]<sizes[0]);
  g.update(CFG.game.caughtCloseSeconds-.35+.01);
  assert.equal(g.death.phase,'fail');
  assert.deepEqual(events,['caught']);
  // No auto-respawn / no hidden reload: the fail scene waits for retryLevel().
  g.update(5);assert.equal(g.state,'caught');assert.equal(g.death.phase,'fail');
  assert.deepEqual(events,['caught']);
  assert.equal(g.level,level);assert.equal(g.level.cheeses[0].taken,true);
  g.retryLevel();
  assert.equal(g.state,'playing');assert.equal(g.death,null);
  assert.equal(g.level,level);assert.equal(g.levelIndex,index);
  assert(g.level.cheeses.every(cheese=>!cheese.taken));
  assert.equal(g.carried.length,0);assert.equal(g.score,0);assert.equal(g.time,0);
});
check("cat-shaped iris cuts an opening in the purple tiled background without moving the pattern", () => {
  const s=new Sprites();s.images.cat_iris={image:{},cols:1,fw:512,fh:512};
  s.images.death_bg={image:{},cols:1,fw:256,fh:256};
  s.irisCanvas={};const images=[],layerImages=[],compositing=[];
  const layer=new Proxy({clearRect(){},drawImage(...args){layerImages.push(args);}},
    {set:(obj,key,value)=>{if(key==='globalCompositeOperation')compositing.push(value);obj[key]=value;return true;}});
  s.deathCanvas={width:960,height:640,getContext:()=>layer};
  const maskCtx={drawImage(...args){images.push(args);}};
  assert(s.catIris(maskCtx,480,320,200,960,640));
  assert.equal(images[0][0],s.deathCanvas);
  assert.deepEqual(layerImages.at(-1),[s.irisCanvas,380,220,200,200]);
  assert.deepEqual(compositing,['source-over','destination-out','source-over']);
  const pattern=layerImages.filter(args=>args[0]===s.images.death_bg.image);
  assert(pattern.length>1);assert.deepEqual(pattern[0].slice(1),[0,0,256,256]);
  layerImages.length=0;
  s.catIris(maskCtx,480,320,100,960,640);
  assert.deepEqual(layerImages.filter(args=>args[0]===s.images.death_bg.image),pattern);
  const raw=fs.readFileSync('assets/ui/cat_silhoutte.png');
  assert.equal(raw.readUInt32BE(16),512);assert.equal(raw.readUInt32BE(20),512);
});
check("completion announcement precedes results once and freezes gameplay", () => {
  const g=game(loaded.levels.find(d=>d.id==='map705')),events=[];
  g.time=8;g.cheeseCounts={10:2};g.stats.paths=1;g.stats.bump=1;
  g.onLevelEnd=event=>events.push(event.type);
  g.levelClear();g.levelClear();
  // Round-3 win flow: the hero shrinks into the exit first ('enter'), then the
  // results mask starts with the 'clear' event. The level itself must not zoom.
  assert.deepEqual(events,[]);assert.equal(g.state,'levelclear');assert.equal(g.clearPresentation.phase,'enter');
  g.update(CFG.game.clearEnterSeconds+.01);
  assert.deepEqual(events,['clear']);assert.equal(g.clearPresentation.phase,'announcement');
  assert.equal(g.clearPresentation.scale,0);assert(Math.abs(g.mouse.x-g.level.exit.x)<.01);
  g.update(.5);assert.equal(g.time,8);assert.deepEqual(events,['clear']);
  g.update(CFG.game.clearAnnouncementSeconds);
  assert.equal(g.clearPresentation.phase,'results');assert.deepEqual(events,['clear','results']);
  g.update(5);assert.deepEqual(events,['clear','results']);
  const model=resultsModel(g.level,g.lastSettlement);
  assert.equal(model.title,'Catch Me If You Can');assert.equal(model.number,'1-4');
  assert.deepEqual([model.points,model.bonus,model.total,model.time],[40,70,110,'0m 8s']);
  assert(model.goals.every(goal=>goal.earned));
  assert.equal(model.goals[1].icon,'star_catdizzy');
  g.restart();assert.equal(g.clearPresentation,null);
});
check("time reward counts down without adding a lethal level timer", () => {
  const g=game(loaded.levels.find(d=>d.id==='map705'));
  assert.equal(g.timeLeft,null);
  g.time=.199;assert.equal(g.settle().timeBonus,110);
  g.time=.2;assert.equal(g.settle().timeBonus,109);
  g.time=8;assert.equal(g.settle().timeBonus,70);
  g.time=100;assert.equal(g.settle().timeBonus,0);assert.equal(g.state,'playing');
});
check("all eight world maps bind authored UID nodes to actual loaded levels", () => {
  const worlds=JSON.parse(fs.readFileSync('assets/menu/worlds.json','utf8'));
  const metadata=JSON.parse(fs.readFileSync('assets/levels.json','utf8'));
  assert.equal(worlds.length,8);
  for(const world of worlds){
    const nodes=worldNodes(world,loaded.levels);
    assert.equal(nodes.length,world.nodes.length,`world ${world.id} node binding`);
    assert(fs.statSync(world.image).size>1000);
    for(const node of nodes){
      assert.equal(loaded.levels[node.index].id,node.levelId);
      assert.equal(metadata.find(level=>level.uid===node.tag).map,node.levelId.replace('map',''));
      assert(node.x>=0&&node.x<=480&&node.y>=0&&node.y<=320);
    }
    assert(world.routes.length>0);
  }
  assert.equal(loaded.levels[worldNodes(worlds[0],loaded.levels).find(node=>node.tag===4).index].num,'1-4');
});
check("menu settings validate stored values without erasing progress", () => {
  assert.deepEqual(normaliseSettings(null),{effects:.8,music:.55,language:'zh'});
  assert.deepEqual(normaliseSettings({effects:4,music:-1,language:'en'}),{effects:1,music:0,language:'en'});
  const saved={effects:.3,music:.4,language:'en'};
  assert.deepEqual(normaliseSettings(JSON.parse(JSON.stringify(saved))),saved);
  assert.equal(normaliseSettings({effects:NaN,language:'unknown'}).effects,.8);
});
check("converted menu music and click retain source channels and sample rate", () => {
  for(const [name,source] of [['menu-music','music/CM_Menu_Loop'],['menu-click','sound/ui/ui_button']]){
    const ogg=fs.readFileSync(`assets/menu/${name}.ogg`),sps=fs.readFileSync(`com.ea.spymouse_row/files/res/sound/${source}.sps`);
    assert.equal(ogg.subarray(0,4).toString(),'OggS');
    const packet=ogg.indexOf(Buffer.from([1,...Buffer.from('vorbis')]));assert(packet>=0);
    const header=sps.readUInt32BE(4);
    assert.equal(ogg[packet+11],((header>>>18)&63)+1);
    assert.equal(ogg.readUInt32LE(packet+12),header&0x3ffff);
  }
});
check('map walking follows segments at the same speed across frame rates and snaps only near nodes',()=>{
  const nodes=[{index:3,x:50,y:50}];
  const snapped=snapMapPath([{x:0,y:0},{x:90,y:95}],nodes);assert.equal(snapped.node.index,3);assert.deepEqual(snapped.path.at(-1),{x:100,y:100});
  assert.equal(snapMapPath([{x:0,y:0}],nodes).node,null);
  const run=dt=>{const walk={position:{x:0,y:0},path:[{x:0,y:0},{x:100,y:0},{x:100,y:100}]};for(let i=0;i<Math.round(1/dt);i++)advanceMapWalk(walk,dt,150);return walk;};
  const a=run(1/60),b=run(1/20);assert(Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y)<1e-7);
  assert(Math.abs(a.position.y-50)<1e-7);assert.equal(advanceMapWalk(a,10,150),true);assert.deepEqual(a.position,{x:100,y:100});
});
check('map node activation takes authored road corners in either direction',()=>{
  const routes=[{points:[{x:0,y:0},{x:50,y:0},{x:50,y:50}]}];
  const path=mapRoadPath({x:0,y:0},{x:100,y:100},routes);assert(path.some(p=>p.x===100&&p.y===0));
  const reverse=mapRoadPath({x:100,y:100},{x:0,y:0},routes);assert(reverse.some(p=>p.x===100&&p.y===0));assert.deepEqual(reverse.at(-1),{x:0,y:0});
});
check('drawn map paths reject grass and remain on roads through corners and disconnected branches',()=>{
  const routes=[{points:[{x:0,y:0},{x:50,y:0},{x:50,y:50}]},{points:[{x:200,y:0},{x:200,y:50}]}];
  const path=[{x:0,y:0}];assert.equal(extendMapRoadPath(path,{x:40,y:60},routes),false);assert.equal(path.length,1);
  assert.equal(extendMapRoadPath(path,{x:105,y:80},routes),true);
  assert(path.some(p=>p.x===100&&p.y===0));assert(path.every(p=>projectMapRoad(p,routes).distance<.001));
  assert.deepEqual(mapRoadPath(path.at(-1),{x:400,y:100},routes),[]);
  assert.deepEqual(mapRoadPath({x:0,y:0},{x:30,y:90},routes),[]);
  const partial=mapRoadPath({x:10,y:0},{x:20,y:0},routes);assert.deepEqual(partial,[{x:10,y:0},{x:20,y:0}]);
});
check('all map nodes and seven native chapter exits are reachable along source road links',()=>{
  const worlds=JSON.parse(fs.readFileSync('assets/menu/worlds.json','utf8'));
  for(const world of worlds){
    const start=nodePoint(world.nodes[0]);
    for(const node of [...world.nodes,...(world.exit?[world.exit]:[])]){
      const path=mapRoadPath(start,nodePoint(node),world.routes);assert(path.length,`world ${world.id} ${node.levelId||'chapter exit'}`);
      // Native marker centres can differ slightly from the road centreline.
      assert(path.every(p=>projectMapRoad(p,world.routes).distance<=24));
    }
    if(world.id<8)assert(world.exit);else assert.equal(world.exit,null);
  }
});
check('node selection reveals its action immediately while the mouse is still walking',()=>{
  const worlds=JSON.parse(fs.readFileSync('assets/menu/worlds.json','utf8')),world=worlds[0],nodes=worldNodes(world,loaded.levels);
  nodes.push({...world.exit,index:'next',kind:'next'});
  const elements={};
  for(const selector of ['.world-heading','.world-title','.world-mouse','.map-play','.world-nodes'])elements[selector]={hidden:false,style:{},classList:{toggle(){}},setAttribute(name,value){this[name]=value;},children:nodes.map(n=>({dataset:{index:String(n.index)},classList:{toggle(){}}}))};
  const front=Object.create(FrontEnd.prototype);
  Object.assign(front,{levels:loaded.levels,world,worlds,nodes,settings:{language:'zh'},mapPosition:nodePoint(nodes[0]),find:selector=>elements[selector],cancelMapWalk(){this.mapWalk=null;},renderMapMouse(){}});
  const saved=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>1;
  try{
    front.walkToNode(nodes[2]);assert(front.mapWalk);assert.equal(front.selected,nodes[2].index);assert.equal(elements['.map-play'].hidden,false);assert.equal(elements['.map-play'].textContent,'游戏！');assert.deepEqual(front.mapPosition,nodePoint(nodes[0]));
    front.walkToNode(nodes.at(-1));assert.equal(front.selected,'next');assert.equal(elements['.map-play'].hidden,false);assert.equal(elements['.map-play'].textContent,'下一章');
    let changed=null;front.setWorld=world=>changed=world;front.activateMapPlay();assert.equal(changed.id,2);
    front.world=worlds.at(-1);changed=null;front.activateMapPlay();assert.equal(changed,null);
  }finally{if(saved===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=saved;}
});
check('map rasterization includes every native road and branch with correct junction depth',()=>{
  const audit=JSON.parse(fs.readFileSync('assets/menu/geometry-audit.json','utf8'));assert.equal(audit.length,8);
  for(const world of audit){
    const prefix=`world${String(world.world).padStart(2,'0')}`,directory=`com.ea.spymouse_row/files/res/world/${prefix}`;
    const expected=fs.readdirSync(directory).filter(name=>new RegExp(`^${prefix}_(road|hroad|hiddenroad).*\\.obj$`).test(name)&&!name.includes('alpha'));
    const roads=world.meshes.filter(m=>/_(road|hroad|hiddenroad)/.test(m.file));
    assert.deepEqual(roads.map(m=>m.file).sort(),expected.sort(),`world ${world.world} missing road geometry`);
    assert(roads.every(m=>m.triangles>0),`world ${world.world} unrendered material/texture`);
    const junctions=world.meshes.filter(m=>/_(road|hroad|hiddenroad|node)/.test(m.file));
    for(let i=1;i<junctions.length;i++)assert(junctions[i-1].depth>=junctions[i].depth,`world ${world.world} node/road occlusion order`);
  }
  const second=audit.find(w=>w.world===2);assert.equal(second.meshes.filter(m=>/_road_/.test(m.file)).length,13);
});
check('known chapter 2/3/4 road seams render road pixels rather than covering grass',()=>{
  const audit=JSON.parse(fs.readFileSync('assets/menu/geometry-audit.json','utf8'));
  for(const id of [2,3,4]){
    const samples=audit.find(w=>w.world===id).junctionSamples;assert(samples.length);
    for(const {x,y,rgb:[r,g,b]} of samples)assert(r>=g&&g>=b&&r-b<45,`world ${id} seam ${x},${y} covered by grass`);
  }
});
check('native 1-7 pause shows sleep and wake without changing the 13 second pause',()=>{
  const g=game(loaded.levels.find(d=>d.id==='map98')),c=g.level.cats[0],wp=c.route.at(-1);
  c.x=wp.x;c.y=wp.y;c.routeIndex=c.route.length-1;c.routeDir=1;
  c.update(1/60,g.level.world,null,[]);
  assert.equal(c.endpointTimer,13);assert.equal(c.rest.phase,'sleep');assert.equal(c.state,'patrol');
  const point={x:c.x,y:c.y};
  for(let i=0;i<749;i++)c.update(1/60,g.level.world,null,[]);
  assert.deepEqual({x:c.x,y:c.y},point);assert.equal(c.rest.phase,'wake');assert(c.endpointTimer>0&&c.endpointTimer<.6);
  for(let i=0;i<34;i++)c.update(1/60,g.level.world,null,[]);
  assert(c.moving);assert.equal(c.rest,null);
  const short=cat();short.endpointTimer=.5;short.update(1/60,world,null,[]);assert.equal(short.rest,null);
});
check('sleep interruption uses common strips without walking, blank frames or persistent Z',()=>{
  const s=new Sprites(),draws=[],ctx={drawImage(...args){draws.push(args);},save(){},restore(){},translate(){},scale(){}};
  for(const profile of Object.values(CAT_REST_PROFILES)){
    const png=fs.readFileSync(`assets/sprites/${profile.prefix}_common.png`),cell=profile.cell||64,cols=png.readUInt32BE(16)/cell;
    assert(Number.isInteger(cols));assert.equal(png.readUInt32BE(20),cell);
    for(const col of profile.breathing)assert(col<cols);
    s.images[`${profile.prefix}_common`]={cols,fw:cell,fh:cell,image:{prefix:profile.prefix}};
  }
  s.images.sleep_ptcl={cols:8,fw:32,fh:32,image:{particle:true}};
  const c=cat();c.moving=false;c.endpointTimer=13;
  updateCatRest(c,.4);assert.equal(catRestFrameIndex(CAT_REST_PROFILES[0],'sleep',c.rest.frameTime),2);
  assert(s.catRestFrame(ctx,c,100,100,64,64));assert.equal(draws[0][1],128);assert.equal(draws.length,1);
  updateCatRest(c,.6);draws.length=0;s.catRestFrame(ctx,c,100,100,64,64);assert.equal(draws.length,2);assert(draws[1][0].particle);
  c.state='spot';updateCatRest(c,.1);assert.equal(c.rest.phase,'wake');draws.length=0;s.catRestFrame(ctx,c,100,100,64,64);assert.equal(draws.length,1);
  updateCatRest(c,.6);assert.equal(c.rest,null);
  c.state='stunned';updateCatRest(c,.1);assert.equal(c.rest,null);
});
check('non-solid MBN line props stay out of collision, and no contour seals a native route',()=>{
  // Regression: a prop-114 line crossed the 1-Boss corridor at map736 x=1550
  // where the art paints nothing, so the hero jammed on an invisible wall. The
  // import now drops line classes the authored route network (linesB) walks
  // through, so nothing a route crosses may survive as collision.
  const index=JSON.parse(fs.readFileSync('assets/collision/index.json','utf8'));
  const worldPoint=v=>({x:v.x*2+32,y:(320-v.y)*2+64});
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const crosses=(p1,p2,p3,p4)=>{
    const d1=cross(p3,p4,p1),d2=cross(p3,p4,p2),d3=cross(p1,p2,p3),d4=cross(p1,p2,p4);
    return ((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0));
  };
  let checked=0;
  for(const key of index){
    const file=`com.ea.spymouse_row/files/res/${key}/${key}.mbn`;
    if(!fs.existsSync(file))continue;
    const info=parseMbn(file);
    const routes=(info.linesB||[]).map(l=>{const a=info.vertices[l.vA],b=info.vertices[l.vB];return a&&b?[worldPoint(a),worldPoint(b)]:null;}).filter(Boolean);
    if(!routes.length)continue;
    const collision=JSON.parse(fs.readFileSync(`assets/collision/${key}.json`,'utf8'));
    for(const s of collision.segments){
      const p1={x:s[0],y:s[1]},p2={x:s[2],y:s[3]};
      for(const [r1,r2] of routes){
        assert(!crosses(p1,p2,r1,r2),`${key}: collision ${s.map(Math.round)} cuts an authored route`);
      }
      checked++;
    }
  }
  assert(checked>1000,`collision data present (${checked} spans)`);
  // The exact span the player was jammed on: floor is open, nothing blocks.
  const w=World.fromMask(JSON.parse(fs.readFileSync('assets/masks/map736.json','utf8')));
  w.setCollisionSegments(JSON.parse(fs.readFileSync('assets/collision/map736.json','utf8')).segments);
  assert.equal(w.circleHitsWall(1550,360,5.6),false,'map736 x=1550 must be walkable');
  assert(w.lineClear(1500,360,1800,360,5.6),'the corridor span is clear for a body-sized hero');
});
fs.writeFileSync("analysis/repair-regressions.json", JSON.stringify({ results, pass: true }, null, 2));
console.log(`Repair regressions: ${results.length} passed`);
