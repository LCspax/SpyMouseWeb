// Native pipe assemblies require a flipflap exit (204..207). A plain pipe
// assembly is scenery. Zero is a valid tag, just as it is for mouse holes.
export function pipeGroups(pieces){
 const byTag=new Map();
 for(const piece of pieces){const tag=Math.abs(piece.tag||0);if(!byTag.has(tag))byTag.set(tag,[]);byTag.get(tag).push(piece);}
 return [...byTag].map(([tag,pieces])=>({tag,pieces,exits:pieces.filter(p=>p.prop>=204&&p.prop<=207)})).filter(g=>g.exits.length);
}
// Native 0x8f4b0: every same-Tag flipflap places the player at its own mouth
// when player+0x204 == obj.Tag. Touching a flipflap therefore emerges at that
// same flap (a short hop); touching a plain pipe piece uses the group's flap.
// Single-flap groups must work, so never require "another" exit.
export function pipeDestination(group,entry){
 const exits=group.exits||[];
 if(!exits.length)return null;
 if(!entry)return exits[0];
 const other=exits.find(p=>p.id!==entry.id);
 if(other)return other;
 // Entering the flap itself (or a single-flap group): emerge at the nearest
 // exit, i.e. itself.
 return exits.reduce((best,p)=>!best||Math.hypot(p.x-entry.x,p.y-entry.y)<Math.hypot(best.x-entry.x,best.y-entry.y)?p:best,null)||exits[0];
}
