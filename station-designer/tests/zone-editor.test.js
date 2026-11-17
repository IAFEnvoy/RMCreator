import test from 'node:test';
import assert from 'node:assert/strict';
import { ZoneEditor } from '../src/zone-editor.js';
import { corner, distance, flattenPath } from '../src/zone-path.js';
import { defaultProject } from '../src/project.js';

// Exercise the actual pointer state machine without a GPU or DOM renderer.
const event=(x,z,extra={})=>({clientX:x,clientY:z,x,z,button:0,...extra});
function editor(drawing=true){
  const e=Object.create(ZoneEditor.prototype),saved=[],messages=[];
  Object.assign(e,{path:{id:'zone-test',floor:'B2',kind:'paid',closed:!drawing,vertices:[]},drawing,contour:-1,selected:new Set(),mode:drawing?'pen':'direct',marquee:{hidden:true,style:{}},scene:{controls:{enabled:true},renderer:{domElement:{style:{}}},callbacks:{onZoneChange:path=>saved.push(structuredClone(path)),onZoneMessage:s=>messages.push(s)},project:{zonePaths:[]}},notify(){},render(){},worldPoint(e){return {x:e.x,z:e.z};},local(e){return {x:e.x,y:e.z,z:e.z};},screen(p){return {x:p.x,y:p.z};},tolerance(){return 2;},snapped(p,e,{anchor,handles=false}={}){return p;},hitPoint(e){let hit;this.ring.vertices.forEach((v,i)=>{for(const side of ['handleIn','handleOut'])if(this.selected.has(i)&&v[side]&&distance(v[side],e)<.2)hit={index:i,side};if(!hit&&distance(v.pos,e)<.2)hit={index:i};});return hit;}});
  e.saved=saved;e.messages=messages;return e;
}
test('click creates corners, dragging creates smooth handles, and closure ends vertex appending',()=>{
  const e=editor();e.pointerDown(event(0,0));e.pointerUp();e.pointerDown(event(20,0));e.pointerMove(event(30,10));e.pointerUp();e.pointerDown(event(20,20));e.pointerUp();
  assert.equal(e.path.vertices[0].type,'corner');assert.equal(e.path.vertices[1].type,'smooth');assert.deepEqual(e.path.vertices[1].handleIn,{x:10,z:-10});assert.deepEqual(e.path.vertices[1].handleOut,{x:30,z:10});
  e.pointerDown(event(0,0));assert.equal(e.drawing,false);assert.equal(e.path.closed,true);assert.equal(e.saved.length,1);assert.equal(e.mode,'direct');
  e.pointerDown(event(40,40));e.pointerUp();assert.equal(e.path.vertices.length,3);
});
test('Ctrl temporarily edits a draft point and releasing it resumes the same pen path',()=>{
  const e=editor();e.pointerDown(event(0,0));e.pointerUp();e.pointerDown(event(20,0));e.pointerUp();
  e.pointerDown(event(20,0,{ctrlKey:true}));e.pointerMove(event(25,8,{ctrlKey:true}));e.pointerUp();assert.equal(e.path.vertices.length,2);assert.deepEqual(e.path.vertices[1].pos,{x:25,z:8});assert.equal(e.drawing,true);assert.equal(e.saved.length,0);
  e.pointerDown(event(30,30));e.pointerUp();assert.equal(e.path.vertices.length,3);assert.equal(e.mode,'pen');
  e.key({key:'Backspace'});assert.equal(e.path.vertices.length,2);
});
test('Alt dragging breaks a smooth handle without moving its opposite handle',()=>{
  const e=editor(false);e.path.vertices=[corner({x:0,z:0}),{pos:{x:20,z:0},type:'smooth',handleIn:{x:10,z:0},handleOut:{x:30,z:0}},corner({x:20,z:20})];e.selected=new Set([1]);
  e.pointerDown(event(30,0));e.pointerMove(event(32,12,{altKey:true}));e.pointerUp();assert.equal(e.path.vertices[1].type,'cusp');assert.deepEqual(e.path.vertices[1].handleIn,{x:10,z:0});assert.deepEqual(e.path.vertices[1].handleOut,{x:32,z:12});assert.equal(e.saved.length,1);
});
test('marquee and Shift selection support batch moves and type conversions',()=>{
  const e=editor(false);e.path.vertices=[corner({x:0,z:0}),corner({x:20,z:0}),corner({x:20,z:20}),corner({x:0,z:20})];
  e.pointerDown(event(-2,-2));e.pointerMove(event(22,2));e.pointerUp();assert.deepEqual([...e.selected],[0,1]);
  e.pointerDown(event(0,0));e.pointerMove(event(5,8));e.pointerUp();assert.deepEqual(e.path.vertices[0].pos,{x:5,z:8});assert.deepEqual(e.path.vertices[1].pos,{x:25,z:8});assert.deepEqual(e.path.vertices[2].pos,{x:20,z:20});
  e.convert('smooth');assert.equal(e.path.vertices[0].type,'smooth');assert.equal(e.path.vertices[1].type,'smooth');
});
test('incomplete closure stays in drawing mode and Escape discards the full draft',()=>{
  const e=editor();e.pointerDown(event(0,0));e.pointerUp();e.close();assert.equal(e.drawing,true);assert.equal(e.saved.length,0);assert.ok(e.messages.length);
  let cancelled=false;e.stop=()=>{e.path=null;};e.scene.callbacks.onZoneCancel=()=>cancelled=true;e.key({key:'Escape'});assert.equal(e.path,null);assert.equal(cancelled,true);
});
test('opening at a selected vertex preserves the entire contour, including its closing segment',()=>{
  const e=editor(false);e.path.vertices=[corner({x:0,z:0}),{pos:{x:20,z:0},type:'smooth',handleIn:{x:10,z:-10},handleOut:{x:30,z:10}},corner({x:20,z:20}),corner({x:0,z:20})];e.selected=new Set([1]);
  const original=structuredClone(e.path),length=path=>{const ps=flattenPath(path);return ps.slice(1).reduce((sum,p,i)=>sum+distance(ps[i],p),0);};e.toggleClosed();assert.equal(e.path.closed,false);assert.equal(e.path.vertices.length,5);assert.deepEqual(e.path.vertices[0].pos,e.path.vertices.at(-1).pos);assert.ok(Math.abs(length(original)-length(e.path))<1e-8);
  e.close();assert.equal(e.path.closed,true);assert.equal(e.path.vertices.length,4);assert.ok(Math.abs(length(original)-length(e.path))<1e-8);
});

