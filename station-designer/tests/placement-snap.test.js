import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';
import { defaultProject, entity } from '../src/project.js';
import { corner } from '../src/zone-path.js';
import { placementReferences, snapPlacementPoint } from '../src/placement-snap.js';
import { ZoneEditor } from '../src/zone-editor.js';
import { worldPoint, pointAlongTrack, trackGeometry } from '../src/track-path.js';
import { stairEndpoints } from '../src/stair-endpoints.js';
import { makeStairPath, stairWorldNodes } from '../src/stair-path.js';

// Vite imports icon SVGs as strings; their contents are irrelevant to these
// pointer tests, so expose the same string-module shape in Node.
registerHooks({load(url,context,next){return url.includes('.svg')?{format:'module',source:'export default "<svg></svg>"',shortCircuit:true}:next(url,context);}});
const { StationScene }=await import('../src/scene.js');

const p=(x,z)=>({x,z});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
const fixture=()=>({...defaultProject(),snapping:true,entities:[],zones:{B1:{},B2:{}},zonePaths:[]});
const rect=(id,x,z,l=40,d=8,floor='B2')=>({id,floor,kind:'paid',closed:true,vertices:[corner(p(x,z)),corner(p(x+l,z)),corner(p(x+l,z+d)),corner(p(x,z+d))]});

test('placement guides align edges and center lines without rounding exact geometry to a grid',()=>{
  const project=fixture();project.zonePaths=[rect('platform',.23,1.37)];
  const result=snapPlacementPoint(project,'B2',p(20.3,30),{tolerance:.4});
  close(result.point.x,20.23);close(result.point.z,30);assert.equal(result.guides[0].kind,'center');
  const edge=snapPlacementPoint(project,'B2',p(40.3,9.5),{tolerance:.4});
  close(edge.point.x,40.23);close(edge.point.z,9.37);assert.equal(edge.guides.length,2);
  for(const guide of edge.guides){assert.ok(Math.hypot(guide.b.x-guide.a.x,guide.b.z-guide.a.z)>4);}
});

test('offset platforms match equal width and length with dimension references in either drawing direction',()=>{
  const project=fixture();project.zonePaths=[rect('platform',0,0,40,8)];
  for(const sign of [-1,1]){
    const anchor=p(100,50),result=snapPlacementPoint(project,'B2',p(100,50+sign*8.18),{anchor,tolerance:.3});
    close(result.point.z,50+sign*8);assert.ok(result.guides.some(g=>Math.abs((g.measure?.length||0)-8)<1e-6));
    const long=snapPlacementPoint(project,'B2',p(100+sign*40.2,50),{anchor,tolerance:.3});
    close(long.point.x,100+sign*40);assert.ok(long.guides.some(g=>Math.abs((g.measure?.length||0)-40)<1e-6));
  }
});

test('rotated references provide their actual center lines and same-width offsets',()=>{
  const project=fixture(),ref=entity('stairs','stairs','楼梯',12,5,{floor:'B2',l:24,d:3.5,rotation:37});project.entities=[ref];
  const target=worldPoint(ref,p(60,.1)),result=snapPlacementPoint(project,'B2',target,{tolerance:.3});
  const center=worldPoint(ref,p(60,0));close(result.point.x,center.x);close(result.point.z,center.z);
  const anchor=worldPoint(ref,p(100,40)),pointer=worldPoint(ref,p(100,43.6));
  const equal=snapPlacementPoint(project,'B2',pointer,{anchor,tolerance:.3});
  const expected=worldPoint(ref,p(100,43.5));close(equal.point.x,expected.x);close(equal.point.z,expected.z);
  assert.ok(equal.guides.some(g=>Math.abs((g.measure?.length||0)-3.5)<1e-6));
});

test('references ignore hidden, excluded, erased and other-floor geometry; legacy painted cells participate',()=>{
  const project=fixture();project.entities=[entity('hidden','stairs','隐藏',0,0,{floor:'B2',visible:false}),entity('self','stairs','自己',20,0,{floor:'B2'}),entity('other','stairs','其他层',40,0,{floor:'B1'})];
  project.zonePaths=[rect('old',0,30),{...rect('erasure',0,30),kind:'erase'}];
  let refs=placementReferences(project,{floors:['B2'],excludeId:'self'});assert.equal(refs.length,0);
  project.zones.B2={'5,5':'paid','6,5':'paid'};
  refs=placementReferences(project,{floors:['B2'],excludeId:'self'});assert.equal(refs.length,1);
  const r=snapPlacementPoint(project,'B2',p(12.1,30),{references:refs,tolerance:.3});close(r.point.x,12);
});

