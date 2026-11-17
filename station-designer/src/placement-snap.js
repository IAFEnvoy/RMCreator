import { trackGeometry, worldPoint } from './track-path.js';
import { zoneMasks } from './zone-geometry.js';
import { flattenPath } from './zone-path.js';

const rad=Math.PI/180, eps=1e-7;
const dot=(a,b)=>a.x*b.x+a.z*b.z;
const add=(a,b,s=1)=>({x:a.x+b.x*s,z:a.z+b.z*s});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const axis=angle=>({x:Math.cos(angle),z:Math.sin(angle)});
const perpendicular=n=>({x:-n.z,z:n.x});
const angleKey=angle=>(((angle%Math.PI+Math.PI)%Math.PI)%(Math.PI/2)).toFixed(5);

export function placementOutline(object) {
  if(object.vertices)return flattenPath(object);
  if(object.type==='track'&&object.path)return trackGeometry(object).samples.flatMap(p=>[-1,1].map(sign=>worldPoint(object,{x:p.x-p.tz*object.d/2*sign,z:p.z+p.tx*object.d/2*sign})));
  return [-1,1].flatMap(x=>[-1,1].map(z=>worldPoint(object,{x:x*object.l/2,z:z*object.d/2})));
}

function bounds(points,n) {
  const t=perpendicular(n),xs=points.map(p=>dot(p,n)),zs=points.map(p=>dot(p,t));
  return {min:Math.min(...xs),max:Math.max(...xs),lo:Math.min(...zs),hi:Math.max(...zs)};
}

function dominantAngle(points) {
  let longest=0,angle=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],length=distance(a,b);
    if(length>longest){longest=length;angle=Math.atan2(b.z-a.z,b.x-a.x);}
  }
  return angle;
}

// Build once per draft/floor. Erased areas, curve handles and hidden objects
// are excluded; effective polygons also support legacy cell-painted plans.
export function placementReferences(project,{floors,excludeId}={}) {
  const floorIds=new Set(floors||project.floors.map(f=>f.id)),references=[];
  for(const object of project.entities||[]){
    if(object.id===excludeId||object.visible===false||object.type==='train'||object.type==='text'||!floorIds.has(object.floor)&&!floorIds.has(object.toFloor))continue;
    references.push({id:object.id,points:placementOutline(object),angle:(object.rotation||0)*rad,dimensions:!object.path});
  }
  const source=excludeId?{...project,zonePaths:(project.zonePaths||[]).filter(p=>p.id!==excludeId)}:project;
  for(const floor of floorIds){
    const masks=zoneMasks(source,floor);
    for(const [kind,polygons]of Object.entries(masks))for(const [i,polygon]of polygons.entries()){
      const points=polygon[0].map(([x,z])=>({x,z}));
      references.push({id:`area:${floor}:${kind}:${i}`,points,angle:dominantAngle(points),dimensions:true});
    }
  }
  return references;
}

function referenceLines(references,anchor,vertices=[]) {
  const lines=[],frames=new Map([['0.00000',0]]);
  for(const ref of references){
    if(!ref.points.length)continue;
    const angles=Math.abs(Math.sin(ref.angle*2))<eps?[0]:[0,ref.angle];
    frames.set(angleKey(ref.angle),ref.angle);
    for(const angle of angles)for(const n of [axis(angle),axis(angle+Math.PI/2)]){
      const b=bounds(ref.points,n),t=perpendicular(n);
      for(const [value,kind]of [[b.min,'edge'],[(b.min+b.max)/2,'center'],[b.max,'edge']]){
        lines.push({n,value,kind,referenceId:ref.id,a:add({x:n.x*value,z:n.z*value},t,b.lo),b:add({x:n.x*value,z:n.z*value},t,b.hi)});
      }
      // Match widths/lengths even when two platforms don't share an edge.
      if(anchor&&ref.dimensions&&(angle===ref.angle||angles.length===1)){
        const length=b.max-b.min;
        if(length>.2)for(const sign of [-1,1]){
          const value=dot(anchor,n)+sign*length,reference=[add({x:n.x*b.min,z:n.z*b.min},t,(b.lo+b.hi)/2),add({x:n.x*b.max,z:n.z*b.max},t,(b.lo+b.hi)/2)];
          lines.push({n,value,kind:'equal',referenceId:ref.id,a:add(anchor,n,sign*length),b:add(anchor,n,sign*length),measure:{a:anchor,length,reference}});
        }
      }
    }
  }
  for(const p of [...vertices,...(anchor?[anchor]:[])])for(const angle of frames.values())for(const n of [axis(angle),axis(angle+Math.PI/2)]){
    lines.push({n,value:dot(p,n),kind:'vertex',a:p,b:p});
  }
  return lines;
}

