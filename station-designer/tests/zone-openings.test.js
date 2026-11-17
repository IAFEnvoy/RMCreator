import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, entity, migrateProject, isProject } from '../src/project.js';
import { rectangularOpening, openingError, connectionOpeningPaths } from '../src/zone-openings.js';
import { zoneMasks, polygonArea, polygonContains, pathPolygon } from '../src/zone-geometry.js';
import { zonePathError } from '../src/zone-path.js';
import { generateBoundaries, zoneStats } from '../src/zones.js';

const rect=(id,kind,x,z,l,d,floor='B2')=>rectangularOpening({id,kind,floor},{x,z},{x:x+l,z:z+d});
const fixture=()=>({...defaultProject(),entities:[],zones:{B2:{},B1:{}},zonePaths:[]});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('structural openings cut all fill types, including paint added later, without affecting other floors',()=>{
  const p=fixture();p.zonePaths=[rect('base','paid',0,0,30,20),rect('hole','opening',5,5,20,10),rect('later','staff',10,0,10,20),rect('other','unpaid',0,0,30,20,'B1')];
  const masks=zoneMasks(p,'B2');near(polygonArea(masks.paid),300);near(polygonArea(masks.staff),100);near(polygonArea(zoneMasks(p,'B1').unpaid),600);
  for(const kind of ['paid','unpaid','staff'])assert.equal(polygonContains(masks[kind],{x:15,z:10}),false);
  assert.deepEqual(zoneStats(p,'B2'),{paid:300,unpaid:0,staff:100});
  const hole=p.zonePaths.splice(1,1)[0];near(polygonArea(zoneMasks(p,'B2').paid),400);p.zonePaths.push(hole);near(polygonArea(zoneMasks(p,'B2').paid),300);
});

test('overlapping openings union once; edge notches and legacy painted cells remain valid',()=>{
  const p=fixture();p.zones.B2=Object.fromEntries(Array.from({length:100},(_,i)=>[`${i%10},${Math.floor(i/10)}`,'paid']));
  p.zonePaths=[rect('a','opening',2,2,6,6),rect('b','opening',4,4,6,6),rect('notch','opening',18,10,8,4)];
  near(polygonArea(zoneMasks(p,'B2').paid),336);assert.equal(openingError(p,rect('empty','opening',40,40,5,5)),'孔洞需与本层的填色区域相交');
  assert.equal(openingError(p,rect('overlap','opening',16,8,8,4)),'');
});

test('opening cuts break shared railings and platform screen doors rather than spanning the gap',()=>{
  const p=fixture();p.zonePaths=[rect('paid','paid',0,0,20,10),rect('unpaid','unpaid',0,10,20,10),rect('hole','opening',8,8,4,4)];
  let rails=generateBoundaries(p,'B2').filter(e=>e.kind==='railing');assert.equal(rails.length,2);near(rails.reduce((n,e)=>n+Math.hypot(e.x2-e.x1,e.z2-e.z1),0),16);
  p.entities=[entity('rail','track','轨道',10,-2,{l:20,d:4,lineId:'line-1',doorStyle:'half'})];p.zonePaths.push(rect('gap','opening',8,-2,4,4));
  const doors=generateBoundaries(p,'B2').filter(e=>e.kind==='screen');assert.equal(doors.length,2);near(doors.reduce((n,e)=>n+Math.hypot(e.x2-e.x1,e.z2-e.z1),0),16);
});

test('curved openings retain Bezier handles, preserve true holes and round-trip through files',()=>{
  const p=fixture(),hole=rect('curve','opening',5,5,10,10);hole.vertices[0]={pos:{x:5,z:5},type:'cusp',handleOut:{x:7,z:1}};hole.vertices[1]={pos:{x:15,z:5},type:'cusp',handleIn:{x:13,z:1}};
  p.zonePaths=[rect('base','paid',0,0,30,30),hole];const area=polygonArea(pathPolygon(hole));assert.ok(area>100);near(polygonArea(zoneMasks(p,'B2').paid),900-area);assert.equal(zoneMasks(p,'B2').paid[0].length,2);assert.equal(zonePathError(hole),'');assert.ok(isProject(p));
  const loaded=migrateProject(JSON.parse(JSON.stringify(p)));assert.deepEqual(loaded.zonePaths,p.zonePaths);near(polygonArea(zoneMasks(loaded,'B2').paid),900-area);
  hole.closed=false;near(polygonArea(zoneMasks(p,'B2').paid),900);
});

test('facility action generates rotated openings on upper and intermediate floors, skipping empty and already cut floors',()=>{
  const p=fixture();p.floors.push({id:'L3',code:'L3',name:'上层',elevation:24});p.zonePaths=[rect('middle','paid',-40,-40,80,80,'B1'),rect('top','unpaid',-40,-40,80,80,'L3')];
  for(const type of ['stairs','escalator','elevator']){
    const source=entity('s',type,'连接',0,0,{l:30,d:4,floor:'B2',toFloor:'L3',rotation:37}),before=structuredClone(source),paths=connectionOpeningPaths(p,source,`test-${type}`);
    assert.deepEqual(paths.map(p=>p.floor),['B1','L3']);paths.forEach(path=>{assert.equal(path.kind,'opening');assert.equal(openingError(p,path),'');near(polygonArea(pathPolygon(path)),29.2*3.2);});assert.deepEqual(source,before);
    const cut={...p,zonePaths:[...p.zonePaths,...paths]};assert.deepEqual(connectionOpeningPaths(cut,source,'repeat'),[]);
  }
  assert.deepEqual(connectionOpeningPaths(p,entity('s','stairs','未连接',0,0),'none'),[]);
});
