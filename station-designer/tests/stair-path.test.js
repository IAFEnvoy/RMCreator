import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { entity, defaultProject, isProject, migrateProject } from '../src/project.js';
import { stairWorldNodes, stairRoute, stairRoutePoint, stairPathError, makeStairPath, stairPreset, moveStairPoint, insertStairPoint, removeStairPoint, stairFootprint } from '../src/stair-path.js';
import { normalizeConnection, twoPointPlacement, repeatPlacementEntity } from '../src/placement.js';
import { stairEndpoints, editStairEndpoint } from '../src/stair-endpoints.js';
import { polygonContains, cutOpenings, rectPolygon, polygonArea } from '../src/zone-geometry.js';
import { connectionOpeningPaths } from '../src/zone-openings.js';
import { buildBentStair } from '../src/stair-model.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const fixture=()=>({...defaultProject(),floors:[{id:'B3',elevation:-12,code:'B3',name:'下层'},...defaultProject().floors]});
const bent=(extra={})=>makeStairPath(entity('bent','stairs','转弯楼梯',0,0,{floor:'B2',toFloor:'B1',d:4,h:12,landingDepth:4,...extra}),[{x:0,z:0},{x:20,z:0},{x:20,z:20}]);

test('a bent stair keeps exact world points through rotation, endpoint edits and file round trips',()=>{
  for(const rotation of [0,37,90,270]){
    const p=fixture(),e=bent({rotation}),before=structuredClone(e);p.entities=[e];
    assert(isProject(p));assert.deepEqual(stairWorldNodes(migrateProject(JSON.parse(JSON.stringify(p))).entities[0]),stairWorldNodes(e));
    const edited=editStairEndpoint(p,e,1,{x:30,z:25});assert(edited.valid,edited.message);
    const nodes=stairWorldNodes(edited.entity);close(nodes[0].x,0);close(nodes[0].z,0);close(nodes[1].x,20);close(nodes[1].z,0);close(nodes[2].x,30);close(nodes[2].z,25);
    assert.deepEqual(e,before);
  }
});

test('turning and return presets preserve endpoints, create a right angle, and keep passages level',()=>{
  const source=entity('preset','stairs','楼梯',5,8,{l:30,d:4,h:12,rotation:37});
  const turn=stairPreset(source,'turn'),route=stairRoute(turn),[a,m,b]=stairWorldNodes(turn);
  close((a.x-m.x)*(b.x-m.x)+(a.z-m.z)*(b.z-m.z),0);assert.equal(route.segments.length,2);assert.equal(route.landings.length,1);
  for(const shape of ['turn','return']){
    const e=stairPreset(source,shape),nodes=stairWorldNodes(e),ends=stairEndpoints(source);
    for(const [at,index]of [[0,0],[nodes.length-1,1]]){close(nodes[at].x,ends[index].x);close(nodes[at].z,ends[index].z);}
    assert.equal(stairPathError(e,{slope:true}),'');
  }
  const back=stairRoute(stairPreset(source,'return'));assert.equal(back.segments.length,3);assert.equal(back.segments[1].flat,true);
  close(back.segments[1].yFrom,back.segments[1].yTo);close(back.landings[0].y,back.landings[1].y);close(back.segments.at(-1).yTo,12);
});

test('height is distributed only across flights, with continuous level landings in normal and exploded views',()=>{
  const e=bent();
  for(const height of [12,42]){
    const route=stairRoute(e,height);close(route.riseRun,36);close(route.landings[0].y,height/2);
    for(const t of [.46,.5,.54])close(stairRoutePoint(e,t,height).y,height/2);
    close(stairRoutePoint(e,0,height).y,0);close(stairRoutePoint(e,1,height).y,height);
    close(route.segments[0].yTo,route.segments[1].yFrom);
  }
});

test('descending normalization and endpoint-floor edits reverse horizontal-passage flags with their segments',()=>{
  const p=fixture(),source=stairPreset(entity('return','stairs','折返',0,0,{floor:'B1',toFloor:'B2',l:30,d:4,h:12}),'return');
  // An asymmetric passage makes an incorrect point-only reversal observable.
  delete source.stairPath[1].landing;source.stairPath[0].landing=true;
  const before=stairWorldNodes(source),target=normalizeConnection(p,structuredClone(source));
  assert.equal(target.floor,'B2');assert.deepEqual(stairWorldNodes(target).map(p=>[p.x,p.z]),before.map(p=>[p.x,p.z]).reverse());
  assert.deepEqual(stairRoute(target).segments.map(s=>s.flat),[false,false,true]);
  const lower={...source,floor:'B2',toFloor:'B1'},edited=editStairEndpoint(p,lower,1,{floor:'B3'});
  assert(edited.valid,edited.message);assert.equal(edited.entity.floor,'B3');assert.deepEqual(stairRoute(edited.entity).segments.map(s=>s.flat),[false,false,true]);
});

