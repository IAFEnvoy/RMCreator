import { makeTrackPath, trackPathError } from './track-path.js';

// A snapped start owns the new rail's style; an end contact is a fallback.
export function inheritTrackStyle(project, source, ...contacts) {
  const host = contacts.map(p => p?.snapped && project.entities.find(t => t.type === 'track' && t.id === p.trackId && t.floor === source.floor)).find(Boolean);
  if (!host) return source;
  const result = { ...source, lineId: host.lineId, color: host.color, bandVisible: host.bandVisible !== false };
  if (host.bandColor) result.bandColor = host.bandColor;
  else delete result.bandColor;
  return result;
}

export function changeTrackMode(placement, mode) {
  if (placement?.entity.type !== 'track' || !['straight', 'curve', 'connector'].includes(mode)) return false;
  if (placement.trackMode === mode) return false;
  // Keep the curve's control points when temporarily trying another drawing mode.
  const start = placement.points?.[0] || placement.start;
  placement.start = start;
  if (mode === 'curve' && !placement.points?.length) placement.points = start ? [{ ...start }] : [];
  placement.trackMode = mode;
  placement.entity.drawMode = mode;
  placement.result = null;
  placement.point = null;
  return true;
}

export const MAX_CURVE_POINTS = 31;
export function curveDrawingState(count) {
  const completeCount = count >= 3 ? count - (count % 2 === 0 ? 1 : 0) : 0;
  return { nextRole: !count ? 'start' : count % 2 ? 'control' : 'end', completeCount,
    segments: completeCount ? (completeCount - 1) / 2 : 0,
    canFinish: count >= 3 && count % 2 === 1, canAdd: count < MAX_CURVE_POINTS };
}

// Unconfirmed control points stay in the guide; only complete three-point segments become rails.
export function curveDraft(source, points, cursor = null) {
  const state = curveDrawingState(points.length), previewPoints = cursor && state.nextRole === 'end' ? [...points, cursor] : points.slice(0, state.completeCount);
  const entity = previewPoints.length ? makeTrackPath(source, previewPoints, 'quadratic') : null;
  let message = '';
  if (cursor) {
    if (!state.canAdd) message = '最多绘制 15 段曲线，请完成当前轨道';
    else if (![cursor.x, cursor.z].every(n => Number.isFinite(n) && Math.abs(n) <= 500)) message = '路径点需在 ±500 m 范围内';
    else if (points.length && Math.hypot(cursor.x - points.at(-1).x, cursor.z - points.at(-1).z) < .1) message = '控制点与端点不能重合';
  }
  message ||= entity ? trackPathError(entity) : '';
  return { ...state, entity, valid: !message, message,
    guide: cursor && state.canAdd ? [...points, cursor] : points };
}
