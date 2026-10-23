// This checks real registered resources and the real input/step methods.
// It deliberately does not replace Sprites.frame with an always-successful stub.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Game} from '../src/game.js';
import {loadContent} from '../src/content.js';
import {parseMbn} from './decode-mbn.mjs';
import {holeColour,propDirection} from '../src/props.js';
import {pipeDestination} from '../src/pipe-portals.js';
const report={maps:0,floors:0,holes:0,pairedDirections:0,decorativeHoles:0,pipePieces:0,pipeDirections:0,floorDirections:0,exits:0,nativeExits:0,drawCalls:0,resourceFiles:0,missingNative:[],unsafe:[],failures:[],levels:[]};
const resources=new Map();
globalThis.window={devicePixelRatio:1};
globalThis.Image=class{
 set src(url){
  let dimensions=resources.get(url);
  if(!dimensions){
   assert(fs.existsSync(url),`Missing image: ${url}`);const png=fs.readFileSync(url);
   if(png.toString('ascii',1,4)==='PNG')dimensions=[png.readUInt32BE(16),png.readUInt32BE(20)];
   else{for(let at=2;at<png.length;){if(png[at++]!==255)continue;const marker=png[at++],length=png.readUInt16BE(at);if([192,193,194].includes(marker)){dimensions=[png.readUInt16BE(at+5),png.readUInt16BE(at+3)];break;}at+=length;}}
   assert(dimensions,`Unreadable image: ${url}`);resources.set(url,dimensions);
  }
  [this.naturalWidth,this.naturalHeight]=dimensions;this.onload?.();
 }
};
const noop=()=>{};
const ctx=new Proxy({measureText:()=>({width:100}),createLinearGradient:()=>({addColorStop:noop}),drawImage:(img,...args)=>{
 if(args.length===8){const [sx,sy,sw,sh]=args;assert(sx>=0&&sy>=0&&sx+sw<=img.naturalWidth&&sy+sh<=img.naturalHeight,'Sprite crop outside source image');}
}}, {get:(o,k)=>o[k]??noop,set:(o,k,v)=>{o[k]=v;return true;}});
globalThis.document={createElement:()=>({getContext:()=>ctx,set width(w){this.naturalWidth=w;},set height(h){this.naturalHeight=h;}})};
globalThis.fetch=async url=>({ok:fs.existsSync(url),json:async()=>JSON.parse(fs.readFileSync(url,'utf8'))});
const canvas={getContext:()=>ctx,getBoundingClientRect:()=>({width:960,height:640})};
const {levels}=await loadContent();assert.equal(levels.length,121);report.maps=levels.length;
for(const def of levels){
 const game=new Game(canvas,{intro:false});game.loadLevel(def,0);
 for(const [key,sheet]of Object.entries(game.sprites.images)){
  assert(game.sprites.ready(key),`${key}: not registered/loaded`);
  assert.equal(sheet.image.naturalWidth%sheet.fw,0,key);assert.equal(sheet.image.naturalHeight%sheet.fh,0,key);
 }
 const frame=game.sprites.frame.bind(game.sprites),tint=game.sprites.tintedFrame.bind(game.sprites);
 for(const [name,original]of [['frame',frame],['tintedFrame',tint]])game.sprites[name]=(context,key,...args)=>{
  assert(game.sprites.ready(key),`${def.id}: requested unregistered sprite ${key}`);report.drawCalls++;return original(context,key,...args);
 };
 for(const floor of game.floorLevels.values()){
  game.level=floor;game.state='playing';game.death=null;game.pendingHide=null;game.pipeCooldown=0;floor.cats=[];
  const key=def.id+(floor.floor?`_${floor.floor}`:'');
  const background=new Image();background.src=floor.bg;assert.equal(background.naturalWidth,floor.world.w,key);assert.equal(background.naturalHeight,floor.world.h,key);
  const native=parseMbn(`com.ea.spymouse_row/files/res/${def.id}/${key}.mbn`).vertices.filter(v=>v.flags===10);
  const entry={map:key,holes:floor.hideables.length,pipePieces:floor.pipePieces.length,exit:!!floor.exit};report.levels.push(entry);report.floors++;
  for(const h of native.filter(v=>v.prop>=20&&v.prop<=23))if(!floor.hideables.some(p=>p.id===h.id&&p.prop===h.prop&&p.tag===h.tag))report.missingNative.push({map:key,id:h.id,prop:h.prop,tag:h.tag});
  for(const p of native.filter(v=>v.prop>=200&&v.prop<=207))if(!floor.pipePieces.some(h=>h.id===p.id&&h.prop===p.prop&&h.tag===p.tag))report.missingNative.push({map:key,id:p.id,prop:p.prop,tag:p.tag});
  for(const exit of native.filter(v=>v.prop>=240&&v.prop<=247)){
   report.nativeExits++;if(floor.exit?.id!==exit.id||floor.exit?.prop!==exit.prop)report.missingNative.push({map:key,id:exit.id,prop:exit.prop,reason:'native-exit-missing'});
  }
  game.drawHoles(ctx,floor.world.cell);game.drawPipes(ctx,floor.world.cell);game.drawExit(ctx,floor.world.cell);floor.mechanisms.draw(game,ctx);
  for(const hole of floor.hideables){
   report.holes++;assert(game.sprites.ready(`${Math.abs(hole.tag||0)%8===6?'munch_hole':'mouse_hole'}_${propDirection(hole.prop)}`));
   if(Math.abs(hole.tag||0)%8===6){report.decorativeHoles++;continue;}
   const raw=game.holeMouth(hole),mouth=floor.world.closestOpen(raw.x,raw.y,game.mouse.radius);
   Object.assign(game.mouse,{...mouth,hidden:false,hiddenTag:null,furnitureId:null});game.mouse.clearPath();
   const at=game.worldToScreen(hole.ox??hole.x,(hole.oy??hole.y)-floor.world.cell);
   game.onPointerDown(at);game.onPointerUp();
   for(let i=0;i<120&&!game.mouse.hidden;i++)game.step(1/60);
   if(!game.mouse.hidden){report.failures.push({map:key,id:hole.id,reason:'cannot-enter'});continue;}
   assert.equal(game.mouse.hiddenTag,hole.tag);
   game.time+=.16;game.drawHoles(ctx,floor.world.cell);
   for(const other of floor.hideables.filter(h=>h.id!==hole.id&&h.tag===hole.tag)){
    game.enterHole(hole);game.onPointerDown(game.worldToScreen(other.ox??other.x,(other.oy??other.y)-floor.world.cell));game.onPointerUp();
    if(game.mouse.hidden)report.failures.push({map:key,id:hole.id,to:other.id,reason:'cannot-emerge'});
    else if(floor.world.circleHitsWall(game.mouse.x,game.mouse.y,game.mouse.radius))report.unsafe.push({map:key,id:other.id});
    assert.equal(holeColour(hole.tag),holeColour(other.tag));report.pairedDirections++;
   }
  }
  for(const group of floor.pipeGroups)for(const piece of group.pieces){
   const exit=pipeDestination(group,piece);if(!exit)continue;
   // Round-2 teleport animation: entry starts an in/out transit lock, so the
   // destination position only exists after the two 0.16 s phases.
   const finishTransit=()=>{for(let i=0;i<3&&game.pipeTransit;i++)game.updatePipeTransit(1);};
   const mouth=floor.transportMouth(piece,piece.prop),target=floor.transportMouth(exit,exit.prop);
   Object.assign(game.mouse,{...mouth,hidden:false,hiddenTag:null,furnitureId:null});game.mouse.clearPath();game.pipeCooldown=0;game.pipeExitLock=null;game.state='playing';
   const used=game.pipesUsed;
   game.onPointerDown(game.worldToScreen(piece.x,piece.y));game.onPointerUp();finishTransit();
   if(game.pipesUsed!==used+1||Math.hypot(game.mouse.x-target.x,game.mouse.y-target.y)>.01)report.failures.push({map:key,id:piece.id,to:exit.id,reason:'pipe-click-failed'});
   if(floor.world.circleHitsWall(game.mouse.x,game.mouse.y,game.mouse.radius))report.unsafe.push({map:key,id:exit.id});
   // Remaining at the destination after the cooldown must not bounce back.
   for(let i=0;i<60;i++){game.pipeCooldown=Math.max(0,game.pipeCooldown-1/60);game.tryPipeTravel();finishTransit();}
   if(game.pipesUsed!==used+1)report.failures.push({map:key,id:exit.id,reason:'pipe-bounces-without-leaving'});
   Object.assign(game.mouse,mouth);game.pipeCooldown=0;game.pipeExitLock=null;
   if(!game.tryPipeTravel())report.failures.push({map:key,id:piece.id,reason:'pipe-contact-failed'});
   finishTransit();
   report.pipeDirections++;
  }
  for(const object of floor.mechanisms.objects.filter(o=>o.kind==='floor'&&[33,36,37,38,39,267,268,320].includes(o.prop))){
   game.level=floor;const target=floor.mechanisms.destinationFloor(game,object);
   if(target==null){report.failures.push({map:key,id:object.id,reason:'floor-has-no-destination'});continue;}
   Object.assign(game.mouse,floor.mechanisms.interactionPoint(object));
   const travelMech=floor.mechanisms,travelOk=travelMech.travel(game,object);
   for(let i=0;i<180&&game.level.floor!==target;i++)travelMech.prepare(game,1/60);
   if(!travelOk||game.level.floor!==target)report.failures.push({map:key,id:object.id,reason:'floor-travel-failed'});
   else if(game.level.world.circleHitsWall(game.mouse.x,game.mouse.y,game.mouse.radius))report.unsafe.push({map:key,id:object.id,reason:'floor-landing-in-wall'});
   const landed=game.level;game.pipeCooldown=0;landed.mechanisms.update(game,2,game.mouse);
   if(game.level!==landed)report.failures.push({map:key,id:object.id,reason:'floor-bounces-without-leaving'});
   report.floorDirections++;game.level=floor;
  }
  report.pipePieces+=floor.pipePieces.length;if(floor.exit)report.exits++;
 }
}
report.resourceFiles=resources.size;
fs.writeFileSync('analysis/entrances-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,levels:undefined},null,2));
assert.equal(report.missingNative.length,0,'Runtime entrances omitted by the importer (see analysis/entrances-audit.json)');
assert.equal(report.failures.length,0,'Entrance input failed (see analysis/entrances-audit.json)');
assert.equal(report.unsafe.length,0,'Unsafe emergence');
console.log(`Entrance audit passed: ${report.maps} maps / ${report.floors} floors, ${report.holes} holes, ${report.pairedDirections} paired directions.`);

