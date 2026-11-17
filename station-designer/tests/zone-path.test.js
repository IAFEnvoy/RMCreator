import test from 'node:test';
import assert from 'node:assert/strict';
import { corner, cubicAt, segmentControls, flattenPath, closestOnPath, insertZoneVertex, removeZoneVertex, moveZoneVertices, moveZoneHandle, convertZoneVertices, constrainPoint, zonePathError, distance } from '../src/zone-path.js';
import { zoneMasks, pathPolygon, polygonArea, vectorizeCells, snapZonePoint, cutOpenings } from '../src/zone-geometry.js';
import { defaultProject, migrateProject, isProject, entity } from '../src/project.js';
import { generateBoundaries, zoneStats, snapTrack } from '../src/zones.js';

const p=(x,z)=>({x,z});
const rect=(id,kind,x=0,z=0,l=20,d=20)=>({id,floor:'B2',kind,closed:true,vertices:[corner(p(x,z)),corner(p(x+l,z)),corner(p(x+l,z+d)),corner(p(x,z+d))]});
const fixture=()=>({...defaultProject(),zones:{B2:{},B1:{}},entities:[],zonePaths:[]});
const close=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const curve=()=>({id:'zone-test',floor:'B2',kind:'paid',closed:true,vertices:[{pos:p(0,0),type:'cusp',handleOut:p(8,-12)},{pos:p(20,0),type:'cusp',handleIn:p(12,-12)},corner(p(20,20)),corner(p(0,20))]});

