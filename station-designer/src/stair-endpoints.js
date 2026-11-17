import { worldPoint } from './track-path.js';
import { twoPointPlacement } from './placement.js';

export const isStair = object => ['stairs','escalator'].includes(object?.type);

// Derive endpoints from the canonical transform so old files, duplication and
// edits through length/rotation always agree with the endpoint editor.
export function stairEndpoints(object) {
  if(!isStair(object))return [];
  return [
    {...worldPoint(object,{x:-object.l/2,z:0}),floor:object.floor},
    {...worldPoint(object,{x:object.l/2,z:0}),floor:object.toFloor||''},
  ];
}

export function editStairEndpoint(project,source,index,patch) {
  const fail=message=>({valid:false,message});
  if(!isStair(source)||![0,1].includes(index))return fail('请选择楼梯或自动扶梯的端点');
  const endpoints=stairEndpoints(source);endpoints[index]={...endpoints[index],...patch};
  const [start,end]=endpoints;
  if(!endpoints.every(p=>[p.x,p.z].every(v=>Number.isFinite(v)&&Math.abs(v)<=500)))return fail('端点坐标需在 ±500 m 内');
  if(!project.floors.some(f=>f.id===start.floor)||end.floor&&!project.floors.some(f=>f.id===end.floor))return fail('请选择有效楼层');
  if(end.floor===start.floor)return fail('两个端点需位于不同楼层');
  const template={...source,floor:start.floor};
  if(end.floor){
    template.toFloor=end.floor;
    return twoPointPlacement(project,template,start,end,{prepared:true});
  }
  delete template.toFloor;
  const length=Math.hypot(end.x-start.x,end.z-start.z),angle=source.type==='escalator'?35:45;
  const minimum=Math.max(2,Math.ceil(source.h/Math.tan(angle*Math.PI/180)*2-1e-8)/2);
  const error=length<minimum?`长度至少 ${minimum} m（坡度不超过 ${angle}°）`:length>500?'长度不能超过 500 m':'';
  return {entity:{...template,x:(start.x+end.x)/2,z:(start.z+end.z)/2,l:Math.max(.5,Math.min(500,length)),rotation:(Math.atan2(end.z-start.z,end.x-start.x)*180/Math.PI+360)%360},start,end,valid:!error,message:error};
}