test('bend edits and adding/removing points retain other world points and independent source data',()=>{
  const e=bent(),before=structuredClone(e),moved=moveStairPoint(e,1,{x:22,z:2});
  assert.deepEqual(stairWorldNodes(moved).map(p=>[p.x,p.z]),[[0,0],[22,2],[20,20]]);
  const added=insertStairPoint(e,0);assert.equal(added.stairPath.length,4);close(added.l,e.l);
  assert.deepEqual(stairWorldNodes(removeStairPoint(added,1)),stairWorldNodes(e));assert.deepEqual(e,before);
});

test('validation rejects malformed routes, short landings, overly steep flights and out-of-range imports',()=>{
  const e=bent();
  for(const stairPath of [null,[],[{x:0,z:0}],[{x:0,z:0},{x:NaN,z:0}],[{x:0,z:0},{x:1,z:0},{x:1,z:20}],[{x:0,z:0},{x:501,z:0}],[{x:0,z:0},{x:20,z:0,landing:'yes'}]]){
    assert(stairPathError({...e,stairPath}));const p=fixture();p.entities=[{...e,stairPath}];assert.equal(isProject(p),false);
  }
  const flat={...e,stairPath:e.stairPath.map(p=>({...p,landing:true}))};assert(stairPathError(flat));
  assert(stairPathError({...e,h:37},{slope:true}));assert.equal(stairPathError({...e,h:36},{slope:true}),'');
  assert(stairPathError({...e,landingDepth:21}));assert(stairPathError({...e,type:'escalator'}));
});

test('two-point bent placement validates full flight runs, supports either floor order and repeats its shape',()=>{
  const p=fixture();
  for(const shape of ['turn','return'])for(const down of [false,true]){
    const draft=entity('draft','stairs','楼梯',0,0,{floor:down?'B1':'B2',toFloor:down?'B2':'B1',stairShape:shape,d:4});
    const result=twoPointPlacement(p,draft,{x:0,z:0},{x:30,z:0},{prepared:true});
    assert(result.valid,result.message);assert.equal(result.entity.floor,'B2');assert.equal(result.entity.toFloor,'B1');
    const endpoints=stairEndpoints(result.entity);close(endpoints[0].x,down?30:0);close(endpoints[1].x,down?0:30);
    const next=repeatPlacementEntity(draft,result.entity,'next');assert.equal(next.stairShape,shape);assert.equal(next.stairPath,undefined);assert.equal(next.floor,draft.floor);
  }
  const returnDraft=entity('draft','stairs','楼梯',0,0,{floor:'B2',toFloor:'B1',stairShape:'return',d:3});
  assert(twoPointPlacement(p,returnDraft,{x:0,z:0},{x:6,z:0},{prepared:true}).valid,'a short chord can have enough run in a return stair');
  assert.equal(twoPointPlacement(p,returnDraft,{x:0,z:0},{x:NaN,z:0},{prepared:true}).valid,false);
  assert.equal(twoPointPlacement(p,returnDraft,{x:0,z:0},{x:600,z:0},{prepared:true}).valid,false);
});

test('bent footprints and editable floor holes follow the L rather than cutting its bounding box',()=>{
  const p=fixture(),e=bent(),footprint=stairFootprint(e);
  assert(polygonContains(footprint,{x:10,z:0}));assert(polygonContains(footprint,{x:20,z:10}));assert(!polygonContains(footprint,{x:5,z:15}));
  p.zonePaths=[{id:'area',floor:'B1',kind:'paid',closed:true,vertices:[[-10,-10],[40,-10],[40,40],[-10,40]].map(([x,z])=>({type:'corner',pos:{x,z}}))}];
  const openings=connectionOpeningPaths(p,e,'hole');assert.equal(openings.length,1);assert.equal(openings[0].floor,'B1');
  const remaining=cutOpenings(rectPolygon({x:15,z:15,l:50,d:50}),[e]);
  assert(polygonContains(remaining,{x:5,z:15}));assert(!polygonContains(remaining,{x:10,z:0}));assert(polygonArea(remaining)>2200);
});

test('3D bent stairs have two flights, a level landing and dense steps; plan halves omit the other flight',()=>{
  const e=bent(),material=c=>new THREE.MeshBasicMaterial({color:c});
  const full=buildBentStair(e,42,material),flights=full.children.filter(g=>g.name==='stair-flight');
  assert.equal(flights.length,2);assert(full.getObjectByName('stair-turn-landing'));
  for(const flight of flights){const treads=flight.getObjectByName('stair-step-treads');assert(treads.count>=Math.ceil(21/.18));}
  for(const [range,x,z]of [[{from:0,to:.5},0,10],[{from:.5,to:1},-10,0]]){
    const half=buildBentStair(e,1.6,material,range);assert.equal(half.children.filter(g=>g.name==='stair-flight').length,1);half.updateMatrixWorld(true);
    const ray=new THREE.Raycaster(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0));assert.equal(ray.intersectObject(half,true).length,0,'the opposite flight is absent from the plan half');
  }
});
