// World-space cubic contours. Handles are absolute positions, independent of the grid.
export const MAX_ZONE_VERTICES = 128;
export const point = (x, z) => ({x, z});
export const distance = (a, b) => Math.hypot(a.x-b.x, a.z-b.z);
const mix = (a,b,t) => point(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t);
export const corner = p => ({pos:{...p},type:'corner'});
export function segmentControls(path, i) {
  const a=path.vertices[i],b=path.vertices[(i+1)%path.vertices.length];
  return [a.pos,a.handleOut||a.pos,b.handleIn||b.pos,b.pos];
}
export function cubicAt(c,t) {
  const s=1-t;
  return point(s*s*s*c[0].x+3*s*s*t*c[1].x+3*s*t*t*c[2].x+t*t*t*c[3].x,
    s*s*s*c[0].z+3*s*s*t*c[1].z+3*s*t*t*c[2].z+t*t*t*c[3].z);
}
export function splitCubic(c,t) {
  const a=mix(c[0],c[1],t),b=mix(c[1],c[2],t),d=mix(c[2],c[3],t),e=mix(a,b,t),f=mix(b,d,t),p=mix(e,f,t);
  return [[c[0],a,e,p],[p,f,d,c[3]]];
}
function lineDistance(p,a,b) {
  const dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz;
  if(!l)return distance(p,a);
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/l));return distance(p,mix(a,b,t));
}
export function flattenPath(path,tolerance=.035) {
  if(!path?.vertices?.length)return [];
  const result=[{...path.vertices[0].pos}],count=path.closed?path.vertices.length:path.vertices.length-1;
  const flatten=(c,depth=0)=>{
    if(depth>=12||Math.max(lineDistance(c[1],c[0],c[3]),lineDistance(c[2],c[0],c[3]))<=tolerance){result.push({...c[3]});return;}
    const [a,b]=splitCubic(c,.5);flatten(a,depth+1);flatten(b,depth+1);
  };
  for(let i=0;i<count;i++)flatten(segmentControls(path,i));
  return result;
}
export function signedArea(ring) {
  let sum=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];sum+=a.x*b.z-b.x*a.z;}return sum/2;
}
export function inRing(p,ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }return inside;
}
export function closestOnPath(path,p) {
  let best=null;const count=path.closed?path.vertices.length:path.vertices.length-1;
  for(let i=0;i<count;i++){
    const c=segmentControls(path,i);let sample=0,d=Infinity;
    for(let j=0;j<=32;j++){const next=distance(cubicAt(c,j/32),p);if(next<d){sample=j/32;d=next;}}
    let lo=Math.max(0,sample-1/32),hi=Math.min(1,sample+1/32);
    for(let n=0;n<28;n++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(distance(cubicAt(c,a),p)<distance(cubicAt(c,b),p))hi=b;else lo=a;}
    const t=(lo+hi)/2,q=cubicAt(c,t),dist=distance(q,p);
    if(!best||dist<best.distance)best={point:q,t,segment:i,distance:dist};
  }return best;
}
export function insertZoneVertex(source,index,t=.5) {
  const path=structuredClone(source);if(path.vertices.length>=MAX_ZONE_VERTICES)return path;
  const a=path.vertices[index],b=path.vertices[(index+1)%path.vertices.length],straight=!a.handleOut&&!b.handleIn;
  if(straight){path.vertices.splice(index+1,0,corner(mix(a.pos,b.pos,t)));return path;}
  const [left,right]=splitCubic(segmentControls(path,index),t);
  a.handleOut=left[1];b.handleIn=right[2];
  // A subdivision shortens only this segment's handle; the opposite length stays independent.
  if(a.type==='corner')a.type='cusp';if(b.type==='corner')b.type='cusp';
  path.vertices.splice(index+1,0,{pos:left[3],type:'smooth',handleIn:left[2],handleOut:right[1]});return path;
}
export function moveZoneVertices(source,indices,delta) {
  const path=structuredClone(source);for(const i of indices){const v=path.vertices[i];if(!v)continue;for(const key of ['pos','handleIn','handleOut'])if(v[key])v[key]=point(v[key].x+delta.x,v[key].z+delta.z);}return path;
}
export function moveZoneHandle(source,index,side,target,breakLink=false) {
  const path=structuredClone(source),v=path.vertices[index],other=side==='handleIn'?'handleOut':'handleIn';
  if(breakLink)v.type='cusp';if(v.type==='corner')v.type='smooth';
  const otherLength=v[other]?distance(v.pos,v[other]):distance(v.pos,target),length=distance(v.pos,target);v[side]={...target};
  if(v.type==='smooth'&&length>1e-8)v[other]=point(v.pos.x-(target.x-v.pos.x)*otherLength/length,v.pos.z-(target.z-v.pos.z)*otherLength/length);
  return path;
}
export function convertZoneVertices(source,indices,type) {
  const path=structuredClone(source),n=path.vertices.length;
  for(const i of indices){const v=path.vertices[i];if(!v)continue;
    if(type==='corner'){delete v.handleIn;delete v.handleOut;v.type=type;continue;}
    const prev=path.vertices[(i+n-1)%n].pos,next=path.vertices[(i+1)%n].pos;
    let dx=next.x-prev.x,dz=next.z-prev.z,l=Math.hypot(dx,dz)||1;
    if(v.handleOut&&distance(v.pos,v.handleOut)>.001){dx=v.handleOut.x-v.pos.x;dz=v.handleOut.z-v.pos.z;l=Math.hypot(dx,dz);}
    const li=v.handleIn?distance(v.pos,v.handleIn):distance(v.pos,prev)/3,lo=v.handleOut?distance(v.pos,v.handleOut):distance(v.pos,next)/3;
    if(type==='smooth'||!v.handleIn)v.handleIn=point(v.pos.x-dx/l*li,v.pos.z-dz/l*li);
    if(type==='smooth'||!v.handleOut)v.handleOut=point(v.pos.x+dx/l*lo,v.pos.z+dz/l*lo);v.type=type;
  }return path;
}
// Fit the two adjacent segments with one cubic. Endpoint tangent directions are retained.
export function removeZoneVertex(source,index) {
  const path=structuredClone(source),n=path.vertices.length;if(n<=(path.closed?3:2))return path;
  if(!path.closed&&(index===0||index===n-1)){path.vertices.splice(index,1);return path;}
  const prev=(index+n-1)%n,next=(index+1)%n,a=path.vertices[prev],v=path.vertices[index],b=path.vertices[next];
  if(a.handleOut||v.handleIn||v.handleOut||b.handleIn){
    const samples=[];for(let j=0;j<=32;j++)samples.push(cubicAt(segmentControls(path,prev),j/32));for(let j=1;j<=32;j++)samples.push(cubicAt(segmentControls(path,index),j/32));
    const lengths=[0];for(let j=1;j<samples.length;j++)lengths.push(lengths[j-1]+distance(samples[j-1],samples[j]));const total=lengths.at(-1)||1;
    const unit=(p,q)=>{const d=distance(p,q)||1;return point((q.x-p.x)/d,(q.z-p.z)/d);};
    const u=unit(a.pos,a.handleOut&&distance(a.pos,a.handleOut)>.001?a.handleOut:(v.handleIn||v.pos));
    const w=unit(b.pos,b.handleIn&&distance(b.pos,b.handleIn)>.001?b.handleIn:(v.handleOut||v.pos));
    let parameters=lengths.map(l=>l/total);
    // Refine parameterization against the fitted curve instead of locking chord-length t.
    // This also reverses an earlier subdivision with negligible visual drift.
    for(let iteration=0;iteration<14;iteration++){
      let aa=0,ab=0,bb=0,ar=0,br=0;
      samples.forEach((p,j)=>{const t=parameters[j],s=1-t,k=3*s*s*t,l=3*s*t*t,base=point((s*s*s+k)*a.pos.x+(t*t*t+l)*b.pos.x,(s*s*s+k)*a.pos.z+(t*t*t+l)*b.pos.z),r=point(p.x-base.x,p.z-base.z);aa+=k*k;bb+=l*l;ab+=k*l*(u.x*w.x+u.z*w.z);ar+=k*(u.x*r.x+u.z*r.z);br+=l*(w.x*r.x+w.z*r.z);});
      const det=aa*bb-ab*ab;let h1=total/3,h2=total/3;if(Math.abs(det)>1e-9){h1=(ar*bb-br*ab)/det;h2=(br*aa-ar*ab)/det;}
      h1=Math.max(.001,Math.min(total,h1));h2=Math.max(.001,Math.min(total,h2));a.handleOut=point(a.pos.x+u.x*h1,a.pos.z+u.z*h1);b.handleIn=point(b.pos.x+w.x*h2,b.pos.z+w.z*h2);
      const c=[a.pos,a.handleOut,b.handleIn,b.pos];parameters=parameters.map((t,j)=>{if(j===0||j===samples.length-1)return t;let lo=Math.max(parameters[j-1],t-.12),hi=Math.min(parameters[j+1],t+.12);for(let k=0;k<22;k++){const x=lo+(hi-lo)/3,y=hi-(hi-lo)/3;if(distance(cubicAt(c,x),samples[j])<distance(cubicAt(c,y),samples[j]))hi=y;else lo=x;}return (lo+hi)/2;});
    }
    if(a.type==='corner')a.type='cusp';if(b.type==='corner')b.type='cusp';
  }
  path.vertices.splice(index,1);return path;
}
export function constrainPoint(anchor,p) {
  const r=distance(anchor,p),a=Math.round(Math.atan2(p.z-anchor.z,p.x-anchor.x)/(Math.PI/4))*Math.PI/4;return point(anchor.x+Math.cos(a)*r,anchor.z+Math.sin(a)*r);
}
export function zonePathError(path,{draft=false}={}) {
  if(!path||!Array.isArray(path.vertices)||typeof path.closed!=='boolean'||path.vertices.length>MAX_ZONE_VERTICES+(path.closed?0:1))return '区域顶点数据无效';
  const valid=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.z)&&Math.abs(p.x)<=500&&Math.abs(p.z)<=500;
  for(const v of path.vertices){
    if(!v||!['corner','smooth','cusp'].includes(v.type)||!valid(v.pos)||['handleIn','handleOut'].some(k=>v[k]!==undefined&&!valid(v[k])))return '顶点或手柄超出 ±500 m 范围';
    if(v.type==='corner'&&(v.handleIn||v.handleOut))return '角点不能带控制柄';
    if(v.type==='smooth'&&v.handleIn&&v.handleOut){const a=point(v.handleIn.x-v.pos.x,v.handleIn.z-v.pos.z),b=point(v.handleOut.x-v.pos.x,v.handleOut.z-v.pos.z);if(Math.abs(a.x*b.z-a.z*b.x)>1e-5*(1+Math.hypot(a.x,a.z)*Math.hypot(b.x,b.z))||a.x*b.x+a.z*b.z>1e-6)return '平滑点手柄需反向共线';}
  }
  if(draft)return '';
  if(path.vertices.length<(path.closed?3:2))return path.closed?'闭合区域至少需要 3 个顶点':'开放轮廓至少需要 2 个顶点';
  const count=path.closed?path.vertices.length:path.vertices.length-1;for(let i=0;i<count;i++)if(distance(path.vertices[i].pos,path.vertices[(i+1)%path.vertices.length].pos)<.02)return '相邻顶点过近';
  if(path.closed&&Math.abs(signedArea(flattenPath(path)))<.1)return '区域面积过小，请调整轮廓';
  if(path.holes!==undefined&&(!Array.isArray(path.holes)||path.holes.length>100||path.holes.some(vertices=>zonePathError({vertices,closed:true}))))return '孔洞轮廓无效';
  return '';
}
