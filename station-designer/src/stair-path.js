import polygonClipping from 'polygon-clipping';
import { worldPoint, localPoint } from './track-path.js';

export const MAX_STAIR_POINTS = 24;
const distance=(a,b)=>Math.hypot(b.x-a.x,b.z-a.z);
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
export const stairNodes=e=>e.stairPath||[{x:-e.l/2,z:0},{x:e.l/2,z:0}];
export const stairWorldNodes=e=>stairNodes(e).map(p=>({...worldPoint(e,p),...(p.landing?{landing:true}:{})}));
export function reverseStairPath(nodes) {
  return nodes.map((p,i)=>{const next={...p};delete next.landing;if(i>0&&nodes[i-1].landing)next.landing=true;return next;}).reverse();
}

// Each bend has a level landing. Marking a segment as a landing makes an entire
// connecting passage level too, which permits a two-flight return stair.
export function stairRoute(e,height=e.h) {
  const points=stairNodes(e),depth=e.landingDepth??Math.max(2,e.d),lengths=points.slice(1).map((p,i)=>distance(points[i],p));
  const length=lengths.reduce((a,b)=>a+b,0),segments=[];let cursor=0;
  for(let i=0;i<lengths.length;i++) {
    const a=points[i],b=points[i+1],l=lengths[i],start=i?depth/2:0,end=i<lengths.length-1?depth/2:0;
    const run=l-start-end,flat=a.landing===true;
    segments.push({index:i,a:mix(a,b,start/l),b:mix(a,b,1-end/l),run,flat,from:(cursor+start)/length,to:(cursor+l-end)/length,angle:Math.atan2(b.z-a.z,b.x-a.x)*180/Math.PI});
    cursor+=l;
  }
  const riseRun=segments.reduce((sum,s)=>sum+(s.flat?0:s.run),0);let y=0;
  for(const s of segments){s.yFrom=y;if(!s.flat)y+=height*s.run/riseRun;s.yTo=y;}
  const landings=points.slice(1,-1).map((point,i)=>({point,y:segments[i].yTo,t:lengths.slice(0,i+1).reduce((a,b)=>a+b,0)/length,angle:segments[i].angle,depth}));
  return {points,segments,landings,length,riseRun,depth,height};
}

export function stairRoutePoint(e,t,height=e.h) {
  const route=stairRoute(e,height),at=Math.max(0,Math.min(1,t));
  for(const s of route.segments){
    if(at>=s.from&&at<=s.to){const f=(at-s.from)/(s.to-s.from);return {...mix(s.a,s.b,f),y:s.yFrom+(s.yTo-s.yFrom)*f};}
  }
  for(let i=0;i<route.landings.length;i++){
    const a=route.segments[i],b=route.segments[i+1],p=route.landings[i];
    if(at>=a.to&&at<=b.from){const node=at<=p.t?mix(a.b,p.point,(at-a.to)/(p.t-a.to)):mix(p.point,b.a,(at-p.t)/(b.from-p.t));return {...node,y:p.y};}
  }
  return {...route.points.at(-1),y:height};
}

export function stairPathError(e,{slope=false,height=e.h}={}) {
  if(e.stairPath===undefined)return '';
  if(e.type!=='stairs'||!Array.isArray(e.stairPath)||e.stairPath.length<2||e.stairPath.length>MAX_STAIR_POINTS)return '楼梯路径需为 2–24 个点';
  if(e.stairPath.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.z)||Math.abs(p.x)>500||Math.abs(p.z)>500||(p.landing!==undefined&&typeof p.landing!=='boolean')))return '楼梯路径坐标无效';
  if(stairWorldNodes(e).some(p=>Math.abs(p.x)>500||Math.abs(p.z)>500))return '楼梯路径需在 ±500 m 内';
  if(e.landingDepth!==undefined&&(!Number.isFinite(e.landingDepth)||e.landingDepth<1||e.landingDepth>20))return '休息平台深度需为 1–20 m';
  if(e.stairPath.slice(1).some((p,i)=>distance(e.stairPath[i],p)<.1))return '相邻楼梯路径点过近';
  const route=stairRoute(e,height);
  if(route.length>500)return '楼梯路径总长不能超过 500 m';
  if(route.segments.some(s=>s.run<.4))return '转折点过近，放不下休息平台';
  if(route.riseRun<.5)return '楼梯至少需要一段梯段';
  if(slope&&height>route.riseRun+1e-6)return `梯段长度不足：扣除平台后至少需要 ${Number(height.toFixed(2))} m（坡度不超过 45°）`;
  return '';
}

