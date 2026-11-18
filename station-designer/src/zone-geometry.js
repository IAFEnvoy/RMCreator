import polygonClipping from 'polygon-clipping';
import { flattenPath, corner, inRing, point, distance } from './zone-path.js';
import { stairFootprint } from './stair-path.js';
import { snapGeometry } from '../../shared/snap-math.js';

const kinds=['paid','unpaid','staff'],cache=new Map();
export function pathPolygon(path) {
  if(!path.closed||path.vertices.length<3)return [];
  const rings=[flattenPath(path),...(path.holes||[]).map(vertices=>flattenPath({vertices,closed:true}))];
  return [rings.map(r=>r.map(p=>[p.x,p.z]))];
}
export function cellsPolygons(cells,kind) {
  // Union horizontal runs rather than thousands of individual cells.
  const rows=new Map();for(const [key,value]of Object.entries(cells)){if(value!==kind)continue;const [x,z]=key.split(',').map(Number);if(!rows.has(z))rows.set(z,[]);rows.get(z).push(x);}
  const rects=[];for(const [z,xs]of rows){xs.sort((a,b)=>a-b);let start=xs[0],end=start;const add=()=>rects.push([[[start*2,z*2],[(end+1)*2,z*2],[(end+1)*2,(z+1)*2],[start*2,(z+1)*2],[start*2,z*2]]]);for(const x of xs.slice(1)){if(x===end+1)end=x;else{add();start=end=x;}}add();}
  if(!rects.length)return [];return polygonClipping.union(...rects);
}
export function zoneMasks(project,floor) {
  const cells=project.zones[floor]||{},paths=(project.zonePaths||[]).filter(p=>p.floor===floor),key=JSON.stringify([cells,paths]);
  if(cache.has(key))return cache.get(key);
  const masks=Object.fromEntries(kinds.map(k=>[k,cellsPolygons(cells,k)]));
  for(const path of paths){
    if(path.kind==='opening')continue;
    if(!path.closed)continue;const polygon=pathPolygon(path);if(!polygon.length)continue;
    for(const kind of kinds){if(kind===path.kind)masks[kind]=masks[kind].length?polygonClipping.union(masks[kind],polygon):polygonClipping.union(polygon);else if(masks[kind].length)masks[kind]=polygonClipping.difference(masks[kind],polygon);}
  }
  // Structural openings cut every fill on this floor, including later paint.
  const openings=paths.filter(p=>p.kind==='opening'&&p.closed).map(pathPolygon).filter(p=>p.length);
  if(openings.length){const holes=polygonClipping.union(...openings);for(const kind of kinds)if(masks[kind].length)masks[kind]=polygonClipping.difference(masks[kind],holes);}
  cache.set(key,masks);if(cache.size>16)cache.delete(cache.keys().next().value);return masks;
}
export function polygonContains(multi,p) {
  return multi.some(poly=>inRing(p,poly[0].map(([x,z])=>point(x,z)))&&!poly.slice(1).some(r=>inRing(p,r.map(([x,z])=>point(x,z)))));
}
export function polygonArea(multi) {
  const area=ring=>Math.abs(ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2);
  return multi.reduce((sum,poly)=>sum+area(poly[0])-poly.slice(1).reduce((a,r)=>a+area(r),0),0);
}
export function polygonEdges(multi) {
  const edges=[];for(const poly of multi)for(const ring of poly)for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1];if(Math.hypot(b[0]-a[0],b[1]-a[1])>.00001)edges.push({x1:a[0],z1:a[1],x2:b[0],z2:b[1]});}return edges;
}
export function vectorPaidEdges(project,floor) {
  const masks=zoneMasks(project,floor),edges=polygonEdges(masks.paid),others=[...polygonEdges(masks.unpaid),...polygonEdges(masks.staff)],result=[];
  for(const edge of edges){
    const dx=edge.x2-edge.x1,dz=edge.z2-edge.z1,l=Math.hypot(dx,dz),cuts=[0,1];
    // Overlay polygons may leave a shared side subdivided at a neighbor's vertex.
    for(const e of others)for(const p of [point(e.x1,e.z1),point(e.x2,e.z2)]){const t=((p.x-edge.x1)*dx+(p.z-edge.z1)*dz)/(l*l);if(t>1e-6&&t<1-1e-6&&Math.abs((p.x-edge.x1)*dz-(p.z-edge.z1)*dx)/l<.001)cuts.push(t);}
    cuts.sort((a,b)=>a-b);for(let i=1;i<cuts.length;i++){
      const a=cuts[i-1],b=cuts[i];if((b-a)*l<.0001)continue;
      const mid=point(edge.x1+dx*(a+b)/2,edge.z1+dz*(a+b)/2);let nx=dz/l,nz=-dx/l;
      if(polygonContains(masks.paid,point(mid.x+nx*.005,mid.z+nz*.005))){nx=-nx;nz=-nz;}
      const outside=point(mid.x+nx*.01,mid.z+nz*.01),neighbor=kinds.find(k=>k!=='paid'&&polygonContains(masks[k],outside));
      result.push({x1:edge.x1+dx*a,z1:edge.z1+dz*a,x2:edge.x1+dx*b,z2:edge.z1+dz*b,nx,nz,neighbor});
    }
  }return result;
}
export function rectPolygon(e,padding=0) {
  const a=(e.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),l=e.l/2+padding,d=e.d/2+padding;
  const ring=[[-l,-d],[l,-d],[l,d],[-l,d],[-l,-d]].map(([x,z])=>[e.x+x*c-z*s,e.z+x*s+z*c]);return [[ring]];
}
export function cutOpenings(multi,openings) {
  if(!multi.length||!openings.length)return multi;return polygonClipping.difference(multi,...openings.map(e=>e.stairPath?stairFootprint(e,-.4):rectPolygon(e,-.4)));
}
export function vectorizeCells(project,floor) {
  if(!Object.keys(project.zones[floor]||{}).length)return;
  const paths=[];let seq=0;for(const kind of kinds)for(const poly of cellsPolygons(project.zones[floor],kind)){
    const vertices=ring=>ring.slice(0,-1).map(([x,z])=>corner(point(x,z)));
    // Retain complicated imported contours without changing their original cell data.
    if(poly.some(r=>r.length>129))return false;
    paths.push({id:`zone-legacy-${floor.slice(0,30)}-${Date.now()}-${seq++}`,floor,kind,closed:true,vertices:vertices(poly[0]),...(poly.length>1?{holes:poly.slice(1).map(vertices)}:{})});
  }
  if(paths.length+(project.zonePaths?.length||0)>600)return false;
  project.zonePaths=[...paths,...(project.zonePaths||[])];project.zones[floor]={};return true;
}
export function nearestOnEdge(p,e) {
  const dx=e.x2-e.x1,dz=e.z2-e.z1,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((p.x-e.x1)*dx+(p.z-e.z1)*dz)/l)):0;
  const q=point(e.x1+dx*t,e.z1+dz*t);return {...q,distance:distance(p,q)};
}
export function snapZonePoint(project,floor,p,{tolerance=1,vertices=[],excludeId,anchor,constrain=false,constraint,geometryOnly=false,edges:extraEdges=[],cache={}}={}) {
  if(!project.snapping)return {...p};
  if(!constraint&&constrain&&anchor&&distance(anchor,p)>1e-7){const dx=p.x-anchor.x,dz=p.z-anchor.z,l=Math.hypot(dx,dz);constraint={n:{x:-dz/l,z:dx/l},value:(-dz*anchor.x+dx*anchor.z)/l};}
  const compatible=q=>!constrain||!anchor||Math.abs((q.x-anchor.x)*(p.z-anchor.z)-(q.z-anchor.z)*(p.x-anchor.x))<.001*Math.max(1,distance(anchor,p));
  if(!cache.targets){
    const paths=(project.zonePaths||[]).filter(path=>path.floor===floor&&path.id!==excludeId);
    const candidates=[...vertices,...paths.flatMap(path=>[...path.vertices,...(path.holes||[]).flat()].map(v=>v.pos))];
    const masks=zoneMasks(excludeId?{...project,zonePaths:(project.zonePaths||[]).filter(path=>path.id!==excludeId)}:project,floor),edges=[...kinds.flatMap(k=>polygonEdges(masks[k])),...extraEdges];
    cache.targets={points:candidates.map(q=>({x:q.x,y:q.z})),segments:edges.map(e=>({a:{x:e.x1,y:e.z1},b:{x:e.x2,y:e.z2}}))};
  }
  const hit=snapGeometry({x:p.x,y:p.z},{...cache.targets,tolerance,segmentTolerance:tolerance*.8,constraint:constraint?{n:{x:constraint.n.x,y:constraint.n.z},value:constraint.value}:undefined});
  if(hit)return {x:hit.x,z:hit.y,distance:hit.distance,snapped:hit.type==='point'?'顶点':'边界',snapType:hit.type};
  if(geometryOnly)return {...p};
  let best;
  const grid=point(Math.round(p.x/2)*2,Math.round(p.z/2)*2),d=distance(p,grid);if(!best&&d<=tolerance&&compatible(grid))best={...grid,distance:d,snapped:'网格'};
  if(!best)for(const q of [point(grid.x,p.z),point(p.x,grid.z)]){const d=distance(p,q);if(d<=tolerance*.65&&compatible(q)&&(!best||d<best.distance))best={...q,distance:d,snapped:'网格线'};}
  return best||{...p};
}
