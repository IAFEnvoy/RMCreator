import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, entity, isProject, migrateProject } from '../src/project.js';
import { placementPoint, twoPointPlacement, retargetPlacement, placementInputFloor, normalizeConnection, connectionFloors } from '../src/placement.js';
import { changeTrackMode, inheritTrackStyle, curveDraft } from '../src/track-drawing.js';
import { trackLayout } from '../src/track.js';
import { makeTrackPath, snapRailPoint, pointAlongTrack, trackGeometry, worldPoint } from '../src/track-path.js';

const fixture = () => ({ ...defaultProject(), snapping: false });
const item = (type, extra = {}) => entity('placed', type, '两点放置', 0, 0, { floor: 'B2', ...(type === 'track' ? { lineId: 'line-1', doorStyle: 'inherit' } : { toFloor: 'B1' }), ...extra });
const point = (x, z) => ({ x, z });

test('two-point tracks lock to one axis in all four directions and keep exact endpoints', () => {
  const p = fixture(), t = item('track');
  for (const [pointer, rotation, end] of [[point(25, 4), 0, point(25, 0)], [point(-25, 4), 180, point(-25, 0)], [point(4, 25), 90, point(0, 25)], [point(4, -25), 270, point(0, -25)]]) {
    const result = twoPointPlacement(p, t, point(0, 0), pointer);
    assert.equal(result.valid, true); assert.equal(result.entity.rotation, rotation);
    assert.deepEqual(result.end, end); assert.equal(result.entity.l, 25);
    assert.equal(result.entity.x, end.x / 2); assert.equal(result.entity.z, end.z / 2);
    const angle = rotation * Math.PI / 180, half = result.entity.l / 2;
    assert.ok(Math.abs(result.entity.x - Math.cos(angle) * half) < 1e-8);
    assert.ok(Math.abs(result.entity.z - Math.sin(angle) * half) < 1e-8);
  }
  assert.deepEqual(t, item('track'), 'the source template stays unchanged');
});

test('track snapping translates both endpoints without changing length or rotation', () => {
  const p = fixture(); p.snapping = true; p.entities = [];
  const result = twoPointPlacement(p, item('track'), point(-30, 10.5), point(30, 11));
  assert.equal(result.valid, true); assert.equal(result.entity.l, 60); assert.equal(result.entity.rotation, 0);
  assert.equal(result.start.z, 8); assert.equal(result.end.z, 8); assert.equal(result.entity.z, 8);
  assert.ok(result.entity.snapEdge);
});

test('coincident, too short, overlong and invalid-coordinate placements are rejected', () => {
  const p = fixture(), t = item('track');
  for (const [a, b] of [[point(0, 0), point(0, 0)], [point(0, 0), point(1.5, .2)], [point(-500, 0), point(500, 0)], [point(0, 0), point(NaN, 20)]]) {
    assert.equal(twoPointPlacement(p, t, a, b).valid, false);
  }
  assert.equal(twoPointPlacement(p, t, point(0, 0), point(2, .7)).valid, true);
  assert.deepEqual(placementPoint(point(2.24, -3.26)), point(2, -3.5));
});

test('stairs and escalators use the actual rise and reject overly steep runs', () => {
  const p = fixture();
  for (const [type, minimum] of [['stairs', 12], ['escalator', 17.5]]) {
    const e = item(type), short = twoPointPlacement(p, e, point(0, 0), point(minimum - .5, 1));
    assert.equal(short.valid, false); assert.equal(short.minimum, minimum);
    for (const pointer of [point(minimum, 1), point(-minimum, 1), point(1, minimum), point(1, -minimum)]) {
      const result = twoPointPlacement(p, e, point(0, 0), pointer);
      const rotation = (Math.atan2(pointer.z,pointer.x)*180/Math.PI+360)%360;
      assert.equal(result.valid, true); assert.equal(result.entity.rotation, rotation); assert.equal(result.entity.h, 12);
      assert.deepEqual(result.end,pointer);assert.equal(result.entity.l,Math.hypot(pointer.x,pointer.z));
    }
  }
  p.display.exploded = true;
  assert.equal(twoPointPlacement(p, item('stairs'), point(0, 0), point(12, 0)).valid, true);
  p.floors.find(f => f.id === 'B1').elevation = 20;
  assert.equal(twoPointPlacement(p, item('stairs'), point(0, 0), point(12, 0)).valid, false);
});