test('curve reference bounds follow the visible curve, not faraway Bezier handles',()=>{
  const project=fixture(),zone=rect('curve',0,0,20,10);
  zone.vertices[0].handleOut=p(0,-40);zone.vertices[1].handleIn=p(20,-40);project.zonePaths=[zone];
  const refs=placementReferences(project,{floors:['B2']});
  const low=Math.min(...refs[0].points.map(v=>v.z));close(low,-30);
  assert.equal(snapPlacementPoint(project,'B2',p(30,-39.9),{references:refs,tolerance:.3}).snapped,false);
});

test('moving a single-click object snaps its footprint edge without changing size or floor',()=>{
  const project=fixture();project.zonePaths=[rect('platform',0,0)];
  const moving=entity('marker','service','服务中心',44.1,20,{floor:'B2',l:8,d:4});
  const result=snapPlacementPoint(project,'B2',p(moving.x,moving.z),{moving,tolerance:.3});
  close(result.point.x,44);close(result.guides[0].contact.x,40);assert.equal(moving.x,44.1);assert.equal(moving.l,8);
});

test('axis and Shift constraints survive reference snapping; disabled and distant snapping stays free',()=>{
  const project=fixture();project.zonePaths=[rect('platform',0,0)];
  const r=snapPlacementPoint(project,'B2',p(39.9,39.9),{tolerance:.4,constraint:{n:{x:-Math.SQRT1_2,z:Math.SQRT1_2},value:0}});
  close(r.point.x,40);close(r.point.z,40);
  for(const options of [{disabled:true},{tolerance:.01}]){
    const free=snapPlacementPoint(project,'B2',p(39.83,16.71),options);assert.equal(free.snapped,false);assert.deepEqual(free.point,p(39.83,16.71));
  }
  project.snapping=false;assert.equal(snapPlacementPoint(project,'B2',p(0,0)).snapped,false);
});

// Exercise the production placement state machine without a GPU. Pixel/world
// mapping is deterministic, while snapping, preview geometry and validation
// all use the real implementation.
function scene(project,type='stairs',extra={}) {
  const s=Object.create(StationScene.prototype);
  Object.assign(s,{project,activeFloor:'B1',view:'3d',width:1000,camera:{left:-50,right:50,zoom:1},callbacks:{onPlacementChange(){}},floorY(id){return id==='B1'?12:0;},floorOffset(){return 0;},hit(e){this.raycaster={ray:new THREE.Ray(new THREE.Vector3(e.clientX,100,e.clientY),new THREE.Vector3(0,-1,0))};},showSnap(data){this.feedback=data;},placementGuide(a,b){this.endpoints=[a,b];},placementPreview(e,valid){this.preview=e;this.valid=valid;},clearPlacementGroup(){}});
  s.placement={entity:entity('draft',type,'放置',0,0,{floor:'B2',toFloor:'B1',...extra}),start:p(100.23,50.17),twoPoint:true,group:{},guide:{},trackMode:type==='track'?'straight':undefined};
  return s;
}

test('cross-floor stairs use source-floor center references while keeping the clicked start and true slope',()=>{
  const project=fixture();project.entities=[entity('existing','stairs','参考楼梯',120,50.17,{floor:'B2',toFloor:'B1',l:30,d:3.5})];
  const s=scene(project),start={...s.placement.start};
  s.movePlacement({clientX:140.2,clientY:50.3});
  close(s.preview.z,50.17);assert.deepEqual(s.placement.start,start);assert.deepEqual(s.endpoints[0],start);
  close(worldPoint(s.preview,p(-s.preview.l/2,0)).x,start.x);assert.ok(s.feedback.guides.length);assert.equal(s.valid,true);
  s.movePlacement({clientX:105,clientY:50.3});assert.equal(s.valid,false,'alignment cannot bypass maximum slope');
});

test('Alt bypasses guides, rail contacts and grid rounding throughout two-click placement',()=>{
  const project=fixture();project.entities=[entity('host','track','轨道',130.24,50.17,{floor:'B2',l:60,d:4})];
  const s=scene(project,'track',{toFloor:undefined});s.activeFloor='B2';
  s.movePlacement({clientX:140.137,clientY:50.2,altKey:true});
  assert.equal(s.feedback.guides.length,0);assert.equal(s.placement.point.snapped,undefined);close(s.endpoints[0].x,100.23);close(s.endpoints[1].x,140.137);close(s.endpoints[1].z,50.17);
  s.movePlacement({clientX:140.137,clientY:50.2,altKey:false});assert.equal(s.placement.point.snapped,true);
  const host=project.entities[0],contact=pointAlongTrack(host,trackGeometry(host).length*.7,true);
  close(s.endpoints[1].z,contact.z);
});

