import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { defaultProject, entity, isProject, migrateProject } from '../src/project.js';
import { trainLayout } from '../src/track.js';
import { buildTrain } from '../src/train.js';
import { trainOnTrack, placeTrain, trainFit, syncTrains, trainEditError, removeWithTrains } from '../src/train-placement.js';
import { TRAIN_PRESETS, chooseTrainPreset, trainDimensions, editTrainDimension } from '../src/train-presets.js';

const draft = (id='train-1', extra={}) => entity(id,'train','列车',0,0,{trainPreset:'custom',trainCars:6,...extra});
const attach = (project, train, track=project.entities[0], offset=0) => {
  const placed=trainOnTrack(project,train,track,offset);project.entities.push(placed);return placed;
};

test('legacy track trains migrate once into independently saved decorations without losing oversized formations', () => {
  const project=defaultProject(), track=project.entities[0];
  assert.deepEqual(migrateProject(project),project);
  track.trainEnabled=true;track.trainCars=12;track.trainUnits=4;
  const restored=migrateProject(project), train=restored.entities.find(e=>e.type==='train');
  assert.equal(train.trackId,track.id);assert.equal(train.trainCars,12);assert.equal(train.trainUnits,4);
  assert.equal(trainLayout(train).scale,1);assert.equal(trainFit(restored,train).valid,false);
  assert.equal(restored.entities[0].trainEnabled,undefined);
  assert.deepEqual(migrateProject(restored),restored);
  const bad=structuredClone(restored);bad.entities.find(e=>e.type==='train').trackId='missing';
  assert.equal(isProject(bad),false);
});

test('placement checks actual formation length, width, clearances, floor and visible track', () => {
  const project=defaultProject(), track=project.entities[0];
  for(const rotation of [0,90,180,270,37]){
    track.rotation=rotation;
    const result=placeTrain(project,draft(),{x:track.x,z:track.z});
    assert.equal(result.valid,true);assert.equal(result.entity.rotation,rotation);
    const layout=trainLayout(result.entity);
    assert.equal(layout.scale,1);assert.equal(layout.nominalLength,120);
    assert.equal(placeTrain(project,draft('long',{trainCars:12}),track).valid,false);
    track.d=3;assert.match(placeTrain(project,draft(),track).message,/宽度不足/);track.d=4;
  }
  assert.equal(placeTrain(project,draft('other',{floor:'B1'}),track).valid,false);
  track.visible=false;project.entities[1].visible=false;
  assert.equal(placeTrain(project,draft(),track).valid,false);
  track.visible=true;track.rotation=0;track.l=121;
  assert.equal(placeTrain(project,draft(),track).valid,true);
  track.l=120.99;assert.equal(placeTrain(project,draft(),track).valid,false);
});

test('end snapping stays inside rotated tracks, and occupied intervals reject overlap even for hidden trains', () => {
  const project=defaultProject(), track=project.entities[0];track.rotation=90;
  const a=attach(project,draft('first',{trainCars:2}),track,-50);
  const result=placeTrain(project,draft('second',{trainCars:2}),{x:track.x,z:track.z+89});
  assert.equal(result.valid,true);assert.equal(result.entity.trainOffset,69.5);
  assert.ok(Math.abs(result.entity.x-track.x)<1e-8);
  assert.equal(result.entity.z,track.z+69.5);
  assert.equal(placeTrain(project,draft('collision',{trainCars:2}),a).valid,false);
  a.visible=false;assert.equal(placeTrain(project,draft('collision',{trainCars:2}),a).valid,false);
  const second=attach(project,draft('second',{trainCars:2}),track,-9);
  assert.equal(trainFit(project,second).valid,true);
  second.trainOffset=-9.01;assert.equal(trainFit(project,second).valid,false);
});

test('train geometry retains actual scale, carriage gaps, color and fits the validated footprint', () => {
  for(const count of [1,6,12]){
    const project=defaultProject(),track=project.entities[0];track.l=300;
    const e=attach(project,draft('train',{trainCars:count}),track);
    assert.equal(trainFit(project,e).valid,true);
    const train=buildTrain(e,'#bc4554',true),bounds=new THREE.Box3().setFromObject(train);
    assert.equal(train.children.filter(child=>child.userData.carriage).length,count);
    assert.equal(train.scale.x,1);
    assert.ok(bounds.min.x>-e.l/2-.5 && bounds.max.x<e.l/2+.5);
    assert.ok(bounds.min.z>-trainFit(project,e).requiredWidth/2 && bounds.max.z<trainFit(project,e).requiredWidth/2);
    const colors=new Set();train.traverse(mesh=>{if(!mesh.isMesh)return;colors.add(mesh.material.color.getHexString());assert.ok(Array.from(mesh.geometry.attributes.position.array).every(Number.isFinite));});
    assert.ok(colors.has('bc4554'));
  }
});

