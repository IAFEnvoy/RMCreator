import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, entity, migrateProject, isProject } from '../src/project.js';
import { textLayout, calloutLayout, textError, syncText, drawText, moveText } from '../src/text.js';
import * as THREE from 'three';
import { buildTextCallout, updateTextCallout } from '../src/text-callout.js';
import { trackLayout } from '../src/track.js';
import { makeTrackPath, worldPoint } from '../src/track-path.js';
import { removeWithTrains, syncTrains } from '../src/train-placement.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≠ ${b}`);
const text=(extra={})=>syncText(entity('text','text','说明',0,0,{text:'换乘通道\nTransfer',...extra}));
const legacy=()=>({...defaultProject(),version:3,entities:[]});

test('legacy track labels become independent objects once, preserving content, floor, color and world-space centers',()=>{
  for(const labelRotation of [0,90,180,270]){
    const p=legacy(),track=makeTrackPath(entity('track','track','往莘庄',0,0,{floor:'B1',lineId:'line-1',labelX:24.5,labelZ:13,labelRotation}),[{x:-50,z:0},{x:0,z:20},{x:60,z:0}]);
    Object.assign(track,{x:20,z:40,rotation:37});p.entities=[track];
    const layout=trackLayout(p,track),offset=(layout.forward?-1:1)*layout.width*102.5/1024,angle=layout.pathAngle*Math.PI/180;
    const center=worldPoint(track,{x:layout.x+offset*Math.cos(angle),z:layout.z+offset*Math.sin(angle)});
    const migrated=migrateProject(p),label=migrated.entities.find(e=>e.type==='text');
    assert.equal(migrated.version,4);assert.equal(label.text,'1号线往莘庄方向');assert.equal(label.floor,'B1');assert.equal(label.color,p.lines[0].color);
    close(label.x,center.x);close(label.z,center.z);close(label.rotation,(37+layout.pathAngle+labelRotation+360)%360);
    assert.equal(label.writingMode,labelRotation%180?'vertical':'horizontal');assert.equal(label.trackId,undefined);
    assert.equal(migrated.entities[0].labelX,undefined);assert.equal(migrated.entities[0].labelRotation,undefined);
    assert.equal(p.entities[0].labelX,24.5,'migration leaves its input intact');
    assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(migrated))),migrated);
  }
});

test('rail transforms, color changes and deletion cannot alter or remove detached text',()=>{
  const p=defaultProject(),label=p.entities.find(e=>e.type==='text'),original=structuredClone(label),track=p.entities[0];
  Object.assign(track,{x:80,z:30,rotation:91,name:'新终点',floor:'B1'});p.lines[0].color='#123456';syncTrains(p);
  assert.deepEqual(label,original);removeWithTrains(p,track.id);assert.deepEqual(p.entities.find(e=>e.id===label.id),original);
  assert.deepEqual(migrateProject(p).entities.find(e=>e.id===label.id),original);
});

test('valid legacy labels at the maximum name lengths migrate without losing content',()=>{
  const p=legacy();p.lines[0].name='线'.repeat(40);
  p.entities=[entity('long-label','track','站'.repeat(100),0,0,{lineId:p.lines[0].id})];
  assert.ok(isProject(p));
  const migrated=migrateProject(p),label=migrated.entities.find(e=>e.type==='text');
  assert.equal(label.text,`${p.lines[0].name}往${p.entities[0].name}方向`);
  assert.ok(label.fontSize<5.5);assert.equal(textError(label),'');assert.ok(isProject(migrated));
});

