import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProject, createObject, exampleProject, readProject, projectError, quadratic, segmentPoint, splitSegment, moveNode, translateObject, snapPoint, distance } from '../src/model.js';
import { LayoutFiles } from '../src/files.js';
import { exportSVG } from '../src/render.js';
import { LayoutEditor } from '../src/editor.js';
import { LAYOUT_STORAGE_KEYS, ROUTE_STORAGE_KEYS, STATION_STORAGE_KEYS } from '../../shared/storage-keys.js';

const line=points=>createObject('line',{points});
const storage=()=>{const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
const close=(a,b)=>assert.ok(distance(a,b)<1e-8,`${JSON.stringify(a)} != ${JSON.stringify(b)}`);

test('editable presets round-trip and remain flat lines, platforms and text',()=>{
  for(const kind of ['station','depot','interchange']){
    const p=exampleProject(kind);assert.equal(projectError(p),'');assert.deepEqual(readProject(JSON.parse(JSON.stringify(p))),p);
    assert.ok(p.objects.every(o=>['line','platform','text'].includes(o.type)));
  }
  const platforms=exampleProject().objects.filter(o=>o.type==='platform');
  assert.equal(platforms.length,1);
  assert.equal(platforms[0].y-platforms[0].height/2,308);
  assert.equal(platforms[0].y+platforms[0].height/2,412);
});
test('reference interchange exports two platforms, green crossovers and a connected dashed northern link',()=>{
  const p=exampleProject('interchange'),platforms=p.objects.filter(o=>o.type==='platform'),dashes=p.objects.filter(o=>o.dash==='dashed');
  assert.equal(p.name,'广州3、9号线 高增站');
  assert.ok(p.objects.filter(o=>o.name.startsWith('3号线')).every(o=>o.color==='#ec9d49'));
  assert.ok(p.objects.filter(o=>o.name.startsWith('9号线')).every(o=>o.color==='#64ca98'));
  assert.equal(platforms.length,2);assert.notEqual(platforms[0].fill,platforms[1].fill);
  assert.equal(p.settings.names,false);assert.equal(p.settings.grid,false);assert.equal(p.settings.title,false);
  assert.equal(dashes.length,1);assert.equal(dashes[0].name,'顶部虚线联络');
  assert.equal(dashes[0].color,'#64ca98');assert.deepEqual(dashes[0].gradient,{endColor:'#ec9d49'});
  close(dashes[0].points[0],{x:155,y:78});close(dashes.at(-1).points.at(-1),{x:358,y:254});
  for(let i=1;i<dashes.length;i++)close(dashes[i-1].points.at(-1),dashes[i].points[0]);
  assert.ok(p.objects.filter(o=>o.name.startsWith('9号线 · 站前交叉')).length===2);
  assert.ok(p.objects.filter(o=>o.name.startsWith('9号线 · 站后交叉')).length===2);
  const stops=p.objects.filter(o=>o.dash==='siding');assert.equal(stops.length,3);
  assert.deepEqual(stops.filter(o=>o.color==='#64ca98').map(o=>o.points.at(-1)),[{x:267,y:780},{x:254,y:780}]);
  close(stops.find(o=>o.color==='#ec9d49').points.at(-1),{x:321,y:142});
  const svg=exportSVG(p).source;assert.match(svg,/stroke-dasharray/);assert.doesNotMatch(svg,/<text|layout-grid/);
  p.objects[0].points[0].x=0;assert.equal(exampleProject('interchange').objects[0].points[0].x,54);
});
test('invalid imports reject duplicate IDs, invalid curves, coordinates and colors',()=>{
  const p=blankProject();p.objects=[line([{x:0,y:0},{x:100,y:0}])];
  for(const mutate of [p=>p.objects.push(p.objects[0]),p=>p.objects[0].color='url(javascript:bad)',p=>p.objects[0].points[0].control={x:1,y:1},p=>p.objects[0].points[1].x=Infinity,p=>p.objects[0].points[1]={x:0,y:0},p=>p.version=2]){
    const invalid=structuredClone(p);mutate(invalid);assert.throws(()=>readProject(invalid));
  }
});
test('quadratic insertion preserves the entire original curve',()=>{
  const o=line([{x:20,y:40},{x:400,y:250,control:{x:200,y:-180}}]),t=.37,next=splitSegment(o,1,t);
  assert.equal(next.points.length,3);
  for(let i=0;i<=100;i++){const u=i/100;close(segmentPoint(o,1,u),u<=t?segmentPoint(next,1,u/t):segmentPoint(next,2,(u-t)/(1-t)));}
  assert.equal(o.points.length,2);
});
test('inserting into a straight segment creates no curve handles',()=>{
  const next=splitSegment(line([{x:0,y:0},{x:200,y:100}]),1,.4);assert.deepEqual(next.points[1],{x:80,y:40});
});
test('moving a vertex and moving a complete line carry their control points',()=>{
  const o=line([{x:0,y:0},{x:100,y:100,control:{x:60,y:0}},{x:200,y:0,control:{x:150,y:100}}]);
  const moved=moveNode(o,1,{x:120,y:120});assert.deepEqual(moved.points[1].control,{x:70,y:10});assert.deepEqual(moved.points[2].control,{x:160,y:110});
  const translated=translateObject(o,20,-10);assert.deepEqual(translated.points[1],{x:120,y:90,control:{x:80,y:-10}});assert.equal(o.points[1].x,100);
});
test('snapping prioritizes existing endpoints, then straight and curved segments',()=>{
  const p=blankProject();p.objects=[line([{x:33,y:37},{x:233,y:37}])];
  assert.equal(snapPoint(p,{x:35,y:35}).snapped,'端点');close(snapPoint(p,{x:35,y:35}),{x:33,y:37});
  const onLine=snapPoint(p,{x:113,y:40});assert.equal(onLine.snapped,'线条');close(onLine,{x:113,y:37});
  p.objects=[line([{x:0,y:0},{x:200,y:0,control:{x:100,y:200}}])];
  const q=quadratic(p.objects[0].points[0],p.objects[0].points[1].control,p.objects[0].points[1],.5);assert.equal(snapPoint(p,q).snapped,'线条');
});
test('Alt bypass, hidden/excluded objects and 45 degree constraints work together',()=>{
  const p=blankProject(),o=line([{x:33,y:37},{x:233,y:37}]);p.objects=[o];
  assert.deepEqual(snapPoint(p,{x:35,y:35},{disabled:true}),{x:35,y:35});
  assert.equal(snapPoint(p,{x:35,y:35},{excludeIds:[o.id]}).snapped,'网格');
  o.visible=false;assert.equal(snapPoint(p,{x:35,y:35}).snapped,'网格');
  const constrained=snapPoint(p,{x:108,y:93},{anchor:{x:0,y:0},constrain:true,disabled:true});assert.equal(constrained.x,constrained.y);
});
test('snapping accepts browser points whose coordinates are prototype accessors',()=>{
  const browserPoint=Object.create({get x(){return 35;},get y(){return 35;}});
  assert.deepEqual(snapPoint(blankProject(),browserPoint,{disabled:true}),{x:35,y:35});
  assert.deepEqual(snapPoint(blankProject(),browserPoint),{x:40,y:40,snapped:'网格'});
});

test('an off-grid snapped start keeps horizontal and vertical guides after leaving its host',()=>{
  const p=blankProject();p.objects=[line([{x:33.27,y:37.41},{x:233.27,y:37.41}])];
  const start=snapPoint(p,{x:34,y:38});close(start,{x:33.27,y:37.41});
  const horizontal=snapPoint(p,{x:310.2,y:38.9},{anchor:start,draft:[start]});
  assert.equal(horizontal.y,start.y);assert.ok(horizontal.guides.length);
  const vertical=snapPoint(p,{x:35,y:205},{anchor:start,draft:[start]});
  assert.equal(vertical.x,start.x);assert.ok(vertical.guides.length);
  close(snapPoint(p,{x:310.2,y:38.9},{anchor:start,disabled:true}),{x:310.2,y:38.9});
});

test('a right-angle endpoint meets the actual sloping line instead of its nearest projection',()=>{
  const p=blankProject();p.objects=[line([{x:0,y:0},{x:300,y:150}])];
  const start={x:200.37,y:200},q=snapPoint(p,{x:203,y:102},{anchor:start,draft:[start]});
  assert.equal(q.snapped,'线条');close(q,{x:start.x,y:start.x/2});assert.ok(q.guides.length);
});

test('nearby off-axis endpoints cannot pull an active horizontal guide out of alignment',()=>{
  const p=blankProject();p.objects=[line([{x:200.27,y:39.41},{x:200.27,y:-100}])];
  const start={x:33.27,y:37.41},q=snapPoint(p,{x:201,y:38},{anchor:start,draft:[start]});
  close(q,{x:200.27,y:37.41});assert.equal(q.snapped,'线条');assert.ok(q.guides.length);
});

test('parallel and perpendicular guides use the angle of a snapped line, with exact Shift curve intersections',()=>{
  const p=blankProject();p.objects=[line([{x:0,y:0},{x:300,y:150}])];
  const anchor={x:100.27,y:90.34},parallel=snapPoint(p,{x:200.27,y:141.4},{anchor});
  assert.ok(Math.abs((parallel.y-anchor.y)-.5*(parallel.x-anchor.x))<1e-8);assert.ok(parallel.guides.length);
  const perpendicular=snapPoint(p,{x:160.9,y:-29.66},{anchor});
  assert.ok(Math.abs((perpendicular.x-anchor.x)+.5*(perpendicular.y-anchor.y))<1e-8);
  p.objects=[line([{x:0,y:0},{x:200,y:0,control:{x:100,y:200}}])];
  const curved=snapPoint(p,{x:49,y:78},{anchor:{x:50,y:200},constrain:true});
  close(curved,{x:50,y:75});assert.equal(curved.snapped,'线条');assert.ok(curved.guides.length);
});

test('finite segments cannot acquire an imaginary intersection beyond their ends',()=>{
  const p=blankProject();p.objects=[line([{x:0,y:0},{x:100,y:50}])];
  const q=snapPoint(p,{x:105,y:52},{anchor:{x:105,y:200},constrain:true,tolerance:8});
  assert.equal(q.x,105);assert.notEqual(q.snapped,'线条');assert.notEqual(q.snapped,'端点');
});
test('SVG export includes styled curves, labels and platforms without editor helpers',()=>{
  const p=exampleProject();p.objects.push(createObject('text',{text:'<设备 & 股道>',name:'标注',x:500,y:550}));p.objects[0].dash='dashed';
  p.objects.push(line([{x:0,y:0},{x:20,y:20}]));p.objects.at(-1).visible=false;
  const out=exportSVG(p);assert.match(out.source,/Q 840 360 900 360/);assert.match(out.source,/stroke-dasharray="15 10"/);assert.match(out.source,/marker-start=/);assert.match(out.source,/&lt;设备 &amp; 股道&gt;/);assert.match(out.source,/1 \/ 2 站台/);
  assert.doesNotMatch(out.source,/data-object|editing-overlay|object-hit|layout-grid|M 0 0 L 20 20/);assert.ok(out.width>1000&&out.height>200);
  p.settings.names=false;assert.doesNotMatch(exportSVG(p).source,/1 \/ 2 站台/);
});
test('a fresh library defaults to an independent copy of the Gaozeng drawing',()=>{
  const first=new LayoutFiles(storage()),second=new LayoutFiles(storage()),project=first.current.project;
  assert.equal(first.current.title,'广州3、9号线 高增站');
  assert.deepEqual(project,exampleProject('interchange'));
  assert.equal(project.objects.length,16);
  first.save({...project,name:'我的方案',objects:[]});
  assert.deepEqual(second.current.project,exampleProject('interchange'));
});

test('the default drawing never replaces an existing library or its active project',()=>{
  const s=storage(),existing=new LayoutFiles(s),legacy=exampleProject('station');
  const first=existing.create(legacy.name,legacy),active=existing.create('我的空白方案',blankProject('我的空白方案'));
  existing.trash(existing.list().find(f=>f.id!==first.id&&f.id!==active.id).id);
  const raw=s.getItem(LAYOUT_STORAGE_KEYS.workspace),reopened=new LayoutFiles(s);
  assert.deepEqual(reopened.current,active);assert.deepEqual(reopened.data,existing.data);
  assert.equal(reopened.list().some(f=>f.title==='广州3、9号线 高增站'),false);
  assert.equal(s.getItem(LAYOUT_STORAGE_KEYS.workspace),raw);
});

test('layout file creation, reopening, rename and trash restore are persistent and isolated',()=>{
  const s=storage(),other=[...Object.values(ROUTE_STORAGE_KEYS),...Object.values(STATION_STORAGE_KEYS)];other.forEach(k=>s.setItem(k,`original:${k}`));
  const f=new LayoutFiles(s);f.save(f.current.project);const initial=f.current.id;
  const p=blankProject('新方案');p.objects=[line([{x:0,y:0},{x:100,y:0}])];const created=f.create('新方案',p);f.rename(created.id,'改名配线');f.open(initial);f.trash(created.id);assert.equal(f.list(true).length,1);f.restore(created.id);f.open(created.id);
  const reopened=new LayoutFiles(s);assert.equal(reopened.current.title,'改名配线');assert.deepEqual(reopened.current.project,p);
  other.forEach(k=>assert.equal(s.getItem(k),`original:${k}`));assert.throws(()=>{f.trash(initial);f.trash(created.id);},/至少保留/);
});
test('a failed storage write does not mutate the in-memory file library',()=>{
  const s=storage(),f=new LayoutFiles(s);f.save(f.current.project);const before=f.current;s.setItem=()=>{throw new Error('quota');};
  assert.throws(()=>f.create('失败的方案',blankProject()),/保存失败/);assert.deepEqual(f.current,before);assert.equal(f.list().length,1);
});
test('concurrent libraries never overwrite newer work',()=>{
  const s=storage(),first=new LayoutFiles(s);first.save(first.current.project);const second=new LayoutFiles(s);first.create('窗口一修改',blankProject());
  assert.throws(()=>second.save(second.current.project),/其他窗口更新/);assert.equal(new LayoutFiles(s).current.title,'窗口一修改');
});
test('corrupt original storage is preserved as recovery before replacement',()=>{
  const s=storage();s.setItem(LAYOUT_STORAGE_KEYS.workspace,'{"broken":true}');const f=new LayoutFiles(s);assert.match(f.warning,/恢复备份/);assert.deepEqual(f.current.project,exampleProject('interchange'));f.save(f.current.project);assert.equal(s.getItem(LAYOUT_STORAGE_KEYS.recovery),'{"broken":true}');assert.equal(new LayoutFiles(s).warning,'');
});

// Exercise the real pointer state machine with a minimal SVG surface; rendering is
// covered by SVG assertions above and a browser smoke test.
function editorHarness(){
  const e=Object.create(LayoutEditor.prototype),messages=[];
  Object.assign(e,{svg:{focus(){},setPointerCapture(){},classList:{add(){},remove(){}},clientWidth:1000},project:blankProject(),selected:new Set(),tool:'select',view:{x:0,y:0,width:1000},style:{color:'#47a58c',width:6,dash:'dashed',arrow:'none'},draft:null,gesture:null,nodeIndex:null,callbacks:{onChange(objects){e.project={...e.project,objects};return true;},onMessage:m=>messages.push(m)}});
  Object.defineProperty(e,'scale',{get:()=>1});e.position=event=>({x:event.clientX,y:event.clientY});e.draw=()=>{};e.drawOverlay=()=>{};
  const target={closest:()=>null},event=(x,y,extra={})=>({button:0,pointerId:1,detail:0,clientX:x,clientY:y,preventDefault(){},target,...extra});
  const click=(x,y,extra)=>{const ev=event(x,y,extra);e.down(ev);e.up(ev);};return {e,messages,event,click};
}
test('drawing from a snapped point commits exactly the same orthogonal endpoint as its preview',()=>{
  const {e,click,event}=editorHarness();e.project.objects=[line([{x:33.27,y:37.41},{x:233.27,y:37.41}]),line([{x:300,y:0},{x:450,y:300}])];
  e.setTool('line');click(34,38);e.move(event(317,38.9));const preview={x:e.pointer.x,y:e.pointer.y};
  click(317,38.9);assert.equal(e.draft.points[1].y,e.draft.points[0].y);close(e.draft.points[1],preview);
  e.finish();const made=e.project.objects.at(-1);close(made.points[1],preview);assert.equal(made.points[0].y,made.points[1].y);
});
test('drawing mixes line and curve segments without losing the unfinished path',()=>{
  const {e,click}=editorHarness();e.setTool('line');click(100,100);click(200,100);e.setTool('curve');assert.equal(e.draft.points.length,2);click(300,100);click(300,200);e.setTool('line');click(500,200);e.finish();
  assert.equal(e.project.objects.length,1);assert.equal(e.tool,'select');assert.deepEqual(e.project.objects[0].points,[{x:100,y:100},{x:200,y:100},{x:300,y:200,control:{x:300,y:100}},{x:500,y:200}]);assert.equal(e.project.objects[0].color,'#47a58c');assert.equal(e.project.objects[0].dash,'dashed');
});

test('gradient preview and continuous mixed-line drawing keep independent color settings',()=>{
  const {e,click}=editorHarness();e.style.gradient={endColor:'#ec9d49'};e.overlay={};
  e.drawOverlay=LayoutEditor.prototype.drawOverlay;
  e.setTool('line');click(100,100);e.pointer={x:200,y:100};e.drawOverlay();
  assert.match(e.overlay.innerHTML,/<linearGradient/);assert.match(e.overlay.innerHTML,/stop-color="#ec9d49"/);
  click(200,100);e.setTool('curve');click(300,100);click(300,200);e.finish(true);
  assert.equal(e.project.objects.length,1);assert.deepEqual(e.project.objects[0].gradient,{endColor:'#ec9d49'});
  e.style.gradient.endColor='#ffffff';
  click(500,100);click(600,100);click(600,200);e.finish();
  assert.equal(e.project.objects[0].gradient.endColor,'#ec9d49');assert.equal(e.project.objects[1].gradient.endColor,'#ffffff');
});
test('storage line type survives mixed-segment placement and continuous placement',()=>{
  const {e,click}=editorHarness();e.style.dash='siding';e.setTool('line');click(100,100);click(200,100);
  e.setTool('curve');click(300,100);click(300,200);e.finish(true);
  assert.equal(e.project.objects.length,1);assert.equal(e.project.objects[0].dash,'siding');assert.equal(e.tool,'curve');
  click(500,100);click(600,100);click(600,200);e.finish();
  assert.equal(e.project.objects.length,2);assert.equal(e.project.objects[1].dash,'siding');assert.equal(e.tool,'select');
});

test('double-click places one final polyline vertex and finishes despite zero pointerdown detail',()=>{
  const {e,click,event,messages}=editorHarness();e.setTool('line');click(100,100);click(200,100);
  click(300,200);click(300,200);e.doubleClick(event(300,200,{detail:2}));
  assert.equal(e.project.objects.length,1);assert.equal(e.tool,'select');assert.equal(e.draft,null);
  assert.deepEqual(e.project.objects[0].points,[{x:100,y:100},{x:200,y:100},{x:300,y:200}]);
  assert.equal(e.project.objects[0].dash,'dashed');assert.deepEqual(messages,[]);
});
test('double-click cursor drift replaces both presses with the snapped final point',()=>{
  const {e,click,event}=editorHarness();e.project.objects=[line([{x:33.27,y:37.41},{x:233.27,y:37.41}]),line([{x:300,y:0},{x:450,y:300}])];
  e.setTool('line');click(34,38);click(317,38.9);click(319,39.5);e.doubleClick(event(319,39.5,{detail:2}));
  const made=e.project.objects.at(-1);assert.equal(made.points.length,2);close(made.points[0],{x:33.27,y:37.41});
  close(made.points[1],{x:300+made.points[0].y/2,y:made.points[0].y});
});
test('Alt double-click keeps the precise last position and Shift double-click repeats placement',()=>{
  const {e,click,event}=editorHarness();e.setTool('line');click(100,100);
  click(203.2,157.8,{altKey:true});click(205.4,159.6,{altKey:true});e.doubleClick(event(205.4,159.6,{altKey:true}));
  assert.deepEqual(e.project.objects[0].points,[{x:100,y:100},{x:205.4,y:159.6}]);
  e.setTool('line');click(400,400);click(500,494,{shiftKey:true});click(503,498,{shiftKey:true});e.doubleClick(event(503,498,{shiftKey:true}));
  assert.equal(e.project.objects.length,2);assert.equal(e.tool,'line');assert.equal(e.draft,null);
  const last=e.project.objects.at(-1).points;assert.equal(last.length,2);assert.equal(last[1].x-last[0].x,last[1].y-last[0].y);
  click(600,400);assert.deepEqual(e.draft.points,[{x:600,y:400}]);
});
test('double-click on the current endpoint finishes without duplicating it, but cannot finish a one-point path',()=>{
  const {e,click,event}=editorHarness();e.setTool('line');click(100,100);click(100,100);e.doubleClick(event(100,100));
  assert.equal(e.project.objects.length,0);assert.equal(e.draft.points.length,1);
  click(300,100);click(300,100);click(300,100);e.doubleClick(event(300,100));
  assert.equal(e.project.objects.length,1);assert.equal(e.project.objects[0].points.length,2);
});
test('double-click at the vertex limit replaces its two presses and keeps valid mixed geometry',()=>{
  const {e,click,event}=editorHarness();e.setTool('line');
  e.draft={type:'line',points:Array.from({length:127},(_,i)=>({x:i*20,y:0,...(i===1?{control:{x:10,y:-10}}:{})}))};
  click(2600,100);click(2604,103,{altKey:true});e.doubleClick(event(2604,103,{altKey:true}));
  assert.equal(e.project.objects.length,1);const made=e.project.objects[0];assert.equal(made.points.length,128);
  close(made.points.at(-1),{x:2604,y:103});assert.deepEqual(made.points[1].control,{x:10,y:-10});assert.equal(projectError(e.project),'');
});
test('double-click leaves curve placement and secondary mouse buttons alone',()=>{
  const {e,click,event}=editorHarness();e.setTool('curve');click(100,100);click(200,100);
  const draft=structuredClone(e.draft);e.doubleClick(event(200,100));assert.deepEqual(e.draft,draft);assert.equal(e.project.objects.length,0);
  e.setTool('line');const before=structuredClone(e.draft);e.doubleClick(event(300,100,{button:2}));assert.deepEqual(e.draft,before);
});

test('right navigation preserves unfinished curves, selection and the next left click',()=>{
  const {e,click,event}=editorHarness();e.applyView=()=>{};e.setTool('curve');click(100,100);click(200,100);
  const draft=structuredClone(e.draft);e.selected=new Set(['keep-selection']);
  e.down(event(300,200,{button:2,shiftKey:true}));e.move(event(400,250,{buttons:2}));
  e.up(event(400,250,{button:1}));assert.equal(e.gesture.kind,'pan');
  e.up(event(400,250,{button:2}));assert.equal(e.gesture,null);assert.deepEqual(e.view,{x:-100,y:-50,width:1000});
  assert.deepEqual(e.draft,draft);assert.deepEqual([...e.selected],['keep-selection']);assert.equal(e.project.objects.length,0);
  click(400,300,{button:1});assert.deepEqual(e.draft,draft);
  click(300,200);assert.equal(e.draft.points.length,2);assert.equal(e.draft.control,undefined);
});
test('curve completion refuses an unfinished control point and Backspace recovers it',()=>{
  const {e,click,messages}=editorHarness();e.setTool('curve');click(0,0);click(100,0);click(100,100);click(200,100);e.finish();assert.equal(e.project.objects.length,0);assert.match(messages.at(-1),/终点/);assert.ok(e.backspace());e.finish(true);assert.equal(e.project.objects.length,1);assert.equal(e.tool,'curve');assert.equal(e.draft,null);e.escape();assert.equal(e.tool,'select');assert.equal(e.selected.size,0);
});
test('platforms support both click corners and drag placement with minimum dimensions',()=>{
  const {e,click,event,messages}=editorHarness();e.setTool('platform');click(100,100);click(100,100);assert.equal(e.project.objects.length,0);assert.match(messages.at(-1),/至少/);click(400,140);assert.equal(e.project.objects[0].width,300);assert.equal(e.project.objects[0].height,40);
  e.setTool('platform');e.down(event(500,100));e.move(event(800,150));e.up(event(800,150,{shiftKey:true}));assert.equal(e.project.objects.length,2);assert.equal(e.tool,'platform');assert.equal(e.project.objects[1].height,50);
});
test('double-click inserts a vertex even when pointerdown detail is zero',()=>{
  const {e,event}=editorHarness(),o=line([{x:100,y:100},{x:500,y:100}]);e.project.objects=[o];const target={closest:s=>s==='[data-object]'?{dataset:{object:o.id}}:null};
  e.down(event(300,100,{target}));e.up(event(300,100,{target}));e.doubleClick(event(300,100,{target}));assert.equal(e.project.objects[0].points.length,3);assert.equal(e.nodeIndex,1);close(e.project.objects[0].points[1],{x:300,y:100});
});
test('SVG pointer capture retargeting does not prevent double-click insertion',()=>{
  const {e,event}=editorHarness(),o=line([{x:100,y:100},{x:500,y:100}]);e.project.objects=[o];
  e.doubleClick(event(300,101));assert.equal(e.project.objects[0].points.length,3);assert.equal(e.nodeIndex,1);
});
test('dragging a curve handle commits its geometry and cancellation restores it',()=>{
  const {e,event}=editorHarness(),o=line([{x:100,y:100},{x:300,y:100,control:{x:200,y:0}}]);e.project.objects=[o];e.select([o.id]);
  const target={closest:s=>s==='[data-handle]'?{dataset:{handle:'control',index:'1'}}:null};e.down(event(200,0,{target}));e.move(event(200,-100));assert.equal(e.preview.get(o.id).points[1].control.y,-100);e.cancelGesture();assert.equal(e.project.objects[0].points[1].control.y,0);
  e.down(event(200,0,{target}));e.move(event(200,-100));e.up(event(200,-100));assert.equal(e.project.objects[0].points[1].control.y,-100);
});
