import { gateLayout } from './gates.js';
import { trackFootprints } from './track-path.js';
import { vectorPaidEdges, zoneMasks, polygonArea } from './zone-geometry.js';

export const CELL_SIZE = 2;
export const ZONE_COLORS = { paid: '#e8e3bd', unpaid: '#cbdfe0', staff: '#d8cfe0' };
export const ZONE_NAMES = { paid: '付费区', unpaid: '非付费区', staff: '员工区域' };
export const ZONE_KINDS = Object.keys(ZONE_NAMES);
export const CELL_LIMIT = 40000;
export const cellKey = (x, z) => `${x},${z}`;
export const parseCell = (key) => key.split(',').map(Number);
export const toCell = (x, z) => [Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE)];

export function insideRect(x, z, rect, padding = 0) {
  const a = (rect.rotation || 0) * Math.PI / 180, dx = x - rect.x, dz = z - rect.z;
  return Math.abs(dx * Math.cos(a) + dz * Math.sin(a)) <= rect.l / 2 + padding &&
    Math.abs(-dx * Math.sin(a) + dz * Math.cos(a)) <= rect.d / 2 + padding;
}

export function rasterizeRect(cells, rect, kind) {
  if (!['x','z','l','d'].every(k => Number.isFinite(rect[k]) && Math.abs(rect[k]) <= 500) || rect.l <= 0 || rect.d <= 0) throw new Error('区域尺寸无效');
  const a = (rect.rotation || 0) * Math.PI / 180;
  const rx = (Math.abs(Math.cos(a)) * rect.l + Math.abs(Math.sin(a)) * rect.d) / 2;
  const rz = (Math.abs(Math.sin(a)) * rect.l + Math.abs(Math.cos(a)) * rect.d) / 2;
  for (let x = Math.max(-250,Math.floor((rect.x-rx)/CELL_SIZE)); x < Math.min(250,Math.ceil((rect.x+rx)/CELL_SIZE)); x++) {
    for (let z = Math.max(-250,Math.floor((rect.z-rz)/CELL_SIZE)); z < Math.min(250,Math.ceil((rect.z+rz)/CELL_SIZE)); z++) {
      if (insideRect((x+.5)*CELL_SIZE, (z+.5)*CELL_SIZE, rect)) cells[cellKey(x,z)] = kind;
    }
  }
  if (Object.keys(cells).length > CELL_LIMIT) throw new Error('区域过大');
  return cells;
}

export function strokeCells(from, to, size = 1, rectangle = false) {
  const cells = new Set(), add = (x,z) => { if (x >= -250 && x < 250 && z >= -250 && z < 250) cells.add(cellKey(x,z)); };
  if (rectangle) {
    const minX=Math.min(from[0],to[0]),maxX=Math.max(from[0],to[0]),minZ=Math.min(from[1],to[1]),maxZ=Math.max(from[1],to[1]);
    if ((maxX-minX+1)*(maxZ-minZ+1)>CELL_LIMIT) return cells;
    for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++)add(x,z);
  } else {
    const steps=Math.max(Math.abs(to[0]-from[0]),Math.abs(to[1]-from[1]),1),offset=Math.floor(size/2);
    for(let i=0;i<=steps;i++)for(let bx=0;bx<size;bx++)for(let bz=0;bz<size;bz++)add(Math.round(from[0]+(to[0]-from[0])*i/steps)+bx-offset,Math.round(from[1]+(to[1]-from[1])*i/steps)+bz-offset);
  }
  return cells;
}

export function applyPaint(cells, keys, kind) {
  for(const key of keys) { if(kind==='erase')delete cells[key];else cells[key]=kind; }
}

const sides = [
  { dx:0,dz:-1, points:(x,z,s)=>[x*s,z*s,(x+1)*s,z*s], nx:0,nz:-1 },
  { dx:0,dz:1, points:(x,z,s)=>[x*s,(z+1)*s,(x+1)*s,(z+1)*s], nx:0,nz:1 },
  { dx:-1,dz:0, points:(x,z,s)=>[x*s,z*s,x*s,(z+1)*s], nx:-1,nz:0 },
  { dx:1,dz:0, points:(x,z,s)=>[(x+1)*s,z*s,(x+1)*s,(z+1)*s], nx:1,nz:0 },
];

