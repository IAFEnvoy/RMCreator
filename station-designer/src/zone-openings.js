import polygonClipping from 'polygon-clipping';
import { corner, zonePathError } from './zone-path.js';
import { zoneMasks, pathPolygon, polygonArea, rectPolygon } from './zone-geometry.js';
import { CONNECTION_TYPES, connectionFloors } from './placement.js';

export function rectangularOpening(source,a,b) {
  return {...source,closed:true,vertices:[a,{x:b.x,z:a.z},b,{x:a.x,z:b.z}].map(corner)};
}

export function openingError(project,path) {
  const error=zonePathError(path);if(error)return error;
  if(!path.closed)return '';
  const base={...project,zonePaths:(project.zonePaths||[]).filter(p=>p.id!==path.id)};
  const masks=zoneMasks(base,path.floor),polygon=pathPolygon(path);
  return Object.values(masks).some(mask=>mask.length&&polygonArea(polygonClipping.intersection(mask,polygon))>=.1)?'':'孔洞需与本层的填色区域相交';
}

// Create independent, editable contours on the landings and intermediate floors.
export function connectionOpeningPaths(project,entity,idPrefix) {
  if(!entity?.toFloor||!CONNECTION_TYPES.includes(entity.type))return [];
  const lower=project.floors.find(f=>f.id===entity.floor),upper=project.floors.find(f=>f.id===entity.toFloor);
  if(!lower||!upper)return [];
  const lowFloor=lower.elevation<=upper.elevation?lower.id:upper.id;
  const footprint={...entity,l:Math.max(.4,entity.l-.8),d:Math.max(.4,entity.d-.8)};
  const vertices=rectPolygon(footprint)[0][0].slice(0,-1).map(([x,z])=>corner({x,z}));
  return connectionFloors(project,entity).filter(floor=>floor!==lowFloor).map((floor,i)=>({id:`${idPrefix}-${i}`,floor,kind:'opening',closed:true,vertices:structuredClone(vertices)})).filter(path=>!openingError(project,path));
}
