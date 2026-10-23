// MBN is the shipped runtime map. Old editor XML differs in both props and positions.
import fs from 'node:fs';
import {parseMbn} from './decode-mbn.mjs';
import {buildRoute} from './native-routes.mjs';
import {mechanismKind,ITEM_PROPS,MECHANISM_SHEETS} from '../src/mechanism-types.js';
import {pipeGroups,pipeDestination} from '../src/pipe-portals.js';
const root='com.ea.spymouse_row/files',database={},floorDefinitions={},audit={maps:0,floors:0,counts:{},deferred:{}};
// Explicit floor links (Lead contract: no runtime |tag|/±1 guesses). The
// native FloorTransport only asks the level manager for a floor change; the
// shipped data encodes the target as follows, and the importer bakes the
// resulting floor number into `targetFloor` so the runtime reads data:
//  - prop 34: Tag is the destination floor number;
//  - 31/35: unique same-Tag counterpart on another floor, else the only floor
//    that has a floor trigger; otherwise no target (null);
//  - 33/36/37/38/39/320: same-Tag/same-position counterpart, else the next
//    authored floor; the last room keeps its own floor (in-room door);
//  - 267/268: ride up/down one authored floor, else in-room elevator.
// Node, 2024: these rules are data-driven; nothing falls back to current±1
// when the data does not support it.
const FLOOR_LINK_PROPS = new Set([31, 33, 34, 35, 36, 37, 38, 39, 267, 268, 320]);
function assignFloorTargets(mapId, groups) {
  const floors = groups.map((g) => g.floor).sort((a, b) => a - b);
  const all = [];
  for (const g of groups) for (const o of g.objects) if (o.kind === 'floor' && FLOOR_LINK_PROPS.has(o.prop)) all.push({ floor: g.floor, object: o });
  const byFloor = new Map(groups.map((g) => [g.floor, g.objects.filter((o) => o.kind === 'floor' && FLOOR_LINK_PROPS.has(o.prop))]));
  const cell = 16;
  for (const { floor, object } of all) {
    let target = null;
    if (object.prop === 34) {
      const t = Math.abs(object.tag);
      if (t !== floor && floors.includes(t)) target = t;
    } else if ([31, 35].includes(object.prop)) {
      const peers = all.filter((e) => e.floor !== floor && (e.object.prop === object.prop || ([31, 35].includes(e.object.prop))) && Math.abs(e.object.tag) === Math.abs(object.tag));
      const uniq = [...new Set(peers.map((p) => p.floor))];
      if (uniq.length === 1) target = uniq[0];
      else {
        const others = new Set(all.filter((e) => e.floor !== floor && [31, 34, 35].includes(e.object.prop)).map((e) => e.floor));
        if (others.size === 1) target = [...others][0];
      }
    } else if ([33, 36, 37, 38, 39, 320].includes(object.prop)) {
      const peers = all.filter((e) => e.floor !== floor && Math.abs(e.object.tag) === Math.abs(object.tag) && Math.hypot(e.object.x - object.x, e.object.y - object.y) < cell * 2);
      const uniq = [...new Set(peers.map((p) => p.floor))];
      if (uniq.length === 1) target = uniq[0];
      else {
        const i = floors.indexOf(floor);
        target = i >= 0 && i + 1 < floors.length ? floors[i + 1] : floor;
      }
    } else if (object.prop === 267 || object.prop === 268) {
      const i = floors.indexOf(floor);
      if (object.prop === 267) target = i >= 0 && i + 1 < floors.length ? floors[i + 1] : floor;
      else target = i > 0 ? floors[i - 1] : floor;
    }
    object.targetFloor = target;
  }
  return all.length;
}

