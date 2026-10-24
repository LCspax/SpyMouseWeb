import {CFG} from './config.js';
import {
  signalColour, gateVertical, ITEM_LABELS, FURNITURE_SHEETS,
  SWITCH_LATCH, SWITCH_TIMED, SWITCH_REMOTE, SWITCH_CAT, MACHINE_CHARGES, doorTheme,
} from './mechanism-types.js';
import {updateCarried,resetCarried} from './carried.js';
import {advanceMover} from './movers.js';
import {audio} from './audio.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const copy=value=>JSON.parse(JSON.stringify(value));
function segmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return distance(p,{x:a.x+t*dx,y:a.y+t*dy});}
function angleDiff(a,b){return ((a-b+Math.PI*3)%(Math.PI*2))-Math.PI;}
const ITEM_ART={chilli:'cheese_speed',chilli2:'speedy',string:'twine_ball',fish:'catnip',balloon:'balloon',cover:'teacup',dossier:'dossier_icon',robodog:'robodog_broken01',keepsake:'keepsake',cheese_inf:'cheese_inf'};
const INSTANT_ITEMS=new Set(['dossier','robodog','keepsake','cheese_inf']);
const STATIC_ITEMS=new Set(['cover','chilli','chilli2','string','fish']);
// Native pickup 0x920e0: balloon SetSequence(0,3,mode 3,400ms). The sheet has
// seven columns, but columns 4-6 are the pop/deflate art and must never loop
// while the balloon is still held on the floor or by the hero.
const ITEM_ANIM={balloon:{frames:4,frameTime:.4}};
// Numeric chilli defaults come from the shipped player property initializer.
export const EFFECTS={chilli:{multiplier:4,duration:16},chilli2:{multiplier:7.2,duration:8},cover:10,distraction:8.2,string:15};

// Native sound ids (analysis/rea/evidence/mech_sound_table.json, 0x2ba3ec):
// 37 floor_switch, 38 hatch_open, 148 metaldoor_close, 115 switch_reset,
// 116 timer_alarm, 117 timer_fast_loop, 118 timer_slow_loop, 119 trap_activate, 121 burn,
// 139 ui_newroom, 69 use_cannon, 120 vendor, 54 pickup_chilli, 39 hide,
// 53 pickup_balloon, 55 pickup_fish, 56 ammo_bounce, 110 pickup_food, 113 pickup_toy,
// 88 barrier_down, 89 barrier_up (gates 210-225),
// 68 trap_deactivate (0x44, disarm sequence start).
// 107 fw_shoot1 is HYPOTHESIS for launchers (no exact call site found).
const SOUND={
  switchOn:37,doorOpen:38,doorClose:148,switchReset:115,timerAlarm:116,timerTick:117,timerSlow:118,
  platformLoop:114,
  barrierUp:89,barrierDown:88,
  trapDisarm:68,trapKill:119,fire:121,cannon:69,newRoom:139,launcher:107,machine:120,gas:157,
  dossier:176, // pickup_dossier (native 176)
  chilli:54,cover:39,balloon:53,fish:55,string:56,cheeseInf:110,toy:113,
};
const TRAP_ARM_SECONDS=0;
// Native trap spawn (0xa1acc): state 0x1a is active immediately; +0x204=3000
// exists but the per-frame tick 0xa2400 never reads it as an arming gate, so
// the trap is lethal/baitable from spawn.
// Native disarm: SetSequence(frames 0..7, mode2, 100 ms) then hold frame 7;
// the trap also collects its bait cheese at that moment (0xb3908).
const TRAP_DISARM_FRAME_SECONDS=.1;
const TRAP_DISARM_FRAMES=8;
const LAUNCHER_FIRE_SECONDS=.5;
const TURRET_FIRE_SECONDS=.2;
const TURRET_LIFE_SECONDS=4.5;
const BRIDGE_OPEN_SECONDS=1;
const BRIDGE_CLOSED_SECONDS=1.25;

export class Mechanisms{
  constructor(level,definition={}){
    this.level=level;this.definition=definition;
    this.baseGrid=level.world.grid.slice();this.baseCatGrid=level.catWorld.grid.slice();
    this.reset();
  }
  reset(){
    const base={taken:false,spent:false,cooldown:0,contact:false,active:false,elapsed:0,open:false,openness:0,charges:0,armed:false,armTimer:0,timer:0,flash:0,life:Infinity,disarmT:0};
    this.objects=copy(this.definition.objects||[]).map(o=>({...base,...o,home:{x:o.x,y:o.y}}));
    this.signals=new Map();this.signalTimers=new Map();this.tools=[];this.boost=null;this.coverTime=0;this.balloon=false;this.transit=null;this.pendingInteraction=null;
    this.floorTravel=null;
    this.exitDoorReady=null;this.floorCooldown=0;
    // Never leave a timed-switch tick loop running after a level reset.
    audio.stopSound(SOUND.timerTick);audio.stopSound(SOUND.timerSlow);audio.stopSound(SOUND.platformLoop);
    this.platformLoop=false;
    this.gates=this.objects.filter(o=>o.kind==='gate');
    this.platforms=this.objects.filter(o=>o.kind==='platform');
    this.bridges=this.objects.filter(o=>o.kind==='bridge');
    for(const bridge of this.bridges){bridge.active=bridge.prop!==354;bridge.timer=bridge.active?BRIDGE_OPEN_SECONDS:BRIDGE_CLOSED_SECONDS;}
    for(const gate of this.gates){gate.initialOpen=gate.prop>=218;gate.open=gate.initialOpen;gate.openness=gate.open?1:0;}
    for(const object of this.objects){
      if(object.kind==='item'){
        const radius=this.level.world.cell*0.35;
        if(this.level.world.circleHitsWall(object.x,object.y,radius)){
          const open=this.level.world.closestOpen(object.x,object.y,radius);
          object.x=open.x;object.y=open.y;
        }
      }
      if(object.kind==='machine'){
        // Native spawn rewrites 94/95 to 61 and stores the remaining charge
        // count (+0x22c): 61 -> 3, 94 -> 2, 95 -> 1. No unattended timer.
        // A machine without an equal-Tag 150 button cannot be triggered in
        // the shipped data (map784 3-S, map506 prop-601); it is scenery and
        // must not block level completion.
        object.charges=MACHINE_CHARGES[object.prop]??1;
        object.hasButton=this.objects.some(o=>o.kind==='switch'&&o.prop===150&&Math.abs(o.tag)===Math.abs(object.tag));
        object.spent=false;object.initialSpawned=false;
      }
      if(object.kind==='launcher'){
        const [a,b]=object.route||[];object.angle=a&&b?Math.atan2(b.y-a.y,b.x-a.x):0;
        object.timer=object.prop===275?TURRET_FIRE_SECONDS:LAUNCHER_FIRE_SECONDS;
        object.life=object.prop===275?TURRET_LIFE_SECONDS:Infinity;
      }
      if(object.kind==='flame'||object.kind==='gas'){
        const [a,b]=object.route||[];object.angle=a&&b?Math.atan2(b.y-a.y,b.x-a.x):0;
        object.maxLength=a&&b?distance(a,b):this.level.world.cell*6;
        object.length=0;
        object.timer=(Math.abs(object.tag)+(a?.wait||0))/1000;object.active=false;object.phaseTime=0;
      }
      if(object.kind==='trap'){object.armed=true;object.armTimer=0;}
      if(object.kind==='door'){object.open=false;object.openness=0;}
    }
    this.applyGateGrid();
  }
  // Remaining machine cheese charges gate level completion (see game.js
  // pendingMachineCheese). Each machine used to count as one; native charges
  // are 3/2/1 so the sum is the faithful value. Buttonless machines are not
  // counted: they cannot be triggered, so requiring them would soft-lock.
  get pendingCheese(){return this.objects.reduce((n,o)=>n+(o.kind==='machine'&&o.hasButton?Math.max(0,o.charges||0):0),0);}
  get items(){return this.objects.filter(o=>o.kind==='item');}
  interactionPoint(object){return this.level.world.closestOpen(object.x,object.y,this.level.world.cell*0.35);}

