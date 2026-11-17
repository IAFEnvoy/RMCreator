import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, entity, isProject, migrateProject } from '../src/project.js';
import { curveDrawingState, curveDraft } from '../src/track-drawing.js';
import { makeTrackPath, trackGeometry, projectToTrack, pointAlongTrack, moveTrackKnot, syncTrackPaths, splitQuadraticSegment, removeQuadraticSegment, trackPathError } from '../src/track-path.js';
import { placeTrain, trainCarPose } from '../src/train-placement.js';
import { trainLayout, trackLayout } from '../src/track.js';

const base = () => entity('q','track','三点曲线',0,0,{lineId:'line-1',d:5});
const points = [{x:0,z:0},{x:100,z:0},{x:100,z:100}];
const make = (ps=points) => makeTrackPath(base(),ps,'quadratic');
const project = (...entities) => ({...defaultProject(),entities,zones:{B1:{},B2:{}}});
const close = (a,b,epsilon=1e-7) => assert.ok(Math.abs(a-b)<epsilon,`${a} ≠ ${b}`);

test('three clicks define an exact quadratic with the second point outside the track',()=>{
  const track=make(),geometry=trackGeometry(track),start=geometry.samples[0],end=geometry.samples.at(-1);
  close(start.x,0);close(start.z,0);close(end.x,100);close(end.z,100);
  close(start.tx,1);close(start.tz,0);close(end.tx,0);close(end.tz,1);
  assert.ok(geometry.samples.some(p=>Math.abs(p.x-75)<1e-7&&Math.abs(p.z-25)<1e-7));
  assert.ok(projectToTrack(track,points[1]).distance>30,'the rail must not pass through the control point');
  assert.ok(geometry.length>Math.hypot(100,100)&&geometry.length<200);
  assert.equal(track.pathKind,'quadratic');assert.equal(trackPathError(track),'');
});

test('drawing alternates start/control/end, and never completes with a dangling control point',()=>{
  const roles=['start','control','end','control','end','control'];
  const finishes=[false,false,false,true,false,true];
  roles.forEach((role,i)=>{const state=curveDrawingState(i);assert.equal(state.nextRole,role);assert.equal(state.canFinish,finishes[i]);});
  assert.equal(curveDraft(base(),[],points[0]).entity,null);
  assert.equal(curveDraft(base(),[points[0]],points[1]).entity,null);
  const preview=curveDraft(base(),points.slice(0,2),points[2]);assert.equal(preview.entity.path.length,3);assert.equal(preview.canFinish,false);
  const done=curveDraft(base(),points);assert.equal(done.canFinish,true);assert.equal(done.segments,1);
  const fourth={x:100,z:150},waiting=curveDraft(base(),[...points,fourth]);
  assert.equal(waiting.entity.path.length,3);assert.equal(waiting.canFinish,false);assert.equal(waiting.nextRole,'end');
  assert.deepEqual(curveDraft(base(),points,fourth).entity.path,done.entity.path,'previewing a new control cannot deform finished segments');
  assert.equal(curveDraft(base(),[...points,fourth],{x:150,z:150}).entity.path.length,5);
  assert.equal(curveDraft(base(),[...points,fourth,{x:150,z:150}]).segments,2);
});

test('continued segments share the previous endpoint and preserve each manually chosen control',()=>{
  const track=make([{x:0,z:0},{x:50,z:0},{x:50,z:50},{x:50,z:100},{x:100,z:100}]);
  const geometry=trackGeometry(track),join=geometry.samples.findIndex(p=>Math.abs(p.x-50)<1e-8&&Math.abs(p.z-50)<1e-8);
  assert.ok(join>0);assert.ok(geometry.samples[join-1].tz>.99&&geometry.samples[join+1].tz>.99);
  assert.equal(geometry.samples.filter(p=>Math.hypot(p.x-50,p.z-50)<1e-8).length,1);
  assert.ok(geometry.samples.every((p,i)=>!i||p.s>geometry.samples[i-1].s));
  assert.ok(projectToTrack(track,{x:50,z:0}).distance>10);
  assert.ok(projectToTrack(track,{x:50,z:100}).distance>10);
});

