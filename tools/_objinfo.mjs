import fs from "fs";
const maps=["724","51","752","737","743"];
for(const map of maps){
  const file=`com.ea.spymouse_row/files/res/map${map}/map${map}.xml`; if(!fs.existsSync(file)) continue;
  const xml=fs.readFileSync(file,"utf8");
  const parse=(s)=>{const a={}; for(const m of s.matchAll(/(\w+)\s*=\s*(?:"([^"]*)"|([^\s/>]+))/g)) a[m[1]]=m[2]!==undefined?m[2]:m[3]; return a;};
  const verts=[]; for(const m of xml.matchAll(/<Vertex\s+([^>]*)\/>/g)) verts.push(parse(m[1]));
  const byId=Object.fromEntries(verts.map(v=>[v.id,v]));
  console.log(`\n=== map${map} ===`);
  console.log("-- interesting vertices --");
  for(const v of verts){ const p=+v.Property; if((p>=20&&p<=23)||(p>=65&&p<=67)||p===115||p===123||p===141||p===1300||(p>=200&&p<=225)||(p>=563&&p<=567)||p===431||p===572||p===601) console.log(`v id=${v.id} x=${v.x} y=${v.y} P=${v.Property} T=${v.Tag} F=${v.Flags}${v.Text?" Text="+v.Text:""}${v.MovingPlatformSpeed?" speed="+v.MovingPlatformSpeed:""}`); }
  console.log("-- interesting lines --");
  for(const m of xml.matchAll(/<Line\s+([^>]*)\/>/g)){ const a=parse(m[1]); const p=+a.Property; if((p>=20&&p<=23)||(p>=65&&p<=67)||p===115||p===123||p===141||p===1300){ const A=byId[a.VertexA],B=byId[a.VertexB]; console.log(`l id=${a.id} P=${a.Property} T=${a.Tag} A=${a.VertexA}(${A?.x},${A?.y}) B=${a.VertexB}(${B?.x},${B?.y})${a.Text?" Text="+a.Text:""}`); } }
}