  // TV sprites are 128px sheet frames drawn at 128 web px: the native factory
  // 0x9f25c uses SetScale 64.0 design units and design units are 2 web px, so
  // no extra scaling is applied at draw time. The screen must face the open
  // side of its wall, not
  // blindly follow the first route point: a TV on the bottom wall faces up.
  tvFacing(object){
    const w=this.level.world,cell=w.cell;
    const route=object.route?.find(p=>distance(p,object)>1);
    const routeDir=route?Math.abs(route.x-object.x)>Math.abs(route.y-object.y)?route.x>object.x?'r':'l':route.y>object.y?'d':'u':'d';
    const vec={u:[0,-1],d:[0,1],l:[-1,0],r:[1,0]},opposite={u:'d',d:'u',l:'r',r:'l'};
    const open={},wall={};
    for(const [dir,[vx,vy]] of Object.entries(vec)){
      const probe=w.closestOpen(object.x+vx*cell*1.35,object.y+vy*cell*1.35,cell*0.3);
      const hit=w.gridCircleHitsWall(object.x+vx*cell*1.35,object.y+vy*cell*1.35,cell*0.3);
      (hit?wall:open)[dir]=true;
      // closestOpen above also normalizes a probe that landed in a wall.
      if(hit)delete open[dir];
    }
    const candidates=Object.keys(open).filter(dir=>wall[opposite[dir]]);
    if(candidates.includes(routeDir))return routeDir;
    if(candidates.length)return candidates[0];
    return routeDir;
  }

  tvViewPoint(object){
    const dir=this.tvFacing(object),cell=this.level.world.cell;
    const vec={u:[0,-1],d:[0,1],l:[-1,0],r:[1,0]}[dir];
    return this.level.world.closestOpen(object.x+vec[0]*cell*2,object.y+vec[1]*cell*2,cell*0.4);
  }
  count(game,key){game.stats.items??={};game.stats.items[key]=(game.stats.items[key]||0)+1;}

  setDoorOpen(prop,tag,open=true){
    let changed=false;
    for(const o of this.objects){
      if(o.kind!=='door'||o.prop!==prop)continue;
      if(tag!=null&&Math.abs(o.tag)!==Math.abs(tag))continue;
      o.open=!!open;o.manualOpen=!!open;changed=true;
    }
    return changed;
  }

