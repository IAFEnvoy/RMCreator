import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { registerHooks } from 'node:module';
import { defaultProject, entity, isProject, migrateProject } from '../src/project.js';
import { makeTrackPath, pointAlongTrack, trackGeometry, worldPoint } from '../src/track-path.js';
import { connectedTrainRoute, pointAlongTrainRoute, routeIntervals } from '../src/train-route.js';
import { placeTrain, trainOnTrack, trainFit, trainCarPose, syncTrains, trainEditError, removeWithTrains, trainsOnTrack } from '../src/train-placement.js';
import { trainLayout } from '../src/track.js';
import { buildTrain } from '../src/train.js';

registerHooks({load(url,context,next){return url.includes('.svg')?{format:'module',source:'export default "<svg></svg>"',shortCircuit:true}:next(url,context);}});
const {StationScene}=await import('../src/scene.js');

const rail=(id,x=0,z=0,l=70,extra={})=>entity(id,'track',id,x,z,{l,d:5,lineId:'line-1',...extra});
const draft=(id='train',extra={})=>entity(id,'train',id,0,0,{trainPreset:'custom',trainCars:6,...extra});
const project=(...tracks)=>({...defaultProject(),snapping:false,entities:tracks});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

test('full-size coupled trains span multiple touching rails, including reversed rail directions',()=>{
  for(const rotation of [0,37,90,180,270]){
    const a=rail('a',0,0,70,{rotation}),pos=x=>worldPoint(a,{x,z:0});
    const b=rail('b',...Object.values(pos(70)),70,{rotation:rotation+180}),c=rail('c',...Object.values(pos(140)),70,{rotation});
    const p=project(a,b,c),result=placeTrain(p,draft('train',{trainCars:4,trainUnits:2}),pos(70));
    assert.equal(result.valid,true);assert.match(result.message,/跨 3 段轨道/);close(result.entity.l,160.8);
    close(result.entity.x,b.x);close(result.entity.z,b.z);assert.equal(result.entity.trackId,'b');
    p.entities.push(result.entity);assert.ok(isProject(p));assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(p))),p);
    const route=connectedTrainRoute(p,b);close(route.length,210);
    assert.equal(new Set(route.segments.map(s=>s.track.id)).size,3);
  }
});

test('rigid carriages follow straight-curve-reversed-straight transitions in either cab direction',()=>{
  const a=rail('a',-65,0,70),b=makeTrackPath(rail('curve'),[{x:-30,z:0},{x:30,z:0},{x:30,z:60}],'quadratic');
  const c=rail('c',30,100,80,{rotation:270}),p=project(a,b,c),e=trainOnTrack(p,draft(),b);
  p.entities.push(e);assert.ok(trainFit(p,e).valid);
  const route=connectedTrainRoute(p,b),layout=trainLayout(e);
  for(const forward of [true,false]){
    const model=buildTrain(e,e.color,forward,null,spec=>trainCarPose(e,b,spec,forward,route));
    const group=new THREE.Group();group.position.set(e.x,0,e.z);group.rotation.y=-e.rotation*Math.PI/180;group.add(model);group.updateMatrixWorld(true);
    const cars=model.children.filter(c=>c.userData.carriage),trackIds=new Set();
    cars.forEach((car,i)=>{
      const expected=pointAlongTrainRoute(route,route.origin+(forward?1:-1)*layout.cars[i].center),actual=car.getWorldPosition(new THREE.Vector3());
      close(actual.x,expected.x);close(actual.z,expected.z);trackIds.add(expected.trackId);
      assert.ok(Number.isFinite(car.rotation.y));
    });
    assert.equal(trackIds.size,3);assert.ok(new Set(cars.map(c=>c.rotation.y.toFixed(3))).size>1);
  }
});

test('gaps, other floors, parallel rails and interior-only crossings do not add capacity',()=>{
  const a=rail('a',0,0,70);
  for(const b of [rail('b',71),rail('b',70,0,70,{floor:'B1'}),rail('b',0,6),rail('b',0,0,70,{rotation:90})]){
    const p=project(a,b);close(connectedTrainRoute(p,a).length,70);assert.equal(placeTrain(p,draft(),a).valid,false);
  }
});

test('endpoint-to-interior turnout contacts split the host and prefer the smoothest continuation',()=>{
  const host=rail('host',0,0,240),branch=makeTrackPath(rail('branch'),[{x:0,z:0},{x:-30,z:0},{x:-60,z:50}],'quadratic');
  const p=project(host,branch),route=connectedTrainRoute(p,branch);
  close(route.length,120+trackGeometry(branch).length);
  const first=pointAlongTrainRoute(route,0);close(first.x,120);close(first.z,0);
  close(connectedTrainRoute(p,host).length,240); // Mainline stays on the mainline.
  const e=trainOnTrack(p,draft(),branch,10-trackGeometry(branch).length/2);assert.equal(trainFit(p,e).valid,true);
  assert.equal(new Set(trainFit(p,e).intervals.map(i=>i.track.id)).size,2);
  const forward=rail('forward',155,0,70),diverge=makeTrackPath(rail('diverge'),[{x:120,z:0},{x:155,z:0},{x:155,z:40}],'quadratic');
  const fork=project(host,diverge,forward),ids=p=>connectedTrainRoute(p,host).segments.map(s=>s.track.id);
  assert.deepEqual(ids(fork),['host','forward']);fork.entities.reverse();assert.deepEqual(ids(fork),['host','forward']);
});

