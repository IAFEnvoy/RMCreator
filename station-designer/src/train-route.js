import { trackGeometry, pointAlongTrack, projectToTrack } from './track-path.js';

// Only real endpoint contacts connect rails. Crossing interiors do not form a turnout.
export const TRAIN_CONNECTION_TOLERANCE = .05;
const EPS = 1e-7, rad = Math.PI / 180, networks = new WeakMap();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function network(project) {
  const tracks = project.entities.filter(e => e.type === 'track');
  const key = JSON.stringify(tracks.map(t => [t.id,t.floor,t.x,t.z,t.rotation,t.l,t.d,t.lineId,t.path,t.pathKind,t.pathSmoothness]));
  if (networks.get(project)?.key === key) return networks.get(project).value;
  const records = tracks.map(track => ({ track, length: trackGeometry(track).length, marks: [] }));
  const parents = [], adjacency = new Map();
  const root = id => parents[id] === id ? id : (parents[id] = root(parents[id]));
  const mark = (record, s) => {
    s = clamp(s, 0, record.length);
    let p = record.marks.find(p => Math.abs(p.s - s) < EPS);
    if (!p) { p = { s, id: parents.length }; parents.push(p.id); record.marks.push(p); }
    return p;
  };
  for (const r of records) { mark(r, 0); mark(r, r.length); }
  for (const a of records) for (const s of [0, a.length]) {
    const endpoint = pointAlongTrack(a.track, s, true), from = mark(a, s);
    for (const b of records) {
      if (a === b || a.track.floor !== b.track.floor) continue;
      const hit = projectToTrack(b.track, endpoint);
      if (hit.distance > TRAIN_CONNECTION_TOLERANCE) continue;
      const to = mark(b, hit.s); parents[root(from.id)] = root(to.id);
    }
  }
  const byTrack = new Map(); let edgeId = 0;
  for (const r of records) {
    r.marks.sort((a,b) => a.s-b.s);
    const edges = [];
    for (let i=1;i<r.marks.length;i++) {
      const a=r.marks[i-1],b=r.marks[i]; if (b.s-a.s < EPS) continue;
      const edge = { id: edgeId++, track:r.track, start:a.s, end:b.s, length:b.s-a.s, from:root(a.id), to:root(b.id) };
      edges.push(edge);
      for (const node of new Set([edge.from,edge.to])) { if (!adjacency.has(node)) adjacency.set(node,[]); adjacency.get(node).push(edge); }
    }
    byTrack.set(r.track.id,edges);
  }
  const value = { byTrack, adjacency, routes:new Map() }; networks.set(project,{key,value}); return value;
}

function oriented(edge, reverse=false) {
  return { track:edge.track, start:reverse?edge.end:edge.start, end:reverse?edge.start:edge.end, length:edge.length };
}

// Route orientation always follows the anchor rail's own direction, independently
// of the train's cab facing. Each physical edge can occur at most once, including loops.
export function connectedTrainRoute(project, track, graph = null) {
  if (!track) return null;
  // Whole-track drag previews may supply a replacement before committing it.
  const source=project.entities.find(e=>e.id===track.id);
  if (source !== track) return connectedTrainRoute({ ...project, entities:[...project.entities.filter(e=>e.id!==track.id),track] },track);
  graph ||= network(project);
  if(graph.routes.has(track.id))return graph.routes.get(track.id);
  const anchor=graph.byTrack.get(track.id);
  if (!anchor?.length) return null;
  const used=new Set(anchor.map(e=>e.id));
  const extend = reverse => {
    const segments=[],first=reverse?anchor[0]:anchor.at(-1);
    let node=reverse?first.from:first.to,previous=track;
    let angle=pointAlongTrack(track,reverse?0:trackGeometry(track).length,true).angle+(reverse?180:0);
    while (true) {
      const candidates=(graph.adjacency.get(node)||[]).filter(e=>!used.has(e.id)).map(edge=>{
        const reversed=edge.to===node,segment=oriented(edge,reversed);
        const heading=pointAlongTrack(edge.track,segment.start,true).angle+(reversed?180:0);
        const ahead=pointAlongTrack(edge.track,segment.start+(reversed?-1:1)*Math.min(10,segment.length),true).angle+(reversed?180:0);
        return {edge,segment,reversed,straight:Math.cos((heading-angle)*rad),ahead:Math.cos((ahead-angle)*rad),sameLine:edge.track.lineId===previous.lineId};
      }).filter(c=>c.straight>=-1e-6).sort((a,b)=>
        Math.abs(b.straight-a.straight)>1e-6?b.straight-a.straight:
          Math.abs(b.ahead-a.ahead)>1e-6?b.ahead-a.ahead:
          Number(b.sameLine)-Number(a.sameLine)||a.edge.track.id.localeCompare(b.edge.track.id)||a.edge.start-b.edge.start);
      const next=candidates[0]; if (!next) break;
      used.add(next.edge.id);segments.push(next.segment);
      node=next.reversed?next.edge.from:next.edge.to;previous=next.edge.track;
      angle=pointAlongTrack(previous,next.segment.end,true).angle+(next.reversed?180:0);
    }
    return segments;
  };
  const before=extend(true),after=extend(false),backLength=before.reduce((sum,s)=>sum+s.length,0);
  const segments=[...before.reverse().map(s=>({...s,start:s.end,end:s.start})),...anchor.map(e=>oriented(e)),...after];
  let length=0;for(const segment of segments){segment.from=length;length+=segment.length;segment.to=length;}
  const first=segments[0],last=segments.at(-1),a=pointAlongTrack(first.track,first.start,true),b=pointAlongTrack(last.track,last.end,true);
  const loop=Math.hypot(a.x-b.x,a.z-b.z)<=TRAIN_CONNECTION_TOLERANCE;
  const route={ segments, length, origin:backLength+trackGeometry(track).length/2, track, loop };
  graph.routes.set(track.id,route);return route;
}

export function trainRouteResolver(project) {
  const graph=network(project);
  return track=>connectedTrainRoute(project,track,graph);
}

export function pointAlongTrainRoute(route, distance) {
  const s=route.loop?((distance%route.length)+route.length)%route.length:clamp(distance,0,route.length),segments=route.segments;
  let lo=0,hi=segments.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(segments[mid].to<s)lo=mid+1;else hi=mid;}
  const segment=segments[lo],sign=Math.sign(segment.end-segment.start);
  const local=segment.start+sign*(s-segment.from),p=pointAlongTrack(segment.track,local,true),angle=p.angle+(sign<0?180:0);
  return {...p,s,angle,tx:Math.cos(angle*rad),tz:Math.sin(angle*rad),trackId:segment.track.id,trackS:local};
}

export function routeIntervals(route, start, end) {
  if (!route) return [];
  if(route.loop){
    const size=end-start;
    if(size>=route.length) {start=0;end=route.length;}
    else {
      start=((start%route.length)+route.length)%route.length;end=start+size;
      if(end>route.length)return [...routeIntervals({...route,loop:false},start,route.length),...routeIntervals({...route,loop:false},0,end-route.length)];
    }
  }
  return route.segments.flatMap(segment=>{
    const a=Math.max(start,segment.from),b=Math.min(end,segment.to);if(b-a<EPS)return [];
    const sign=Math.sign(segment.end-segment.start),x=segment.start+sign*(a-segment.from),y=segment.start+sign*(b-segment.from);
    return [{track:segment.track,start:Math.min(x,y),end:Math.max(x,y)}];
  });
}