test('diagonal stairs and escalators retain both picked endpoints and validate their true horizontal run', () => {
  const p=fixture();
  for(const type of ['stairs','escalator'])for(const end of [point(18,24),point(-18,24),point(-18,-24),point(18,-24)]){
    const result=twoPointPlacement(p,item(type),point(0,0),end),e=result.entity;
    assert.equal(result.valid,true);assert.equal(e.l,30);assert.equal(e.h,12);
    for(const [x,expected]of [[-15,point(0,0)],[15,end]]){
      const actual=worldPoint(e,{x,z:0});assert.ok(Math.hypot(actual.x-expected.x,actual.z-expected.z)<1e-8);
    }
    assert.ok(isProject({...p,entities:[e]}));
  }
  assert.equal(twoPointPlacement(p,item('escalator'),point(0,0),point(13,13)).valid,true,'diagonal run is long enough even when neither axis alone is');
  assert.equal(twoPointPlacement(p,item('escalator'),point(0,0),point(12,12)).valid,false);
});

test('straight rail placement makes exact contacts with curves and preserves a snapped start over zone-edge snapping', () => {
  const p=fixture();p.snapping=true;
  const host=makeTrackPath(item('track',{id:'host'}),[point(0,30),point(30,55),point(60,30)],'quadratic');p.entities=[host];
  const contact=pointAlongTrack(host,trackGeometry(host).length*.33,true),source=item('track');
  const result=twoPointPlacement(p,source,point(0,-20),contact);
  assert.equal(result.valid,true);assert.equal(result.snapTarget.trackId,'host');
  assert.ok(Math.hypot(result.end.x-result.snapTarget.x,result.end.z-result.snapTarget.z)<1e-8);
  const start=snapRailPoint(p,source,contact),next=twoPointPlacement(p,source,start,point(70,70));
  assert.deepEqual(next.start,{x:start.x,z:start.z});assert.equal(next.entity.snapEdge,undefined);
  const actual=worldPoint(next.entity,{x:-next.entity.l/2,z:0});assert.ok(Math.hypot(actual.x-start.x,actual.z-start.z)<1e-8);
});

test('elevator opposite corners define an aligned rectangular shaft with bounded dimensions', () => {
  const p = fixture(), elevator = item('elevator');
  for (const end of [point(4, 5), point(-4, 5), point(4, -5), point(-4, -5)]) {
    const result = twoPointPlacement(p, elevator, point(0, 0), end);
    assert.equal(result.valid, true); assert.equal(result.entity.l, 4); assert.equal(result.entity.d, 5);
    assert.equal(result.entity.rotation, 0); assert.equal(result.entity.h, 16);
    assert.equal(result.entity.x, end.x / 2); assert.equal(result.entity.z, end.z / 2);
  }
  for (const end of [point(0, 8), point(1.5, 3), point(13, 4)]) assert.equal(twoPointPlacement(p, elevator, point(0, 0), end).valid, false);
});

test('connections require distinct real floors and finished placements round-trip as regular entities', () => {
  const p = fixture();
  for (const type of ['stairs', 'escalator', 'elevator']) {
    for (const extra of [{ toFloor: '' }, { toFloor: 'missing' }, { toFloor: 'B2' }]) {
      assert.equal(twoPointPlacement(p, item(type, extra), point(0, 0), point(20, 4)).valid, false);
    }
  }
  for (const type of ['track', 'stairs', 'escalator', 'elevator']) {
    const result = twoPointPlacement(p, item(type), point(30, 20), type === 'elevator' ? point(34, 24) : point(55, 22));
    assert.equal(result.valid, true);
    const project = { ...p, entities: [result.entity] };
    assert.ok(isProject(project)); assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(project))), project);
  }
});

