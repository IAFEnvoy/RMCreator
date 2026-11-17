import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, entity, migrateProject, isProject } from '../src/project.js';
import { applyPaint, strokeCells, generateBoundaries, snapTrack, clipToRect, zoneStats } from '../src/zones.js';

const fixture = (cells = {'0,0':'paid'}) => ({...defaultProject(),zones:{B2:cells,B1:{}},entities:[]});
const track = (extra={}) => entity('track','track','轨道',1,5,{l:12,d:4,lineId:'line-1',doorStyle:'inherit',...extra});
const length = edges => edges.reduce((sum,e)=>sum+Math.hypot(e.x2-e.x1,e.z2-e.z1),0);

test('default project has paid/unpaid railings and two platform screen edges',()=>{
  const p=defaultProject();assert.ok(isProject(p));
  assert.equal(generateBoundaries(p,'B2').filter(e=>e.kind==='screen').length,2);
  assert.equal(generateBoundaries(p,'B1').filter(e=>e.kind==='railing').length,6);
  assert.deepEqual(zoneStats(p,'B2'),{paid:1920,unpaid:0,staff:0});
});
test('shared paid/unpaid cells merge into one railing; exterior edges stay open',()=>{
  const p=fixture({'0,0':'paid','1,0':'paid','0,1':'unpaid','1,1':'unpaid'});
  const b=generateBoundaries(p,'B2');assert.equal(b.length,1);assert.equal(length(b),4);
  p.boundaries.railings=false;assert.equal(generateBoundaries(p,'B2').length,0);
});
test('gate footprint cuts a traversable opening through railings',()=>{
  const p=fixture(Object.fromEntries(Array.from({length:10},(_,i)=>[`${i%5},${Math.floor(i/5)}`,i<5?'paid':'unpaid'])));
  p.entities=[entity('gate','gates','闸机',5,2,{floor:'B2',l:2,d:2})];
  const b=generateBoundaries(p,'B2');assert.equal(b.length,2);assert.ok(Math.abs(length(b)-8)<1e-8);
  p.entities[0].visible=false;assert.equal(length(generateBoundaries(p,'B2')),10);
});

test('railings meet the outer gate cabinets at every size and quarter-turn without blocking passages',()=>{
  for(const d of [2,7.5,12,24])for(const rotation of [0,90,180,270]){
    const horizontal=rotation%180===90,cells={};
    for(let i=0;i<20;i++){
      cells[horizontal?`${i},0`:`0,${i}`]='paid';
      cells[horizontal?`${i},1`:`1,${i}`]='unpaid';
    }
    const p=fixture(cells);
    p.entities=[entity('gate','gates','闸机',horizontal?20:2,horizontal?2:20,{floor:'B2',d,rotation})];
    const rails=generateBoundaries(p,'B2'),count=Math.max(2,Math.min(12,Math.round(d/1.2))),half=(d-d/count+.45)/2;
    assert.equal(rails.length,2);
    const endpoints=rails.map(e=>horizontal?[e.x1,e.x2]:[e.z1,e.z2]).flat();
    for(const [i,expected]of [0,20-half,20+half,40].entries())assert.ok(Math.abs(endpoints[i]-expected)<1e-8,`size ${d}, rotation ${rotation}, endpoint ${i}`);
    assert.ok(Math.abs(length(rails)-(40-half*2))<1e-8);
  }
});

test('diagonal gates attach to real cabinets instead of empty corners of the row footprint',()=>{
  const cells={};for(let i=0;i<10;i++){cells[`0,${i}`]='paid';cells[`1,${i}`]='unpaid';}
  const p=fixture(cells);
  p.entities=[entity('gate','gates','闸机',2,10,{floor:'B2',rotation:45})];
  const rails=generateBoundaries(p,'B2'),reach=(.625+.225)*Math.SQRT2;
  assert.equal(rails.length,2);
  assert.ok(Math.abs(rails[0].z2-(10-reach))<1e-8);
  assert.ok(Math.abs(rails[1].z1-(10+reach))<1e-8);
  p.entities[0].floor='B1';assert.equal(length(generateBoundaries(p,'B2')),20);
});