test('area drawing uses the same equal-width guides and Alt leaves exact free vertex coordinates',()=>{
  const project=fixture();project.zonePaths=[rect('existing',0,0,40,8)];
  const editor=Object.create(ZoneEditor.prototype);
  Object.assign(editor,{path:{id:'draft',floor:'B2',vertices:[corner(p(100,50))]},contour:-1,tolerance(){return .5;},scene:{project,callbacks:{onSnap(){}},showSnap(){}}});
  const result=editor.snapped(p(100.1,58.2),{}, {anchor:p(100,50)});
  close(result.z,58);assert.ok(editor.guides.some(g=>Math.abs((g.measure?.length||0)-8)<1e-6));
  const free=editor.snapped(p(100.123,58.234),{altKey:true},{anchor:p(100,50)});assert.deepEqual(free,p(100.123,58.234));assert.equal(editor.guides.length,0);
});

test('curve placement confirmation keeps the snapped preview endpoint with no whole-path translation',()=>{
  const project=fixture();project.zonePaths=[rect('platform',0,0,40,8)];
  const s=scene(project,'track',{toFloor:undefined});s.activeFloor='B2';s.placement.trackMode='curve';s.placement.points=[p(100.23,50.17),p(120,70)];s.curvePlacementGuide=()=>{};
  s.movePlacement({clientX:140.1,clientY:58.3});
  const path=s.placement.result.entity,start=worldPoint(path,path.path[0]),end=worldPoint(path,path.path.at(-1));
  assert.deepEqual(start,p(100.23,50.17));close(end.x,s.placement.point.x);close(end.z,s.placement.point.z);
});

test('rail contact and a non-grid start are solved together, keeping preview and placement orthogonal',()=>{
  const project=fixture();project.entities=[entity('host','track','斜线',110,60,{floor:'B2',l:100,d:4,rotation:45})];
  const s=scene(project,'track',{toFloor:undefined});s.activeFloor='B2';s.placement.start=p(100.23,50.17);
  s.movePlacement({clientX:100.7,clientY:50.3});
  close(s.endpoints[1].x,100.17);close(s.endpoints[1].z,50.17);assert.equal(s.placement.point.snapped,true);assert.ok(s.feedback.guides.length);
  // A longer run reaches the same rail while retaining the exact chosen start.
  s.placement.start=p(60.23,50.17);s.movePlacement({clientX:100.7,clientY:50.3});
  close(s.endpoints[0].x,60.23);close(s.endpoints[1].z,50.17);close(s.preview.rotation,0);assert.equal(s.valid,true);
});

test('parallel and perpendicular rail placement preserves arbitrary reference angles',()=>{
  const project=fixture();project.entities=[entity('host','track','斜线',0,0,{floor:'B2',l:100,d:4,rotation:37})];
  const start=p(100.23,70.17);
  for(const angle of [37,127]){
    const s=scene(project,'track',{toFloor:undefined});s.activeFloor='B2';s.placement.start=start;
    const a=angle*Math.PI/180;s.movePlacement({clientX:start.x+Math.cos(a)*45+.1,clientY:start.z+Math.sin(a)*45+.1});
    close(s.preview.rotation,angle);assert.deepEqual(s.endpoints[0],start);assert.ok(s.feedback.guides.length);assert.equal(s.valid,true);
  }
});

test('area boundary contacts retain right-angle guides and exact intersections on a diagonal edge',()=>{
  const project=fixture();project.zonePaths=[{id:'triangle',floor:'B2',kind:'paid',closed:true,vertices:[corner(p(0,0)),corner(p(50,50)),corner(p(50,0))]}];
  const editor=Object.create(ZoneEditor.prototype),anchor=p(20.23,35);
  Object.assign(editor,{path:{id:'draft',floor:'B2',vertices:[corner(anchor)]},contour:-1,tolerance(){return .7;},scene:{project,callbacks:{onSnap(){}},showSnap(data){this.feedback=data;}}});
  for(const modifiers of [{},{shiftKey:true}]){
    const q=editor.snapped(p(20.5,20.3),modifiers,{anchor});close(q.x,20.23);close(q.z,20.23);assert.ok(editor.guides.length);assert.equal(editor.snap.snapped,'边界');
  }
  const free=editor.snapped(p(20.5,20.3),{altKey:true},{anchor});assert.deepEqual(free,p(20.5,20.3));assert.equal(editor.guides.length,0);
});

