import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultProject,entity,migrateProject,isProject} from '../src/project.js';
import {trackLayout,trackLabelPosition,trackTextLayout} from '../src/track.js';

test('track destination uses line + destination + direction without duplicate words',()=>{
  const p=defaultProject(),t=p.entities.find(e=>e.id==='track-south');
  assert.equal(trackLayout(p,t).text,'1号线往莘庄方向');
  t.name='莘庄方向';assert.equal(trackLayout(p,t).text,'1号线往莘庄方向');
});

test('automatic travel direction keeps the color band on the right through rotations',()=>{
  const p=defaultProject();
  for(const z of [-8,8])for(const rotation of [0,90,180,270]){
    const t=entity('test','track','终点',0,z,{rotation,lineId:'line-1'}),layout=trackLayout(p,t);
    const a=rotation*Math.PI/180,sign=layout.forward?1:-1;
    const travel=[sign*Math.cos(a),sign*Math.sin(a)],band=[-layout.side*Math.sin(a),layout.side*Math.cos(a)];
    assert.ok(travel[0]*band[1]-travel[1]*band[0]>0);
  }
});

test('track arrows default off for new and existing projects and persist independently of direction and band visibility',()=>{
  const p=defaultProject(),t=p.entities.find(e=>e.type==='track');
  assert.equal(t.arrowVisible,false);assert.equal(trackLayout(p,t).arrowVisible,false);
  delete t.arrowVisible;assert.equal(trackLayout(p,migrateProject(p).entities[0]).arrowVisible,false);
  for(const arrowVisible of [true,false])for(const bandVisible of [true,false]){
    Object.assign(t,{arrowVisible,bandVisible,direction:'backward'});
    const restored=migrateProject(JSON.parse(JSON.stringify(p))),layout=trackLayout(restored,restored.entities[0]);
    assert.equal(layout.arrowVisible,arrowVisible);assert.equal(layout.bandVisible,bandVisible);
    assert.equal(layout.forward,false);assert.equal(layout.side,-1);
  }
  for(const invalid of [1,'true',null]){t.arrowVisible=invalid;assert.equal(isProject(p),false);}
});

test('legacy global direction visibility is removed while each track keeps its arrow setting',()=>{
  const p=defaultProject();assert.equal(p.display.trackDirections,undefined);
  p.display.trackDirections=false;
  const tracks=p.entities.filter(e=>e.type==='track');tracks[0].arrowVisible=true;tracks[1].arrowVisible=false;
  const migrated=migrateProject(p);
  assert.equal(Object.hasOwn(migrated.display,'trackDirections'),false);
  assert.equal(trackLayout(migrated,migrated.entities.find(e=>e.id===tracks[0].id)).arrowVisible,true);
  assert.equal(trackLayout(migrated,migrated.entities.find(e=>e.id===tracks[1].id)).arrowVisible,false);
  assert.deepEqual(migrateProject(migrated),migrated);
});

test('explicit travel direction controls the band side even with old side overrides and hidden arrows',()=>{
  const p=defaultProject();
  for(const direction of ['forward','backward'])for(const bandSide of ['auto','left','right'])for(const z of [-8,8])for(const rotation of [0,37,90,180,270]){
    const t=entity('test','track','终点',0,z,{rotation,lineId:'line-1',direction,bandSide}),layout=trackLayout(p,t);
    assert.equal(layout.forward,direction==='forward');assert.equal(layout.side,layout.forward?1:-1);
    const a=rotation*Math.PI/180,sign=layout.forward?1:-1;
    const travel=[sign*Math.cos(a),sign*Math.sin(a)],band=[-layout.side*Math.sin(a),layout.side*Math.cos(a)];
    assert.ok(travel[0]*band[1]-travel[1]*band[0]>0);
    assert.equal(layout.arrowVisible,false);
  }
});

test('dragging text converts world coordinates into the rotated track frame and persists',()=>{
  const p=defaultProject(),t=p.entities.find(e=>e.type==='track');
  Object.assign(t,{x:20,z:10,rotation:90});
  Object.assign(t,trackLabelPosition(t,12,24));
  assert.equal(t.labelX,14);assert.equal(t.labelZ,8);
  const roundtrip=migrateProject(JSON.parse(JSON.stringify(p)));
  const layout=trackLayout(roundtrip,roundtrip.entities.find(e=>e.id===t.id));
  assert.equal(layout.x,14);assert.equal(layout.z,8);
  t.labelX=Infinity;assert.equal(isProject(p),false);
});

test('text facing is optional and persists independently of track travel and dragged position',()=>{
  const p=defaultProject(),t=p.entities.find(e=>e.id==='track-south');
  Object.assign(t,{rotation:90,labelX:36.5,labelZ:28});
  const original=trackLayout(p,t);assert.equal(original.rotation,0);
  for(const angle of [0,90,180,270]){
    t.labelRotation=angle;
    const restored=migrateProject(JSON.parse(JSON.stringify(p))).entities.find(e=>e.id===t.id);
    const layout=trackLayout(p,restored);
    assert.equal(layout.rotation,angle);assert.equal(layout.forward,original.forward);
    assert.equal(layout.x,36.5);assert.equal(layout.z,28);assert.equal(restored.rotation,90);
  }
  for(const invalid of [-1,45,360,Infinity,'90']){t.labelRotation=invalid;assert.equal(isProject(p),false);}
  delete t.labelRotation;assert.equal(isProject(p),true);
});

test('vertical lettering matches the reference without rotating or stretching the track-aligned strip',()=>{
  const p=defaultProject(),t=p.entities.find(e=>e.id==='track-south');
  const horizontal=trackTextLayout(trackLayout(p,t));
  assert.equal(horizontal.vertical,false);assert.equal(horizontal.characters.join(''),'1号线往莘庄方向');assert.equal(horizontal.glyphRotation,0);assert.equal(horizontal.blockRotation,0);
  t.labelRotation=90;const down=trackTextLayout(trackLayout(p,t));
  assert.equal(down.vertical,true);assert.deepEqual(down.characters,['向','方','庄','莘','往','线','号','1']);
  assert.equal(down.width,horizontal.width);assert.equal(down.depth,horizontal.depth);
  assert.equal(down.glyphRotation,90);assert.equal(down.blockRotation,0);
  t.labelRotation=270;const up=trackTextLayout(trackLayout(p,t));
  assert.equal(up.vertical,true);assert.deepEqual(up.characters,horizontal.characters);assert.equal(up.glyphRotation,270);assert.equal(up.blockRotation,0);
  assert.equal(up.width,down.width);assert.equal(up.depth,down.depth);
  t.labelRotation=180;const left=trackTextLayout(trackLayout(p,t));
  assert.equal(left.vertical,false);assert.deepEqual(left.characters,horizontal.characters);assert.equal(left.glyphRotation,180);assert.equal(left.blockRotation,180);
});