test('dragging a control changes curvature without moving endpoints or snapping the control onto nearby rails',()=>{
  const source=make(),host=entity('host','track','主轨道',40,40,{l:100,lineId:'line-1'}),p=project(source,host);
  const changed=moveTrackKnot(p,source,1,{x:40,z:41});
  assert.deepEqual(changed.path[0],source.path[0]);assert.deepEqual(changed.path[2],source.path[2]);
  assert.deepEqual(changed.path[1],{x:40,z:41});assert.equal(changed.joins.start,undefined);
  assert.notEqual(changed.l,source.l);
  const linked=moveTrackKnot(p,source,0,{x:10,z:41});assert.equal(linked.joins.start.trackId,'host');
  assert.deepEqual(linked.path[1],source.path[1]);assert.equal(linked.path[0].tx,undefined);
  host.z=45;p.entities=[host,linked];syncTrackPaths(p);close(linked.path[0].z,45);
  assert.deepEqual(linked.path[1],source.path[1]);
});

test('splitting a quadratic preserves the curve and removing segments preserves correct endpoint links',()=>{
  const source=make(),split=splitQuadraticSegment(source,0);
  assert.equal(split.path.length,5);assert.deepEqual(split.path[2],{x:75,z:25});
  for(const sample of trackGeometry(source).samples)assert.ok(projectToTrack(split,sample).distance<.003);
  close(split.l,source.l,.003);
  split.joins={start:{trackId:'a',t:0,reverse:false},end:{trackId:'b',t:1,reverse:false}};
  const removedFirst=removeQuadraticSegment(split,0),removedLast=removeQuadraticSegment(split,1);
  assert.deepEqual(removedFirst.path,split.path.slice(2));assert.equal(removedFirst.joins.start,undefined);assert.ok(removedFirst.joins.end);
  assert.deepEqual(removedLast.path,split.path.slice(0,3));assert.equal(removedLast.joins.end,undefined);assert.ok(removedLast.joins.start);
  assert.deepEqual(removeQuadraticSegment(source,0),source);
});

test('unfinished, collapsed and reversing curves fail validation; a draft cannot exceed 15 segments',()=>{
  assert.equal(trackPathError(make([{x:-1,z:0},{x:0,z:0},{x:1,z:0}])),'','a minimum-length straight track must still be editable as a curve');
  for(const path of [points.slice(0,2),[...points,{x:100,z:200}],points.map(()=>({x:0,z:0})),[{x:0,z:0},{x:100,z:0},{x:50,z:0}],
    [{x:0,z:0},{x:100,z:100},{x:0,z:0}]])assert.ok(trackPathError({...base(),pathKind:'quadratic',path}));
  assert.equal(curveDraft(base(),[points[0]],{x:0,z:0}).valid,false);
  assert.equal(curveDraft(base(),[],{x:501,z:0}).valid,false);
  const full=Array.from({length:31},(_,i)=>({x:i*4,z:0})),state=curveDraft(base(),full,{x:130,z:0});
  assert.equal(state.canAdd,false);assert.equal(state.canFinish,true);assert.match(state.message,/15 段/);
  assert.ok(trackPathError({...make(),pathKind:'unknown'}));
});

test('quadratic paths persist with old spline and straight tracks without changing existing shapes',()=>{
  const q=make(),legacy=makeTrackPath({...base(),id:'legacy'},[{x:-150,z:0},{x:0,z:30},{x:150,z:0}]),straight={...base(),id:'straight'};
  const p=project(q,legacy,straight);assert.equal(isProject(p),true);
  assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(p))),p);
  const bad=structuredClone(p);bad.entities[0].path.push({x:1,z:2});assert.equal(isProject(bad),false);
});

test('trains use the quadratic rail rather than its control polygon for position, heading and capacity',()=>{
  const track=make([{x:-120,z:0},{x:0,z:0},{x:120,z:60}]),p=project(track),center=pointAlongTrack(track,track.l/2,true);
  const placed=placeTrain(p,entity('train','train','列车',0,0,{trainPreset:'custom',trainCars:2}),center);
  assert.equal(placed.valid,true);
  const poses=trainLayout(placed.entity).cars.map(spec=>trainCarPose(placed.entity,track,spec,trackLayout(p,track).forward));
  poses.forEach(pose=>assert.ok(projectToTrack(track,pose.world).distance<1e-6));
  assert.ok(Math.abs(poses[0].worldAngle-poses[1].worldAngle)>1);
});