  prepare(game,dt){
    if(this.floorTravel){
      const travel=this.floorTravel;travel.elapsed+=dt;
      travel.object.travelT=Math.min(1,travel.elapsed/travel.duration);
      if(travel.elapsed>=travel.duration){
        this.floorTravel=null;
        travel.object.travelT=1;
        if(travel.floor===travel.game.level.floor){travel.object.travelT=0;}
        else{
          if(travel.object.prop!==33)audio.playSound(SOUND.newRoom,{priority:6});
          travel.game.switchFloor(travel.floor);
        }
      }
    }
    if(this.boost){this.boost.left=Math.max(0,this.boost.left-dt);if(!this.boost.left)this.boost=null;}
    // Native machine spawn (0xa1acc/0xa26b0) immediately emits the first
    // cheese; the authored charges are the remaining button outputs.
    for(const machine of this.objects){
      if(machine.kind!=='machine'||machine.initialSpawned||!machine.hasButton)continue;
      machine.initialSpawned=true;
      const w=this.level.world,position=w.closestOpen(machine.x,machine.y+w.cell*2.5,w.cell*0.35);
      this.level.cheeses.push({...position,prop:8,taken:false,generated:true,initial:true,machineId:machine.id});
      game.cheeseLeft++;
    }
    this.coverTime=Math.max(0,this.coverTime-dt);
    const m=game.mouse;m.disguised=this.coverTime>0;
    // Native b6d8c..b6d9c: run * (1 + score_speed_mult * chilli).
    // hazards.js sets game.envSpeedMult (playerwater_speed_mult 0.9 in water).
    m.speed=CFG.mouse.speedCells*m.cell*(1+.2*(this.boost?.multiplier||0))*(game.envSpeedMult??1);
    if(this.transit){
      const t=this.transit;t.elapsed+=dt;const k=clamp(t.elapsed/t.duration,0,1);
      if(t.points?.length){
        let left=k*t.total,prev=t.points[0];
        let x=prev.x,y=prev.y;
        for(let i=1;i<t.points.length;i++){
          const p=t.points[i],seg=Math.hypot(p.x-prev.x,p.y-prev.y);
          if(left<=seg||i===t.points.length-1){const f=seg?Math.min(1,left/seg):1;x=prev.x+(p.x-prev.x)*f;y=prev.y+(p.y-prev.y)*f;break;}
          left-=seg;prev=p;
        }
        m.x=x;m.y=y;
      }else{
        m.x=t.from.x+(t.to.x-t.from.x)*k;m.y=t.from.y+(t.to.y-t.from.y)*k;
      }
      m.airborne=true;
      m.lift=Math.sin(k*Math.PI)*(t.cannon?m.cell*5:m.cell);
      if(k>=1){m.airborne=false;m.lift=0;this.transit=null;resetCarried(game.carried,m);game.pipeCooldown=.7;}
    }
    for(const platform of this.platforms){
      const old={x:platform.x,y:platform.y};
      // Native 0x9611c: tag speed bands, defaults .65/.85/1 design units/frame.
      advanceMover(platform,dt,(Math.abs(platform.tag)<200?78:Math.abs(platform.tag)<300?102:120));
      const dx=platform.x-old.x,dy=platform.y-old.y;
      // Native platform_update_96b80 only advances the route and plays 114.
      // There is no rider-carry code and no terrain write (PROVEN negative).
      if(dx||dy)platform.movingNow=true;
    }
    const anyPlatformMoving=this.platforms.some(p=>p.movingNow);
    for(const p of this.platforms)p.movingNow=false;
    if(anyPlatformMoving&&!this.platformLoop){this.platformLoop=true;audio.playSound(SOUND.platformLoop,{loop:true,priority:3});}
    else if(!anyPlatformMoving&&this.platformLoop){this.platformLoop=false;audio.stopSound(SOUND.platformLoop);}
    // Timed switches: 67/153 = 10 s, 80 = 20 s, 81 = 30 s (native 0x99eb0).
    for(const [tag,state] of this.signalTimers){
      const before=state.left,next=before-dt;
      if(state.slow&&next<=5){
        state.slow=false;state.alarmed=true;
        audio.stopSound(SOUND.timerSlow);
        audio.playSound(SOUND.timerAlarm,{priority:6});
        audio.playSound(SOUND.timerTick,{loop:true,priority:4});
      }
      if(next<=0){
        this.signals.set(tag,false);this.signalTimers.delete(tag);
        audio.stopSound(SOUND.timerTick);audio.stopSound(SOUND.timerSlow);
        audio.playSound(SOUND.switchReset,{priority:5});
        for(const o of this.objects)if(o.kind==='switch'&&Math.abs(o.tag)===tag&&SWITCH_TIMED[o.prop])o.active=false;
      }else state.left=next;
    }
    // Remote receivers (151/152/154) and the boss4 trigger mirror the signal.
    for(const o of this.objects){
      if(o.kind==='switch'&&(SWITCH_REMOTE.includes(o.prop)))o.active=!!this.signals.get(Math.abs(o.tag));
    }
    // Traps are live from spawn (state 0x1a); +0x204=3000 is not read by the
    // trap tick, so there is no arming countdown to advance.
    // Timed bridge 354: native 0xa22c8 states 0x3e-0x41 use 1000/1250 ms phases.
    let bridgeChanged=false;
    for(const bridge of this.bridges){
      if(bridge.prop!==354)continue;
      bridge.timer-=dt;
      if(bridge.timer<=0){bridge.active=!bridge.active;bridge.timer=bridge.active?BRIDGE_OPEN_SECONDS:BRIDGE_CLOSED_SECONDS;bridgeChanged=true;}
    }
    // Exit doors 358/359 (Lead's game.js reads door.open). No invented opens:
    // 358 only after a boss win, 359 only when the level goal is complete
    // (HYPOTHESIS: native level scripts set state 0x27; the old synthetic exit
    // used the same condition).
    for(const door of this.objects){
      if(door.kind!=='door')continue;
      if(door.manualOpen==null){
        if(door.prop===358)door.open=!!(game.bossWin||game.bossWorldComplete);
        else if(door.prop===359)door.open=!!(game.cheeseLeft===0&&(game.pendingMachineCheese??0)===0);
      }
      door.openness=clamp(door.openness+(door.open?1:-1)*dt*5,0,1);
    }
    this.floorCooldown=Math.max(0,this.floorCooldown-dt);
    let changed=bridgeChanged;
    for(const gate of this.gates){
      const signal=this.signals.get(Math.abs(gate.tag));
      let open=signal===undefined?gate.initialOpen:gate.initialOpen?!signal:signal;
      // Native 0x8ab30 only reads state and the sprite sequence: there is no
      // player/cat body test, i.e. a gate can close through an actor. The old
      // "never close through a body" guard was an invention and is removed.
      if(open!==gate.open){gate.open=open;changed=true;const barrier=gate.prop>=210&&gate.prop<=225;audio.playSound(open?(barrier?SOUND.barrierUp:SOUND.doorOpen):(barrier?SOUND.barrierDown:SOUND.doorClose),{priority:5});}
      gate.openness=clamp(gate.openness+(gate.open?1:-1)*dt*5,0,1);
    }
    if(changed)this.applyGateGrid();
    if(changed)for(const cat of this.level.cats){cat.navPath=null;cat.navGoal=null;cat.repathTimer=0;cat.navInvalidated=true;}
  }

  inGate(p,gate,extra=0){const vertical=gateVertical(gate.prop);const hx=vertical?16:20,hy=vertical?20:16;return Math.abs(p.x-gate.x)<hx+extra&&Math.abs(p.y-gate.y)<hy+extra;}
  gateCells(gate){
    const world=this.level.world,vertical=gateVertical(gate.prop),cells=[];const hx=vertical?16:20,hy=vertical?20:16;
    for(let y=Math.floor((gate.y-hy)/world.cell);y<=Math.floor((gate.y+hy-.01)/world.cell);y++)
      for(let x=Math.floor((gate.x-hx)/world.cell);x<=Math.floor((gate.x+hx-.01)/world.cell);x++)
        if(x>0&&y>0&&x<world.cols-1&&y<world.rows-1)cells.push(y*world.cols+x);
    return cells;
  }
  applyGateGrid(){
    for(const [world,base] of [[this.level.world,this.baseGrid],[this.level.catWorld,this.baseCatGrid]]){
      world.grid.set(base);
      // Platforms do not write terrain collision (native negative evidence).
      for(const bridge of this.bridges)if(bridge.active){
        // Bridge art is a 92x92 (94x92 timed) plank piece. Clear only its
        // oriented footprint; the old ±115x30 box opened huge wall strips.
        const vertical=this.bridgeVertical(bridge),hx=vertical?30:46,hy=vertical?46:30;
        for(let y=Math.floor((bridge.y-hy)/world.cell);y<Math.ceil((bridge.y+hy)/world.cell);y++)for(let x=Math.floor((bridge.x-hx)/world.cell);x<Math.ceil((bridge.x+hx)/world.cell);x++)if(x>0&&y>0&&x<world.cols-1&&y<world.rows-1)world.grid[y*world.cols+x]=0;
      }
      // Bridge pieces are authored as consecutive tiles (~68-90 px apart).
      // Connect nearby pieces so BFS can cross the whole span, not just each
      // 72 px island individually.
      if(this.bridges.some(b=>b.active))for(let i=0;i<this.bridges.length;i++)for(let j=i+1;j<this.bridges.length;j++){
        const a=this.bridges[i],b=this.bridges[j];
        if(!a.active||!b.active)continue;
        const d=Math.hypot(b.x-a.x,b.y-a.y);if(d>140)continue;
        const steps=Math.max(1,Math.ceil(d/8));
        for(let k=0;k<=steps;k++){
          const t=k/steps,x0=a.x+(b.x-a.x)*t,y0=a.y+(b.y-a.y)*t;
          for(let y=Math.floor((y0-36)/world.cell);y<Math.ceil((y0+36)/world.cell);y++)for(let x=Math.floor((x0-36)/world.cell);x<Math.ceil((x0+36)/world.cell);x++)if(x>0&&y>0&&x<world.cols-1&&y<world.rows-1)world.grid[y*world.cols+x]=0;
        }
      }
      for(const gate of this.gates)for(const i of this.gateCells(gate))world.grid[i]=0;
      for(const gate of this.gates)if(!gate.open)for(const i of this.gateCells(gate))world.grid[i]=1;
    }
  }

