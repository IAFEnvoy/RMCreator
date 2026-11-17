import polygonClipping from 'polygon-clipping';
import { polygonEdges, zoneMasks } from './zone-geometry.js';
import { clipToRect } from './zones.js';
import { connectionFloors } from './placement.js';
import { isStair, stairEndpoints } from './stair-endpoints.js';
import { stairWorldNodes } from './stair-path.js';

const contactTolerance = .08;

function floorPassages(project, floor) {
  const passages = [];
  for (const e of project.entities) {
    if (!e.visible) continue;
    const angle = (e.rotation || 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    if (isStair(e)) {
      const reach = Math.min(e.l / 2, Math.max(1, e.d));
      stairEndpoints(e).forEach((end, index) => {
        if (end.floor !== floor) return;
        const nodes=stairWorldNodes(e),a=index?nodes.at(-2):nodes[0],b=index?nodes.at(-1):nodes[1],angle=Math.atan2(b.z-a.z,b.x-a.x),c=Math.cos(angle),s=Math.sin(angle);
        const x = (index ? -1 : 1) * (reach - contactTolerance) / 2;
        passages.push({ x: end.x + c * x, z: end.z + s * x, l: reach + contactTolerance, d: e.d, rotation: angle*180/Math.PI, axis: { x: c, z: s } });
      });
    } else if (e.type === 'elevator' && connectionFloors(project, e).includes(floor)) {
      // The cabin door faces local +Z; the other three shaft walls stay closed.
      const reach = Math.min(e.d / 2, 1), z = e.d / 2 - (reach - contactTolerance) / 2;
      passages.push({ x: e.x - s * z, z: e.z + c * z, l: Math.min(e.l, 2.24), d: reach + contactTolerance, rotation: e.rotation, axis: { x: -s, z: c } });
    }
  }
  return passages;
}

export function floorOutlineEdges(project, floor, masks = zoneMasks(project, floor)) {
  // Colors meet without a wall. Draw the perimeter of the connected public floor,
  // while actual barriers remain the responsibility of railings and screen doors.
  const fills = [masks.paid, masks.unpaid].filter(mask => mask.length);
  if (!fills.length) return [];
  const edges = polygonEdges(polygonClipping.union(...fills)), passages = floorPassages(project, floor);
  return edges.flatMap(edge => {
    const dx = edge.x2 - edge.x1, dz = edge.z2 - edge.z1, length = Math.hypot(dx, dz);
    let intervals = [[0, 1]];
    for (const passage of passages) {
      // Do not erase the long sides of a stairwell when opening its landing.
      if (Math.abs(dx * passage.axis.z - dz * passage.axis.x) / length < .01) continue;
      const cut = clipToRect(edge, passage, 0);
      if (!cut) continue;
      intervals = intervals.flatMap(([a, b]) => cut.end <= a || cut.start >= b ? [[a, b]] : [
        ...(cut.start > a ? [[a, cut.start]] : []), ...(cut.end < b ? [[cut.end, b]] : []),
      ]);
    }
    return intervals.filter(([a, b]) => (b - a) * length > .001).map(([a, b]) => ({
      x1: edge.x1 + dx * a, z1: edge.z1 + dz * a, x2: edge.x1 + dx * b, z2: edge.z1 + dz * b,
    }));
  });
}