test('floor changes keep an unfinished contour and pause input until its floor is visible again',()=>{
  const e=editor();e.pointerDown(event(0,0));e.pointerUp();e.pointerDown(event(20,0));e.pointerUp();
  const original=structuredClone(e.path);let stopped=false;e.stop=()=>{stopped=true;};
  e.scene.activeFloor='B1';e.scene.project={zonePaths:[]};e.sync();
  assert.equal(stopped,false);assert.deepEqual(e.path,original);
  assert.equal(ZoneEditor.prototype.worldPoint.call(e,event(5,5)),null);
  e.scene.activeFloor='all';e.sync();assert.deepEqual(e.path,original);
  e.pointerDown(event(20,20));e.pointerUp();e.close();assert.equal(e.saved.length,1);assert.equal(e.saved[0].floor,'B2');
});

test('rectangle opening uses two corners, validates the landing and enters editable mode with one commit',()=>{
  const e=editor();e.path.kind='opening';e.drawShape='rectangle';e.scene.project=defaultProject();
  e.pointerDown(event(-20,-4));e.pointerUp();assert.equal(e.saved.length,0);assert.equal(e.path.vertices.length,1);
  e.pointerDown(event(-10,4));e.pointerUp();assert.equal(e.saved.length,1);assert.equal(e.drawing,false);assert.equal(e.path.vertices.length,4);assert.equal(e.mode,'direct');assert.equal(e.saved[0].kind,'opening');
  assert.deepEqual(e.path.vertices.map(v=>v.pos),[{x:-20,z:-4},{x:-10,z:-4},{x:-10,z:4},{x:-20,z:4}]);
  e.selected=new Set([0]);e.pointerDown(event(-20,-4));e.pointerMove(event(-26,-7));e.pointerUp();assert.equal(e.saved.length,2);assert.deepEqual(e.path.vertices[0].pos,{x:-26,z:-7});
});

test('empty or collapsed opening attempts stay in draft; switching to pen preserves its first corner',()=>{
  const e=editor();e.path.kind='opening';e.drawShape='rectangle';e.scene.project=defaultProject();
  e.pointerDown(event(200,200));e.pointerUp();e.pointerDown(event(200,210));e.pointerUp();assert.equal(e.saved.length,0);assert.equal(e.drawing,true);
  e.pointerDown(event(210,210));e.pointerUp();assert.equal(e.saved.length,0);assert.equal(e.path.vertices.length,1);assert.match(e.messages.at(-1),/相交/);
  e.undoPoint();e.pointerDown(event(-20,-4));e.pointerUp();e.setDrawShape('pen');assert.equal(e.path.vertices.length,1);
  e.pointerDown(event(-10,-4));e.pointerMove(event(-8,-8));e.pointerUp();e.pointerDown(event(-10,4));e.pointerUp();e.key({key:'Enter'});assert.equal(e.saved.length,1);assert.equal(e.path.vertices[1].type,'smooth');
});