test('horizontal, vertical and reverse layouts preserve Unicode and multiline text without rotating individual vertical glyphs',()=>{
  const e=text({text:'换乘🚆\nAB'}),horizontal=textLayout(e);
  assert.equal(horizontal.lines[0].length,3);assert.ok(horizontal.l>horizontal.d);
  e.writingMode='vertical';syncText(e);assert.ok(e.d>e.l);
  const draws=[],ctx={save(){},restore(){},scale(){},fillText(...args){draws.push(args);}};
  drawText(ctx,512,1024,e);
  assert.deepEqual(draws.slice(0,3).map(d=>d[0]),['换','乘','🚆']);
  close(draws[0][1],draws[1][1]);assert.ok(draws[0][2]<draws[1][2]);assert.ok(draws[3][1]<draws[0][1],'vertical columns run right to left');
  e.textReverse=true;assert.deepEqual(textLayout(e).lines[0],['🚆','乘','换']);
});

test('text style, visibility and independent transforms round-trip; invalid content, sizes and layout are rejected',()=>{
  const p=defaultProject(),e=text({rotation:37,textReverse:true,textBold:false,textAlign:'right',visible:false});p.entities=[e];p.display.texts=false;
  assert.ok(isProject(p));assert.deepEqual(migrateProject(p),p);
  for(const extra of [{text:''},{text:' '.repeat(2)},{text:'字'.repeat(501)},{fontSize:NaN},{fontSize:0},{fontSize:21},{writingMode:'diagonal'},{textAlign:'outside'},{textReverse:1},{textBold:'yes'}]){
    assert.ok(textError({...e,...extra}));assert.equal(isProject({...p,entities:[{...e,...extra}]}),false);
  }
  assert.match(textError({...e,text:'字'.repeat(100),fontSize:20}),/500 m/);
  p.display.texts='true';assert.equal(isProject(p),false);
});

test('legacy hidden directions and hidden rails preserve annotation visibility while new rails never auto-generate text',()=>{
  const p=legacy();p.display.trackDirections=false;p.entities=[entity('hidden','track','终点',0,0,{lineId:'line-1',visible:false})];
  const migrated=migrateProject(p);assert.equal(migrated.display.texts,false);assert.equal(migrated.entities.find(e=>e.type==='text').visible,false);
  migrated.entities.push(entity('new','track','新轨道',0,40,{lineId:'line-1'}));
  assert.equal(migrateProject(migrated).entities.filter(e=>e.type==='text').length,1);
});

test('camera-facing labels keep their floor anchor, upright card and visible connected leader through orbit and top views',()=>{
  const e=text({textMode:'callout',leaderLength:14,rotation:137}),annotation=buildTextCallout(e,null);
  const root=new THREE.Group();root.position.set(23,29,-17);root.rotation.y=-137*Math.PI/180;root.add(annotation);
  const camera=new THREE.OrthographicCamera(-100,100,100,-100,.1,1000),anchor=new THREE.Vector3(23,29.25,-17);
  const {card,leader}=annotation.userData.callout;
  for(const position of [[-150,200,250],[220,95,-150],[23,340,-16.999]]){
    camera.position.set(...position);camera.up.set(0,1,0);camera.lookAt(anchor);camera.updateMatrixWorld();root.updateMatrixWorld(true);
    updateTextCallout(annotation,camera);annotation.updateMatrixWorld(true);
    const base=annotation.userData.callout.anchor.getWorldPosition(new THREE.Vector3()),end=card.getWorldPosition(new THREE.Vector3());
    close(base.distanceTo(anchor),0);close(end.distanceTo(base),14);
    const a=base.clone().project(camera),b=end.clone().project(camera);
    close(a.x,b.x);assert.ok(b.y>a.y,'leader remains screen-up and visible even from above');
    const vertex=new THREE.Vector3().fromBufferAttribute(leader.geometry.attributes.position,1);
    assert.ok(vertex.distanceTo(card.position)<1e-5,'leader terminates exactly at the bottom of the card');
    assert.deepEqual(card.center.toArray(),[.5,0]);assert.equal(card.material.rotation,0);
    close(card.scale.x,calloutLayout(e).l);close(card.scale.y,calloutLayout(e).d);
  }
  root.position.x+=12;root.updateMatrixWorld(true);updateTextCallout(annotation,camera);
  close(annotation.userData.callout.anchor.getWorldPosition(new THREE.Vector3()).x,23);
});