  activate(game,object){
    const tag=Math.abs(object.tag),prop=object.prop;
    // Native 0x9a060: props 151-154 reject player touch; they only change state
    // through an equal-Tag signal (they are receivers/logic switches).
    if(SWITCH_REMOTE.includes(prop))return false;
    object.active=true;object.elapsed=0;
    if(prop===150){
      // trigger_cheese: broadcast the machine trigger of this Tag.
      for(const machine of this.objects.filter(o=>o.kind==='machine'&&Math.abs(o.tag)===tag))this.dispense(game,machine);
      audio.playSound(SOUND.switchOn,{priority:5});
    }else if(SWITCH_LATCH.includes(prop)){
      // 65 latches a group open, 66 latches it closed (broadcast action 1 / 2).
      this.signals.set(tag,prop!==66);
      this.signalTimers.delete(tag);
      audio.playSound(SOUND.switchOn,{priority:5});
    }else if(SWITCH_TIMED[prop]){
      // 67/153 = 10 s, 80 = 20 s, 81 = 30 s; native 0x998f0:
      // >4999 ms -> 118 slow loop; <=4999 ms -> 116 alarm once + 117 fast loop.
      this.signals.set(tag,true);
      audio.stopSound(SOUND.timerTick);audio.stopSound(SOUND.timerSlow);
      const left=SWITCH_TIMED[prop];
      this.signalTimers.set(tag,{left,alarmed:left<=5,slow:left>5});
      if(left>5)audio.playSound(SOUND.timerSlow,{loop:true,priority:4});
      else{audio.playSound(SOUND.timerAlarm,{priority:6});audio.playSound(SOUND.timerTick,{loop:true,priority:4});}
      audio.playSound(SOUND.switchOn,{priority:5});
    }else if(prop===155){
      // Boss4 two-state trigger: first press on, second press resets (0x998f0).
      object.stage=!object.stage;
      this.signals.set(tag,!!object.stage);
      object.active=!!object.stage;
      audio.playSound(SOUND.switchOn,{priority:5});
    }else return false;
    this.count(game,'switch');
    return true;
  }
  dispense(game,machine){
    // Native player+0x48 / game+0x48 carry limit, observed at runtime as 4.
    // Guard machine output; authored floor cheese remains collectible until a
    // proper native drop/delivery action is implemented.
    if((game.carried?.length||0)>=4)return false;
    if(machine.cooldown>0||(machine.charges??0)<=0)return false;
    const w=this.level.world,position=w.closestOpen(machine.x,machine.y+w.cell*2.5,w.cell*0.35);
    // The machine is a source of cheese, not an already completed empty level.
    const cheese={...position,prop:8,taken:false,generated:true,machineId:machine.id};
    this.level.cheeses.push(cheese);game.cheeseLeft++;
    machine.charges-=1;machine.spent=machine.charges<=0;machine.cooldown=.8;machine.elapsed=0;
    audio.playSound(SOUND.machine,{priority:5});
    game.emitHud();return true;
  }

  pickup(game,item){
    item.taken=true;this.count(game,item.item==='cover'?(this.isBucket?'bucket':'teacup'):item.item==='chilli2'?'chilli':item.item);
    if(item.item==='cheese_inf')game.score+=1; // native cheese_instantscore
    const sound=item.item==='dossier'?SOUND.dossier:item.item==='chilli'||item.item==='chilli2'?SOUND.chilli:item.item==='cover'?SOUND.cover:item.item==='balloon'?SOUND.balloon:item.item==='fish'?SOUND.fish:item.item==='string'?SOUND.string:item.item==='cheese_inf'?SOUND.cheeseInf:SOUND.toy;
    audio.playSound(sound,{priority:5});
    if(item.item==='dossier')game.collectDossier?.(item.tag);
    if(item.item==='chilli'||item.item==='chilli2')this.boost={...EFFECTS[item.item],left:EFFECTS[item.item].duration};
    else if(item.item==='cover')this.coverTime=EFFECTS.cover;
    else if(item.item==='balloon')this.balloon=true;
    else if(INSTANT_ITEMS.has(item.item)){/* collected immediately; counted above */}
    else this.tools.push({sourceId:item.id,sourceFloor:this.level.floor,kind:item.item,x:game.mouse.x,y:game.mouse.y,angle:game.mouse.angle});
    game.floats.push({x:item.x,y:item.y,t:0,text:ITEM_LABELS[item.item],color:'#ffbc43'});game.emitHud();
  }
  get isBucket(){return /^3-/.test(this.level.num);}
  distract(cat,target,kind){
    if(!cat||cat.ghost||cat.blind)return;
    if(kind==='string')audio.playSound(32,{priority:6}); // cat_string
    cat.distraction={x:target.x,y:target.y,kind,left:kind==='string'?EFFECTS.string:EFFECTS.distraction};cat.rest=null;cat.state='distracted';
    cat.navPath=null;cat.navGoal=null;cat.repathTimer=0;cat.pounceTarget=null;cat.attackTarget=null;cat.pounceTimer=0;
  }