test('track movement, rotation, line color and floor propagate; deleting track removes attached trains and round-trip restores them', () => {
  const project=defaultProject(),track=project.entities[0],train=attach(project,draft(),track,20);
  track.x=30;track.z=-10;track.rotation=90;track.floor='B1';project.lines[0].color='#123456';
  syncTrains(project);
  assert.ok(Math.abs(train.x-30)<1e-8);assert.ok(Math.abs(train.z-10)<1e-8);
  assert.equal(train.floor,'B1');assert.equal(train.rotation,90);assert.equal(train.color,'#123456');
  const before=structuredClone(project);removeWithTrains(project,track.id);
  assert.equal(project.entities.some(e=>e.id===train.id),false);
  assert.deepEqual(migrateProject(before),before);
});

test('editing train or shrinking its host rejects new overrun and overlap; legacy problems can be repaired incrementally', () => {
  const project=defaultProject(),track=project.entities[0],train=attach(project,draft(),track);
  const edit=action=>{const after=structuredClone(project);action(after);syncTrains(after);return trainEditError(project,after);};
  assert.match(edit(p=>p.entities.find(e=>e.id===train.id).trainUnits=2),/长度不足/);
  assert.match(edit(p=>p.entities[0].l=100),/长度不足/);
  assert.match(edit(p=>p.entities[0].d=2),/宽度不足/);
  assert.match(edit(p=>p.entities.find(e=>e.id===train.id).trainOffset=40),/超出轨道/);
  assert.equal(edit(p=>p.entities[0].rotation=90),'');
  train.trainUnits=4;syncTrains(project);
  assert.equal(edit(p=>p.entities.find(e=>e.id===train.id).trainUnits=3),'');
  const traded=structuredClone(project), repaired=traded.entities.find(e=>e.id===train.id);
  repaired.trainCars=2;repaired.trainUnits=1;
  attach(traded,draft('new-overlap',{trainCars:2}),traded.entities[0]);syncTrains(traded);
  assert.ok(trainEditError(project,traded),'repairing length must not allow a new overlap');
  const orphan=structuredClone(project);orphan.entities=orphan.entities.filter(e=>e.id!==track.id);
  assert.ok(trainEditError(project,orphan),'missing host is always invalid');
});

test('train direction and transforms inherit the track including floor elevation', () => {
  const train = buildTrain({ trainEnabled: true, trainCars: 3, l: 180, d: 4 }, '#487fb1', false);
  assert.equal(train.rotation.y, Math.PI);
  const track = new THREE.Group();
  track.position.set(20, 12, -8); track.rotation.y = -Math.PI / 2; track.add(train);
  track.updateMatrixWorld(true);
  const first = train.children.find(child => child.userData.carriage === 1);
  const last = train.children.find(child => child.userData.carriage === 3);
  const a = first.getWorldPosition(new THREE.Vector3()), b = last.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(a.x - 20) < 1e-8 && Math.abs(b.x - 20) < 1e-8);
  assert.equal(a.y, 12); assert.equal(b.y, 12);
  assert.ok(a.z > b.z);
});

test('4+4 coupling retains four cabs and a wider unit connection, unlike a fixed eight-car unit', () => {
  const track = { trainEnabled: true, trainPreset: 'suburban-c', trainCars: 4, trainUnits: 2, l: 500, d: 5 };
  const coupled = trainLayout(track), fixed = trainLayout({ ...track, trainCars: 8, trainUnits: 1 });
  const cabs = layout => layout.cars.reduce((n, car) => n + car.rearCab + car.frontCab, 0);
  assert.equal(coupled.formation, '4+4'); assert.equal(coupled.count, 8);
  assert.equal(cabs(coupled), 4); assert.equal(cabs(fixed), 2);
  assert.equal(coupled.cars[3].frontCab, true); assert.equal(coupled.cars[4].rearCab, true);
  for (let i = 1; i < coupled.count; i++) {
    const before = coupled.cars[i - 1], after = coupled.cars[i];
    const gap = after.center - before.center - (before.length + after.length) / 2;
    assert.ok(Math.abs(gap - (i === 4 ? 1.4 : .6)) < 1e-9);
  }
  assert.ok(Math.abs(coupled.nominalLength - 196.8) < 1e-9);
  const train = buildTrain(track, '#bc4554', true);
  assert.equal(train.children.filter(child => child.name === 'unit-coupler').length, 1);
  assert.equal(train.children.filter(child => child.userData.carriage && child.userData.frontCab).length, 2);
});

