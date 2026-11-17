import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, entity, migrateProject } from '../src/project.js';
import { stairEndpoints, editStairEndpoint } from '../src/stair-endpoints.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const samePoint=(a,b)=>{close(a.x,b.x);close(a.z,b.z);assert.equal(a.floor,b.floor);};
const fixture=()=>({...defaultProject(),floors:[{id:'B3',elevation:-12,code:'B3',name:'下层'},...defaultProject().floors]});
const stairs=(extra={})=>entity('stairs-test','stairs','楼梯',10,20,{floor:'B2',toFloor:'B1',l:30,rotation:37,...extra});

test('existing rotated stairs derive two editable endpoints from their current transform without migration',()=>{
  const project=fixture();
  for(const rotation of [0,37,90,180,270,345]){
    const source=stairs({rotation}),before=structuredClone(source),[start,end]=stairEndpoints(source);
    close((start.x+end.x)/2,source.x);close((start.z+end.z)/2,source.z);close(Math.hypot(end.x-start.x,end.z-start.z),30);
    assert.equal(start.floor,'B2');assert.equal(end.floor,'B1');assert.deepEqual(source,before);
    project.entities=[source];const saved=migrateProject(JSON.parse(JSON.stringify(project))).entities[0];
    samePoint(stairEndpoints(saved)[0],start);samePoint(stairEndpoints(saved)[1],end);
  }
});

test('editing either endpoint keeps the other fixed and preserves width, appearance, ID and name',()=>{
  const project=fixture();
  for(const type of ['stairs','escalator'])for(const index of [0,1]){
    const source=stairs({type}),before=structuredClone(source),original=stairEndpoints(source),sign=index?1:-1,point={x:original[index].x+12.137*sign,z:original[index].z+15.234*sign};
    const result=editStairEndpoint(project,source,index,point);assert.equal(result.valid,true,result.message);
    const ends=stairEndpoints(result.entity);samePoint(ends[1-index],original[1-index]);close(ends[index].x,point.x);close(ends[index].z,point.z);
    for(const key of ['id','name','type','color','d','visible'])assert.equal(result.entity[key],source[key]);assert.deepEqual(source,before);
  }
});

test('changing endpoint floors supports multiple levels and descending connections without moving either point',()=>{
  const project=fixture(),source=stairs({l:80}),original=stairEndpoints(source);
  const multi=editStairEndpoint(project,source,0,{floor:'B3'});assert.equal(multi.valid,true);assert.equal(multi.entity.h,24);
  const down=editStairEndpoint(project,source,1,{floor:'B3'});assert.equal(down.valid,true);assert.equal(down.entity.floor,'B3');assert.equal(down.entity.toFloor,'B2');
  const ends=stairEndpoints(down.entity);samePoint(ends[0],{...original[1],floor:'B3'});samePoint(ends[1],original[0]);
  const same=editStairEndpoint(project,source,0,{floor:'B1'});assert.equal(same.valid,false);
});

test('endpoints stay in sync after whole-object moves, rotation, resizing, cloning and file reload',()=>{
  const project=fixture(),source=stairs(),edited=editStairEndpoint(project,source,1,{x:60,z:55}).entity;
  const moved={...edited,id:'copy',x:edited.x+10,z:edited.z-7,l:70,rotation:90};
  const [start,end]=stairEndpoints(moved);close(start.x,moved.x);close(end.x,moved.x);close(start.z,moved.z-35);close(end.z,moved.z+35);
  project.entities=[moved];const loaded=migrateProject(JSON.parse(JSON.stringify(project))).entities[0];assert.deepEqual(stairEndpoints(loaded),[start,end]);
});

test('legacy stairs with custom height keep their height and can reconnect to a real floor',()=>{
  const project=fixture(),source=stairs({toFloor:undefined,h:6,l:20});
  const original=stairEndpoints(source),result=editStairEndpoint(project,source,1,{x:original[1].x+15});
  assert.equal(result.valid,true);assert.equal(result.entity.toFloor,undefined);assert.equal(result.entity.h,6);samePoint(stairEndpoints(result.entity)[0],original[0]);
  const connected=editStairEndpoint(project,result.entity,1,{floor:'B1'});assert.equal(connected.valid,true);assert.equal(connected.entity.h,12);
  const custom=editStairEndpoint(project,connected.entity,1,{floor:''});assert.equal(custom.valid,true);assert.equal(custom.entity.toFloor,undefined);assert.equal(custom.entity.h,12);
});

test('invalid endpoint edits reject steep stairs, overlong runs, missing floors and non-finite coordinates',()=>{
  const project=fixture(),source=stairs(),start=stairEndpoints(source)[0];
  for(const patch of [{x:start.x+1,z:start.z},{x:501},{x:NaN},{z:Infinity},{floor:'missing'},{floor:'B2'}])assert.equal(editStairEndpoint(project,source,1,patch).valid,false);
  const wide=stairs({x:0,z:0,rotation:0,l:500});assert.equal(editStairEndpoint(project,wide,1,{x:400}).valid,false);
  const custom=stairs({toFloor:undefined,l:30,h:20});assert.equal(editStairEndpoint(project,custom,1,{...stairEndpoints(custom)[0],x:0}).valid,false);
});