  update(game,dt,previous){
    const m=game.mouse,w=this.level.world;
    if(game.floorExitLock&&distance(m,game.floorExitLock)>w.cell*2.1)game.floorExitLock=null;
    if(this.pendingInteraction&&!m.hidden&&!m.airborne){
      const object=this.objects.find(o=>o.id===this.pendingInteraction.id);
      if(object&&distance(m,this.interactionPoint(object))<=w.cell*2){this.pendingInteraction=null;this.use(game,object);}
      else if(!m.path?.length||m.cursor>=m.path.length)this.pendingInteraction=null;
    }
    for(const o of this.objects){o.cooldown=Math.max(0,o.cooldown-dt);o.elapsed+=dt;if(o.kind==='trap'&&o.spent)o.disarmT+=dt;}
    for(const flame of this.objects.filter(o=>o.kind==='flame')){
      const period=Math.max(.25,Math.floor(Math.abs(flame.tag)/250)*.25);
      const continuous=Math.abs(flame.tag)>60000;
      flame.timer-=dt;flame.phaseTime+=dt;
      if(continuous){flame.active=true;flame.length=flame.maxLength;}
      else{
        // Native 0x8e670/0x1425a4: 500 ms extension, 2 s warning,
        // .5 pause ratio and 1450 ms retreat. Route first wait is an ms phase offset here.
        if(flame.timer<=0){flame.active=!flame.active;flame.phaseTime=0;flame.timer=flame.active?period*.5+1.45:period+2;}
        flame.length=flame.active?flame.maxLength*Math.min(1,flame.phaseTime/.5,Math.max(0,flame.timer/1.45)):0;
      }
      const rotation=flame.prop===276?0:(flame.prop===277?1:-1)*flame.elapsed*Math.PI*2/(continuous?2:Math.max(.25,period*.5));
      flame.drawAngle=flame.angle+rotation;
      if(flame.length>4&&!m.hidden&&!m.airborne){const end={x:flame.x+Math.cos(flame.drawAngle)*flame.length,y:flame.y+Math.sin(flame.drawAngle)*flame.length};if(segmentDistance(m,flame,end)<m.radius+10){this.count(game,'touched_flame');audio.playSound(SOUND.fire,{priority:7});game.caught(null,'fire');return;}}
    }
    // Boss5 gas vents 279-281 (native 0x8e670 gas path): non-lethal knockback
    // along the jet (settings+0x234 = 3.5) instead of burning the player.
    for(const gas of this.objects.filter(o=>o.kind==='gas')){
      const period=Math.max(.5,Math.floor(Math.abs(gas.tag)/250)*.25);
      gas.timer-=dt;gas.phaseTime+=dt;
      if(gas.timer<=0){gas.active=!gas.active;gas.phaseTime=0;gas.timer=gas.active?period*.5+1.45:period+2;}
      gas.length=gas.active?gas.maxLength*Math.min(1,gas.phaseTime/.5,Math.max(0,gas.timer/1.45)):0;
      gas.drawAngle=gas.angle;
      if(gas.length>4&&!m.hidden&&!m.airborne){
        const end={x:gas.x+Math.cos(gas.drawAngle)*gas.length,y:gas.y+Math.sin(gas.drawAngle)*gas.length};
        if(segmentDistance(m,gas,end)<m.radius+12){m.x+=Math.cos(gas.drawAngle)*3.5;m.y+=Math.sin(gas.drawAngle)*3.5;this.count(game,'touched_gas');audio.playSound(SOUND.gas,{priority:4});}
      }
    }
    for(const launcher of this.objects.filter(o=>o.kind==='launcher')){
      launcher.flash=Math.max(0,(launcher.flash||0)-dt);
      // 274 is a one-shot decorated spawner with no per-frame behaviour (the
      // native spawner update only tests 269/270/275); 271-273 are unused.
      if(![269,270,275].includes(launcher.prop))continue;
      if(launcher.prop===275){launcher.life=(launcher.life??TURRET_LIFE_SECONDS)-dt;if(launcher.life<=0)continue;}
      launcher.timer-=dt;
      if(launcher.timer>0)continue;
      let aim=launcher.angle;
      if(launcher.prop===270||launcher.prop===275){
        // Native 0x974f0: cone/vision check (0x9c4e4 with the cat vision arc)
        // then aim at the player. No line-of-sight means no shot.
        const dx=m.x-launcher.x,dy=m.y-launcher.y,d=Math.hypot(dx,dy);
        const cone=Math.abs(angleDiff(Math.atan2(dy,dx),launcher.angle))<=(CFG.cat?.fov??145)*Math.PI/360;
        const visible=!m.hidden&&d<w.cell*30&&cone&&w.lineClear(launcher.x,launcher.y,m.x,m.y);
        if(!visible){launcher.timer=.2;continue;}
        aim=Math.atan2(dy,dx);launcher.angle=aim;
      }
      const turret=launcher.prop===275;
      const speed=160,muzzle=turret?28:36;
      const x=launcher.x+Math.cos(aim)*muzzle,y=launcher.y+Math.sin(aim)*muzzle;
      game.projectiles.push({x,y,tx:x+Math.cos(aim)*w.w,ty:y+Math.sin(aim)*w.w,speed,radius:turret?5:6,life:w.w/speed,angle:aim,type:turret?'shuriken':'wall'});
      audio.playSound(SOUND.launcher,{priority:5});
      launcher.timer=turret?TURRET_FIRE_SECONDS:LAUNCHER_FIRE_SECONDS;launcher.flash=.2;
    }
    updateCarried(this.tools,m,w,dt);
    for(let i=this.tools.length-1;i>=0;i--){
      const tool=this.tools[i];
      const cat=this.level.cats.find(c=>!c.ghost&&!c.blind&&c.state!=='stunned'&&!c.distraction&&distance(c,tool)<w.cell*2.2&&w.lineClear(c.x,c.y,tool.x,tool.y));
      if(cat&&!cat.ghost&&!cat.blind){this.distract(cat,tool,tool.kind);this.tools.splice(i,1);const source=game.floorLevels?.get(tool.sourceFloor)||this.level;const item=source.mechanisms.items.find(o=>o.id===tool.sourceId);if(item&&tool.kind==='string'){item.taken=false;item.x=tool.x;item.y=tool.y;item.cooldown=EFFECTS.string+.5;
        // A reusable tool dropped upstairs belongs to that floor, even if picked up downstairs.
        if(source!==this.level){source.mechanisms.objects=source.mechanisms.objects.filter(o=>o!==item);this.objects.push(item);}
      }}
    }
    for(const o of this.objects){
      const contactPoint=['tv','furniture','cannon','floor'].includes(o.kind)?this.interactionPoint(o):o;
      const touched=!m.hidden&&!m.airborne&&segmentDistance(contactPoint,previous||m,m)<w.cell*1.25;
      if(o.kind==='item'&&!o.taken&&o.cooldown===0&&touched)this.pickup(game,o);
      else if(o.kind==='switch'){
        let contact=false;
        if(SWITCH_CAT.includes(o.prop))contact=this.level.cats.some(c=>distance(c,o)<w.cell*1.5);
        else if(!SWITCH_REMOTE.includes(o.prop))contact=touched;
        if(contact&&!o.contact)this.activate(game,o);
        o.contact=contact;
      }else if(o.kind==='tv'){
        // Native 0x83934: the TV is toggled by the player's tap/use action,
        // not by walking past its collision box.
        if(o.active)for(const cat of this.level.cats){
          if(distance(cat,o)<w.cell*14&&w.lineClear(cat.x,cat.y,o.x,o.y)&&(!cat.distraction||cat.distraction.kind==='tv')){
            if(!cat.distraction)this.distract(cat,this.tvViewPoint(o),'tv');else cat.distraction.left=EFFECTS.distraction;
          }
        }
      }else if(o.kind==='trap'&&!o.spent){
        // Native 0xa2400: the trap only reacts when the player's carried chain
        // contains a cwmouse (prop 11) or 0x48 and the player is near; the decoy
        // disarms the trap (0xb3908 cheese collection + sound 0x44).
        // Presentation rule: the decoy is caught where it is; it must NOT fly
        // across the room into the trap.
        const near=touched||distance(m,o)<w.cell*2.2;
        const decoy=(this.level.cwmice||[]).find(c=>c.picked&&!c.gone&&!c.fleeing);
        if(o.armed&&near&&decoy){
          decoy.gone=true;
          o.spent=true;o.disarmT=0;
          this.count(game,'disarm_trap');
          audio.playSound(SOUND.trapDisarm,{priority:6});
          if(typeof game.collectTrapCheese==='function')game.collectTrapCheese(o);
        }else if(o.armed&&touched&&!m.hidden){
          // 0xb52e4 death + 0x77 trap_activate.
          audio.playSound(SOUND.trapKill,{priority:7});game.caught(null,'trap');return;
        }
      }else if((o.kind==='cannon'||o.kind==='floor'&&!game.floorExitLock)&&touched&&game.pipeCooldown<=0&&!this.transit){if(this.travel(game,o))return;}
    }
    // Exit doors 358/359: expose the contact for game.js (Lead owns the
    // levelClear branch). Open state is driven in prepare (boss win / goal).
    this.exitDoorReady=null;
    for(const door of this.objects){
      if(door.kind!=='door'||!door.open||(door.prop!==358&&door.prop!==359))continue;
      if(!m.hidden&&distance(m,this.interactionPoint(door))<w.cell*0.9){this.exitDoorReady={id:door.id,prop:door.prop,x:door.x,y:door.y};break;}
    }
  }

