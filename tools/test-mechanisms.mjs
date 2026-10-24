import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Game} from '../src/game.js';
import {loadContent} from '../src/content.js';
import {MECHANISM_SHEETS,portalColor,gateVertical} from '../src/mechanism-types.js';
import {CFG} from '../src/config.js';
import {Cat} from '../src/entities.js';
import {advanceMover} from '../src/movers.js';
import {holeColour} from '../src/props.js';
import {updateHazards} from '../src/hazards.js';
import {updateCwmice} from '../src/cwmouse.js';
import {pipeGroups,pipeDestination} from '../src/pipe-portals.js';
import {audio} from '../src/audio.js';
import {Sprites} from '../src/sprites.js';
import {entranceScale,ENTRANCE_POP_SECONDS} from '../src/entrance-feedback.js';
const ctx=new Proxy({}, {get:()=>()=>{},set:()=>true});
const canvas={getContext:()=>ctx,getBoundingClientRect:()=>({width:960,height:640})};
globalThis.window={devicePixelRatio:1};globalThis.Image=class{set src(v){}};
globalThis.fetch=async url=>({ok:fs.existsSync(url),json:async()=>JSON.parse(fs.readFileSync(url,'utf8'))});
const {levels}=await loadContent();
const results=[];
function check(name,fn){fn();results.push(name);}
function make(objects=[],extras={}){
 const g=new Game(canvas,{intro:false});
 g.loadLevel({id:'test',num:'1-1',cell:16,rows:Array.from({length:24},(_,y)=>y===0||y===23?'#'.repeat(40):'#'+'.'.repeat(38)+'#'),mouseStart:{x:56,y:56},cheeses:[{x:550,y:300,prop:8}],mechanisms:{objects},...extras},0);
 return g;
}
const item=(item,id=1,x=120,y=120)=>({kind:'item',id,item,prop:14,x,y,tag:0});
function touch(g,o){Object.assign(g.mouse,{x:o.x,y:o.y});g.level.mechanisms.update(g,1/60,g.mouse);}
check('all runtime maps and 61 additional floors load with valid navigation',()=>{
 assert.equal(levels.length,121);assert.equal(levels.flatMap(d=>d.extraFloors).length,61);
 for(const def of levels){const g=make([],def);for(const floor of g.floorLevels.values()){
  assert(floor.world.grid.some(v=>v===0));assert.equal(floor.world.grid.length,floor.world.cols*floor.world.rows);
  for(const c of floor.cheeses)assert(!floor.world.isWallAt(c.x,c.y),`${def.id}/${floor.floor}: cheese`);
  for(const o of floor.mechanisms.items)assert(!floor.world.isWallAt(o.x,o.y),`${def.id}/${floor.floor}: item`);
  g.level=floor;floor.mechanisms.prepare(g,1/60);floor.mechanisms.update(g,1/60,g.mouse);floor.mechanisms.draw(g,ctx);
 }}
});
check('single and double chilli use native speed formula, expire and reset',()=>{
 for(const [kind,speed,seconds] of [['chilli',1.8,16],['chilli2',2.44,8]]){
  const g=make([item(kind)]),m=g.level.mechanisms;touch(g,m.items[0]);m.prepare(g,0);
  assert(Math.abs(g.mouse.speed-CFG.mouse.speedCells*16*speed)<1e-6);assert.equal(g.stats.items.chilli,1);
  touch(g,m.items[0]);assert.equal(g.stats.items.chilli,1);m.prepare(g,seconds+.01);assert.equal(m.boost,null);
  assert.equal(g.mouse.speed,CFG.mouse.speedCells*16);g.resetLevel(true);assert(!m.items[0].taken);
 }
});
check('fast movement cannot skip an item between frames',()=>{
 const g=make([item('chilli')]),m=g.level.mechanisms;Object.assign(g.mouse,{x:160,y:120});m.update(g,.1,{x:80,y:120});assert(m.boost);
});
check('cover conceals vision and expires; balloons burst on hiding or impact',()=>{
 const g=make([item('cover'),item('balloon',2,160)]),m=g.level.mechanisms;
 touch(g,m.items[0]);m.prepare(g,0);assert(g.mouse.disguised);m.prepare(g,10.1);assert(!g.mouse.disguised);
 touch(g,m.items[1]);assert(m.balloon);assert(m.absorbProjectile());assert(!m.absorbProjectile());m.balloon=true;m.onHide();assert(!m.balloon);
});
check('tagged switches change both player and cat grids; timed gates use native 10/20/30 s and close through bodies',()=>{
 const gate={kind:'gate',prop:210,tag:101,id:1,x:240,y:160},sw={kind:'switch',prop:67,tag:101,id:2,x:120,y:120};
 const g=make([gate,sw,{...gate,id:3,tag:201,x:400}]),m=g.level.mechanisms;
 assert(g.level.world.isWallAt(240,160));touch(g,m.objects[1]);m.prepare(g,.01);
 assert(!g.level.world.isWallAt(240,160));assert(!g.level.catWorld.isWallAt(240,160));assert(g.level.world.isWallAt(400,160));
 // Native 0x99eb0: prop 67 holds for 10000 ms.
 m.prepare(g,9.9);assert(!g.level.world.isWallAt(240,160));
 m.prepare(g,.2);assert(g.level.world.isWallAt(240,160));
 // No body guard: a closing gate ignores a player standing in the doorway.
 m.activate(g,m.objects[1]);m.prepare(g,0);Object.assign(g.mouse,{x:240,y:160});m.prepare(g,10.1);assert(!m.gates[0].open);
 Object.assign(g.mouse,{x:80,y:80});m.prepare(g,.01);assert(!m.gates[0].open);
 g.resetLevel(true);assert(!m.gates[0].open);assert.equal(m.signals.size,0);assert.equal(m.signalTimers.size,0);
});
check('native switch families: latch / timed / remote / two-state',()=>{
 const gates=[{kind:'gate',prop:210,tag:101,id:1,x:240,y:160}];
 const g=make([...gates,{kind:'switch',prop:65,tag:101,id:2,x:120,y:120}]),m=g.level.mechanisms;
 touch(g,m.objects[1]);m.prepare(g,.01);assert(m.gates[0].open);assert.equal(m.signalTimers.size,0);
 // Latch: player can leave, the signal persists.
 Object.assign(g.mouse,{x:80,y:80});m.prepare(g,60);assert(m.gates[0].open);
 // 66 latches closed.
 const g2=make([...gates,{kind:'switch',prop:66,tag:101,id:2,x:120,y:120}]),m2=g2.level.mechanisms;
 touch(g2,m2.objects[1]);m2.prepare(g2,.01);assert(!m2.gates[0].open);
 // Remote receivers ignore the player; an equal-Tag signal drives them.
 const g3=make([...gates,{kind:'switch',prop:151,tag:101,id:2,x:120,y:120}]),m3=g3.level.mechanisms;
 touch(g3,m3.objects[1]);m3.prepare(g3,.01);assert(!m3.gates[0].open);
 m3.signals.set(101,true);m3.prepare(g3,.01);assert(m3.gates[0].open);assert(m3.objects[1].active);
 // 155 is a two-state trigger: first press opens, second closes.
 const g4=make([...gates,{kind:'switch',prop:155,tag:101,id:2,x:120,y:120}]),m4=g4.level.mechanisms;
 touch(g4,m4.objects[1]);m4.prepare(g4,.01);assert(m4.gates[0].open);
 Object.assign(g4.mouse,{x:80,y:80});m4.update(g4,.01,g4.mouse);touch(g4,m4.objects[1]);m4.prepare(g4,.01);assert(!m4.gates[0].open);
});
check('cat-only switches ignore the player and open initially closed gates for cats',()=>{
 const g=make([{kind:'switch',prop:80,tag:2,id:1,x:120,y:120},{kind:'gate',prop:210,tag:2,id:2,x:240,y:160}]),m=g.level.mechanisms;
 touch(g,m.objects[0]);assert.equal(m.signals.size,0);g.level.cats.push({x:120,y:120});m.update(g,.01,g.mouse);m.prepare(g,0);assert(m.gates[0].open);
});
check('initially open gates invert their signal',()=>{
 const g=make([{kind:'gate',prop:218,tag:1,id:1,x:240,y:160}]),m=g.level.mechanisms;
 assert(m.gates[0].open);m.signals.set(1,true);m.prepare(g,0);assert(!m.gates[0].open);
});
check('cheese dispensers emit their first authored cheese immediately',()=>{
 const g=make([{kind:'machine',prop:94,tag:12,id:1,x:240,y:160},{kind:'switch',prop:150,tag:12,id:2,x:120,y:120}],{cheeses:[]}),m=g.level.mechanisms;
 m.prepare(g,1/60);
 assert.equal(g.cheeseLeft,1);
 assert.equal(g.level.cheeses.filter(c=>c.initial).length,1);
 assert.equal(g.pendingMachineCheese,2);
});
check('machine output respects the native carry limit of 4',()=>{
 const g=make([{kind:'machine',prop:94,tag:12,id:1,x:240,y:160},{kind:'switch',prop:150,tag:12,id:2,x:120,y:120}],{cheeses:[]}),m=g.level.mechanisms;
 g.carried=Array.from({length:4},(_,i)=>({prop:8,id:i}));
 touch(g,m.objects[1]);
 assert.equal(g.cheeseLeft,0);
 assert.equal(g.pendingMachineCheese,2);
});
check('cheese dispensers consume native charges and wait for a same-tag 150 button',()=>{
 const g=make([{kind:'machine',prop:94,tag:12,id:1,x:240,y:160},{kind:'switch',prop:150,tag:12,id:2,x:120,y:120}],{cheeses:[]}),m=g.level.mechanisms;
 assert.equal(g.pendingMachineCheese,2); // native 0xa12ec: prop 94 carries 2 charges
 touch(g,m.objects[1]);assert.equal(g.cheeseLeft,1);assert.equal(g.pendingMachineCheese,1);
 Object.assign(g.mouse,{x:80,y:80});m.update(g,1,g.mouse);
 touch(g,m.objects[1]);assert.equal(g.cheeseLeft,2);assert.equal(g.pendingMachineCheese,0);
 Object.assign(g.mouse,{x:80,y:80});m.update(g,1,g.mouse);
 touch(g,m.objects[1]);assert.equal(g.cheeseLeft,2);
 g.resetLevel(true);assert.equal(g.cheeseLeft,0);assert.equal(g.pendingMachineCheese,2);
});
check('button-operated repeat dispensers wait for the button instead of generating unattended cheese',()=>{
 const g=make([{kind:'machine',prop:61,tag:12,id:1,x:240,y:160},{kind:'switch',prop:150,tag:12,id:2,x:120,y:120}],{cheeses:[]}),m=g.level.mechanisms;
 m.update(g,10,g.mouse);assert.equal(g.cheeseLeft,0);assert.equal(g.pendingMachineCheese,3);
 for(let i=0;i<3;i++){
  touch(g,m.objects[1]);assert.equal(g.cheeseLeft,i+1);
  Object.assign(g.mouse,{x:80,y:80});m.update(g,1,g.mouse);
 }
 touch(g,m.objects[1]);assert.equal(g.cheeseLeft,3);
});
check('distant furniture interaction completes on arrival and can be exited',()=>{
 const g=make([{kind:'furniture',prop:25,id:1,x:240,y:160}]),m=g.level.mechanisms;
 assert(m.handleTap(g,{x:240,y:160}));assert(m.pendingInteraction);Object.assign(g.mouse,{x:240,y:160});m.update(g,.01,g.mouse);
 assert(g.mouse.hidden);assert.equal(g.mouse.furnitureId,1);m.handleTap(g,{x:300,y:200});assert(!g.mouse.hidden);
});
check('trap cheesemask is registered and an armed trap draws frame 0 with bait',()=>{
 assert.deepEqual(MECHANISM_SHEETS.mouse_trap_cheesemask,[64,84]);
 assert(fs.existsSync('assets/sprites/mouse_trap_cheesemask.png'));
 const trap={kind:'trap',prop:60,id:1,x:120,y:120},g=make([trap]),m=g.level.mechanisms;
 m.prepare(g,3.1);assert(m.objects[0].armed);
 const calls=[];g.sprites.frame=(_ctx,key,frame,x,y,w,h)=>{calls.push({key,frame,x,y,w,h});return true;};
 m.draw(g,ctx);
 assert(calls.some(c=>c.key==='mouse_trap'&&c.frame===0));
 assert(calls.some(c=>c.key==='mouse_trap_cheesemask'&&c.frame===0&&c.w===64&&c.h===84));
});
check('trap is live from spawn (no arming countdown) and a bare step kills with 119',()=>{
 const trap={kind:'trap',prop:60,id:1,x:120,y:120};
 let g=make([trap]),m=g.level.mechanisms,caught=[];g.caught=(cat,cause)=>caught.push(cause);
 assert(m.objects[0].armed,'state 0x1a is active immediately');
 const played=[],orig=audio.playSound;audio.playSound=(id)=>{played.push(id);};
 try{
  touch(g,trap);assert.deepEqual(caught,['trap']);assert(played.includes(119));
 }finally{audio.playSound=orig;}
});
check('carried cwmouse disarms trap: 0..7 frames, 68+110, real collectTrapCheese',()=>{
 const trap={kind:'trap',prop:60,id:1,x:120,y:120},g=make([trap]),m=g.level.mechanisms;
 g.level.cwmice=[{picked:true,x:150,y:120,gone:false,fleeing:false,t:0}];
 g.cheeseCounts={};g.carried=[];g.pickupEffects=[];g.score=0;g.cheeseLeft=1;
 const played=[];const orig=audio.playSound;audio.playSound=(id)=>{played.push(id);};
 try{
  m.prepare(g,0);
  Object.assign(g.mouse,{x:trap.x,y:trap.y});
  m.update(g,1/60,g.mouse);
  assert(m.objects[0].spent);assert(m.objects[0].disarmT===0);
  // Lead's game.collectTrapCheese: wedge prop 10 enters score/carried chain
  // (bonus cheese; cheeseLeft / exit gate must not change).
  assert.equal(g.stats.items.disarm_trap,1);
  assert.equal(g.cheeseCounts[10],1);assert.equal(g.carried.length,1);assert.equal(g.carried[0].prop,10);
  assert(g.pickupEffects.length>=1);assert.equal(m.objects[0].cheeseTaken,true);assert.equal(g.score,0);
  assert.equal(g.cheeseLeft,1);
  assert(played.includes(68));assert(played.includes(110));assert(!played.includes(119));
  assert(g.level.cwmice[0].gone,'caught cwmouse is removed in place');
  assert(!g.level.cwmice[0].fleeing,'caught cwmouse must not fly to the trap');
  const frames=[];g.sprites.frame=(_ctx,key,frame)=>{if(key==='mouse_trap')frames.push(frame);return true;};
  for(let i=0;i<9;i++){m.draw(g,ctx);m.update(g,.1,g.mouse);}
  assert.deepEqual(frames.slice(0,8),[0,1,2,3,4,5,6,7]);
  assert(frames.slice(8).every(f=>f===7),'sequence must stop on frame 7');
  updateCwmice(g.level,g.mouse,2);
  assert(g.level.cwmice[0].gone,'cwmouse stays removed');
 }finally{audio.playSound=orig;}
});
check('colored pipe portals pair by Tag, require a flipflap, and single flaps emerge in place',()=>{
 const pieces=[{id:1,prop:200,tag:7},{id:2,prop:204,tag:7},{id:3,prop:201,tag:8},{id:4,prop:206,tag:8},{id:5,prop:202,tag:9}];
 const groups=pipeGroups(pieces);assert.equal(groups.length,2);
 const g7=groups.find(g=>g.tag===7),g8=groups.find(g=>g.tag===8);
 assert.equal(pipeDestination(g7,pieces[0]).id,2);
 // Entering the single flipflap itself emerges at that same flap.
 assert.equal(pipeDestination(g7,pieces[1]).id,2);
 assert.equal(pipeDestination(g8,pieces[2]).id,4);
 assert.equal(pipeDestination(g8,pieces[3]).id,4);
 // A same-Tag assembly without a flipflap is scenery, not a portal.
 assert.equal(pipeGroups([{id:9,prop:200,tag:3}]).length,0);
 assert.equal(portalColor(0),holeColour(0));assert.equal(portalColor(7),holeColour(7));assert.equal(portalColor(107),holeColour(107));
});
check('cannon follows its authored route and lands on walkable floor',()=>{
 const cannon={kind:'cannon',prop:28,id:1,x:120,y:120,route:[{x:120,y:120},{x:400,y:240}]},g=make([cannon]),m=g.level.mechanisms;
 touch(g,cannon);assert(m.transit);m.prepare(g,.4);assert(g.mouse.airborne&&g.mouse.lift>0);m.prepare(g,.41);assert(!g.mouse.airborne);assert(!g.level.world.isWallAt(g.mouse.x,g.mouse.y));
});
check('exit doors 358/359 only open from boss win / completed goal and expose contact',()=>{
 const g=make([{kind:'door',prop:359,id:1,x:240,y:160}],{cheeses:[]}),m=g.level.mechanisms;
 Object.assign(g.mouse,{x:240,y:160});m.prepare(g,.01);assert(m.objects[0].open);
 m.update(g,.01,g.mouse);assert(m.exitDoorReady);assert.equal(m.exitDoorReady.prop,359);
 g.cheeseLeft=1;m.prepare(g,.01);assert(!m.objects[0].open);
 assert(m.setDoorOpen(359,null,true));m.prepare(g,.01);assert(m.objects[0].open);
 const boss=make([{kind:'door',prop:358,id:1,tag:5,x:240,y:160}],{cheeses:[]}),bm=boss.level.mechanisms;
 bm.prepare(boss,.01);assert(!bm.objects[0].open);boss.bossWin=true;bm.prepare(boss,.01);assert(bm.objects[0].open);
});
check('hazard layer slows in water and kills in lava/fire cells once',()=>{
 const g=make([],levels.find(d=>d.id==='map575'));
 assert.equal(g.level.hazardCells.size,219);
 const cell=[...g.level.hazardCells][0],tx=cell%g.level.world.cols,ty=Math.floor(cell/g.level.world.cols);
 Object.assign(g.mouse,{x:(tx+.5)*g.level.world.cell,y:(ty+.5)*g.level.world.cell,hidden:false,airborne:false});
 let causes=[];g.caught=(cat,cause)=>causes.push(cause);g.stats={items:{}};
 updateHazards(g,1/60);assert.deepEqual(causes,['lava']);assert.equal(g.stats.touched_lava,1);
 causes=[];g.mouse.hidden=true;updateHazards(g,1/60);assert.deepEqual(causes,[]);
 g.mouse.hidden=false;g.mouse.airborne=true;updateHazards(g,1/60);assert.deepEqual(causes,[]);
 g.mouse.airborne=false;Object.assign(g.mouse,{x:32,y:32});updateHazards(g,1/60);assert.equal(g.stats.touched_lava,1);
 const safe=make([],levels.find(d=>d.id==='map10'));
 const si=Math.floor(safe.mouse.y/safe.level.world.cell)*safe.level.world.cols+Math.floor(safe.mouse.x/safe.level.world.cell);
 safe.level.waterCells.add(si);updateHazards(safe,1/60);assert.equal(safe.envSpeedMult,0.9);
 safe.level.waterCells.clear();updateHazards(safe,1/60);assert.equal(safe.envSpeedMult,1);
});
check('native mechanism counts, music/ambience and explicit floor links survive regeneration',()=>{
 const db=JSON.parse(fs.readFileSync('assets/mechanisms.json','utf8'));
 const defs=JSON.parse(fs.readFileSync('assets/floors/definitions.json','utf8'));
 const counts={};for(const d of Object.values(db))for(const o of d.objects)counts[o.kind]=(counts[o.kind]||0)+1;
 assert.equal(counts.gate,249);assert.equal(counts.switch,144);assert.equal(counts.bridge,88);assert.equal(counts.platform,20);
 assert.equal(counts.cannon,16);assert.equal(counts.tv,10);assert.equal(counts.trap,39);assert.equal(counts.furniture,4);
 assert.equal(counts.machine,14);assert.equal(counts.gas,15);assert.equal(counts.launcher,37);
 assert.equal(levels.filter(l=>l.music).length,levels.length);
 assert(levels.filter(l=>l.ambience).length>=90);
 const m727=levels.find(l=>l.id==='map727'),f1=m727.extraFloors.find(f=>f.floor===1);
 assert.equal(f1.ambience.scheme,'ext_rooftop');
 assert.equal(f1.mechanisms.objects.find(o=>o.kind==='floor'&&o.prop===34).targetFloor,2);
 for(const [id,floors] of Object.entries(defs))for(const f of floors)for(const o of f.mechanisms?.objects||[])
  if(o.kind==='floor'&&[33,36,37,38,39,267,268,320].includes(o.prop))assert(Number.isInteger(o.targetFloor),`${id}/${f.floor}/${o.id}`);
});
check('multi-floor inventory, cheese and switch states persist; restart returns to root',()=>{
 const def=levels.find(d=>d.id==='map727'),g=make([],def);assert(g.floorLevels.size>=3);const root=g.level;
 root.mechanisms.boost={multiplier:4,left:12};root.mechanisms.signals.set(123,true);
 assert(g.switchFloor(1));assert.equal(g.level.mechanisms.boost.left,12);const first=g.level;assert(first.cheeses.length);first.cheeses[0].taken=true;
 assert(g.switchFloor(2));assert(g.switchFloor(1));assert(first.cheeses[0].taken);assert(g.switchFloor(0));assert(root.mechanisms.signals.get(123));
 g.resetLevel(true);assert.equal(g.level.floor,0);assert(!first.cheeses[0].taken);assert(!root.mechanisms.boost);assert.equal(root.mechanisms.signals.size,0);
});
check('every mechanism sheet divides into complete source frames',()=>{
 for(const [name,[w,h]] of Object.entries(MECHANISM_SHEETS)){const png=fs.readFileSync(`assets/sprites/${name}.png`);assert.equal(png.readUInt32BE(16)%w,0,name);assert.equal(png.readUInt32BE(20)%h,0,name);}
 assert.deepEqual(MECHANISM_SHEETS.entrance_door,[96,192]);
 assert.deepEqual(MECHANISM_SHEETS.exit_door_boss,[96,192]);
 assert.deepEqual(MECHANISM_SHEETS.bridge,[92,92]);
 assert.deepEqual(MECHANISM_SHEETS.bridge_timed,[94,92]);
 assert.equal(gateVertical(210),true);assert.equal(gateVertical(211),false);
 for(let i=2;i<=8;i++)assert(fs.existsSync(`assets/sprites/cannon0${i}.png`),`cannon0${i}`);
});
check('fish is consumed once; string distracts for 15 seconds and can be reused',()=>{
 for(const kind of ['fish','string']){
  const g=make([item(kind)]),m=g.level.mechanisms;touch(g,m.items[0]);const c=new Cat(120,120,[{x:120,y:120}],0,g.level.world,0);g.level.cats=[c];
  m.update(g,.01,g.mouse);assert.equal(m.tools.length,0);assert.equal(c.distraction.kind,kind);assert.equal(c.distraction.left,kind==='fish'?8.2:15);
  assert.equal(c.canSeeMouse(g.mouse,g.level.world),false);c.update(16,g.level.world,g.mouse,[]);assert(!c.distraction);assert.equal(c.state,'return');
  if(kind==='string'){assert(!m.items[0].taken);m.update(g,16,g.mouse);assert.equal(m.tools.length,1);}else assert(m.items[0].taken);
 }
});
check('television is toggled by tap/use, attracts cats and releases them after switching off',()=>{
 const tv={kind:'tv',prop:96,id:1,tag:0,x:200,y:120},g=make([tv]),m=g.level.mechanisms,c=new Cat(270,120,[{x:270,y:120}],0,g.level.world,0);g.level.cats=[c];
 m.use(g,m.objects[0]);assert(m.objects[0].active);m.update(g,.01,g.mouse);assert.equal(c.distraction.kind,'tv');
 m.use(g,m.objects[0]);assert(!m.objects[0].active);c.update(9,g.level.world,g.mouse,[]);assert(!c.distraction);
});
check('moving platforms follow routes without carrying riders or writing terrain',()=>{
 const rows=Array.from({length:24},(_,y)=>y===0||y===23?'#'.repeat(40):y===7?'#....'+'#'.repeat(16)+'.'.repeat(18)+'#':'#'+'.'.repeat(38)+'#');
 const p={kind:'platform',prop:265,id:1,tag:1,x:120,y:120,routeMode:'pingpong',route:[{x:120,y:120,wait:1},{x:280,y:120,wait:.5}]},g=make([p],{rows}),m=g.level.mechanisms;
 const base=g.level.world.grid.slice();
 Object.assign(g.mouse,{x:120,y:120});m.prepare(g,.5);assert.equal(g.mouse.x,120);m.prepare(g,1);assert.equal(g.mouse.x,120);
 m.prepare(g,1.6);assert.deepEqual(g.level.world.grid,base,'platform must not write collision grid');
 const obj={x:0,y:0,route:[{x:0,y:0},{x:10,y:0}],routeMode:'stop'};advanceMover(obj,3,10);assert.equal(obj.x,10);assert(obj.routeStopped);
 const loop={x:0,y:0,route:[{x:0,y:0},{x:10,y:0}],routeMode:'pingpong'};advanceMover(loop,1.5,10);assert.equal(loop.x,5);
 g.resetLevel(true);assert.equal(m.platforms[0].x,120);
});
check('flames respect authored delay, extend along their route, catch and reset',()=>{
 const fire={kind:'flame',prop:276,id:1,tag:1000,x:200,y:120,route:[{x:200,y:120,wait:500},{x:400,y:120}]},g=make([fire]),m=g.level.mechanisms;let caught=0;g.caught=()=>caught++;
 Object.assign(g.mouse,{x:300,y:120});m.update(g,1,g.mouse);assert(!m.objects[0].active);assert.equal(caught,0);
 m.update(g,.51,g.mouse);assert(m.objects[0].active);m.update(g,.5,g.mouse);assert.equal(caught,1);assert.equal(m.objects[0].length,200);
 g.resetLevel(true);assert(!m.objects[0].active);assert.equal(m.objects[0].length,0);
});
check('wall launchers use authored direction and create moving projectiles',()=>{
 const p={kind:'launcher',prop:269,id:1,tag:1,x:120,y:120,route:[{x:120,y:120},{x:400,y:120}]},g=make([p]),m=g.level.mechanisms;
 m.update(g,1.6,g.mouse);assert.equal(g.projectiles.length,1);const shot=g.projectiles[0];assert(shot.tx>shot.x);assert.equal(shot.ty,shot.y);assert.equal(shot.speed,160);
 g.resetLevel(true);assert.equal(g.projectiles.length,0);
});
check('every authored moving mechanism has a nonempty native route',()=>{
 const db=JSON.parse(fs.readFileSync('assets/mechanisms.json','utf8'));
 for(const [id,d]of Object.entries(db))for(const o of d.objects)if(['cannon','platform','flame','launcher'].includes(o.kind)&&![274,275].includes(o.prop))assert(o.route.length>=2,`${id}/${o.id}`);
});
check('bucket is the third chapter variant; furniture anchors inside walls remain usable',()=>{
 const g=make([{kind:'furniture',prop:25,id:1,x:240,y:8}],{num:'3-5'}),m=g.level.mechanisms;
 assert(m.isBucket);m.handleTap(g,{x:240,y:8});const p=m.interactionPoint(m.objects[0]);Object.assign(g.mouse,p);m.update(g,.01,g.mouse);assert(g.mouse.hidden);
});
check('all 182 floor instances execute the real game step without invalid positions',()=>{
 for(const def of levels){const g=make([],def);for(const floor of g.floorLevels.values()){
  g.level=floor;g.state='playing';g.death=null;Object.assign(g.mouse,floor.world.closestOpen(floor.mouseStart.x,floor.mouseStart.y));
  for(let i=0;i<12;i++)g.step(1/60);
  assert(Number.isFinite(g.mouse.x)&&Number.isFinite(g.mouse.y),`${def.id}/${floor.floor}`);
 }}
});
check('1-8 yellow entrances hide and use the same-tag portal to the paired hole',()=>{
 const g=make([],levels.find(d=>d.num==='1-8'));g.level.cats=[];
 const [a,b]=g.level.hideables;assert.equal(holeColour(a.tag),'#ffd800');assert.equal(holeColour(a.tag),holeColour(b.tag));
 const click=h=>{const screen=g.worldToScreen(h.x,h.y-16);g.onPointerDown(screen);g.onPointerUp();};
 click(a);assert(g.pendingHide||g.mouse.hidden);
 for(let i=0;i<2400&&!g.mouse.hidden;i++)g.step(1/60);
 assert(g.mouse.hidden,'tap must reach and enter real map11 entrance');
 // Native 0xdbbd4 uses the screen->world input point: tapping the paired hole
 // while hidden emerges there.
 click(b);assert(!g.mouse.hidden);
 const targetB=g.holeMouth(b),openB=g.level.world.closestOpen(targetB.x,targetB.y);assert.equal(g.mouse.x,openB.x);assert.equal(g.mouse.y,openB.y);
});
check('1-10 red and blue entrances retain tag isolation and both directions work',()=>{
 const g=make([],levels.find(d=>d.num==='1-10'));g.level.cats=[];
 for(const tag of [1,7]){
  const pair=g.level.hideables.filter(h=>h.tag===tag);assert.equal(pair.length,2);assert.equal(holeColour(tag),tag===1?'#d61212':'#1962f6');
  for(const [a,b]of [[pair[0],pair[1]],[pair[1],pair[0]]]){
   const raw=g.holeMouth(a),mouth=g.level.world.closestOpen(raw.x,raw.y,g.mouse.radius);Object.assign(g.mouse,mouth);g.enterHole(a);
   const wrong=g.level.hideables.find(h=>h.tag!==tag);g.handleTap({x:wrong.x,y:wrong.y-16});assert(g.mouse.hidden,'other colour must not emerge');
   const screen=g.worldToScreen(b.x,b.y-16);g.onPointerDown(screen);g.onPointerUp();assert(!g.mouse.hidden);
   // Native scan reference is the tapped hole (screen->world input point).
   const exit=g.holeMouth(b),target=g.level.world.closestOpen(exit.x,exit.y);assert.deepEqual([g.mouse.x,g.mouse.y],[target.x,target.y]);assert(!g.level.world.circleHitsWall(g.mouse.x,g.mouse.y,g.mouse.radius));
  }
 }
});
check('live drawn paths ending at the real 1-8 entrance trigger hiding',()=>{
 const g=make([],levels.find(d=>d.num==='1-8'));g.level.cats=[];const h=g.level.hideables[0],raw=g.holeMouth(h),mouth=g.level.world.closestOpen(raw.x,raw.y);
 const route=g.level.world.bfsToWorld(g.mouse.x,g.mouse.y,mouth.x,mouth.y);assert(route?.length);
 g.onPointerDown(g.worldToScreen(g.mouse.x,g.mouse.y));for(const p of route)g.onPointerMove(g.worldToScreen(p.x,p.y));g.onPointerMove(g.worldToScreen(h.x,h.y-16));g.onPointerUp();
 assert(g.pendingHide,'live stroke must keep its entrance interaction');
 for(let i=0;i<2400&&!g.mouse.hidden;i++)g.step(1/60);assert(g.mouse.hidden);
 const drawn=[];g.sprites.tintedFrame=(_ctx,key,frame,x,y,w,h,colour)=>{drawn.push({key,colour});return true;};g.drawHoles(ctx,16);
 const holesDrawn=drawn.filter(d=>d.key.startsWith('mouse_hole'));
 assert.equal(holesDrawn.length,2);assert(holesDrawn.every(d=>d.colour==='#ffd800'));
 // While hidden, every same-Tag portal hole also glows (coloured flare).
 assert(drawn.filter(d=>d.key==='flare'&&d.colour==='#ffd800').length>=2);
});
check('a stroke can start from a paired exit while hidden without immediately entering again',()=>{
 const g=make([],levels.find(d=>d.num==='1-10'));g.level.cats=[];const [a,b]=g.level.hideables.filter(h=>h.tag===7);
 g.enterHole(a);g.onPointerDown(g.worldToScreen(b.x,b.y-16));assert(!g.mouse.hidden);assert(g.stroke.emergedOnDown);
 g.onPointerUp();assert(!g.mouse.hidden);
});
check('hole sprite tint uses the native palette, preserves source alpha and caches per colour',()=>{
 const saved=globalThis.document,operations=[],created=[];
 globalThis.document={createElement:()=>{const c={getContext:()=>new Proxy({drawImage:()=>{},fillRect:()=>{}},{set:(o,k,v)=>{operations.push([k,v]);o[k]=v;return true;}})};created.push(c);return c;}};
 try{
  const s=new Sprites();s.images.portalTest={image:{naturalWidth:64,naturalHeight:64},fw:64,fh:64,cols:1};
  assert(s.tintedFrame(ctx,'portalTest',0,10,10,64,64,holeColour(0)));s.tintedFrame(ctx,'portalTest',0,10,10,64,64,holeColour(0));
  assert.equal(created.length,1);assert(operations.some(([k,v])=>k==='fillStyle'&&v==='#ffd800'));
  assert(operations.some(([k,v])=>k==='globalCompositeOperation'&&v==='destination-in'));
  s.tintedFrame(ctx,'portalTest',0,10,10,64,64,holeColour(7));assert.equal(created.length,2);
 }finally{globalThis.document=saved;}
});
check('entering lights both matching entrances, pulses the entered door and clears on emergence/restart',()=>{
 const g=make([],levels.find(d=>d.num==='1-10')),pair=g.level.hideables.filter(h=>h.tag===1),drawn=[];
 g.sprites.frame=(_ctx,key,frame,x,y,w,h)=>{drawn.push({key,x,y,w,h});return true;};
 g.enterHole(pair[0]);g.time+=ENTRANCE_POP_SECONDS/2;g.drawHoles(ctx,16);
 const flares=drawn.filter(d=>d.key==='flare');assert.equal(flares.length,2);
 assert(flares.every(d=>pair.some(h=>h.x===d.x&&h.y-16===d.y)));
 assert(drawn.find(d=>d.key.startsWith('mouse_hole')&&d.x===pair[0].x).w>64);
 assert.equal(drawn.find(d=>d.key.startsWith('mouse_hole')&&d.x===pair[1].x).w,64);
 g.emergeAt(pair[1]);drawn.length=0;g.drawHoles(ctx,16);assert(!drawn.some(d=>d.key==='flare'));
 g.time+=ENTRANCE_POP_SECONDS;assert(Math.abs(g.entranceDrawScale(pair[1])-1)<1e-9);
 g.resetLevel(true);assert.equal(g.entrancePulses.size,0);assert.equal(g.pipeGlow,null);
 assert.equal(entranceScale(-1),1);assert.equal(entranceScale(0),1);assert.equal(entranceScale(ENTRANCE_POP_SECONDS),1);assert.equal(entranceScale(ENTRANCE_POP_SECONDS/2),1.22);
});
check('paths ending at a mouse hole use a directional arrow; ordinary endpoints keep their dot',()=>{
 const g=make([],levels.find(d=>d.num==='1-8')),hole=g.level.hideables[0],raw=g.holeMouth(hole),end=g.level.world.closestOpen(raw.x,raw.y),calls=[];
 const drawing=new Proxy({}, {get:(_o,k)=>(...args)=>calls.push([k,...args]),set:()=>true});
 Object.assign(g.mouse,{x:end.x-80,y:end.y});g.mouse.setPath([{x:end.x-40,y:end.y},end]);g.drawPath(drawing,16);
 assert(calls.some(c=>c[0]==='closePath'));assert(!calls.some(c=>c[0]==='arc'));assert(calls.some(c=>c[0]==='rotate'&&c[1]===0));
 calls.length=0;g.mouse.setPath([{x:400,y:400}]);g.drawPath(drawing,16);assert(calls.some(c=>c[0]==='arc'));assert(!calls.some(c=>c[0]==='closePath'));
});
check('native pipe endpoints use arrows and portal feedback follows the used group',()=>{
 const g=make([],levels.find(d=>d.id==='map786')),group=g.level.pipeGroups[0],entry=group.pieces.find(p=>p.prop<204),mouth=g.level.transportMouth(entry,entry.prop),calls=[];
 const drawing=new Proxy({}, {get:(_o,k)=>(...args)=>calls.push([k,...args]),set:()=>true});
 Object.assign(g.mouse,{x:mouth.x-60,y:mouth.y});g.mouse.setPath([mouth]);g.drawPath(drawing,16);assert(calls.some(c=>c[0]==='closePath'));
 Object.assign(g.mouse,mouth);g.pipeCooldown=0;g.pipeExitLock=null;assert(g.tryPipeTravel());assert.equal(g.pipeGlow.tag,group.tag);
 const drawn=[];g.sprites.frame=(_ctx,key)=>{drawn.push(key);return true;};g.drawPipes(ctx,16);assert.equal(drawn.filter(key=>key==='flare').length,group.pieces.length);
 g.time+=1.01;drawn.length=0;g.drawPipes(ctx,16);assert(!drawn.includes('flare'));
});
check('1-1 tutorial guide line is not solid; spawn-to-cheese and exit paths stay clear',()=>{
 const g=make([],levels.find(d=>d.id==='map10')),w=g.level.world,m=g.mouse,cheese=g.level.cheeses[0],exit=g.level.exit;
 assert(!w.segmentNear(448,454,2),'Property 142 guide path must not be a collision wall');
 assert(w.lineClear(m.x,m.y,cheese.x,cheese.y),'spawn to cheese is a clear drawn line');
 m.setPath([{x:cheese.x,y:cheese.y}]);
 for(let i=0;i<600&&!cheese.taken;i++)g.step(1/60);
 assert(cheese.taken,'mouse reaches the first cheese without wedging');
 const route=w.bfsToWorld(m.x,m.y,exit.x,exit.y);
 assert(route&&route.length,'spawn/cheese to exit remains connected');
 assert(!route.some(p=>w.circleHitsWall(p.x,p.y,1)),'route avoids native walls');
});
check('native MBN wall contours block the red divider and BFS routes around it',()=>{
 const g=make([],levels.find(d=>d.num==='1-8'));
 assert(g.level.world.segments.length>0);
 assert(g.level.world.circleHitsWall(410,392,5.6),'authored divider must be solid');
 const hole=g.level.hideables[0],raw=g.holeMouth(hole),mouth=g.level.world.closestOpen(raw.x,raw.y,g.mouse.radius);
 const route=g.level.world.bfsToWorld(g.level.mouseStart.x,g.level.mouseStart.y,mouth.x,mouth.y);
 assert(route&&route.length);
 assert(!route.some(p=>g.level.world.circleHitsWall(p.x,p.y,1)),'BFS route must not cross native walls');
});
check('unreachable native cats are preserved and map769 keeps both lava cats',()=>{
 const def=levels.find(d=>d.id==='map769');assert.equal(def.cats.length,2);
 const g=make([],def);assert.equal(g.level.cats.length,2);assert(g.level.cats.every(c=>c.type===7));
});
check('special pickups 250/330/431 and cheese_inf are collectible, not carried tools',()=>{
 for(const [item,prop] of [['dossier',431],['robodog',250],['keepsake',330],['cheese_inf',13]]){
  const g=make([{kind:'item',id:1,item,prop,x:120,y:120,itemFrame:2}]),m=g.level.mechanisms;
  Object.assign(g.mouse,{x:120,y:120});m.update(g,1/60,g.mouse);
  assert.equal(g.level.mechanisms.objects[0].taken,true,item);
  assert.equal(g.level.mechanisms.tools.length,0,`${item} must not enter the carried tools`);
  assert.equal(g.stats.items[item],1,item);
 }
});
check('boss win seam uses the native raw trigger and sets world-complete flags',()=>{
 const g=make([],levels.find(d=>d.id==='map791'));g.state='playing';const b=g.level.bosses[0];
 assert.equal(b.prop,301);assert.equal(b.triggerStatus,'implemented');assert(!b.checkWin());
 b.levelPhase=9;assert(b.checkWin());b.update(1/60,{mouse:g.mouse,game:g,caught:()=>{}});
 assert.equal(g.state,'levelclear');assert.equal(g.bossWin,true);assert.equal(g.bossWorldComplete,true);assert(b.defeated);
});
check('boss entrance/exit doors import as native exits and bridges become walkable',()=>{
 const boss=make([],levels.find(d=>d.id==='map791'));
 assert.equal(boss.level.exit.prop,358);
 assert(boss.level.mechanisms.objects.some(o=>o.kind==='door'&&o.prop===358));
 const bridge=make([],levels.find(d=>d.id==='map810'));
 assert(bridge.level.mechanisms.bridges.length>0);
 const b=bridge.level.mechanisms.bridges[0];
 assert.equal(bridge.level.world.isWallAt(b.x,b.y),false);
});
check('balloon pickup loops only native frames 0..3 and never the pop frames',()=>{
 const g=make([{kind:'item',prop:18,item:'balloon',tag:0,id:1,x:240,y:160}],{cheeses:[]});
 const m=g.level.mechanisms,frames=[];
 g.sprites.frame=(_ctx,key,frame)=>{frames.push({key,frame});return true;};
 for(const t of [0,.4,.8,1.2,1.6]){g.time=t;m.draw(g,{});}
 const balloon=frames.filter(f=>f.key==='balloon').map(f=>f.frame);
 assert(balloon.length===5);assert(balloon.every(f=>f>=0&&f<4));assert.deepEqual([...new Set(balloon)].sort(),[0,1,2,3]);
});
fs.writeFileSync('analysis/mechanisms-regression.json',JSON.stringify({passed:results.length,checks:results},null,2));
console.log(`Mechanism regressions: ${results.length} groups passed (${levels.length} maps, 61 additional floors).`);




