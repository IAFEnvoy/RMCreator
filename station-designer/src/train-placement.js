import { trainLayout, trackLayout } from './track.js';
import { pointAlongTrack, trackGeometry, projectToTrack, localPoint } from './track-path.js';
import { connectedTrainRoute, trainRouteResolver, pointAlongTrainRoute, routeIntervals } from './train-route.js';

// Clearance also covers the small door/stripe details outside the nominal body.
export const TRAIN_END_CLEARANCE = .5;
export const TRAIN_SEPARATION = 1;
const metres = n => Number(n.toFixed(2));
function occupancy(project, train, padding = 0, resolve = track=>connectedTrainRoute(project,track)) {
  const track=project.entities.find(e=>e.type==='track'&&e.id===train.trackId),route=resolve(track);
  if(!route)return [];
  const center=route.origin+(train.trainOffset??0),half=trainLayout(train).nominalLength/2+padding;
  return routeIntervals(route,center-half,center+half);
}
export const trainsOnTrack = (project, id) => project.entities.filter(e => e.type === 'train' &&
  (e.trackId===id||occupancy(project,e,TRAIN_END_CLEARANCE).some(interval=>interval.track.id===id)));

export function trainOnTrack(project, train, track, offset = train.trainOffset ?? 0) {
  const layout = trainLayout(train), route=connectedTrainRoute(project,track);
  const p = pointAlongTrainRoute(route,route.origin+offset);
  return { ...train, trackId: track.id, trainOffset: offset, floor: track.floor,
    x: p.x, z: p.z, rotation: p.angle,
    l: layout.nominalLength, d: layout.dimensions.width, h: layout.dimensions.height,
    color: trackLayout(project, track).color };
}

export function syncTrains(project) {
  for (const train of project.entities.filter(e => e.type === 'train')) {
    const track = project.entities.find(e => e.type === 'track' && e.id === train.trackId);
    if (track) Object.assign(train, trainOnTrack(project, train, track));
  }
}
export function trainCarPose(train, track, spec, forward = true, route = null) {
  const sign=forward?1:-1,center=(route?.origin??trackGeometry(track).length/2)+(train.trainOffset??0)+sign*spec.center;
  const at=s=>route?pointAlongTrainRoute(route,s):pointAlongTrack(track,s,true);
  const p=at(center),a=at(center-spec.length/2),b=at(center+spec.length/2);
  const angle=Math.atan2(b.z-a.z,b.x-a.x)*180/Math.PI+(forward?0:180),local=localPoint(train,p);
  return {...local,angle:angle-train.rotation,world:p,worldAngle:angle};
}