  destinationFloor(game,object){
    // Explicit floor links only. Native FloorTransport 0x8c2d4 sets the global
    // "change floor" flag and lets the level manager choose; the shipped data
    // encodes the target in the object itself:
    //   - prop 34: Tag is the destination floor number (map727/729/755/...);
    //   - props 31/35 (and 33/36-39/320): unique same-Tag counterpart on
    //     another floor, otherwise the only floor that has a floor trigger.
    // No |tag|/current+1 guesses remain.
    const current=this.level.floor||0;
    const floors=game.floorLevels?[...game.floorLevels.keys()]:[current];
    // Explicit floor links are baked into the data by tools/import-mechanisms.mjs
    // (object.targetFloor). The runtime rules below only cover hand-authored
    // test data and legacy objects without the field.
    if(object.targetFloor!=null&&floors.includes(object.targetFloor))return object.targetFloor;
    if(object.prop===34){const t=Math.abs(object.tag);if(t!==current&&floors.includes(t))return t;}
    const peers=[];
    for(const floor of game.floorLevels?.values()||[]){
      if(floor===this.level)continue;
      for(const o of floor.mechanisms.objects){
        if(o.kind!=='floor')continue;
        const sameFamily=o.prop===object.prop||([31,35].includes(o.prop)&&[31,35].includes(object.prop));
        if(sameFamily&&Math.abs(o.tag)===Math.abs(object.tag))peers.push(floor.floor);
      }
    }
    const uniq=[...new Set(peers)];
    if(uniq.length===1)return uniq[0];
    if([31,35].includes(object.prop)){
      const others=new Set();
      for(const floor of game.floorLevels?.values()||[]){
        if(floor===this.level)continue;
        for(const o of floor.mechanisms.objects)if(o.kind==='floor'&&[31,34,35].includes(o.prop))others.add(floor.floor);
      }
      if(others.size===1)return [...others][0];
    }
    const sorted=floors.slice().sort((a,b)=>a-b);
    const index=sorted.indexOf(current);
    // House door / trapdoors / sliding door: the native controller only asks
    // the level manager to change floor. Shipped multi-floor maps order the
    // rooms, so the next authored floor is the destination; the last room has
    // no destination (stay). A same-Tag counterpart at the same position wins
    // when present (map786_1 style return doors).
    if([33,36,37,38,39,320].includes(object.prop)){
      const counterpart=[];
      for(const floor of game.floorLevels?.values()||[]){
        if(floor===this.level)continue;
        for(const o of floor.mechanisms.objects)if(o.kind==='floor'&&Math.abs(o.tag)===Math.abs(object.tag)&&distance(o,object)<this.level.world.cell*2)counterpart.push(floor.floor);
      }
      const cup=[...new Set(counterpart)];
      if(cup.length===1)return cup[0];
      if(index>=0&&index+1<sorted.length)return sorted[index+1];
      return current;
    }
    // 267 rides up, 268 rides down (map767/769 pair them on consecutive
    // floors); with a single floor they are in-room elevators and do not
    // change floor.
    if(object.prop===267)return index>=0&&index+1<sorted.length?sorted[index+1]:current;
    if(object.prop===268)return index>0?sorted[index-1]:current;
    return null;
  }
  travel(game,object){
    if(object.kind==='floor'&&game.switchFloor){
      // Native cooldown: 1000 ms for the house door (33), 10000 ms otherwise
      // (player+0x1fc, 0x8c2d4).
      if(this.floorCooldown>0)return false;
      const current=this.level.floor||0;
      const floor=this.destinationFloor(game,object);
      if(floor!=null){
        this.floorCooldown=object.prop===33?1:10;
        const duration=[267,268].includes(object.prop)?1.5:[33,36,37,320].includes(object.prop)?1:0;
        if(duration>0){
          this.floorTravel={object,game,floor,elapsed:0,duration};
          object.travelT=0;
          if(object.prop===33)audio.playSound(SOUND.doorOpen,{priority:6});
          this.count(game,'floor');
          return true;
        }
        if(object.prop===33)audio.playSound(SOUND.doorOpen,{priority:6});
        else audio.playSound(SOUND.newRoom,{priority:6});
        this.count(game,'floor');
        if(floor===current)return true; // in-room ride, no floor change
        if(game.switchFloor(floor))return true;
      }
      return false;
    }
    if(object.kind==='cannon'&&object.route?.length>=2){
      // Native 0xa25c4 stores the authored route as the cannon trajectory;
      // the whole polyline is used, not only the farthest endpoint.
      const points=[{x:object.x,y:object.y}];
      for(const p of object.route){const q={x:p.x,y:p.y};if(distance(q,points[points.length-1])>0.5)points.push(q);}
      const last=points[points.length-1];
      points[points.length-1]=this.level.world.closestOpen(last.x,last.y,game.mouse.radius);
      let total=0;for(let i=1;i<points.length;i++)total+=distance(points[i-1],points[i]);
      const duration=clamp(total/600,.35,1.8);
      this.transit={from:{x:game.mouse.x,y:game.mouse.y},points,total,elapsed:0,duration,cannon:true};
      audio.playSound(SOUND.cannon,{priority:6});
      this.count(game,'cannon');game.pipeCooldown=1;return true;
    }
    return false;
  }
  onHide(){this.balloon=false;this.coverTime=0;}
  absorbProjectile(){if(!this.balloon)return false;this.balloon=false;audio.playSound(4,{priority:6});return true;}
  handleTap(game,point){
    const m=game.mouse,w=this.level.world;
    if(m.furnitureId!=null){m.hidden=false;m.furnitureId=null;m.hiddenTag=null;const open=w.closestOpen(point.x,point.y,m.radius);const route=w.bfsToWorld(m.x,m.y,open.x,open.y);if(route)m.setPath(route);return true;}
    const object=this.objects.find(o=>['tv','furniture','cannon','floor'].includes(o.kind)&&distance(point,o)<w.cell*2);
    if(!object)return false;
    const open=this.interactionPoint(object);
    if(distance(m,open)>w.cell*2){const route=w.bfsToWorld(m.x,m.y,open.x,open.y);if(route){m.setPath(route);this.pendingInteraction={id:object.id};}return true;}
    this.pendingInteraction=null;this.use(game,object);return true;
  }
  use(game,object){
    const m=game.mouse;
    if(object.kind==='furniture'){m.hidden=true;m.furnitureId=object.id;m.clearPath();this.onHide();this.count(game,'furniture');audio.playSound(39,{priority:5});}
    else if(object.kind==='tv'){object.active=!object.active;this.count(game,'tv');audio.playSound(72,{priority:5});}
    else {if(object.kind==='floor')game.floorExitLock=null;this.travel(game,object);}
  }

