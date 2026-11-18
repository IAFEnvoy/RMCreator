import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProject, createObject, exampleProject, readProject, lineTerminator, objectBounds, distance, mix, moveNode, translateObject, splitSegment } from '../src/model.js';
import { objectMarkup, exportSVG } from '../src/render.js';
import { LayoutEditor } from '../src/editor.js';
import { LayoutFiles } from '../src/files.js';

const siding=points=>createObject('line',{points,dash:'siding',color:'#df7455',width:5});
const close=(a,b)=>assert.ok(distance(a,b)<1e-8,`${JSON.stringify(a)} != ${JSON.stringify(b)}`);

test('buffer stops stay centered on the end and perpendicular to straight or curved tangents',()=>{
  for(const end of [{x:100,y:0},{x:0,y:100},{x:-100,y:40},{x:100,y:100,control:{x:100,y:0}},{x:100,y:100,control:{x:100,y:100}}]){
    const start={x:0,y:0},o=siding([start,end]),stop=lineTerminator(o),from=end.control&&distance(end.control,end)>0?end.control:start;
    close(mix(stop.a,stop.b,.5),end);
    const dot=(stop.b.x-stop.a.x)*(end.x-from.x)+(stop.b.y-stop.a.y)*(end.y-from.y);
    assert.ok(Math.abs(dot)<1e-8);assert.equal(stop.width,4);assert.ok(Math.abs(distance(stop.a,stop.b)-26)<1e-8);
  }
});
test('ordinary line styles have no stop; line edits and curve splits carry the stop automatically',()=>{
  const o=siding([{x:0,y:0},{x:200,y:100,control:{x:200,y:0}}]);
  for(const dash of ['solid','dashed','dotted'])assert.equal(lineTerminator({...o,dash}),null);
  const moved=moveNode(o,1,{x:300,y:200}),stop=lineTerminator(moved);
  close(mix(stop.a,stop.b,.5),{x:300,y:200});
  const translated=lineTerminator(translateObject(o,23,-17)),original=lineTerminator(o);
  close(translated.a,{x:original.a.x+23,y:original.a.y-17});
  close(translated.b,{x:original.b.x+23,y:original.b.y-17});
  assert.deepEqual(lineTerminator(splitSegment(o,1,.37)),original);
  const reversed=siding([{x:200,y:100},{x:0,y:0,control:{x:200,y:0}}]),reverseStop=lineTerminator(reversed);
  close(mix(reverseStop.a,reverseStop.b,.5),{x:0,y:0});
  assert.equal(o.points[1].x,200);
});
test('thick buffer stops fit within the computed drawing bounds',()=>{
  const o={...siding([{x:0,y:0},{x:100,y:0}]),width:30},stop=lineTerminator(o),b=objectBounds(o);
  for(const end of [stop.a,stop.b]){
    assert.ok(b.x<=end.x-stop.width/2&&b.right>=end.x+stop.width/2);
    assert.ok(b.y<=end.y-stop.width/2&&b.bottom>=end.y+stop.width/2);
  }
});
test('a buffer stop shares the selectable line, color and export renderer',()=>{
  const o=siding([{x:0,y:0},{x:100,y:0}]),interactive=objectMarkup(o,{interactive:true});
  assert.equal((interactive.match(/data-object=/g)||[]).length,1);
  assert.equal((interactive.match(/class="object-hit"/g)||[]).length,2);
  assert.match(interactive,/<path class="buffer-stop" d="M 100 -13 L 100 13" fill="none" stroke="#df7455" stroke-width="4"/);
  assert.doesNotMatch(interactive,/stroke-dasharray/);
  const p=blankProject();p.objects=[o];const svg=exportSVG(p).source;
  assert.match(svg,/class="buffer-stop"/);assert.doesNotMatch(svg,/data-object|object-hit/);
  assert.doesNotMatch(objectMarkup({...o,visible:false}),/buffer-stop/);
  const arrows=objectMarkup({...o,arrow:'both'});
  assert.match(arrows,/marker-start=/);assert.match(arrows,/marker-end=/);
  assert.match(arrows,/refX="20"/);
});
test('drawing preview uses the same buffer stop rendering as the finished line',()=>{
  const o=siding([{x:0,y:0},{x:100,y:0}]),e=Object.create(LayoutEditor.prototype);
  Object.assign(e,{project:blankProject(),selected:new Set(),svg:{clientWidth:1000},view:{width:1000},overlay:{},style:o,tool:'line',draft:{type:'line',points:[o.points[0]]},pointer:o.points[1]});
  e.drawOverlay();assert.match(e.overlay.innerHTML,/class="buffer-stop" d="M 100 -13 L 100 13"/);
  assert.match(e.overlay.innerHTML,/pointer-events="none"/);
});
test('presets use integrated storage line stops and the file library preserves their type',()=>{
  for(const [kind,count] of [['station',1],['depot',5]]){
    const p=exampleProject(kind);assert.equal(p.objects.filter(o=>o.dash==='siding').length,count);
    assert.equal(p.objects.some(o=>o.name==='存车线尽端'),false);
    assert.equal((exportSVG(p).source.match(/class="buffer-stop"/g)||[]).length,count);
    const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},files=new LayoutFiles(storage);
    files.create(kind,p);assert.deepEqual(new LayoutFiles(storage).current.project,p);
    assert.deepEqual(readProject(JSON.parse(JSON.stringify(p))),p);
  }
  const invalid=exampleProject();invalid.objects[0].dash='invalid';assert.throws(()=>readProject(invalid));
});
function legacyExample(){
  const p=exampleProject(),host=p.objects.find(o=>o.name==='折返线');host.dash='solid';
  p.objects.push(createObject('line',{name:'存车线尽端',points:[{x:1150,y:347},{x:1150,y:373}],color:host.color,width:4}));
  return p;
}
test('only a matching legacy example buffer bar is upgraded, without modifying the source',()=>{
  const old=legacyExample(),before=structuredClone(old),upgraded=readProject(old);
  assert.deepEqual(old,before);assert.equal(upgraded.objects.length,old.objects.length-1);
  assert.equal(upgraded.objects.find(o=>o.name==='折返线').dash,'siding');
  assert.deepEqual(readProject(upgraded),upgraded);
  const reversed=legacyExample();reversed.objects.at(-1).points.reverse();assert.equal(readProject(reversed).objects.length,reversed.objects.length-1);
  for(const edit of [p=>p.objects.at(-1).name='自定义尽端',p=>p.objects.at(-1).points[0].y=340,p=>p.objects.at(-1).color='#222222',p=>p.objects.at(-1).width=6,p=>p.objects.at(-1).locked=true]){
    const custom=legacyExample();edit(custom);assert.deepEqual(readProject(custom),custom);
  }
});