export function makeStairPath(source,worldPoints) {
  const x=(Math.min(...worldPoints.map(p=>p.x))+Math.max(...worldPoints.map(p=>p.x)))/2;
  const z=(Math.min(...worldPoints.map(p=>p.z))+Math.max(...worldPoints.map(p=>p.z)))/2;
  const e={...source,x,z};e.stairPath=worldPoints.map(p=>({...localPoint(e,p),...(p.landing?{landing:true}:{})}));
  e.l=worldPoints.slice(1).reduce((sum,p,i)=>sum+distance(worldPoints[i],p),0);return e;
}

export function stairPreset(source,shape='turn') {
  const [a,b]=[stairNodes(source)[0],stairNodes(source).at(-1)],l=distance(a,b),ux=(b.x-a.x)/l,uz=(b.z-a.z)/l;
  const run=Math.max(source.h/2+source.d,source.d*2,8),offset=p=>({x:p.x-uz*run,z:p.z+ux*run});
  const middle=mix(a,b,.5);
  const nodes=shape==='return'?[a,{...offset(a),landing:true},offset(b),b]:[a,{x:middle.x-uz*l/2,z:middle.z+ux*l/2},b];
  return makeStairPath(source,nodes.map(p=>({...worldPoint(source,p),...(p.landing?{landing:true}:{})})));
}

export function moveStairPoint(source,index,patch) {
  const points=stairWorldNodes(source);if(!points[index])return source;
  points[index]={...points[index],...patch};return makeStairPath(source,points);
}
export function insertStairPoint(source,index) {
  const points=stairWorldNodes(source);if(index<0||index>=points.length-1||points.length>=MAX_STAIR_POINTS)return source;
  const a=points[index],b=points[index+1];points.splice(index+1,0,{...mix(a,b,.5),...(a.landing?{landing:true}:{})});return makeStairPath(source,points);
}
export function removeStairPoint(source,index) {
  const points=stairWorldNodes(source);if(index<=0||index>=points.length-1)return source;
  points.splice(index,1);return makeStairPath(source,points);
}

function rectangle(a,b,width) {
  const l=distance(a,b),nx=-(b.z-a.z)/l*width/2,nz=(b.x-a.x)/l*width/2;
  return [[[[a.x+nx,a.z+nz],[b.x+nx,b.z+nz],[b.x-nx,b.z-nz],[a.x-nx,a.z-nz],[a.x+nx,a.z+nz]]]];
}
export function stairFootprint(e,padding=0) {
  const nodes=stairWorldNodes(e),width=Math.max(.2,e.d+2*padding),parts=[];
  for(let i=0;i<nodes.length-1;i++)parts.push(rectangle(nodes[i],nodes[i+1],width));
  const depth=Math.max(.2,(e.landingDepth??Math.max(2,e.d))+2*padding);
  for(let i=1;i<nodes.length-1;i++){
    const a=nodes[i-1],p=nodes[i],l=distance(a,p),u={x:(p.x-a.x)/l,z:(p.z-a.z)/l};
    parts.push(rectangle({x:p.x-u.x*depth/2,z:p.z-u.z*depth/2},{x:p.x+u.x*depth/2,z:p.z+u.z*depth/2},width));
    const b=nodes[i+1],m=distance(p,b),v={x:(b.x-p.x)/m,z:(b.z-p.z)/m};
    parts.push(rectangle({x:p.x-v.x*depth/2,z:p.z-v.z*depth/2},{x:p.x+v.x*depth/2,z:p.z+v.z*depth/2},width));
  }
  return polygonClipping.union(...parts);
}
