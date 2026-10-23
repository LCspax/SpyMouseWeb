// Map coordinates are the same 960×640 coordinates as the rendered world.
export const nodePoint=node=>({x:node.x*2,y:node.y*2});
export function snapMapPath(points,nodes,radius=55){
  const path=points.map(p=>({...p})),end=path.at(-1);
  if(!end)return {path,node:null};
  const node=nodes.reduce((best,n)=>{
    const p=nodePoint(n),distance=Math.hypot(p.x-end.x,p.y-end.y);
    return distance<=radius&&(!best||distance<best.distance)?{node:n,distance}:best;
  },null)?.node||null;
  if(node)path.push(nodePoint(node));
  return {path,node};
}
export function advanceMapWalk(walk,seconds,speed=185){
  let remaining=Math.max(0,seconds)*speed;
  while(walk.path.length){
    const target=walk.path[0],dx=target.x-walk.position.x,dy=target.y-walk.position.y,distance=Math.hypot(dx,dy);
    if(distance>0)walk.heading=Math.atan2(dy,dx);
    if(distance<=remaining){walk.position={...target};walk.path.shift();remaining-=distance;}
    else{walk.position.x+=dx/distance*remaining;walk.position.y+=dy/distance*remaining;break;}
  }
  return walk.path.length===0;
}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function roadSegments(routes){return (routes||[]).flatMap(route=>route.points.slice(1).map((p,i)=>({a:nodePoint(route.points[i]),b:nodePoint(p)}))).filter(s=>distance(s.a,s.b)>0);}
function project(point,segments){
  let best=null;
  segments.forEach((s,index)=>{
    const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,t=Math.max(0,Math.min(1,((point.x-s.a.x)*dx+(point.y-s.a.y)*dy)/(dx*dx+dy*dy)));
    const p={x:s.a.x+t*dx,y:s.a.y+t*dy},d=distance(point,p);
    if(!best||d<best.distance)best={point:p,distance:d,segment:index};
  });return best;
}
export function projectMapRoad(point,routes){return project(point,roadSegments(routes));}
// Both node activation and drawn routes use this graph. Never fall back to a
// straight shortcut when a branch is disconnected or the target is off-road.
export function mapRoadPath(position,target,routes){
  const segments=roadSegments(routes),from=project(position,segments),to=project(target,segments);
  if(!from||!to||from.distance>24||to.distance>24)return [];
  const points=[],edges=[];
  const vertex=point=>{const index=points.findIndex(q=>distance(q,point)<.001);if(index>=0)return index;points.push({...point});edges.push([]);return points.length-1;};
  const link=(i,j)=>{const d=distance(points[i],points[j]);edges[i].push([j,d]);edges[j].push([i,d]);};
  const links=segments.map(s=>{const a=vertex(s.a),b=vertex(s.b);link(a,b);return [a,b];});
  const attach=p=>{const i=vertex(p.point);for(const j of links[p.segment])if(j!==i)link(i,j);return i;};
  const start=attach(from),end=attach(to);
  if(from.segment===to.segment&&start!==end)link(start,end);
  const dist=points.map(()=>Infinity),previous=[],pending=new Set(points.map((_,i)=>i));dist[start]=0;
  while(pending.size){const i=[...pending].reduce((a,b)=>dist[a]<dist[b]?a:b);pending.delete(i);if(i===end||!Number.isFinite(dist[i]))break;for(const [j,d] of edges[i])if(dist[i]+d<dist[j]){dist[j]=dist[i]+d;previous[j]=i;}}
  if(!Number.isFinite(dist[end]))return [];
  const path=[];for(let i=end;i!==undefined;i=previous[i])path.unshift({...points[i]});
  if(distance(path.at(-1),target)>.001)path.push({...target});return path;
}
export function extendMapRoadPath(path,target,routes){
  const projected=projectMapRoad(target,routes);
  if(!path.length||!projected||projected.distance>28)return false;
  const extension=mapRoadPath(path.at(-1),projected.point,routes);
  if(!extension.length)return false;
  path.push(...extension.filter((p,i)=>i>0||distance(p,path.at(-1))>.001));return true;
}