  switchSprite(o){
    const level=this.level;
    if(o.prop===150){const n=Math.abs(o.tag);return n===253?'trigger_bomb':n===301?'trigger_exclamation':'trigger_cheese';}
    if(o.prop===155){const n=Math.abs(o.tag);return [2,3,4,5].includes(n)?`trigger_${n}`:'trigger_2';}
    const colour=signalColour(o.tag);
    // Native factory 0x8fd14: 80/81 use boss4/trigger_cat_<colour> (blue has
    // only the set sheet), 154/155 boss4/trigger_<tag>, boss5 red/green and
    // boss7 mayan override the generic trigger_set_<colour> art.
    // Native 80/81 are cat-only triggers but use the normal trigger_set art,
    // not the trigger_cat_* sheets.
    if(SWITCH_CAT.includes(o.prop)&&['red','yellow','green'].includes(colour))return `trigger_set_${colour}`;
    if(level.mode==='boss'&&String(level.num).startsWith('5-')&&['red','green'].includes(colour))return `trigger_set_${colour}_boss5`;
    if(level.mode==='boss'&&String(level.num).startsWith('7-'))return 'trigger_set_mayan';
    return `trigger_set_${colour}`;
  }
  gateSprite(o){
    const colour=signalColour(o.tag);
    // Native 0x8acb8: boss5 uses boss5/bars_boss5_<colour>, others use
    // bars_<chapter-theme>_<colour>.
    if(this.level.mode==='boss'&&String(this.level.num).startsWith('5-')&&['red','green'].includes(colour))return `bars_boss5_${colour}`;
    return `bars_${doorTheme(this.level)}_${colour}`;
  }

  bridgeVertical(bridge){
    // Bridge placements have no route; infer the chain direction from the
    // nearest neighbouring bridge tile (map780/781 are vertical chains).
    let best=null,bestD=Infinity;
    for(const other of this.bridges){
      if(other===bridge)continue;
      const d=Math.hypot(other.x-bridge.x,other.y-bridge.y);
      if(d<bestD&&d<=140){bestD=d;best=other;}
    }
    return !!best&&Math.abs(best.y-bridge.y)>Math.abs(best.x-bridge.x);
  }

