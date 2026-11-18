import { snapTrack } from './zones.js';
import { snapRailPoint } from './track-path.js';
import { inheritTrackStyle } from './track-drawing.js';
import { stairPreset, stairPathError, reverseStairPath } from './stair-path.js';

export const TWO_POINT_TYPES = ['track', 'stairs', 'escalator', 'elevator'];
export const CONNECTION_TYPES = ['stairs', 'escalator', 'elevator'];
export const placementPoint = point => ({
  x: Math.max(-500, Math.min(500, Math.round((Number.isFinite(point.x) ? point.x : 0) * 2) / 2)),
  z: Math.max(-500, Math.min(500, Math.round((Number.isFinite(point.z) ? point.z : 0) * 2) / 2)),
});

export function placementConnection(project, entity) {
  const from = project.floors.find(f => f.id === entity.floor);
  const to = project.floors.find(f => f.id === entity.toFloor);
  return from && to && from.id !== to.id ? { from, to, rise: Math.abs(to.elevation - from.elevation), descending: to.elevation < from.elevation } : null;
}

// Store connections from the lower floor so existing meshes and openings agree,
// regardless of which endpoint the user picked first.
export function normalizeConnection(project, entity) {
  if (!entity.toFloor) return entity;
  const connection = placementConnection(project, entity);
  if (!connection) { delete entity.toFloor; return entity; }
  entity.h = Math.max(.5, connection.rise + (entity.type === 'elevator' ? 4 : 0));
  if (connection.descending) {
    [entity.floor, entity.toFloor] = [entity.toFloor, entity.floor];
    if(entity.stairPath){
      entity.stairPath=reverseStairPath(entity.stairPath);
    }else if (entity.type !== 'elevator') entity.rotation = (entity.rotation + 180) % 360;
  }
  return entity;
}

export function connectionFloors(project, entity) {
  const connection=placementConnection(project, entity);
  if(!connection)return [entity.floor];
  const low=Math.min(connection.from.elevation,connection.to.elevation),high=Math.max(connection.from.elevation,connection.to.elevation);
  return project.floors.filter(f=>f.elevation>=low&&f.elevation<=high).map(f=>f.id);
}

// Changing the viewed floor keeps the draft and its picked coordinates intact.
export function retargetPlacement(project, placement, floor, endpoint = false) {
  if (!placement || !project.floors.some(f => f.id === floor)) return;
  const e = placement.entity, connection = CONNECTION_TYPES.includes(e.type);
  if (connection && (placement.start || endpoint)) {
    if (floor !== e.floor) e.toFloor = floor;
  } else if (!placement.anchorPicking && !placement.start && !placement.points?.length) {
    e.floor = floor;
    if (connection && (!e.toFloor || e.toFloor === floor)) {
      const from = project.floors.find(f => f.id === floor);
      e.toFloor = project.floors.filter(f => f.id !== floor).sort((a,b) => Math.abs(a.elevation-from.elevation)-Math.abs(b.elevation-from.elevation))[0]?.id;
    }
  }
  placement.point = null;
  placement.result = null;
  delete placement.pointerDown;
}

export function placementInputFloor(placement, activeFloor) {
  if (activeFloor !== 'all') return activeFloor;
  return CONNECTION_TYPES.includes(placement.entity.type) && placement.start ? placement.entity.toFloor : placement.entity.floor;
}

export function placementLimit(project, type) {
  if (project.entities.length >= 600) return '当前方案对象总数已达上限';
  if (type === 'text' && project.entities.filter(e => e.type === 'text').length >= 200) return '当前方案最多支持 200 个文字对象';
  if (!['train', 'text'].includes(type) && project.entities.filter(e => !['train', 'text'].includes(e.type)).length >= 200) return '当前方案最多支持 200 个构件';
  return '';
}

export function repeatPlacementEntity(draft, placed, id) {
  const next = structuredClone(placed);
  next.id = id;
  for (const key of ['snapEdge', 'snapped', 'drawMode']) delete next[key];
  if (CONNECTION_TYPES.includes(next.type)) {
    // The stored mesh is normalized bottom-up; repeat in the user's picking order.
    next.floor = draft.floor;
    next.toFloor = draft.toFloor;
    if(next.type==='stairs'){delete next.stairPath;delete next.landingDepth;next.stairShape=draft.stairShape||'straight';}
  }
  if (next.type === 'track') {
    next.drawMode = draft.drawMode || 'straight';
    for (const key of ['path', 'pathKind', 'pathSmoothness', 'joins']) delete next[key];
  }
  if (next.type === 'train') { delete next.trackId; next.trainOffset = 0; }
  return next;
}

