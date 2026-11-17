import test from 'node:test';
import assert from 'node:assert/strict';
import { floorsTopDown, floorElevationWarnings, adjacentFloor, floorShortcut } from '../src/floors.js';
import { defaultProject, migrateProject } from '../src/project.js';

test('floor choices follow actual elevations including basement and renamed floors without changing storage order',()=>{
  const floors=[{id:'B2',code:'S1',elevation:0},{id:'B1',code:'G',elevation:12},{id:'L3',code:'S3',elevation:-12}];
  assert.deepEqual(floorsTopDown(floors).map(f=>f.id),['B1','B2','L3']);
  assert.deepEqual(floors.map(f=>f.id),['B2','B1','L3']);
  floors[2].elevation=24;assert.deepEqual(floorsTopDown(floors).map(f=>f.id),['L3','B1','B2']);
  floors[0].elevation=24;assert.deepEqual(floorsTopDown(floors).map(f=>f.id),['B2','L3','B1']);
});

test('all floors sharing an elevation are flagged with their peers and clear immediately when separated',()=>{
  const floors=[{id:'a',code:'B1',elevation:0},{id:'b',code:'B2',elevation:0},{id:'c',code:'B3',elevation:0},{id:'d',code:'B4',elevation:-12}];
  const warnings=floorElevationWarnings(floors);assert.equal(warnings.size,3);
  assert.match(warnings.get('a'),/B2、B3/);assert.match(warnings.get('b'),/B1、B3/);assert.match(warnings.get('c'),/B1、B2/);
  floors[1].elevation=12;floors[2].elevation=24;assert.equal(floorElevationWarnings(floors).size,0);
});

test('floor shortcuts follow elevations in either direction, stop at boundaries and preserve tied floor order',()=>{
  const floors=[{id:'lower',elevation:-12},{id:'top',elevation:24},{id:'middle',elevation:0},{id:'same-height',elevation:0}];
  assert.equal(adjacentFloor(floors,'lower',1),'same-height');
  assert.equal(adjacentFloor(floors,'same-height',1),'middle');
  assert.equal(adjacentFloor(floors,'middle',1),'top');
  assert.equal(adjacentFloor(floors,'top',-1),'middle');
  assert.equal(adjacentFloor(floors,'middle',-1),'same-height');
  assert.equal(adjacentFloor(floors,'top',1),undefined);assert.equal(adjacentFloor(floors,'lower',-1),undefined);
  assert.equal(adjacentFloor(floors,'all',1),'top');assert.equal(adjacentFloor(floors,'all',-1),'lower');
  assert.equal(adjacentFloor([],null,1),undefined);
  for(const key of ['+','='])assert.equal(floorShortcut({key}),1);
  assert.equal(floorShortcut({key:'-'}),-1);
  assert.equal(floorShortcut({key:'Add',code:'NumpadAdd'}),1);assert.equal(floorShortcut({key:'Subtract',code:'NumpadSubtract'}),-1);
  for(const modifier of ['ctrlKey','metaKey','altKey','isComposing'])assert.equal(floorShortcut({key:'+',[modifier]:true}),0);
});

test('floor abbreviations persist while objects, connecting facilities and zones retain their original floor IDs',()=>{
  const project=defaultProject(),before=structuredClone(project);
  project.floors.find(f=>f.id==='B1').code='站厅';project.floors.find(f=>f.id==='B2').code='S1';
  const restored=migrateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.floors.map(f=>f.code),['S1','站厅']);
  assert.deepEqual(restored.entities,before.entities);assert.deepEqual(restored.zones,before.zones);
});
