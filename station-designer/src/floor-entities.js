import { connectionFloors } from './placement.js';
import { isStair } from './stair-endpoints.js';

export function entityDisplayFloors(project, entity, view) {
  if (view !== 'floor') return [entity.floor];
  const floors = isStair(entity) ? [entity.floor, entity.toFloor] : connectionFloors(project, entity);
  return [...new Set(floors)].filter(id => project.floors.some(f => f.id === id));
}

export function stairPlanRange(entity, floor) {
  if (!isStair(entity)) return null;
  if (floor === entity.floor) return { from: 0, to: .5 };
  if (floor && floor === entity.toFloor) return { from: .5, to: 1 };
  return null;
}