export function twoPointPlacement(project, source, first, pointer, options = {}) {
  const invalidInput = ![first.x,first.z,pointer.x,pointer.z].every(Number.isFinite);
  const track = source.type === 'track';
  // Rail contacts retain exact curve coordinates instead of rounding them back onto the grid.
  const start = options.prepared || first.snapped || first.aligned ? { x: first.x, z: first.z } : placementPoint(first);
  const point = options.prepared ? { ...pointer } : track ? snapRailPoint(project, source, placementPoint(pointer)) : pointer.aligned ? { ...pointer } : placementPoint(pointer);
  if (track) source = inheritTrackStyle(project, source, first, point);
  const dx = point.x - start.x, dz = point.z - start.z;
  const connection = placementConnection(project, source);
  const elevator = source.type === 'elevator';
  let target, end, minimum = 2, error = '', snapTarget;
  if (elevator) {
    const l = Math.abs(dx), d = Math.abs(dz);
    end = point;
    target = { ...source, x: (start.x + end.x) / 2, z: (start.z + end.z) / 2, l: Math.max(.5, l), d: Math.max(.5, d), rotation: 0 };
    if (l < 2 || d < 2) error = '井道长宽均至少 2 m';
    else if (l > 12 || d > 12) error = '井道长宽均不能超过 12 m';
  } else {
    const alongX = Math.abs(dx) >= Math.abs(dz);
    // Prepared points already satisfy the drawing constraint, including a
    // parallel/perpendicular guide at an arbitrary angle.
    end = !track || point.snapped || options.prepared && point.aligned ? { x: point.x, z: point.z } : alongX ? { x: point.x, z: start.z } : { x: start.x, z: point.z };
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    const rotation = (Math.atan2(end.z - start.z, end.x - start.x) * 180 / Math.PI + 360) % 360;
    target = { ...source, x: (start.x + end.x) / 2, z: (start.z + end.z) / 2, l: Math.max(.5, Math.min(500, length)), rotation };
    if (connection && source.type !== 'track') {
      const angle = source.type === 'escalator' ? 35 : 45;
      minimum = Math.max(2, Math.ceil(connection.rise / Math.tan(angle * Math.PI / 180) * 2 - 1e-8) / 2);
    }
    if (length < minimum) error = `长度至少 ${minimum} m${source.type === 'stairs' ? '（坡度不超过 45°）' : source.type === 'escalator' ? '（坡度不超过 35°）' : ''}`;
    else if (length > 500) error = '长度不能超过 500 m';
    if (track && (first.snapped || point.snapped)) {
      snapTarget = { ...(point.snapped ? point : first), floor: source.floor };
    } else if (track && !options.prepared) {
      const snapped = snapTrack(project, target);
      // Lateral snapping translates both ends together and keeps the chosen length.
      const shift = { x: snapped.x - target.x, z: snapped.z - target.z };
      start.x += shift.x; start.z += shift.z; end.x += shift.x; end.z += shift.z;
      target = { ...target, x: snapped.x, z: snapped.z };
      if (snapped.snapped) target.snapEdge = snapped.snapEdge;
    }
  }
  if (CONNECTION_TYPES.includes(source.type)) {
    if (!connection) error = '请选择两个不同的楼层';
    else {
      target.h = Math.max(.5, connection.rise + (elevator ? 4 : 0));
      if (connection.descending) {
        target.floor = source.toFloor; target.toFloor = source.floor;
        if (!elevator) target.rotation = (target.rotation + 180) % 360;
      }
      if(target.h>500)error='连接高度不能超过 500 m';
    }
  }
  if(target.type==='stairs'&&['turn','return'].includes(source.stairShape)&&!invalidInput&&target.l>=2){
    target=stairPreset(target,source.stairShape);error=stairPathError(target,{slope:true});
    if(!connection)error='请选择两个不同的楼层';
    else if(target.h>500)error='连接高度不能超过 500 m';
  }
  if (invalidInput || ![start.x, start.z, end.x, end.z].every(v => Number.isFinite(v) && Math.abs(v) <= 500)) error = '放置范围需在 ±500 m 内';
  delete target.stairShape;
  const dimensions = elevator ? `${target.l} × ${target.d} m · 竖直井道` : `${Number(Math.hypot(end.x - start.x, end.z - start.z).toFixed(2))} m · ${Number(target.rotation.toFixed(1))}°`;
  return { entity: target, start, end, snapTarget, valid: !error, message: error || dimensions, dimensions, minimum };
}