  draw(game,ctx){
    const sprites=game.sprites,w=this.level.world;
    for(const o of this.objects){
      let key=null,frame=0,width=64,height=64;
      if(o.kind==='item'){
        if(o.taken||o.cooldown>0)continue;key=ITEM_ART[o.item];if(o.item==='cover'&&this.isBucket)key='bucket';
        if(o.item==='cover'&&!this.isBucket){
          const variant=`teacup${String((Math.abs(o.tag||0)%8)+1).padStart(2,'0')}`;
          if(sprites.images[variant])key=variant;
        }
        const s=sprites.images[key];if(s){width=s.fw;height=s.fh;}
        const anim=ITEM_ANIM[o.item];
        frame=o.item==='cheese_inf'?(o.itemFrame||0):INSTANT_ITEMS.has(o.item)?0:STATIC_ITEMS.has(o.item)?0:anim?Math.floor(game.time/anim.frameTime+1e-6)%anim.frames:Math.floor(game.time*5);
      }else if(o.kind==='switch'){
        key=this.switchSprite(o);width=40;height=40;
        if(key==='trigger_set_mayan'){width=76;height=34;}
        const bossPair=key.startsWith('trigger_set_')&&key.endsWith('_boss5');
        const mayan=key==='trigger_set_mayan';
        const catSheet=key.startsWith('trigger_cat_');
        const pair=[65,66].includes(o.prop)?(o.prop===65?0:2):[67,80,81,153].includes(o.prop)?4:6;
        frame=mayan?0:o.prop===150||o.prop===155?(o.active?1:0):catSheet?(o.active?1:0):pair+(o.active?1:0);
        const timer=this.signalTimers.get(Math.abs(o.tag));
        if(timer){const total=SWITCH_TIMED[o.prop]||Math.max(1,timer.left);const f=Math.max(0,Math.min(30,Math.floor((1-timer.left/total)*30)));sprites.frame(ctx,'timer',f,o.x,o.y-34,36,36);}
      }else if(o.kind==='gate'){
        key=this.gateSprite(o);frame=Math.min(5,Math.floor(o.openness*5));width=32;height=40;
        ctx.save();ctx.translate(o.x,o.y);ctx.rotate(((o.prop-210)%4)*Math.PI/2);
        sprites.frame(ctx,key,frame,0,0,width,height);ctx.restore();continue;
      }else if(o.kind==='machine'){key='cheese_machine';width=height=96;frame=o.spent?5:o.cooldown>0?Math.floor(o.elapsed*5)%6:0;}
      else if(o.kind==='tv'){
        // Suffix names the wall/back side (tv_l = wall on left, screen right),
        // so a TV facing right uses the left-wall art. Native factory 0x9f25c
        // uses SetScale 64.0 design units; design units are 2 web px (see the
        // LoadSheet 24 -> 48px cell note in game.js), so the TV fills 128 web
        // px — one full sheet frame, whose art body (~56x70 idle, wave extends
        // to 81 wide) is roughly centered in it.
        const facing=this.tvFacing(o);
        const wallSide={u:'d',d:'u',l:'r',r:'l'}[facing];
        key=`tv_${wallSide}`;width=height=128;frame=o.active?Math.floor(game.time*5)%5:0;
      }
      else if(o.kind==='trap'){
        key='mouse_trap';width=64;height=84;
        // Native spawn (0xa1acc): state 0x1a is active at once and the sprite
        // stays on frame 0. After the decoy disarms it, SetSequence(0..7,
        // 100 ms) plays once and holds frame 7; the bait is gone from then on.
        frame=o.spent?Math.min(TRAP_DISARM_FRAMES-1,Math.floor((o.disarmT||0)/TRAP_DISARM_FRAME_SECONDS+1e-6)):0;
        sprites.frame(ctx,key,frame,o.x,o.y,width,height);
        // The bait wedge is part of the armed trap art (factory 0x9f7fc loads
        // it alongside the trap sheet); it stays visible through the 3 s arm
        // window and disappears only once the trap is spent.
        if(!o.spent)sprites.frame(ctx,'mouse_trap_cheesemask',0,o.x,o.y,64,84);
        continue;
      }
      else if(o.kind==='platform'){key='platform_rounded';width=height=96;}
      else if(o.kind==='launcher'){
        if([271,272,273,274].includes(o.prop)){const dir=({271:'d',272:'r',273:'u',274:'l'})[o.prop];key=`pipe_flipflap_${dir}`;width=height=64;frame=0;}
        else if(o.prop===275){if(Math.abs(o.tag)!==102)continue;key='shuriken_launcher';width=72;height=81;frame=0;}
        else{const dx=Math.cos(o.angle),dy=Math.sin(o.angle);key=`wallspawner_${Math.abs(dx)>Math.abs(dy)?dx>0?'r':'l':dy>0?'d':'u'}`;width=height=64;frame=o.flash>0?Math.min(4,1+Math.floor((.2-o.flash)*15)):Math.floor(game.time*5)%5;}
      }
      else if(o.kind==='flame'||o.kind==='gas'){
        ctx.save();ctx.translate(o.x,o.y);ctx.rotate(o.drawAngle??o.angle);
        if(o.kind==='gas'){
          sprites.frame(ctx,'gas_vent',0,0,0,58,74);
          if(o.length>0){for(let x=24;x<=o.length;x+=24)sprites.frame(ctx,'gas_stream',0,x,0,64,44);sprites.frame(ctx,'gas_puff',0,o.length,0,56,86);}
        }else{
          sprites.frame(ctx,o.prop===276?'flame_block':'flame_rotate_base',0,0,0,o.prop===276?90:32,o.prop===276?48:32);
          if(o.length>0){if(o.prop===276)sprites.frame(ctx,'flames',Math.floor(game.time*10),o.length/2,0,o.length,54);
            else for(let x=16;x<=o.length;x+=24)sprites.frame(ctx,'flame_rotate',0,x,0,32,32);}
        }
        ctx.restore();continue;
      }
      else if(o.kind==='bridge'){
        key=o.prop===354?'bridge_timed':'bridge';
        const frames=o.prop===354?4:5;
        frame=Math.floor(game.time/.1)%frames;
        width=o.prop===354?94:92;height=92;
        const vertical=this.bridgeVertical(o);
        ctx.save();ctx.translate(o.x,o.y);if(vertical)ctx.rotate(Math.PI/2);
        if(o.prop===354&&!o.active)ctx.globalAlpha=.35;
        sprites.frame(ctx,key,frame,0,0,width,height);
        ctx.restore();continue;
      }
      else if(o.kind==='door'){
        key=o.prop===357?'entrance_door':o.prop===358?'exit_door_boss':'exit_door';
        // Native door sheets are 96x192 frames (9/9/8 columns), not one wide
        // strip. Use the door openness to select the authored frame; the old
        // code drew the whole 864px strip as a 128x28 collage.
        const frameCount=o.prop===358?8:9;
        frame=Math.max(0,Math.min(frameCount-1,Math.round((o.openness??(o.open?1:0))*(frameCount-1))));
        width=96;height=192;
      }
      else if(o.kind==='cannon'){
        const sector=((Math.round((o.angle||0)/(Math.PI/4))+8)%8)+1;key=`cannon0${sector}`;width=138;height=130;frame=o.flash>0?Math.min(4,1+Math.floor((.2-o.flash)*15)):0;
      }
      else if(o.kind==='floor'){
        key=({33:'door_house',36:'trapdoor_house',37:'trapdoor_factory',38:'trapdoor_spooky',39:'trapdoor_manhole',267:'elevator',268:'elevator',320:'door_house'})[o.prop];
        if(!key)continue;const s=sprites.images[key];width=s?.fw||80;height=s?.fh||80;
        const frames=s?.image?Math.max(1,Math.floor(s.image.width/width)):1;
        frame=o.travelT?Math.min(frames-1,Math.floor(o.travelT*(frames-1))):0;
      }
      else if(o.kind==='furniture'){
        key=FURNITURE_SHEETS[o.prop];if(!key||!sprites.images[key])continue;width=height=128;
      }
      if(key){sprites.frame(ctx,key,frame,o.x,o.y,width,height);if(o.prop===354&&!o.active)ctx.globalAlpha=1;}
    }
    for(const tool of this.tools){const key=ITEM_ART[tool.kind];sprites.frame(ctx,key,Math.floor(game.time*5),tool.x,tool.y,tool.kind==='fish'?64:48,48);}
  }
  drawPlayer(game,ctx){
    const m=game.mouse,s=game.sprites;
    if(m.hidden)return;
    if(this.balloon){ctx.save();ctx.strokeStyle='#eed5a7';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(m.x,m.y-10);ctx.lineTo(m.x-12,m.y-65);ctx.stroke();ctx.restore();s.frame(ctx,'balloon',Math.floor(game.time/.4+1e-6)%4,m.x-12,m.y-80,48,64);}
    if(this.coverTime>0&&(this.coverTime>2||Math.floor(game.time*8)%2===0))s.frame(ctx,this.isBucket?'bucket':'teacup',0,m.x,m.y-5,64,64);
  }
}
