// Platforms use the same authored route modes and per-point waits as cats.
// Speed is expressed in web pixels/second; path geometry is never snapped to land.
export function advanceMover(object,dt,speed){
 const points=object.route||[];if(points.length<2||object.routeStopped)return;
 let budget=Math.max(0,dt),guard=0;
 object.routeIndex??=1;object.routeDirection??=1;object.routeWait??=Math.max(0,points[0].wait||0);
 while(budget>0&&guard++<points.length*4+8){
  if(object.routeWait>0){const time=Math.min(budget,object.routeWait);object.routeWait-=time;budget-=time;if(!budget)break;}
  const target=points[object.routeIndex],dx=target.x-object.x,dy=target.y-object.y,d=Math.hypot(dx,dy),time=d/speed;
  if(time>budget){object.x+=dx/d*speed*budget;object.y+=dy/d*speed*budget;break;}
  object.x=target.x;object.y=target.y;budget-=time;object.routeWait=Math.max(0,target.wait||0);
  let next=object.routeIndex+object.routeDirection;
  if(next<0||next>=points.length){
   if(object.routeMode==='pingpong'){object.routeDirection*=-1;next=object.routeIndex+object.routeDirection;}
   else if(object.routeMode==='loop')next=0;
   else{object.routeStopped=true;break;}
  }
  object.routeIndex=next;
 }
}