test('optional anchors remain fixed when moving a callout, can move independently, and disable together with their leader',()=>{
  const e=text({textMode:'callout',x:24,z:32,anchorX:10,anchorZ:-6,anchorEnabled:true,rotation:63});
  const moved=moveText(e,{x:55,z:60});assert.equal(moved.anchorX,10);assert.equal(moved.anchorZ,-6);assert.equal(e.x,24);
  const root=new THREE.Group();root.position.set(moved.x,29,moved.z+110);root.rotation.y=-63*Math.PI/180;
  const annotation=buildTextCallout(moved,null,110);root.add(annotation);root.updateMatrixWorld(true);
  const camera=new THREE.OrthographicCamera(-100,100,100,-100,.1,1000);camera.position.set(-155,185,255);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  updateTextCallout(annotation,camera);annotation.updateMatrixWorld(true);
  const data=annotation.userData.callout,anchor=data.anchor.getWorldPosition(new THREE.Vector3()),card=data.card.position.clone();
  close(anchor.x,10);close(anchor.z,104);close(anchor.y,29.25);
  Object.assign(data,{anchorX:18,anchorZ:-13});updateTextCallout(annotation,camera);annotation.updateMatrixWorld(true);
  close(data.anchor.getWorldPosition(new THREE.Vector3()).x,18);close(data.anchor.getWorldPosition(new THREE.Vector3()).z,97);
  assert.ok(data.card.position.distanceTo(card)<1e-8,'editing the anchor leaves the text in place');
  data.enabled=false;updateTextCallout(annotation,camera);assert.equal(data.anchor.visible,false);assert.equal(data.leader.visible,false);assert.equal(data.card.visible,true);
  assert.ok(data.card.position.distanceTo(card)<1e-8,'disabling the anchor leaves the text in place');
  const implicit=text({textMode:'callout',x:7,z:9});const pinned=moveText(implicit,{x:60,z:40});assert.equal(pinned.anchorX,7);assert.equal(pinned.anchorZ,9);
  const free=moveText({...implicit,anchorEnabled:false},{x:60,z:40});assert.equal(free.anchorX,undefined);assert.equal(free.anchorZ,undefined);
});

test('anchor enablement and coordinates persist, while incomplete or invalid anchor targets are rejected',()=>{
  const p=defaultProject();p.entities=[text({textMode:'callout',anchorEnabled:false,anchorX:-27.5,anchorZ:41})];
  assert.ok(isProject(p));assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(p))),p);
  for(const extra of [{anchorEnabled:'yes'},{anchorX:501},{anchorZ:-501},{anchorX:NaN},{anchorZ:undefined}]){
    assert.ok(textError({...p.entities[0],...extra}));assert.equal(isProject({...p,entities:[{...p.entities[0],...extra}]}),false);
  }
});

test('both text display modes preserve style, anchor and saved floor rotation, including old v4 text without a mode',()=>{
  const p=defaultProject(),e=text({textMode:'callout',leaderLength:19,rotation:84,writingMode:'vertical',textReverse:true});p.entities=[e];
  assert.ok(isProject(p));assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(p))),p);
  const anchor=[e.x,e.z,e.floor,e.rotation],card=calloutLayout(e),floor=textLayout(e);
  assert.ok(card.l>floor.l&&card.d>floor.d);
  e.textMode='floor';syncText(e);close(e.l,floor.l);assert.deepEqual([e.x,e.z,e.floor,e.rotation],anchor);
  delete e.textMode;delete e.leaderLength;assert.ok(isProject(p));assert.deepEqual(migrateProject(p),p);
  for(const extra of [{textMode:'unknown'},{leaderLength:0},{leaderLength:101},{leaderLength:'8'},{leaderLength:NaN}]){
    assert.ok(textError({...e,...extra}));assert.equal(isProject({...p,entities:[{...e,...extra}]}),false);
  }
});