test('small connectors survive cell seams and multiple gate openings remain separate',()=>{
  const cells={};for(let i=0;i<10;i++){cells[`0,${i}`]='paid';cells[`1,${i}`]='unpaid';}
  const p=fixture(cells);
  p.entities=[entity('a','gates','闸机 A',2,5.32,{floor:'B2'}),entity('b','gates','闸机 B',2,15,{floor:'B2',d:2})];
  const rails=generateBoundaries(p,'B2');
  assert.equal(rails.length,3);
  assert.ok(Math.abs(rails[0].z2-1.97)<1e-8);
  assert.ok(Math.abs(rails[1].z1-8.67)<1e-8);
  assert.ok(Math.abs(rails[1].z2-14.275)<1e-8);
  assert.ok(Math.abs(rails[2].z1-15.725)<1e-8);
});
test('exact paid/track edge contact produces screen doors; a gap does not',()=>{
  const p=fixture();p.entities=[track({z:4})];
  const b=generateBoundaries(p,'B2');assert.equal(b.length,1);assert.equal(b[0].style,'half');assert.equal(length(b),2);
  p.entities[0].z=4.1;assert.equal(generateBoundaries(p,'B2').length,0);
});
test('screen door mode supports none, half, full and per-track overrides',()=>{
  const p=fixture();p.entities=[track({z:4})];
  for(const mode of ['none','half','full']){p.boundaries.screenDoors=mode;const b=generateBoundaries(p,'B2');assert.equal(b.length,mode==='none'?0:1);if(b.length)assert.equal(b[0].style,mode);}
  p.entities[0].doorStyle='none';assert.equal(generateBoundaries(p,'B2').length,0);
  p.boundaries.screenDoors='none';p.entities[0].doorStyle='full';assert.equal(generateBoundaries(p,'B2')[0].style,'full');
});
test('hidden tracks and tracks on other floors do not generate doors',()=>{
  const p=fixture();p.entities=[track({z:4,visible:false})];assert.equal(generateBoundaries(p,'B2').length,0);
  p.entities[0].visible=true;p.entities[0].floor='B1';assert.equal(generateBoundaries(p,'B2').length,0);
});
test('perpendicular track contact and rotated rectangle clipping work',()=>{
  const p=fixture();p.entities=[track({rotation:90,x:4,z:1})];
  const b=generateBoundaries(p,'B2');assert.equal(b.length,1);assert.equal(b[0].x1,2);
  assert.ok(clipToRect({x1:2,z1:0,x2:2,z2:2},p.entities[0]));
});
test('track snaps its side, with a continuous highlighted boundary',()=>{
  const p=fixture({'0,0':'paid','1,0':'paid','2,0':'paid'});
  const result=snapTrack(p,track({x:3,z:6.3}));
  assert.equal(result.snapped,true);assert.equal(result.z,4);assert.equal(result.x,3);
  assert.equal(result.snapEdge.x2-result.snapEdge.x1,6);
  p.entities=[result];assert.equal(length(generateBoundaries(p,'B2')),6);
});
test('snapping handles negative side, 90/180/270 degrees, and leaves distant tracks alone',()=>{
  const p=fixture();
  assert.equal(snapTrack(p,track({z:-4})).z,-2);
  assert.equal(snapTrack(p,track({rotation:180,z:6})).z,4);
  for(const rotation of [90,270])assert.equal(snapTrack(p,track({rotation,x:6,z:1})).x,4);
  for(const extra of [{z:8},{x:50},{rotation:45},{floor:'B1'}])assert.equal(snapTrack(p,track(extra)).snapped,false);
  p.snapping=false;assert.equal(snapTrack(p,track({z:5})).snapped,false);
});
test('repainting and erasing immediately remove obsolete automatic boundaries',()=>{
  const p=fixture({'0,0':'paid','0,1':'unpaid'});assert.equal(generateBoundaries(p,'B2').length,1);
  applyPaint(p.zones.B2,['0,1'],'paid');assert.equal(generateBoundaries(p,'B2').length,0);
  p.entities=[track({z:6})];assert.equal(generateBoundaries(p,'B2').length,1);
  applyPaint(p.zones.B2,['0,1'],'erase');assert.equal(generateBoundaries(p,'B2').length,0);
});
test('brush strokes interpolate fast drags; rectangle and erase snap to grid cells',()=>{
  const brush=strokeCells([0,0],[5,0],1);assert.equal(brush.size,6);assert.ok(brush.has('3,0'));
  const rectangle=strokeCells([2,2],[0,0],1,true);assert.equal(rectangle.size,9);
  const cells={};applyPaint(cells,rectangle,'paid');applyPaint(cells,['1,1'],'erase');assert.equal(Object.keys(cells).length,8);
  assert.equal(strokeCells([-250,-250],[-250,-250],1).size,1);
  assert.equal(strokeCells([250,250],[250,250],1).size,0);
});
test('v1 migration preserves components and converts slabs to paintable areas',()=>{
  const old=defaultProject();old.version=1;old.line='3';old.color='#e5bd45';
  delete old.lines;delete old.zones;delete old.zoneColors;delete old.snapping;delete old.boundaries;
  old.entities.push({...entity('slab','track','旧站台',0,0),type:'platform',l:20,d:8});
  old.entities.push({...entity('hall','track','旧站厅',0,0,{floor:'B1'}),type:'concourse',l:20,d:8});
  const p=migrateProject(old);assert.ok(isProject(p));assert.equal(p.lines[0].name,'3 号线');
  assert.equal(p.lines[0].color,'#e5bd45');assert.ok(!('color'in p));assert.ok(!('line'in p));
  assert.ok(p.entities.every(e=>!['platform','concourse'].includes(e.type)));assert.ok(zoneStats(p,'B2').paid>0);assert.ok(zoneStats(p,'B1').unpaid>0);
  p.lines.push({id:'line-4',name:'4 号线',color:'#925da6'});p.entities[0].lineId='line-4';
  assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(p))),p);
});
test('invalid imports fail validation without processing unbounded legacy geometry',()=>{
  const p=defaultProject();p.entities[0].lineId='missing';assert.equal(isProject(p),false);
  assert.throws(()=>migrateProject({version:1,entities:[{type:'platform',floor:'B2',x:0,z:0,l:1e20,d:1e20}]}));
});