export function paidEdges(cells) {
  const edges=[];
  for(const [key,kind] of Object.entries(cells)) {
    if(kind!=='paid')continue;const [x,z]=parseCell(key);
    for(const side of sides){const neighbor=cells[cellKey(x+side.dx,z+side.dz)];if(neighbor==='paid')continue;
      const [x1,z1,x2,z2]=side.points(x,z,CELL_SIZE);edges.push({x1,z1,x2,z2,nx:side.nx,nz:side.nz,neighbor});}
  }
  return edges;
}

export function zoneOutlineEdges(cells) {
  const edges=[];
  for(const [key,kind]of Object.entries(cells)){
    if(kind!=='paid'&&kind!=='unpaid')continue;
    const [x,z]=parseCell(key);
    for(const side of sides){
      const neighbor=cells[cellKey(x+side.dx,z+side.dz)];
      // Public fills share a walkable floor regardless of color.
      if(neighbor==='paid'||neighbor==='unpaid')continue;
      const [x1,z1,x2,z2]=side.points(x,z,CELL_SIZE);
      edges.push({x1,z1,x2,z2,nx:0,nz:0});
    }
  }
  return mergeEdges(edges);
}

// Clip a world-space segment to a rotated rectangle. Exact edge contact counts.
export function clipToRect(edge, rect, padding = .04) {
  const a=(rect.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const local=(x,z)=>[(x-rect.x)*c+(z-rect.z)*s,-(x-rect.x)*s+(z-rect.z)*c];
  const p=local(edge.x1,edge.z1),q=local(edge.x2,edge.z2),delta=[q[0]-p[0],q[1]-p[1]],half=[rect.l/2+padding,rect.d/2+padding];
  let t0=0,t1=1;
  for(let axis=0;axis<2;axis++){
    if(Math.abs(delta[axis])<1e-8){if(Math.abs(p[axis])>half[axis])return null;continue;}
    let tA=(-half[axis]-p[axis])/delta[axis],tB=(half[axis]-p[axis])/delta[axis];if(tA>tB)[tA,tB]=[tB,tA];t0=Math.max(t0,tA);t1=Math.min(t1,tB);if(t0>=t1)return null;
  }
  return {start:t0,end:t1};
}

function subtractIntervals(intervals, cuts) {
  for(const cut of cuts){const next=[];for(const [a,b] of intervals){if(cut.end<=a||cut.start>=b)next.push([a,b]);else{if(cut.start>a)next.push([a,cut.start]);if(cut.end<b)next.push([cut.end,b]);}}intervals=next;}return intervals;
}
function sliceEdge(e,a,b){return {...e,x1:e.x1+(e.x2-e.x1)*a,z1:e.z1+(e.z2-e.z1)*a,x2:e.x1+(e.x2-e.x1)*b,z2:e.z1+(e.z2-e.z1)*b};}
export function mergeEdges(edges) {
  const buckets=new Map();
  for(const e of edges){
    let dx=e.x2-e.x1,dz=e.z2-e.z1,l=Math.hypot(dx,dz);if(l<1e-7)continue;dx/=l;dz/=l;
    const reverse=dx<-.000001||(Math.abs(dx)<.000001&&dz<0);if(reverse){dx=-dx;dz=-dz;}
    const key=[e.kind,e.trackId||'',e.style||'',(e.nx||0).toFixed(5),(e.nz||0).toFixed(5),dx.toFixed(5),dz.toFixed(5),(-dz*e.x1+dx*e.z1).toFixed(4)].join(':');
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push({...e,...(reverse?{x1:e.x2,z1:e.z2,x2:e.x1,z2:e.z1}:{}),_start:Math.min(e.x1*dx+e.z1*dz,e.x2*dx+e.z2*dz),_end:Math.max(e.x1*dx+e.z1*dz,e.x2*dx+e.z2*dz)});
  }
  const result=[];
  for(const list of buckets.values()){
    list.sort((a,b)=>a._start-b._start);let current;
    for(const e of list){
      if(current&&e._start<=current._end+.001){if(e._end>current._end){current.x2=e.x2;current.z2=e.z2;current._end=e._end;}}
      else{current={...e};result.push(current);}}
  }
  return result.map(({_start,_end,...e})=>e);
}

export const projectPaidEdges=(project,floor)=>project.zonePaths?.some(p=>p.floor===floor&&p.closed)?vectorPaidEdges(project,floor):paidEdges(project.zones[floor]||{});

export function generateBoundaries(project, floorId) {
  const cells=project.zones[floorId]||{},tracks=project.entities.filter(e=>e.type==='track'&&e.floor===floorId&&e.visible),gates=project.entities.filter(e=>e.type==='gates'&&e.floor===floorId&&e.visible),edges=[];
  const perimeter=projectPaidEdges(project,floorId);
  const footprints=new Map(tracks.map(track=>[track.id,trackFootprints(track)]));
  if(project.boundaries.railings){
    const cabinetRows=gates.map(g=>{
      const {centers,cabinetWidth}=gateLayout(g),angle=g.rotation*Math.PI/180;
      return {
        footprint:{...g,d:centers.at(-1)-centers[0]+cabinetWidth},
        cabinets:centers.map(z=>({...g,x:g.x-Math.sin(angle)*z,z:g.z+Math.cos(angle)*z,d:cabinetWidth})),
      };
    });
    // Clip whole shared edges so a grid-cell seam cannot put a rail in a gate passage.
    for(const edge of mergeEdges(perimeter.filter(e=>e.neighbor==='unpaid'))){
      const cuts=cabinetRows.map(row=>{
        const crossing=clipToRect(edge,row.footprint,0);if(!crossing)return null;
        const hits=row.cabinets.map(cabinet=>clipToRect(edge,cabinet,0)).filter(Boolean);
        // Keep passages open, with each end meeting an actual cabinet, even after rotation.
        return hits.length?{start:Math.min(...hits.map(h=>h.start)),end:Math.max(...hits.map(h=>h.end))}:crossing;
      }).filter(Boolean);
      for(const [a,b]of subtractIntervals([[0,1]],cuts))if((b-a)*Math.hypot(edge.x2-edge.x1,edge.z2-edge.z1)>.001)edges.push({...sliceEdge(edge,a,b),kind:'railing'});
    }
  }
  for(const edge of perimeter){
    if(!edge.neighbor){
      let remaining=[[0,1]];
      for(const track of tracks){
        const style=track.doorStyle&&track.doorStyle!=='inherit'?track.doorStyle:project.boundaries.screenDoors;
        if(style==='none')continue;
        for(const footprint of footprints.get(track.id)){
          const hit=clipToRect(edge,footprint);if(!hit)continue;
          for(const[a,b]of remaining){const start=Math.max(a,hit.start),end=Math.min(b,hit.end);if((end-start)*Math.hypot(edge.x2-edge.x1,edge.z2-edge.z1)>.15)edges.push({...sliceEdge(edge,start,end),kind:'screen',style,trackId:track.id});}
          remaining=subtractIntervals(remaining,[hit]);
        }
      }
    }
  }
  return mergeEdges(edges);
}

// Snap the long side of a track onto an exposed paid-area edge, never its center.
export function snapTrack(project, track, tolerance = 3) {
  if(!project.snapping||track.type!=='track'||track.path)return {...track,snapped:false};
  const a=(track.rotation||0)*Math.PI/180,alongX=Math.abs(Math.cos(a))>.999,alongZ=Math.abs(Math.sin(a))>.999;
  if(!alongX&&!alongZ)return {...track,snapped:false};
  let best=null;
  for(const edge of mergeEdges(projectPaidEdges(project,track.floor).filter(e=>!e.neighbor))){
    if(alongX&&Math.abs(edge.nz)>.999&&Math.abs(edge.z2-edge.z1)<.001){if(track.x+track.l/2<=edge.x1||track.x-track.l/2>=edge.x2)continue;const z=edge.z1+edge.nz*track.d/2,distance=Math.abs(z-track.z);if(distance<=tolerance&&(!best||distance<best.distance))best={x:track.x,z,distance,edge};}
    if(alongZ&&Math.abs(edge.nx)>.999&&Math.abs(edge.x2-edge.x1)<.001){if(track.z+track.l/2<=edge.z1||track.z-track.l/2>=edge.z2)continue;const x=edge.x1+edge.nx*track.d/2,distance=Math.abs(x-track.x);if(distance<=tolerance&&(!best||distance<best.distance))best={x,z:track.z,distance,edge};}
  }
  return best?{...track,x:best.x,z:best.z,snapped:true,snapEdge:best.edge}:{...track,snapped:false};
}

export function zoneStats(project,floorId) {
  if(project.zonePaths?.some(p=>p.floor===floorId&&p.closed)){const masks=zoneMasks(project,floorId);return Object.fromEntries(ZONE_KINDS.map(kind=>[kind,Math.round(polygonArea(masks[kind])*10)/10]));}
  const stats=Object.fromEntries(ZONE_KINDS.map(kind=>[kind,0]));
  for(const kind of Object.values(project.zones[floorId]||{}))if(Object.hasOwn(stats,kind))stats[kind]+=CELL_SIZE**2;
  return stats;
}