export function trainFit(project, train) {
  const layout = trainLayout(train), track = project.entities.find(e => e.type === 'track' && e.id === train.trackId);
  if (!track) return { valid: false, message: '请选择轨道放置列车', penalty: Infinity };
  const requiredLength = layout.nominalLength + 2 * TRAIN_END_CLEARANCE;
  const requiredWidth = layout.width * 1.1 + .2;
  const resolve=trainRouteResolver(project),route=resolve(track),length=route.length,offset=train.trainOffset??0,center=route.origin+offset;
  const minOffset=route.loop?-Infinity:requiredLength/2-route.origin,maxOffset=route.loop?Infinity:length-requiredLength/2-route.origin,limit=Math.min(-minOffset,maxOffset);
  const overrun=route.loop?Math.max(0,(requiredLength-length)/2):Math.max(0,minOffset-offset,offset-maxOffset);
  const intervals=routeIntervals(route,center-requiredLength/2,center+requiredLength/2);
  const width=intervals.length?Math.min(...intervals.map(i=>i.track.d)):track.d,narrow=Math.max(0,requiredWidth-width);
  const occupied=occupancy(project,train,TRAIN_SEPARATION/2,resolve);
  const overlaps=Object.fromEntries(project.entities.filter(e=>e.type==='train'&&e.id!==train.id).map(other=>{
    const otherIntervals=occupancy(project,other,TRAIN_SEPARATION/2,resolve);
    let overlap=0;
    for(const a of occupied)for(const b of otherIntervals)if(a.track.id===b.track.id)
      overlap=Math.max(overlap,Math.min(a.end,b.end)-Math.max(a.start,b.start));
    return [other.id,overlap];
  }));
  // This is a schematic: rigid carriages follow the path individually, without an engineering bend-radius limit.
  const penalty = overrun + narrow + Object.values(overlaps).reduce((sum, n) => sum + n, 0);
  const valid = penalty < 1e-7;
  let message;
  if (length + 1e-7 < requiredLength) message = `轨道长度不足：需 ${metres(requiredLength)} m，现有 ${metres(length)} m`;
  else if (narrow > 1e-7) message = `轨道宽度不足：需 ${metres(requiredWidth)} m，现有 ${metres(width)} m`;
  else if (overrun > 1e-7) message = `列车超出轨道，请将中心偏移设在 ${metres(minOffset)} 至 ${metres(maxOffset)} m 内`;
  else if (Object.values(overlaps).some(n => n > 1e-7)) message = '此处已有列车，车间需留出 1 m 间距';
  else message = `${layout.formation} 编组 · 全长 ${metres(layout.nominalLength)} m · 可放置${new Set(intervals.map(i=>i.track.id)).size>1?` · 跨 ${new Set(intervals.map(i=>i.track.id)).size} 段轨道`:''}`;
  return { valid, message, penalty, overrun, narrow, overlaps, limit, minOffset, maxOffset, requiredLength, requiredWidth, track, route, intervals };
}

export function placeTrain(project, train, point) {
  const tracks = project.entities.filter(e => e.type === 'track' && e.visible && e.floor === train.floor);
  const candidates = tracks.map(track => ({track,...projectToTrack(track,point)}))
    .filter(p => p.distance <= p.track.d / 2 + 2).sort((a,b)=>a.distance-b.distance);
  if (!candidates.length) return { entity: { ...train, ...point }, valid: false, message: '移到当前楼层的轨道上放置' };
  const { track, s } = candidates[0], length=trackGeometry(track).length, along=s-length/2;
  const route=connectedTrainRoute(project,track),half=trainLayout(train).nominalLength/2+TRAIN_END_CLEARANCE;
  const minOffset=half-route.origin,maxOffset=route.length-half-route.origin;
  const offset=route.loop?Math.round(along*2)/2:minOffset<=maxOffset?Math.max(minOffset,Math.min(maxOffset,Math.round(along*2)/2)):0;
  const entity = trainOnTrack(project, train, track, offset);
  return { entity, ...trainFit(project, entity) };
}

// Reject newly invalid edits; allow an oversized legacy formation to be repaired in steps.
export function trainEditError(before, after) {
  for (const train of after.entities.filter(e => e.type === 'train')) {
    const fit = trainFit(after, train);
    if (fit.valid) continue;
    const old = before.entities.find(e => e.id === train.id && e.type === 'train');
    const previous = old && trainFit(before, old);
    const worsened = !fit.track || !previous || fit.overrun > previous.overrun + 1e-7 || fit.narrow > previous.narrow + 1e-7 ||
      Object.entries(fit.overlaps || {}).some(([id, n]) => n > (previous.overlaps?.[id] ?? 0) + 1e-7);
    if (worsened) return `${train.name}：${fit.message}`;
  }
  return '';
}

export function removeWithTrains(project, id) {
  const attached=new Set(trainsOnTrack(project,id).map(e=>e.id));
  project.entities = project.entities.filter(e => e.id !== id && !attached.has(e.id));
  for(const track of project.entities.filter(e=>e.type==='track'))for(const[key,join]of Object.entries(track.joins||{}))if(join.trackId===id)delete track.joins[key];
}