function endpointScene() {
  const project=fixture(),source=entity('existing','stairs','楼梯',15,0,{floor:'B2',toFloor:'B1',l:30});project.entities=[source];
  const s=scene(project);s.placement=null;s.selected=source.id;s.controls={enabled:true};s.renderer={domElement:{style:{}}};s.plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);s.setTool=()=>{};
  s.update=(project,view,floor,id)=>{s.project=project;s.selected=id;};s.commits=[];s.callbacks.onStairEndpointChange=(id,target)=>s.commits.push({id,target});
  s.hit({clientX:30,clientY:0});s.beginStairEndpointDrag({clientX:30,clientY:0},{id:source.id,stairEndpoint:1});
  return s;
}

test('dragging a placed stair endpoint previews from the unchanged source and commits exactly once on release',()=>{
  const s=endpointScene(),base=s.project,source=structuredClone(base.entities[0]);
  s.moveStairEndpointDrag({clientX:40.137,clientY:10.234,altKey:true});assert.equal(s.commits.length,0);assert.deepEqual(base.entities[0],source);
  const ends=stairEndpoints(s.project.entities[0]);close(ends[0].x,0);close(ends[0].z,0);close(ends[1].x,40.137);close(ends[1].z,10.234);
  s.finishStairEndpointDrag();assert.equal(s.commits.length,1);assert.equal(s.commits[0].id,source.id);assert.equal(s.endpointDrag,null);assert.equal(s.controls.enabled,true);
  close(stairEndpoints(s.commits[0].target)[1].x,40.137);
});

test('invalid, cancelled and click-only endpoint drags keep the saved stair and restore camera controls',()=>{
  for(const action of ['invalid','cancel','click']){
    const s=endpointScene(),base=s.project,before=structuredClone(base.entities[0]);
    if(action!=='click')s.moveStairEndpointDrag({clientX:action==='invalid'?1:45,clientY:0,altKey:true});
    action==='cancel'?s.cancelStairEndpointDrag():s.finishStairEndpointDrag();
    assert.equal(s.commits.length,0);assert.deepEqual(s.project.entities[0],before);assert.equal(s.controls.enabled,true);
  }
});

test('placed stair endpoint dragging shares the reference guides and honors Alt without resnapping the fixed end',()=>{
  const s=endpointScene();s.endpointDrag.references=placementReferences({...s.project,zonePaths:[rect('reference',0,10,40,8)]},{floors:['B2','B1'],excludeId:'existing'});
  s.moveStairEndpointDrag({clientX:39.8,clientY:17.9});const aligned=stairEndpoints(s.project.entities[0]);close(aligned[1].x,40);close(aligned[1].z,18);assert.ok(s.feedback.guides.length);
  s.moveStairEndpointDrag({clientX:39.8,clientY:17.9,altKey:true});const free=stairEndpoints(s.project.entities[0]);close(free[1].x,39.8);close(free[1].z,17.9);close(free[0].x,0);close(free[0].z,0);assert.equal(s.feedback.guides.length,0);
});

test('dragging a bend snaps with guides, Alt preserves exact coordinates and cancellation leaves the source intact',()=>{
  for(const cancel of [false,true]){
    const s=endpointScene();s.cancelStairEndpointDrag();
    const source=makeStairPath(s.project.entities[0],[p(0,0),p(30,0),p(30,30)]);s.project.entities=[source];
    const before=structuredClone(source);s.hit({clientX:30,clientY:0});s.beginStairEndpointDrag({clientX:30,clientY:0},{id:source.id,stairEndpoint:2});
    s.endpointDrag.references=placementReferences({...s.project,zonePaths:[rect('reference',0,10,40,8)]},{floors:['B2','B1'],excludeId:source.id});
    s.moveStairEndpointDrag({clientX:39.8,clientY:17.9});let points=stairWorldNodes(s.project.entities[0]);close(points[1].x,40);close(points[1].z,18);assert(s.feedback.guides.length);
    s.moveStairEndpointDrag({clientX:39.8,clientY:17.9,altKey:true});points=stairWorldNodes(s.project.entities[0]);close(points[1].x,39.8);close(points[1].z,17.9);assert.equal(s.feedback.guides.length,0);assert.deepEqual(source,before);
    s.finishStairEndpointDrag(cancel);assert.equal(s.commits.length,cancel?0:1);assert.deepEqual(s.project.entities[0],before);
    if(!cancel)close(stairWorldNodes(s.commits[0].target)[1].x,39.8);
  }
});