function intersect(a,b) {
  const det=a.n.x*b.n.z-a.n.z*b.n.x;
  return Math.abs(det)<1e-5?null:{x:(a.value*b.n.z-a.n.z*b.value)/det,z:(a.n.x*b.value-a.value*b.n.x)/det};
}

export function snapPlacementPoint(project,floor,point,{references,tolerance=1,excludeId,disabled=false,anchor,vertices=[],constraint,moving}={}) {
  const free={point:{...point},snapped:false,guides:[]};
  if(disabled||!project.snapping)return free;
  const refs=references||placementReferences(project,{floors:[floor],excludeId});
  const lines=referenceLines(refs,anchor,vertices),candidates=[];
  for(const line of lines){
    let offsets=[0];
    if(moving){
      const b=bounds(placementOutline(moving),line.n),center=dot(moving,line.n);
      offsets=[0,b.min-center,b.max-center];
    }
    for(const offset of offsets){
      const candidate={...line,value:line.value-offset,offset};
      const q=constraint?(intersect(constraint,candidate)||(Math.abs(dot(point,line.n)-candidate.value)<eps?point:null)):add(point,line.n,candidate.value-dot(point,line.n));
      if(!q||distance(q,point)>tolerance+eps)continue;
      candidates.push({line:candidate,point:q,distance:distance(q,point)});
    }
  }
  candidates.sort((a,b)=>a.distance-b.distance||(a.line.kind==='equal'?1:0)-(b.line.kind==='equal'?1:0));
  const first=candidates[0];if(!first)return free;
  let q=first.point,hits=[first.line];
  for(const candidate of candidates.slice(1)){
    const second=candidate.line;
    if(Math.abs(dot(first.line.n,second.n))>.01)continue;
    const both=intersect(first.line,second);
    if(both&&distance(both,point)<=tolerance*(constraint?1:Math.SQRT2)+eps&&(!constraint||Math.abs(dot(both,constraint.n)-constraint.value)<eps)){q=both;hits.push(second);break;}
  }
  if(Math.abs(q.x)>500||Math.abs(q.z)>500)return free;
  const guides=hits.map(({offset=0,...line})=>{
    const contact=add(q,line.n,offset);
    const t=perpendicular(line.n),coordinates=[dot(line.a,t),dot(line.b,t),dot(contact,t)];
    const origin={x:line.n.x*(line.value+offset),z:line.n.z*(line.value+offset)};
    return {...line,value:line.value+offset,a:add(origin,t,Math.min(...coordinates)-2),b:add(origin,t,Math.max(...coordinates)+2),contact,...(line.measure?{measure:{...line.measure,b:contact}}:{})};
  });
  return {point:{x:q.x,z:q.z,aligned:true},snapped:true,guides};
}

export function alignmentMessage(guides) {
  const equal=guides.find(g=>g.measure);
  if(equal)return `等宽 / 等长 ${Number(equal.measure.length.toFixed(2))} m · Alt 暂停吸附`;
  return guides.length?`${guides.some(g=>g.kind==='center')?'中线':'对齐'}吸附 · Alt 暂停吸附`:'';
}