// 274/275 (one-shot spawner / Boss4 turret) and 279-281 (Boss5 gas vents) are
// implemented now; native boss-object properties stay deferred.
const deferredProps=new Set([252,300,301,302,303,304,305,306]);
const CAT_TYPES={50:0,51:1,52:2,53:3,54:4,55:5,56:6,57:7,58:8,59:9,285:10};
const CHEESE_INF_FRAME={13:0,97:1,98:2,99:3};
// Ambience data (Lead request, round 2): floor id -> scheme -> amb.xml.
function parseAttrs(text){const out={};if(!text)return out;for(const m of text.matchAll(/(\w+)\s*=\s*"([^"]*)"/g))out[m[1]]=m[2];return out;}
const ambCache=new Map();
function readAmbXml(scheme){
  if(ambCache.has(scheme))return ambCache.get(scheme);
  const file=`${root}/res/sound/sound/amb/${scheme}/amb.xml`;
  let out={scheme,loop:null,groups:[]};
  if(fs.existsSync(file)){
    const xml=fs.readFileSync(file,'utf8');
    const loop=(xml.match(/<loop\b[^>]*file="([^"]+)"/)||[])[1]||null;
    const groups=[];
    for(const m of xml.matchAll(/<ambience\b([^>]*)>([\s\S]*?)<\/ambience>/g)){
      const a=parseAttrs(m[1]);
      const sounds=[...m[2].matchAll(/<sound\b[^>]*file="([^"]+)"/g)].map(s=>s[1]);
      groups.push({minDelay:+(a.min_delay??0),maxDelay:+(a.max_delay??0),sounds});
    }
    out={scheme,loop,groups};
  }
  ambCache.set(scheme,out);return out;
}
function floorAmbience(mapId,floor){
  const file=`${root}/res/${mapId}/amb_schemes.xml`;
  if(!fs.existsSync(file))return null;
  const xml=fs.readFileSync(file,'utf8');
  let scheme=null;
  for(const m of xml.matchAll(/<floor\b([^>]*)\/?>/g)){const a=parseAttrs(m[1]);if(String(a.id)===String(floor))scheme=a.scheme||null;}
  return scheme?readAmbXml(scheme):null;
}
fs.mkdirSync('assets/floors/backgrounds',{recursive:true});
function importMap(id,file){
  const info=parseMbn(file);if(!info.eof||info.hashOk===false)throw Error(`Invalid runtime map ${file}`);
  const tags=[...new Set(info.vertices.filter(v=>[101,130,132].includes(v.prop)).map(v=>Math.abs(v.tag)))];
  const routes=tags.map(tag=>buildRoute(info,tag)).filter(Boolean);
  const points=info.vertices.filter(v=>v.flags===10).map(v=>({...v,x:v.x*2+32,y:(320-v.y)*2+64}));
  const objects=[];
  for(const point of points){
    if(deferredProps.has(point.prop)){const entry=audit.deferred[point.prop]??={count:0,maps:[]};entry.count++;if(!entry.maps.includes(id))entry.maps.push(id);}
    const kind=mechanismKind(point.prop);if(!kind)continue;
    const route=routes.find(r=>Math.abs(r.tag)===Math.abs(point.tag));
    if(['cannon','platform','flame'].includes(kind)||(kind==='launcher'&&[269,270].includes(point.prop))){if(!route||route.points.length<2)throw Error(`${id}/${point.id}: missing native ${kind} route`);}
    objects.push({...point,kind,item:ITEM_PROPS[point.prop]||null,itemFrame:CHEESE_INF_FRAME[point.prop]??0,route:route?.points||[],routeMode:route?.mode||'stop'});
    audit.counts[kind]=(audit.counts[kind]||0)+1;
  }
  // Keep every same-tag pipe assembly, including links within a floor component.
  const pipes=points.filter(v=>v.prop>=200&&v.prop<=207);
  const tunnels=[];
  for(const group of pipeGroups(pipes))for(const a of group.pieces){
    const b=pipeDestination(group,a);if(b)tunnels.push({kind:'pipe',tag:group.tag,a,b,aProp:a.prop,bProp:b.prop,oneWay:true});
  }
  const nativeExit=points.find(p=>p.prop>=240&&p.prop<=247)||points.find(p=>p.prop===358)||points.find(p=>p.prop===359);
  const definition={source:'runtime-mbn',objects,tunnels,nativeExit:nativeExit?{...nativeExit,ox:nativeExit.x,oy:nativeExit.y,source:'runtime-mbn'}:null};database[id]=definition;
  return {definition,points,routes};
}
for(const entry of JSON.parse(fs.readFileSync('assets/levels/index.json','utf8'))){
  const id=entry.id,file=`${root}/res/${id}/${id}.mbn`;if(!fs.existsSync(file))throw Error(`Missing runtime map ${file}`);
  importMap(id,file);audit.maps++;
  const floors=[];
  for(const name of fs.readdirSync(`${root}/res/${id}`).filter(name=>new RegExp(`^${id}_[0-9]+\\.mbn$`).test(name))){
    const key=name.replace('.mbn',''),number=+key.split('_').at(-1),bg=`${root}/res_960x640/${id}/${key}.jpg`;
    if(!fs.existsSync(bg))throw Error(`Missing alternate floor background ${bg}`);
    const {definition,points,routes}=importMap(key,`${root}/res/${id}/${name}`);
    fs.copyFileSync(bg,`assets/floors/backgrounds/${key}.jpg`);
    const exit=points.find(p=>p.prop>=240&&p.prop<=247),holes=points.filter(p=>p.prop>=20&&p.prop<=23),traps=points.filter(p=>p.prop===60);
    // Prop 11 cwmouse is paired with a mousetrap: same Tag when the map has it,
    // otherwise nearest unpaired trap on the same floor. The runtime disarm
    // rule only needs the carried cwmouse (see mechanisms.js), but the data
    // field should still name a real trap, not a "hole".
    const usedTraps=new Set();
    const cwmice=points.filter(p=>p.prop===11).map(p=>{
      let trap=traps.find(t=>Math.abs(t.tag)===Math.abs(p.tag));
      if(!trap)trap=traps.filter(t=>!usedTraps.has(t.id)).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0]||null;
      if(trap)usedTraps.add(trap.id);
      return {...p,trap:trap?{x:trap.x,y:trap.y,id:trap.id}:null};
    });
    floors.push({id,num:entry.num,name:entry.name,theme:entry.theme,floor:number,bg:`assets/floors/backgrounds/${key}.jpg`,mask:`assets/floors/masks/${key}.json`,mechanisms:definition,
      ambience:floorAmbience(id,number),
      mouseStart:points.find(p=>p.prop===1)||{x:512,y:384},exit,
      cheeses:points.filter(p=>p.prop>=6&&p.prop<=10),crumbs:points.filter(p=>p.prop===260),
      cats:points.filter(p=>CAT_TYPES[p.prop]!=null).map(p=>{const route=routes.find(r=>Math.abs(r.tag)===Math.abs(p.tag));return {...p,type:CAT_TYPES[p.prop],angle:0,route:route?.points||[{x:p.x,y:p.y}],routeMode:route?.mode||'stationary'};}),
      pipePieces:points.filter(p=>p.prop>=200&&p.prop<=207),hideables:holes,
      cwmice,
    });audit.floors++;
  }
  assignFloorTargets(id,[{floor:0,objects:database[id].objects},...floors.map(f=>({floor:f.floor,objects:f.mechanisms.objects}))]);
  floorDefinitions[id]=floors.sort((a,b)=>a.floor-b.floor);
}
fs.mkdirSync('assets/sprites',{recursive:true});
const SHEET_SOURCE={
  boss4_reflector:'boss4/reflector_1.png',boss4_breakable:'boss4/breakable.png',
  gas_vent:'boss5/gas_vent.png',gas_stream:'boss5/gas_stream.png',gas_puff:'boss5/gas_puff.png',gas_vent_top:'boss5/gas_vent_top.png',
  shuriken_launcher:'boss4/shuriken_launcher.png',
  trigger_set_mayan:'boss7/trigger_set_mayan.png',
  trigger_set_green_boss5:'boss5/trigger_set_green_boss5.png',trigger_set_red_boss5:'boss5/trigger_set_red_boss5.png',
  bars_boss5_red:'boss5/bars_boss5_red.png',bars_boss5_green:'boss5/bars_boss5_green.png',
  trigger_2:'boss4/trigger_2.png',trigger_3:'boss4/trigger_3.png',trigger_4:'boss4/trigger_4.png',trigger_5:'boss4/trigger_5.png',
};
for(const name of Object.keys(MECHANISM_SHEETS)){
  const relative=SHEET_SOURCE[name]||`${name}.png`;
  const src=`${root}/res_960x640/sprites/${relative}`;
  if(!fs.existsSync(src))throw Error(`Missing mechanism sprite ${name}`);
  fs.copyFileSync(src,`assets/sprites/${name}.png`);
}
fs.writeFileSync('assets/mechanisms.json',JSON.stringify(database));
fs.writeFileSync('assets/floors/definitions.json',JSON.stringify(floorDefinitions));
fs.writeFileSync('analysis/mechanisms-import-audit.json',JSON.stringify(audit,null,2));
console.log(`Mechanisms: ${audit.maps} runtime maps + ${audit.floors} floors, ${JSON.stringify(audit.counts)}`);