test('corner segments remain straight; cubic handles produce a grid-independent curved fill',()=>{
  close(polygonArea(pathPolygon(rect('r','paid'))),400);
  const path=curve(),mid=cubicAt(segmentControls(path,0),.5);close(mid.x,10);close(mid.z,-9);
  assert.ok(flattenPath(path).length>15);assert.ok(polygonArea(pathPolygon(path))>500);assert.equal(zonePathError(path),'');
});
test('inserting a cubic point uses exact de Casteljau subdivision without deforming the outline',()=>{
  const source=curve(),split=.37,next=insertZoneVertex(source,0,split);
  assert.equal(next.vertices.length,5);assert.equal(next.vertices[1].type,'smooth');assert.equal(zonePathError(next),'');
  for(let i=0;i<=100;i++){const t=i/100,a=cubicAt(segmentControls(source,0),t),b=t<=split?cubicAt(segmentControls(next,0),t/split):cubicAt(segmentControls(next,1),(t-split)/(1-split));assert.ok(distance(a,b)<1e-8);}
  const straight=insertZoneVertex(rect('r','paid'),0,.25);assert.equal(straight.vertices[1].type,'corner');assert.deepEqual(straight.vertices[1].pos,p(5,0));
});
test('smooth handles rotate together while retaining independent lengths; Alt creates a cusp',()=>{
  let path=convertZoneVertices(rect('r','paid'),[0],'smooth');path.vertices[0].handleIn=p(-3,0);path.vertices[0].handleOut=p(7,0);
  const next=moveZoneHandle(path,0,'handleOut',p(0,10));assert.deepEqual(next.vertices[0].handleIn,p(0,-3));assert.equal(zonePathError(next),'');
  const broken=moveZoneHandle(next,0,'handleOut',p(8,8),true);assert.equal(broken.vertices[0].type,'cusp');assert.deepEqual(broken.vertices[0].handleIn,p(0,-3));
  const cornered=convertZoneVertices(broken,[0],'corner');assert.equal(cornered.vertices[0].handleIn,undefined);assert.equal(cornered.vertices[0].handleOut,undefined);
});
test('moving several vertices translates their handles and preserves unselected vertices',()=>{
  const source=curve(),next=moveZoneVertices(source,[0,1],p(2,4));assert.deepEqual(next.vertices[0].handleOut,p(10,-8));assert.deepEqual(next.vertices[1].handleIn,p(14,-8));assert.deepEqual(source.vertices[2],next.vertices[2]);
});
test('removing a curved point fits a cubic and retains endpoint tangent directions',()=>{
  const source=curve(),split=insertZoneVertex(source,0,.5),next=removeZoneVertex(split,1);
  assert.equal(next.vertices.length,4);assert.ok(next.vertices[0].handleOut);assert.ok(next.vertices[1].handleIn);
  const before=segmentControls(source,0),after=segmentControls(next,0);assert.ok(distance(cubicAt(before,.5),cubicAt(after,.5))<.8);assert.equal(zonePathError(next),'');
  assert.equal(removeZoneVertex({vertices:rect('r','paid').vertices.slice(0,3),closed:true},1).vertices.length,3);
});
test('point projection and 45 degree constraints support precise segment selection',()=>{
  const source=curve(),q=cubicAt(segmentControls(source,0),.42),hit=closestOnPath(source,q);assert.equal(hit.segment,0);close(hit.t,.42,1e-6);assert.ok(hit.distance<1e-5);
  const constrained=constrainPoint(p(0,0),p(8,7));close(constrained.x,constrained.z);
});
test('filled paths compose by drawing order; erasing creates a real hole without rasterization',()=>{
  const project=fixture();project.zonePaths=[rect('paid','paid'),rect('staff','staff',10,0,10,20),rect('erase','erase',2,2,4,4)];
  const masks=zoneMasks(project,'B2');close(polygonArea(masks.paid),184);close(polygonArea(masks.staff),200);assert.equal(masks.paid[0].length,2);
  assert.deepEqual(zoneStats(project,'B2'),{paid:184,unpaid:0,staff:200});
  project.zonePaths[2].closed=false;close(polygonArea(zoneMasks(project,'B2').paid),200);
});
test('legacy grid conversion preserves all colors, areas, holes and automatic facilities',()=>{
  const project=defaultProject(),before=structuredClone(project),stats=zoneStats(project,'B1'),count=generateBoundaries(project,'B1').length;
  vectorizeCells(project,'B1');assert.deepEqual(project.zones.B1,{});assert.deepEqual(zoneStats(project,'B1'),stats);assert.equal(generateBoundaries(project,'B1').length,count);assert.ok(isProject(project));
  assert.deepEqual(before.zones.B1['0,0'],'paid');assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(project))),project);
  const hole=fixture();hole.zones.B2={'0,0':'paid','1,0':'paid','2,0':'paid','0,1':'paid','2,1':'paid','0,2':'paid','1,2':'paid','2,2':'paid'};vectorizeCells(hole,'B2');assert.equal(hole.zonePaths[0].holes.length,1);close(polygonArea(zoneMasks(hole,'B2').paid),32);
});
test('vertex, boundary and grid snapping prioritizes actual geometry; disabled snapping stays free',()=>{
  const project=fixture();project.zonePaths=[rect('r','paid',.3,.4,20,20)];
  const v=snapZonePoint(project,'B2',p(.7,.6),{tolerance:1});assert.equal(v.snapped,'顶点');close(v.x,.3);close(v.z,.4);
  const edge=snapZonePoint(project,'B2',p(9.3,.7),{tolerance:1});assert.equal(edge.snapped,'边界');close(edge.z,.4);
  const grid=snapZonePoint(project,'B2',p(30.2,30.3),{tolerance:1});assert.equal(grid.snapped,'网格');close(grid.x,30);close(grid.z,30);
  project.snapping=false;assert.deepEqual(snapZonePoint(project,'B2',p(.7,.6)),p(.7,.6));
});
test('snapping excludes the contour being dragged and honors angular constraints',()=>{
  const project=fixture();project.zonePaths=[rect('r','paid',.3,.4)];
  const free=snapZonePoint(project,'B2',p(10.8,.5),{tolerance:.6,excludeId:'r'});assert.equal(free.snapped,undefined);
  const locked=snapZonePoint(project,'B2',p(10,10),{tolerance:1,anchor:p(0,0),constrain:true});close(locked.x,locked.z);
});
test('vector paid/unpaid shared edges generate railings and gate openings remain clear',()=>{
  const project=fixture();project.zonePaths=[rect('a','paid',0,0,20,10),rect('b','unpaid',0,10,20,10)];
  let edges=generateBoundaries(project,'B2');assert.equal(edges.length,1);close(Math.hypot(edges[0].x2-edges[0].x1,edges[0].z2-edges[0].z1),20);
  project.entities=[entity('g','gates','闸机',10,10,{floor:'B2',rotation:90,d:2})];edges=generateBoundaries(project,'B2');assert.equal(edges.length,2);assert.ok(edges[0].x2<10&&edges[1].x1>10);
});
test('diagonal shared boundaries stay diagonal and a straight platform side supports track snapping and screen doors',()=>{
  const project=fixture();project.zonePaths=[{...rect('a','paid'),vertices:[corner(p(0,0)),corner(p(20,20)),corner(p(0,20))]},{...rect('b','unpaid'),vertices:[corner(p(0,0)),corner(p(20,0)),corner(p(20,20))]}];
  const rails=generateBoundaries(project,'B2');assert.equal(rails.length,1);close(Math.abs(rails[0].x2-rails[0].x1),20);close(Math.abs(rails[0].z2-rails[0].z1),20);
  project.zonePaths=[rect('p','paid',0,0,20,10)];const track=entity('t','track','轨道',10,14,{floor:'B2',l:30,d:4,lineId:'line-1',doorStyle:'half'});const snapped=snapTrack(project,track);close(snapped.z,12);project.entities=[snapped];assert.equal(generateBoundaries(project,'B2').filter(e=>e.kind==='screen').length,1);
});
test('opening a contour removes fill and boundaries while preserving handles for reclosure and persistence',()=>{
  const project=fixture(),path=curve();project.zonePaths=[path];const before=structuredClone(path);path.closed=false;assert.equal(zoneMasks(project,'B2').paid.length,0);assert.equal(generateBoundaries(project,'B2').length,0);assert.ok(isProject(project));path.closed=true;assert.deepEqual(project.zonePaths[0],before);assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(project))),project);
});
test('curved paid/unpaid contact generates facilities along the curve rather than a cell staircase',()=>{
  const project=fixture(),paid=curve();project.zonePaths=[rect('background','unpaid',-10,-20,40,50),paid];
  const rails=generateBoundaries(project,'B2').filter(e=>e.kind==='railing');assert.ok(rails.length>10);
  assert.ok(rails.some(e=>Math.abs(e.x2-e.x1)>.05&&Math.abs(e.z2-e.z1)>.05));
  const closest=Math.min(...rails.flatMap(e=>[Math.hypot(e.x1-10,e.z1+9),Math.hypot(e.x2-10,e.z2+9)]));assert.ok(closest<.1);
  assert.ok(rails.every(e=>Number.isFinite(e.nx)&&Number.isFinite(e.nz)));
});
test('real staircase openings subtract from curved floor surfaces',()=>{
  const source=pathPolygon(curve()),cut=cutOpenings(source,[{x:10,z:10,l:4,d:4,rotation:0}]);close(polygonArea(source)-polygonArea(cut),3.2*3.2);
});
test('invalid paths and malformed imports fail before rendering',()=>{
  const project=fixture(),path=curve();project.zonePaths=[path];assert.ok(isProject(project));
  path.vertices[0].pos.x=Infinity;assert.equal(isProject(project),false);assert.throws(()=>migrateProject(project));
  assert.ok(zonePathError({vertices:[],closed:true}));assert.ok(zonePathError({vertices:[corner(p(0,0)),corner(p(1,1)),corner(p(2,2))],closed:true}));
});
