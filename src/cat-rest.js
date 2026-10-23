// Rest is a presentation of an authored patrol pause, not a new AI timer.
// Keep detection, route direction and the original pause duration unchanged.
export const CAT_REST_PROFILES={
  0:{prefix:'browncat',breathing:[3,4,5,6]},
  2:{prefix:'blackcat',breathing:[5,6,7,8]},
  6:{prefix:'ninjacat',breathing:[5,6,7,8]},
  7:{prefix:'lavacat',cell:68,breathing:[5,6,7,8]},
};
export function updateCatRest(cat,dt){
  if(!CAT_REST_PROFILES[cat.type]||cat.moving){cat.rest=null;return;}
  const remaining=cat.state==='patrol'?Math.max(0,cat.waypointTimer||0,cat.endpointTimer||0):0;
  if(remaining>0&&(remaining>=2||cat.rest?.pause)){
    if(!cat.rest?.pause)cat.rest={pause:true,elapsed:0,phase:'sleep'};
    cat.rest.elapsed+=dt;
    cat.rest.phase=remaining<=.6?'wake':'sleep';
    cat.rest.frameTime=cat.rest.phase==='wake'?Math.max(0,.6-remaining):cat.rest.elapsed;
  }else if(cat.rest&&cat.state==='spot'){
    if(cat.rest.phase!=='wake'||cat.rest.pause)cat.rest={pause:false,elapsed:0,phase:'wake'};
    cat.rest.elapsed+=dt;cat.rest.frameTime=cat.rest.elapsed;
    if(cat.rest.elapsed>=.6)cat.rest=null;
  }else cat.rest=null;
}
export function catRestFrameIndex(profile,phase,time){
  if(phase==='wake')return Math.max(0,2-Math.floor((time+1e-9)/.2));
  if(time<.8)return Math.min(3,Math.floor((time+1e-9)/.2));
  return profile.breathing[Math.floor((time-.8+1e-9)/.2)%profile.breathing.length];
}
