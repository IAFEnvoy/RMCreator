import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProject, createObject, exampleProject, readProject, translateObject, moveNode, splitSegment } from '../src/model.js';
import { objectMarkup, exportSVG } from '../src/render.js';
import { LayoutFiles } from '../src/files.js';
import { LAYOUT_STORAGE_KEYS } from '../../shared/storage-keys.js';
import legacyReferenceLink from '../src/legacy-reference-link.json' with { type: 'json' };

const gradient=points=>createObject('line',{points,color:'#64ca98',gradient:{endColor:'#ec9d49'},dash:'dashed',width:3});
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};};

test('gradient lines round-trip and reject malformed or unsafe endpoint colors',()=>{
  const p=blankProject();p.objects=[gradient([{x:0,y:0},{x:200,y:100,control:{x:200,y:0}}])];
  assert.deepEqual(readProject(JSON.parse(JSON.stringify(p))),p);
  for(const value of [null,[],true,'#ffffff',{}, {endColor:'#fff'},{endColor:'url(#paint)'},{endColor:'" onload="alert(1)'}]){
    const invalid=structuredClone(p);invalid.objects[0].gradient=value;assert.throws(()=>readProject(invalid),/渐变/);
  }
  delete p.objects[0].gradient;assert.deepEqual(readProject(p),p);
  assert.doesNotMatch(exportSVG(p).source,/linearGradient/);
});

test('one dashed SVG path uses a unique continuous gradient in both editor and export',()=>{
  const a=gradient([{x:0,y:0},{x:100,y:-100,control:{x:50,y:-100}},{x:200,y:100,control:{x:200,y:-100}}]),b={...structuredClone(a),id:'other-line'};
  const interactive=objectMarkup(a,{interactive:true});
  assert.equal((interactive.match(/data-object=/g)||[]).length,1);
  assert.equal((interactive.match(/stroke-dasharray=/g)||[]).length,1);
  const p=blankProject();p.objects=[a,b];const source=exportSVG(p).source;
  for(const line of [a,b]){
    assert.match(source,new RegExp(`id="gradient-${line.id}"`));
    assert.ok(source.includes(`stroke="url(#gradient-${line.id})"`));
  }
  assert.equal((source.match(/<linearGradient /g)||[]).length,2);
  assert.equal((source.match(/stroke-dasharray="9 6"/g)||[]).length,2);
  assert.doesNotMatch(source,/object-hit|data-object|editing-overlay/);
  assert.match(source,/gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="200" y2="100"/);
  assert.match(source,/<stop offset="0" stop-color="#64ca98"\/><stop offset="1" stop-color="#ec9d49"\/>/);
});

test('vertical, horizontal, reversed and closed paths have a non-degenerate gradient axis',()=>{
  for(const [points,axis] of [
    [[{x:25,y:30},{x:25,y:230}],'x1="25" y1="30" x2="25" y2="230"'],
    [[{x:25,y:30},{x:225,y:30}],'x1="25" y1="30" x2="225" y2="30"'],
    [[{x:25,y:230},{x:25,y:30}],'x1="25" y1="230" x2="25" y2="30"'],
    [[{x:0,y:0},{x:200,y:0},{x:0,y:0}],'x1="0" y1="0" x2="200" y2="0"'],
  ])assert.ok(objectMarkup(gradient(points)).includes(axis));
});

test('gradient colors survive geometric editing and follow the moved endpoints',()=>{
  const o=gradient([{x:0,y:0},{x:200,y:100,control:{x:200,y:0}}]);
  const moved=moveNode(o,1,{x:300,y:200}),translated=translateObject(o,30,-20),split=splitSegment(o,1,.4);
  for(const edit of [moved,translated,split])assert.deepEqual(edit.gradient,o.gradient);
  assert.match(objectMarkup(translated),/x1="30" y1="-20" x2="230" y2="80"/);
  assert.match(objectMarkup(moved),/x1="0" y1="0" x2="300" y2="200"/);
  assert.match(objectMarkup(split),/x1="0" y1="0" x2="200" y2="100"/);
  const endStyle=objectMarkup({...o,dash:'siding',arrow:'both'});
  assert.match(endStyle,/<path class="buffer-stop"[^>]*stroke="#ec9d49"/);
  assert.match(endStyle,/<marker[^>]*-end"[^>]*><path[^>]*stroke="#ec9d49"/);
  assert.match(endStyle,/<marker[^>]*-start"[^>]*><path[^>]*stroke="#64ca98"/);
});

function legacyProject(){
  const p=exampleProject('interchange'),index=p.objects.findIndex(o=>o.id==='reference-14');
  p.objects.splice(index,1,...structuredClone(legacyReferenceLink));return p;
}

test('only the unchanged eight-piece reference link upgrades to one editable gradient line',()=>{
  const p=legacyProject(),before=structuredClone(p),expected=exampleProject('interchange');
  assert.equal(p.objects.length,23);assert.deepEqual(readProject(p),expected);assert.deepEqual(p,before);
  assert.deepEqual(readProject(readProject(p)),expected);
  for(const edit of [
    p=>p.objects.find(o=>o.id==='reference-14').points[0].x++,
    p=>p.objects.find(o=>o.id==='reference-15').name='我的联络线',
    p=>p.objects.find(o=>o.id==='reference-16').color='#ffffff',
    p=>p.objects.find(o=>o.id==='reference-17').visible=false,
    p=>p.objects.find(o=>o.id==='reference-18').locked=true,
    p=>p.objects.splice(p.objects.findIndex(o=>o.id==='reference-19'),1),
  ]){const custom=legacyProject();edit(custom);assert.deepEqual(readProject(custom),custom);}
});

test('saved legacy libraries upgrade in memory, keep their active file, and persist the gradient on save',()=>{
  const s=storage(),legacy=legacyProject(),date='2026-11-18T12:00:00.000Z';
  const files={version:1,activeId:'my-gaozeng',files:[{id:'my-gaozeng',title:legacy.name,project:legacy,updatedAt:date},{id:'custom',title:'我的图纸',project:blankProject(),updatedAt:date}]};
  const raw=JSON.stringify(files);s.setItem(LAYOUT_STORAGE_KEYS.workspace,raw);
  const library=new LayoutFiles(s);assert.equal(library.current.id,'my-gaozeng');assert.equal(library.current.project.objects.length,16);
  assert.equal(s.getItem(LAYOUT_STORAGE_KEYS.workspace),raw);assert.deepEqual(library.list().find(f=>f.id==='custom').project,files.files[1].project);
  library.save(library.current.project);
  assert.deepEqual(new LayoutFiles(s).current.project.objects,exampleProject('interchange').objects);
});