test('staff paint is independent of public areas and persists with restroom markers',()=>{
  const p=fixture({'0,0':'paid','0,1':'staff','1,1':'unpaid'});
  p.entities=[entity('wc','restroom','卫生间',6,2)];
  assert.deepEqual(zoneStats(p,'B2'),{paid:4,unpaid:4,staff:4});
  assert.equal(generateBoundaries(p,'B2').length,0);
  assert.ok(isProject(p));assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(p))),p);
  applyPaint(p.zones.B2,['0,0'],'staff');assert.deepEqual(zoneStats(p,'B2'),{paid:0,unpaid:4,staff:8});
  applyPaint(p.zones.B2,['0,1'],'erase');assert.equal(zoneStats(p,'B2').staff,4);
});

test('v2 exit corridors become unpaid paint and marker positions follow their old endpoints',()=>{
  const p=fixture({'0,0':'paid'});p.version=2;delete p.zoneColors.staff;
  p.entities=[entity('exit','exit','1 号口',0,4,{l:4,d:12,h:.7,color:'#d6e6e6',floor:'B2',exitNumber:'1'}),track({z:20})];
  delete p.entities[1].direction;
  const next=migrateProject(p),exit=next.entities[0];
  assert.equal(next.version,4);assert.equal(next.zones.B2['0,0'],'paid');assert.equal(next.zones.B2['0,4'],'unpaid');
  assert.equal(exit.z,9.2);assert.equal(exit.l,6);assert.equal(exit.d,6);assert.equal(next.entities[1].direction,'right-side');
  assert.deepEqual(migrateProject(next),next);
  const zones=structuredClone(next.zones);exit.x=80;exit.z=80;
  assert.deepEqual(migrateProject(next).zones,zones,'moving a marker cannot paint a new corridor');
});

test('legacy rotated and hidden exits preserve passage orientation and visibility',()=>{
  const p=fixture();p.version=2;
  p.entities=[entity('east','exit','东出口',10,10,{l:4,d:12,rotation:90,floor:'B2'}),entity('hidden','exit','隐藏出口',100,100,{l:4,d:12,visible:false,floor:'B2'})];
  const next=migrateProject(p);assert.ok(Math.abs(next.entities[0].x-4.8)<1e-9);assert.equal(next.entities[0].z,10);
  assert.equal(next.zones.B2['3,4'],'unpaid');assert.equal(next.zones.B2['50,50'],undefined);
});

test('current marker-only projects retain blank floors and explicit track directions',()=>{
  const p=fixture({});p.entities=[entity('exit','exit','A 口',0,0,{exitNumber:'A'}),track({direction:'backward'})];
  assert.deepEqual(migrateProject(p).zones.B2,{});assert.equal(migrateProject(p).entities[1].direction,'backward');
  p.entities[1].direction='invalid';assert.equal(isProject(p),false);
});
