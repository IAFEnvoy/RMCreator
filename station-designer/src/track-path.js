// Track geometry is shared by drawing, snapping, trains and boundary facilities.
import { snapGeometry } from '../../shared/snap-math.js';

const rad = Math.PI / 180, clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const unit = (x, z) => { const l = Math.hypot(x, z); return l > 1e-8 ? { x: x / l, z: z / l } : { x: 1, z: 0 }; };
export const pathKnots = track => track.path || [{ x: -track.l / 2, z: 0 }, { x: track.l / 2, z: 0 }];
export function localPoint(track, point) {
  const a = track.rotation * rad, dx = point.x - track.x, dz = point.z - track.z;
  return { x: dx * Math.cos(a) + dz * Math.sin(a), z: -dx * Math.sin(a) + dz * Math.cos(a) };
}
export function worldPoint(track, point) {
  const a = track.rotation * rad;
  return { x: track.x + point.x * Math.cos(a) - point.z * Math.sin(a), z: track.z + point.x * Math.sin(a) + point.z * Math.cos(a) };
}
function tangent(knots, i) {
  const p = knots[i], before = knots[Math.max(0, i - 1)], after = knots[Math.min(knots.length - 1, i + 1)];
  return Number.isFinite(p.tx) && Number.isFinite(p.tz) ? unit(p.tx, p.tz) : unit(after.x - before.x, after.z - before.z);
}
const cache = new WeakMap();
export function trackGeometry(track) {
  const key = JSON.stringify([track.path, track.pathKind, track.pathSmoothness, track.l]);
  if (cache.get(track)?.key === key) return cache.get(track).geometry;
  const knots = pathKnots(track), samples = [], smooth = track.pathSmoothness ?? 1;
  let length = 0;
  const quadratic = track.pathKind === 'quadratic', stride = quadratic ? 2 : 1;
  for (let i = 0; i < knots.length - stride; i += stride) {
    const a = knots[i], b = knots[i + stride], chord = Math.hypot(b.x - a.x, b.z - a.z);
    // Represent a quadratic Bézier as an equivalent cubic; the middle point is a handle, never a stop on the rail.
    let c, d, samplingLength = chord;
    if (quadratic) {
      const control = knots[i + 1];
      c = { x: a.x + (control.x - a.x) * 2 / 3, z: a.z + (control.z - a.z) * 2 / 3 };
      d = { x: b.x + (control.x - b.x) * 2 / 3, z: b.z + (control.z - b.z) * 2 / 3 };
      samplingLength = Math.hypot(control.x - a.x, control.z - a.z) + Math.hypot(b.x - control.x, b.z - control.z);
    } else {
      const ta = tangent(knots, i), tb = tangent(knots, i + 1), h = chord / 3 * smooth;
      c = { x: a.x + ta.x * h, z: a.z + ta.z * h }; d = { x: b.x - tb.x * h, z: b.z - tb.z * h };
    }
    const steps = track.path ? clamp(Math.ceil(samplingLength / .7), 16, 512) : 1;
    for (let j = i ? 1 : 0; j <= steps; j++) {
      const t = j / steps, u = 1 - t;
      const p = { x: u ** 3 * a.x + 3 * u * u * t * c.x + 3 * u * t * t * d.x + t ** 3 * b.x,
        z: u ** 3 * a.z + 3 * u * u * t * c.z + 3 * u * t * t * d.z + t ** 3 * b.z };
      const direction = unit(3 * u * u * (c.x - a.x) + 6 * u * t * (d.x - c.x) + 3 * t * t * (b.x - d.x),
        3 * u * u * (c.z - a.z) + 6 * u * t * (d.z - c.z) + 3 * t * t * (b.z - d.z));
      if (samples.length) length += Math.hypot(p.x - samples.at(-1).x, p.z - samples.at(-1).z);
      samples.push({ ...p, tx: direction.x, tz: direction.z, s: length });
    }
  }
  const geometry = { samples, length };
  cache.set(track, { key, geometry });
  return geometry;
}
export function pointAlongTrack(track, distance, world = false) {
  const { samples, length } = trackGeometry(track), s = clamp(distance, 0, length);
  let lo = 0, hi = samples.length - 1;
  while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (samples[m].s < s) lo = m; else hi = m; }
  const a = samples[lo], b = samples[hi], t = (s - a.s) / (b.s - a.s || 1);
  const dir = unit(a.tx + (b.tx - a.tx) * t, a.tz + (b.tz - a.tz) * t);
  const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  const angle = Math.atan2(dir.z, dir.x) / rad;
  return { ...(world ? worldPoint(track, p) : p), tx: dir.x, tz: dir.z, angle: angle + (world ? track.rotation : 0), s };
}
export function projectToTrack(track, point) {
  const local = localPoint(track, point), { samples, length } = trackGeometry(track);
  let best;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], dx = b.x - a.x, dz = b.z - a.z;
    const t = clamp(((local.x - a.x) * dx + (local.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const x = a.x + t * dx, z = a.z + t * dz, distance = Math.hypot(local.x - x, local.z - z);
    if (!best || distance < best.distance) best = { distance, s: a.s + t * (b.s - a.s) };
  }
  return { ...pointAlongTrack(track, best.s, true), distance: best.distance, fraction: best.s / (length || 1) };
}
export function trackFootprints(track) {
  if (!track.path) return [track];
  const points = trackGeometry(track).samples, result = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], p = worldPoint(track, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    result.push({ ...p, l: Math.hypot(b.x - a.x, b.z - a.z) + .025, d: track.d, rotation: track.rotation + Math.atan2(b.z - a.z, b.x - a.x) / rad });
  }
  return result;
}
export function snapRailPoint(project, source, point, tolerance = 3, constraint, cache = {}) {
  if (!project.snapping) return { ...point };
  if(constraint){
    if(!cache.targets){
      const points=[],segments=[];
      for(const track of project.entities.filter(e=>e.type==='track'&&e.visible&&e.floor===source.floor&&e.id!==source.id)){
        const {samples,length}=trackGeometry(track);
        for(const fraction of [0,1]){const p=pointAlongTrack(track,length*fraction,true);points.push({x:p.x,y:p.z,track,s:fraction*length});}
        for(let i=1;i<samples.length;i++){const a=worldPoint(track,samples[i-1]),b=worldPoint(track,samples[i]);segments.push({a:{x:a.x,y:a.z},b:{x:b.x,y:b.z},track,start:samples[i-1].s,end:samples[i].s});}
      }
      cache.targets={points,segments};
    }
    const hit=snapGeometry({x:point.x,y:point.z},{...cache.targets,tolerance,constraint:{n:{x:constraint.n.x,y:constraint.n.z},value:constraint.value}});
    if(!hit)return {...point};
    const track=hit.target.track,s=hit.type==='point'?hit.target.s:hit.target.start+(hit.target.end-hit.target.start)*hit.t;
    return {...pointAlongTrack(track,s,true),x:hit.x,z:hit.y,distance:hit.distance,fraction:s/(trackGeometry(track).length||1),trackId:track.id,snapKind:hit.type==='point'?'endpoint':'track',snapType:hit.type,snapped:true};
  }
  let best, endpoint;
  for (const track of project.entities.filter(e => e.type === 'track' && e.visible && e.floor === source.floor && e.id !== source.id)) {
    const hit = projectToTrack(track, point);
    if (hit.distance <= tolerance && (!best || hit.distance < best.distance)) best = { ...hit, trackId: track.id, snapKind: 'track' };
    const length = trackGeometry(track).length;
    for (const fraction of [0, 1]) {
      const p = pointAlongTrack(track, length * fraction, true), distance = Math.hypot(p.x - point.x, p.z - point.z);
      if (distance <= tolerance && (!endpoint || distance < endpoint.distance)) endpoint = { ...p, distance, fraction, trackId: track.id, snapKind: 'endpoint' };
    }
  }
  best = endpoint || best;
  return best ? { ...best, snapType:best.snapKind==='endpoint'?'point':'segment', snapped: true } : { ...point };
}
export function makeTrackPath(source, points, mode = 'curve') {
  const origin = points[0], a = { ...source, x: origin.x, z: origin.z, rotation: 0 };
  a.path = points.map(p => ({ x: p.x - origin.x, z: p.z - origin.z }));
  a.pathSmoothness = 1;
  if (mode === 'quadratic') { a.pathKind = 'quadratic'; delete a.pathSmoothness; }
  else delete a.pathKind;
  a.joins = {};
  for (const [key, i] of [['start', 0], ['end', points.length - 1]]) {
    const p = points[i], next = points[i === 0 ? 1 : i - 1], sign = i === 0 ? 1 : -1;
    const dx = (next.x - p.x) * sign, dz = (next.z - p.z) * sign;
    if (p.snapped) {
      const reverse = dx * Math.cos(p.angle * rad) + dz * Math.sin(p.angle * rad) < 0, angle = p.angle * rad + (reverse ? Math.PI : 0);
      if (mode !== 'quadratic') Object.assign(a.path[i], { tx: Math.cos(angle), tz: Math.sin(angle) });
      a.joins[key] = { trackId: p.trackId, t: p.fraction, reverse };
    } else if (mode === 'connector') {
      const direction = Math.abs(dx) >= Math.abs(dz) ? { tx: Math.sign(dx) || 1, tz: 0 } : { tx: 0, tz: Math.sign(dz) || 1 };
      Object.assign(a.path[i], direction);
    }
  }
  a.l = trackGeometry(a).length;
  return a;
}
export function trackPathError(track) {
  if (!track.path) return track.pathKind === undefined ? '' : '轨道缺少曲线路径';
  if (track.pathKind !== undefined && track.pathKind !== 'quadratic') return '轨道曲线类型无效';
  const quadratic = track.pathKind === 'quadratic';
  if (!Array.isArray(track.path) || track.path.length < (quadratic ? 3 : 2) || track.path.length > (quadratic ? 31 : 32) || quadratic && track.path.length % 2 !== 1) return quadratic ? '曲线需按起点、控制点、终点排列，最多 15 段' : '轨道需有 2–32 个路径点';
  if (!track.path.every(p => p && ['x', 'z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 1000) &&
    (p.tx === undefined && p.tz === undefined || Number.isFinite(p.tx) && Number.isFinite(p.tz) && Math.hypot(p.tx, p.tz) > .01 && Math.hypot(p.tx, p.tz) <= 2))) return '路径坐标或方向无效';
  if (track.pathSmoothness !== undefined && (!Number.isFinite(track.pathSmoothness) || track.pathSmoothness < .1 || track.pathSmoothness > 1)) return '平滑度需为 0.1–1';
  if (track.path.some((p, i) => i && Math.hypot(p.x - track.path[i - 1].x, p.z - track.path[i - 1].z) < (quadratic ? .1 : 2))) return quadratic ? '控制点与端点不能重合' : '相邻路径点至少相距 2 m';
  if (quadratic) for (let i = 0; i < track.path.length - 2; i += 2) {
    const [a, c, b] = track.path.slice(i, i + 3), u = { x: c.x - a.x, z: c.z - a.z }, v = { x: b.x - c.x, z: b.z - c.z };
    if (Math.hypot(b.x - a.x, b.z - a.z) < 2) return '每段曲线的起点与终点至少相距 2 m';
    if (Math.abs(u.x * v.z - u.z * v.x) < 1e-6 && u.x * v.x + u.z * v.z < 0) return '控制点导致轨道折回，请调整控制点';
    if ([a, c, b].some(p => { const w = worldPoint(track, p); return Math.abs(w.x) > 500 || Math.abs(w.z) > 500; })) return '路径点需在 ±500 m 范围内';
  }
  const geometry = trackGeometry(track);
  if (geometry.length < 2 || geometry.length > 500) return '轨道路径全长需为 2–500 m';
  if (geometry.samples.some(p => { const w = worldPoint(track, p); return Math.abs(w.x) > 500 || Math.abs(w.z) > 500; })) return '轨道需在 ±500 m 范围内';
  return '';
}
export function moveTrackKnot(project, source, index, point, { prepared = false } = {}) {
  const track = structuredClone(source);
  track.path ||= pathKnots(track);
  const end = index === 0 ? 'start' : index === track.path.length - 1 ? 'end' : null;
  const target = prepared ? point : end ? snapRailPoint(project, track, point) : point;
  const local = localPoint(track, target);
  track.path[index] = local;
  if (end && track.joins) delete track.joins[end];
  if (end && target.snapped) {
    const neighbor = track.path[index === 0 ? 1 : index - 1], sign = index === 0 ? 1 : -1;
    const angle = (target.angle - track.rotation) * rad;
    const reverse = ((neighbor.x - local.x) * Math.cos(angle) + (neighbor.z - local.z) * Math.sin(angle)) * sign < 0;
    if (track.pathKind !== 'quadratic') Object.assign(local, { tx: Math.cos(angle) * (reverse ? -1 : 1), tz: Math.sin(angle) * (reverse ? -1 : 1) });
    track.joins ||= {}; track.joins[end] = { trackId: target.trackId, t: target.fraction, reverse };
  }
  track.l = trackGeometry(track).length;
  return track;
}
export function splitQuadraticSegment(source, segment) {
  const track = structuredClone(source), index = segment * 2;
  if (track.pathKind !== 'quadratic' || track.path.length >= 31 || !Number.isInteger(segment) || index < 0 || index + 2 >= track.path.length) return track;
  const [a, c, b] = track.path.slice(index, index + 3), mid = (p, q) => ({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
  const left = mid(a, c), right = mid(c, b);
  track.path.splice(index + 1, 1, left, mid(left, right), right);
  track.l = trackGeometry(track).length;
  return track;
}
export function removeQuadraticSegment(source, segment) {
  const track = structuredClone(source), index = segment * 2;
  if (track.pathKind !== 'quadratic' || track.path.length <= 3 || !Number.isInteger(segment) || index < 0 || index + 2 >= track.path.length) return track;
  if (!segment) { track.path.splice(0, 2); if (track.joins) delete track.joins.start; }
  else { track.path.splice(index + 1, 2); if (index + 1 === track.path.length && track.joins) delete track.joins.end; }
  track.l = trackGeometry(track).length;
  return track;
}
export function syncTrackPaths(project) {
  const tracks = project.entities.filter(e => e.type === 'track'), done = new Set(), visiting = new Set();
  const update = track => {
    if (done.has(track.id)) return;
    if (visiting.has(track.id)) throw new Error('轨道连接不能形成循环依赖');
    visiting.add(track.id);
    for (const [key, join] of Object.entries(track.joins || {})) {
      const host = tracks.find(e => e.id === join.trackId);
      if (!host || host.floor !== track.floor || !track.path) { delete track.joins[key]; continue; }
      update(host);
      const p = pointAlongTrack(host, trackGeometry(host).length * join.t, true), local = localPoint(track, p), angle = (p.angle - track.rotation + (join.reverse ? 180 : 0)) * rad;
      const endpoint = track.path[key === 'start' ? 0 : track.path.length - 1];
      Object.assign(endpoint, local);
      if (track.pathKind !== 'quadratic') Object.assign(endpoint, { tx: Math.cos(angle), tz: Math.sin(angle) });
    }
    if (track.path) track.l = trackGeometry(track).length;
    visiting.delete(track.id); done.add(track.id);
  };
  tracks.forEach(update);
}
