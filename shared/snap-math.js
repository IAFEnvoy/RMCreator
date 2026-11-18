// Geometry and guide constraints are solved together; snapping never projects
// a point onto an object and then silently discards the drawing direction.
const EPS=1e-7;
export const snapDistance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const dot=(a,b)=>a.x*b.x+a.y*b.y;
export function guideThrough(a,b,extra={}) {
  const length=snapDistance(a,b);if(length<EPS)return null;
  const n={x:-(b.y-a.y)/length,y:(b.x-a.x)/length};
  return {...extra,n,value:dot(a,n),a,b};
}
export const onGuide=(p,line)=>Math.abs(dot(p,line.n)-line.value)<EPS;
export const projectGuide=(p,line)=>{const d=line.value-dot(p,line.n);return {x:p.x+line.n.x*d,y:p.y+line.n.y*d};};
export function intersectGuides(a,b) {
  const det=a.n.x*b.n.y-a.n.y*b.n.x;
  return Math.abs(det)<EPS?null:{x:(a.value*b.n.y-a.n.y*b.value)/det,y:(a.n.x*b.value-a.value*b.n.x)/det};
}
export function segmentPosition(segment,t) {
  const {a,b,control:c}=segment,u=1-t;
  return c?{x:u*u*a.x+2*u*t*c.x+t*t*b.x,y:u*u*a.y+2*u*t*c.y+t*t*b.y}:{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
}
export function closestOnSegment(segment,p) {
  const {a,b,control:c}=segment;
  if(!c){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return {...segmentPosition(segment,t),t};}
  let best;
  for(let i=0;i<=48;i++){const t=i/48,q=segmentPosition(segment,t),d=snapDistance(q,p);if(!best||d<best.distance)best={...q,t,distance:d};}
  let t=best.t;
  for(let i=0;i<8;i++){
    const q=segmentPosition(segment,t),v={x:2*((1-t)*(c.x-a.x)+t*(b.x-c.x)),y:2*((1-t)*(c.y-a.y)+t*(b.y-c.y))},w={x:2*(b.x-2*c.x+a.x),y:2*(b.y-2*c.y+a.y)},delta={x:q.x-p.x,y:q.y-p.y},den=dot(v,v)+dot(delta,w);
    if(Math.abs(den)<EPS)break;
    t=Math.max(0,Math.min(1,t-dot(delta,v)/den));
  }
  const q=segmentPosition(segment,t);return snapDistance(q,p)<=best.distance?{...q,t}:best;
}
export function segmentGuideHits(segment,line,p) {
  const {a,b,control:c}=segment,fa=dot(a,line.n)-line.value,fb=dot(b,line.n)-line.value;
  const A=c?fa-2*(dot(c,line.n)-line.value)+fb:0,B=c?2*(dot(c,line.n)-line.value-fa):fb-fa;
  let ts=[];
  if(Math.abs(A)<EPS){
    if(Math.abs(B)<EPS)return Math.abs(fa)<EPS?[closestOnSegment(segment,p)]:[];
    ts=[-fa/B];
  }else{
    const d=B*B-4*A*fa;if(d>=-EPS){const root=Math.sqrt(Math.max(0,d));ts=[(-B-root)/(2*A),(-B+root)/(2*A)];}
  }
  return ts.filter(t=>t>=-EPS&&t<=1+EPS).map(t=>{t=Math.max(0,Math.min(1,t));return {...segmentPosition(segment,t),t};});
}
export function snapGeometry(point,{points=[],segments=[],tolerance,constraint,segmentTolerance=tolerance}={}) {
  let best;
  for(const target of points){
    const d=snapDistance(point,target);if(d<=tolerance+EPS&&(!constraint||onGuide(target,constraint))&&(!best||d<best.distance))best={x:target.x,y:target.y,distance:d,target,type:'point'};
  }
  if(best)return best;
  for(const target of segments){
    const hits=constraint?segmentGuideHits(target,constraint,point):[closestOnSegment(target,point)];
    for(const q of hits){const d=snapDistance(q,point);if(d<=segmentTolerance+EPS&&(!best||d<best.distance))best={...q,distance:d,target,type:'segment'};}
  }
  return best||null;
}
export function snapWithGuides(point,{lines=[],tolerance=1,constraint,geometry}={}) {
  if(constraint){point=projectGuide(point,constraint);lines=[{...constraint,anchor:true,kind:'direction',a:constraint.a||point,b:constraint.b||point},...lines];}
  const candidates=[];
  for(const line of lines){
    const q=constraint?(intersectGuides(constraint,line)||(onGuide(point,line)?point:null)):projectGuide(point,line);
    if(q&&snapDistance(point,q)<=tolerance+EPS)candidates.push({line,point:q,distance:snapDistance(point,q)});
  }
  candidates.sort((a,b)=>Number(!!b.line.anchor)-Number(!!a.line.anchor)||a.distance-b.distance||Number(!!a.line.grid)-Number(!!b.line.grid)||(a.line.kind==='equal')-(b.line.kind==='equal'));
  const matching=q=>{
    const hits=[];
    for(const {line}of candidates)if(onGuide(q,line)&&!hits.some(hit=>Math.abs(hit.n.x*line.n.y-hit.n.y*line.n.x)<EPS)){
      hits.push(line);if(hits.length===2)break;
    }
    return hits;
  };
  const base=geometry?.(point,constraint);
  const direction=candidates.find(candidate=>candidate.line.anchor)?.line;
  const keepsDirection=p=>!direction||onGuide(p,direction);
  if(base?.snapType==='point'&&keepsDirection(base))return {point:base,lines:matching(base),geometry:base};
  if(geometry){
    const visited=new Set();
    for(const {line,point:q}of candidates){
      const key=[line.n.x.toFixed(5),line.n.y.toFixed(5),line.value.toFixed(5)].join(',');
      if(visited.has(key))continue;visited.add(key);if(visited.size>24)break;
      const contact=geometry(q,line);
      if(contact&&keepsDirection(contact)&&snapDistance(point,contact)<=tolerance*Math.SQRT2+EPS&&(!constraint||onGuide(contact,constraint)))return {point:contact,lines:matching(contact),geometry:contact};
    }
    if(base&&keepsDirection(base))return {point:base,lines:matching(base),geometry:base};
  }
  const first=candidates[0];if(!first)return {point,lines:[],geometry:null};
  let q=first.point,hits=[first.line];
  for(const {line}of candidates.slice(1)){
    const both=intersectGuides(first.line,line);
    if(both&&snapDistance(point,both)<=tolerance*Math.SQRT2+EPS&&(!constraint||onGuide(both,constraint))){q=both;hits.push(line);break;}
  }
  return {point:q,lines:hits,geometry:null};
}
