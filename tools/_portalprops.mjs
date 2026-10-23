import fs from "fs";
const res="com.ea.spymouse_row/files/res";
const hits=[];
for(const d of fs.readdirSync(res)){ if(!d.startsWith("map")) continue; const f=`${res}/${d}/${d}.xml`; if(!fs.existsSync(f)) continue; const xml=fs.readFileSync(f,"utf8"); const props={}; for(const m of xml.matchAll(/<Line\s+([^>]*)\/>/g)){ const a={}; for(const x of m[1].matchAll(/(\w+)\s*=\s*(?:"([^"]*)"|([^\s/>]+))/g)) a[x[1]]=x[2]!==undefined?x[2]:x[3]; const p=+a.Property; if(p===115||p===123||p===141||(p>=20&&p<=23)||(p>=65&&p<=67)||p===1300){ props[p]=(props[p]||0)+1; } } if(Object.keys(props).length) hits.push({map:d,props}); }
hits.sort((a,b)=>Object.values(b.props).reduce((x,y)=>x+y,0)-Object.values(a.props).reduce((x,y)=>x+y,0));
for(const h of hits.slice(0,60)) console.log(h.map, JSON.stringify(h.props));