test('sourced presets retain reference lengths and generate the actual selected number of door panels', () => {
  const lengths = { 'metro-a': 188.42, 'metro-b': 118.36, 'metro-c': 77.86, 'metro-l': 70.72, 'suburban-c': 98, 'suburban-d': 88, 'mtr-r': 218.952 };
  for (const preset of TRAIN_PRESETS) {
    const track = { trainEnabled: true, l: 500, d: 5 };
    chooseTrainPreset(track, preset.id);
    const layout = trainLayout(track), train = buildTrain(track, '#487fb1', true);
    assert.ok(Math.abs(layout.nominalLength - lengths[preset.id]) < 1e-8);
    for (const car of train.children.filter(child => child.userData.carriage)) {
      const doors = car.children.find(child => child.name === 'passenger-doors');
      assert.equal(doors.geometry.attributes.position.count, car.userData.doors * 2 * 36);
    }
    if (preset.id === 'mtr-r') {
      assert.equal(layout.count, 9);
      assert.equal(layout.cars.filter(car => car.firstClass).length, 1);
      assert.equal(layout.cars[5].firstClass, true);
      assert.equal(layout.cars.filter(car => car.frontCab || car.rearCab).length, 2);
      assert.ok(train.children.find(car => car.userData.carriage === 6).children.some(mesh => mesh.material.color.getHexString() === 'c89c45'));
    }
  }
});

test('custom train settings persist per decoration and invalid inputs are rejected', () => {
  const project=defaultProject(),first=attach(project,draft()),second=attach(project,draft('train-2'),project.entities[1]);
  chooseTrainPreset(first,'metro-l');first.trainUnits=2;
  assert.ok(editTrainDimension(first,'carLength',18.2));assert.ok(editTrainDimension(first,'headDoors',2));
  const custom=trainDimensions(first);chooseTrainPreset(first,'metro-a');chooseTrainPreset(first,'custom');
  assert.deepEqual(trainDimensions(first),custom);syncTrains(project);
  const restored=migrateProject(project).entities.find(e=>e.id===first.id);
  assert.deepEqual(restored.trainCustom,first.trainCustom);assert.equal(restored.trainUnits,2);
  assert.equal(second.trainCustom,undefined);
  for(const [key,value] of [['trainCars',0],['trainCars',13],['trainUnits',5],['trainUnits',1.5],['trainPreset','unknown'],['trainCustom',{doors:7}],['trainCustom',{width:null}],['trainCustom',[]]]){
    const bad=structuredClone(project);bad.entities.find(e=>e.id===first.id)[key]=value;assert.equal(isProject(bad),false);
  }
  assert.equal(editTrainDimension(first,'doors',2.5),false);
});

test('maximum coupled custom formation remains finite and is rejected on short tracks', () => {
  const track = { type:'train', trainCars: 12, trainUnits: 4, l: .2, d: .2,
    trainCustom: { headLength: 35, carLength: 8, width: 4, height: 5.5, doors: 6, gap: 2, unitGap: .2 } };
  const layout = trainLayout(track), train = buildTrain(track, '#bc4554', false);
  assert.equal(layout.count, 48);
  const bounds = new THREE.Box3().setFromObject(train);
  assert.ok(bounds.max.x-bounds.min.x>500);assert.equal(layout.scale,1);
  const p=defaultProject(),placed=trainOnTrack(p,track,p.entities[0]);assert.equal(trainFit(p,placed).valid,false);
  train.traverse(mesh => {
    if (!mesh.isMesh) return;
    assert.ok(Array.from(mesh.geometry.attributes.position.array).every(Number.isFinite));
    if (mesh.name.endsWith('coupler')) assert.ok(mesh.geometry.parameters.width > 0);
  });
});