test('width is checked on every occupied rail, without restricting the train by unused distant rails',()=>{
  const a=rail('a',0,0,100),b=rail('b',100,0,100,{d:2}),p=project(a,b);
  assert.equal(placeTrain(p,draft('short',{trainCars:2}),a).valid,true);
  const spanning=trainOnTrack(p,draft('train',{trainCars:2}),a,40);
  assert.match(trainFit(p,spanning).message,/宽度不足/);
  b.d=5;assert.ok(trainFit(p,spanning).valid);
  b.x+=1;assert.match(trainFit(p,spanning).message,/超出轨道/); // Rebuild cached topology after editing.
});

test('different anchor rails still share occupancy and require a metre between trains',()=>{
  const a=rail('a',0,0,100),b=rail('b',100,0,100),p=project(a,b);
  const first=trainOnTrack(p,draft('first',{trainCars:2}),a,40);p.entities.push(first);first.visible=false;
  const second=trainOnTrack(p,draft('second',{trainCars:2}),b,-20);
  assert.match(trainFit(p,second).message,/已有列车/);
  second.trainOffset=-19;assert.ok(trainFit(p,second).valid);
  second.trainOffset=-19.01;assert.equal(trainFit(p,second).valid,false);
  const branch=makeTrackPath(rail('branch'),[{x:50,z:0},{x:80,z:0},{x:110,z:40}],'quadratic');p.entities.push(branch);
  const onBranch=trainOnTrack(p,draft('branch-train',{trainCars:2}),branch,-trackGeometry(branch).length/2+5);
  assert.match(trainFit(p,onBranch).message,/已有列车/);
});

test('removing or disconnecting any occupied rail is handled together with the spanning train',()=>{
  const a=rail('a'),b=rail('b',70),c=rail('c',140),p=project(a,b,c),e=trainOnTrack(p,draft(),b);
  p.entities.push(e);assert.deepEqual(trainsOnTrack(p,a.id).map(e=>e.id),['train']);
  const disconnected=structuredClone(p);disconnected.entities[0].x-=5;syncTrains(disconnected);
  assert.match(trainEditError(p,disconnected),/轨道/);
  const narrow=structuredClone(p);narrow.entities[2].d=2;syncTrains(narrow);assert.match(trainEditError(p,narrow),/宽度不足/);
  removeWithTrains(p,a.id);assert.equal(p.entities.some(t=>t.id===e.id),false);assert.ok(isProject(p));
});

test('closed rail loops wrap at their seam, count capacity once and retain occupancy',()=>{
  const tracks=[rail('a',25,0,50),rail('b',50,25,50,{rotation:90}),rail('c',25,50,50,{rotation:180}),rail('d',0,25,50,{rotation:270})];
  const p=project(...tracks),route=connectedTrainRoute(p,tracks[0]);assert.equal(route.loop,true);close(route.length,200);
  const e=trainOnTrack(p,draft('train',{trainCars:6}),tracks[0]);p.entities.push(e);assert.equal(trainFit(p,e).valid,true);
  const a=pointAlongTrainRoute(route,route.origin-20),b=pointAlongTrainRoute(route,route.origin-20+200);close(a.x,b.x);close(a.z,b.z);
  close(routeIntervals(route,170,230).reduce((sum,i)=>sum+i.end-i.start,0),60);
  assert.equal(trainFit(p,trainOnTrack(p,draft('long',{trainCars:12}),tracks[0])).valid,false);
  assert.match(trainFit(p,trainOnTrack(p,draft('overlap',{trainCars:2}),tracks[1])).message,/已有列车/);
});

test('the actual scene renderer and placement preview bend trains anchored on a straight rail',()=>{
  const a=rail('straight',0,0,80),b=makeTrackPath(rail('curve'),[{x:40,z:0},{x:100,z:0},{x:100,z:60}],'quadratic');
  const p=project(a,b),e=trainOnTrack(p,draft(),a,25),route=connectedTrainRoute(p,a);assert.ok(trainFit(p,e).valid);
  const s=Object.create(StationScene.prototype);Object.assign(s,{project:p,isPreview:true,mat:color=>new THREE.MeshStandardMaterial({color})});
  for(const forward of [true,false]){
    e.trainFacing=forward?'inherit':'reverse';
    const group=new THREE.Group();group.position.set(e.x,0,e.z);group.rotation.y=-e.rotation*Math.PI/180;s.buildEntity(group,e);group.updateMatrixWorld(true);
    const cars=group.children[0].children.filter(c=>c.userData.carriage),layout=trainLayout(e);
    cars.forEach((car,i)=>{
      const expected=pointAlongTrainRoute(route,route.origin+e.trainOffset+(forward?1:-1)*layout.cars[i].center),actual=car.getWorldPosition(new THREE.Vector3());
      close(actual.x,expected.x);close(actual.z,expected.z);
    });
    assert.ok(cars.some(c=>Math.abs(c.rotation.y)>.01));
  }
});