test('switching all rail drawing modes retains exact snapped starts, styles and unfinished control points', () => {
  const p=fixture();p.snapping=true;
  const host=item('track',{id:'host',lineId:'line-2',color:'#228866',bandColor:'#1188aa',bandVisible:true});
  p.lines.push({id:'line-2',name:'2号线',color:'#2277aa'});p.entities=[host];
  const start=snapRailPoint(p,item('track'),point(-host.l/2,0));
  const draft={entity:inheritTrackStyle(p,item('track'),start),trackMode:'straight',start};
  for(const mode of ['curve','connector','straight','curve']){
    assert.equal(changeTrackMode(draft,mode),true);
    assert.deepEqual(draft.start,start);assert.equal(draft.entity.lineId,'line-2');
    assert.equal(trackLayout(p,draft.entity).bandColor,'#1188aa');
  }
  draft.points.push(point(-50,20));changeTrackMode(draft,'straight');changeTrackMode(draft,'curve');
  assert.deepEqual(draft.points,[start,point(-50,20)]);
  const curve=curveDraft(draft.entity,draft.points,point(-20,20)).entity;
  assert.equal(curve.joins.start.trackId,'host');assert.equal(curve.bandColor,'#1188aa');
  const straight=twoPointPlacement(p,draft.entity,start,point(-20,0)).entity;
  assert.equal(straight.lineId,'line-2');assert.equal(trackLayout(p,straight).bandColor,'#1188aa');
  const other={...host,id:'other',lineId:'line-1',bandColor:undefined};p.entities.push(other);
  const inherited=inheritTrackStyle(p,item('track',{bandColor:'#ffffff'}),{...start,trackId:'other'});
  assert.equal(inherited.bandColor,undefined);assert.equal(trackLayout(p,inherited).bandColor,p.lines[0].color);
  assert.equal(inheritTrackStyle(p,draft.entity,start,{...start,trackId:'other'}).lineId,'line-2','the start wins over a differently colored end');
});

test('changing viewed floors preserves picked points; endpoint selection supports either height order and any span',()=>{
  const p=fixture();p.floors.push({id:'L3',code:'L3',name:'上层',elevation:24});p.zones.L3={};
  for(const type of ['stairs','escalator','elevator']){
    const start=point(5,8),draft={entity:item(type,{floor:'L3',toFloor:'B1'}),start};
    retargetPlacement(p,draft,'B2');
    assert.deepEqual(draft.start,start);assert.equal(draft.entity.floor,'L3');assert.equal(draft.entity.toFloor,'B2');
    assert.equal(placementInputFloor(draft,'all'),'B2');assert.equal(placementInputFloor(draft,'B1'),'B1');
    const end=type==='elevator'?point(10,13):point(55,28),result=twoPointPlacement(p,draft.entity,start,end);
    assert.equal(result.valid,true);assert.equal(result.entity.floor,'B2');assert.equal(result.entity.toFloor,'L3');
    assert.equal(result.entity.h,type==='elevator'?28:24);assert.deepEqual(result.start,start);assert.deepEqual(result.end,end);
    if(type!=='elevator'){
      const lower=worldPoint(result.entity,{x:-result.entity.l/2,z:0}),upper=worldPoint(result.entity,{x:result.entity.l/2,z:0});
      assert.ok(Math.hypot(lower.x-end.x,lower.z-end.z)<1e-8);assert.ok(Math.hypot(upper.x-start.x,upper.z-start.z)<1e-8);
    }
    const stable=structuredClone(result.entity);normalizeConnection(p,result.entity);assert.deepEqual(result.entity,stable);
    assert.deepEqual(connectionFloors(p,result.entity),['B2','B1','L3']);
    assert.ok(isProject({...p,entities:[result.entity]}));
    assert.deepEqual(migrateProject({...p,entities:[result.entity]}).entities[0],result.entity);
    retargetPlacement(p,draft,'all');assert.deepEqual(draft.start,start);assert.equal(draft.entity.toFloor,'B2');
  }
  const rail={entity:item('track'),start:point(1,2)};retargetPlacement(p,rail,'B1');
  assert.equal(rail.entity.floor,'B2');assert.deepEqual(rail.start,point(1,2));
  const unpicked={entity:item('stairs')};retargetPlacement(p,unpicked,'L3');
  assert.equal(unpicked.entity.floor,'L3');assert.notEqual(unpicked.entity.toFloor,'L3');
});
