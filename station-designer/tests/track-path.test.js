import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { defaultProject, entity, isProject, migrateProject } from '../src/project.js';
import { trackLayout, trainLayout } from '../src/track.js';
import { buildTrackModel } from '../src/track-model.js';
import { buildTrain } from '../src/train.js';
import { trainOnTrack, trainCarPose, placeTrain, trainFit, trainEditError, syncTrains, removeWithTrains } from '../src/train-placement.js';
import { trackGeometry, pointAlongTrack, worldPoint, localPoint, projectToTrack, makeTrackPath, snapRailPoint, moveTrackKnot, syncTrackPaths, trackPathError } from '../src/track-path.js';
import { generateBoundaries } from '../src/zones.js';

const close = (a,b,tolerance=1e-6) => assert.ok(Math.abs(a-b)<tolerance,`${a} ≠ ${b}`);
const rail = (id='curve',extra={}) => entity(id,'track','折返',0,0,{lineId:'line-1',...extra});
const projectWith = (...entities) => ({...defaultProject(),entities,zones:{B1:{},B2:{}}});
const curve = (extra={}) => makeTrackPath(rail('curve',extra),[{x:-150,z:0},{x:0,z:30},{x:150,z:0}]);

test('curve samples pass through knots, use continuous tangents and measure actual arc length',()=>{
  const track=curve(),g=trackGeometry(track);
  assert.ok(g.length>300);close(track.l,g.length);
  for(const knot of track.path)assert.ok(g.samples.some(p=>Math.hypot(p.x-knot.x,p.z-knot.z)<1e-8));
  const middle=g.samples.findIndex(p=>p.x===150&&p.z===30);
  close(g.samples[middle].tz,0);
  assert.ok(g.samples[middle-1].tx>.99&&g.samples[middle+1].tx>.99);
  assert.ok(g.samples.every((p,i)=>!i||p.s>g.samples[i-1].s));
  assert.equal(trackGeometry(track),g);
  track.path[1].z=50;assert.notEqual(trackGeometry(track),g);
});

test('arc projection and local/world transforms work after arbitrary rotation and translation',()=>{
  const track=curve({rotation:37});Object.assign(track,{x:24,z:-15,rotation:37});
  const length=trackGeometry(track).length;
  for(const fraction of [0,.17,.5,.83,1]){
    const p=pointAlongTrack(track,length*fraction,true),hit=projectToTrack(track,p);
    close(hit.distance,0);close(hit.s,length*fraction);close(hit.fraction,fraction);
    const local=localPoint(track,p),roundtrip=worldPoint(track,local);close(roundtrip.x,p.x);close(roundtrip.z,p.z);
  }
});

test('smooth connector snaps to interiors and aligns both ends even when drawn in reverse',()=>{
  const a=rail('a',{l:250,z:-10}),b=rail('b',{l:250,z:10}),p=projectWith(a,b);
  for(const reverse of [false,true]){
    const points=[{x:-45,z:-9},{x:45,z:11}].map(v=>snapRailPoint(p,rail(),v));
    if(reverse)points.reverse();
    const connector=makeTrackPath(rail('connector'),points,'connector');
    assert.equal(connector.joins.start.trackId,reverse?'b':'a');
    assert.equal(connector.joins.end.trackId,reverse?'a':'b');
    assert.equal(connector.joins.start.reverse,reverse);
    for(const s of [0,trackGeometry(connector).length]){
      const point=pointAlongTrack(connector,s,true);close(point.tz,0);close(point.tx,reverse?-1:1);
    }
    close(worldPoint(connector,connector.path[0]).z,reverse?10:-10);
    assert.equal(trackPathError(connector),'');
  }
  p.snapping=false;assert.equal(snapRailPoint(p,rail(),{x:0,z:-9}).snapped,undefined);
  p.snapping=true;a.visible=false;assert.equal(snapRailPoint(p,rail(),{x:0,z:-9}).snapped,undefined);
});

test('attached junction follows host transforms and JSON round-trip; deletion preserves branch shape',()=>{
  const host=curve(),p=projectWith(host),start=snapRailPoint(p,rail('branch'),pointAlongTrack(host,100,true));
  const branch=makeTrackPath(rail('branch'),[start,{x:100,z:80}],'connector');p.entities.push(branch);
  host.rotation=30;host.x+=10;host.z-=20;syncTrackPaths(p);
  const actual=worldPoint(branch,branch.path[0]),expected=pointAlongTrack(host,host.l*branch.joins.start.t,true);
  close(actual.x,expected.x);close(actual.z,expected.z);
  close(Math.atan2(branch.path[0].tz,branch.path[0].tx)*180/Math.PI,expected.angle);
  assert.ok(isProject(p));assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(p))),p);
  const shape=structuredClone(branch.path);removeWithTrains(p,host.id);syncTrackPaths(p);
  assert.deepEqual(branch.path,shape);assert.equal(branch.joins.start,undefined);assert.ok(isProject(p));
});

test('point editing detaches or reattaches endpoints and detects cyclic joins',()=>{
  const a=rail('a',{z:10}),b=makeTrackPath(rail('b'),[{x:-50,z:0},{x:50,z:0}]);
  const p=projectWith(a,b),joined=moveTrackKnot(p,b,0,{x:-50,z:11});
  assert.equal(joined.joins.start.trackId,'a');close(worldPoint(joined,joined.path[0]).z,10);
  const detached=moveTrackKnot(p,joined,0,{x:-50,z:20});assert.equal(detached.joins.start,undefined);
  a.path=[{x:-90,z:0},{x:90,z:0}];a.joins={start:{trackId:'b',t:0,reverse:false}};
  b.joins={start:{trackId:'a',t:0,reverse:false}};
  assert.equal(isProject(p),false);assert.throws(()=>syncTrackPaths(p),/循环/);
});

test('editing a knot retains an already solved guide point instead of snapping it a second time',()=>{
  const host=rail('host',{z:10}),source=makeTrackPath(rail('branch'),[{x:-50,z:30},{x:50,z:30}]),project=projectWith(host,source);
  const target={x:-40.23,z:10.37,aligned:true};
  const edited=moveTrackKnot(project,source,0,target,{prepared:true}),p=worldPoint(edited,edited.path[0]);
  close(p.x,target.x);close(p.z,target.z);assert.equal(edited.joins.start,undefined);
  assert.deepEqual(source.path[0],{x:0,z:0});
});

test('invalid paths are rejected before expensive processing',()=>{
  for(const path of [[],[{x:0,z:0}],Array(33).fill({x:0,z:0}),[{x:0,z:0},{x:NaN,z:0}],
    [{x:0,z:0},{x:1,z:0}],[{x:0,z:0},{x:501,z:0}],[{x:0,z:0},{x:10,z:0,tx:0,tz:0}]]){
    const t=rail('invalid',{path});assert.ok(trackPathError(t));assert.equal(isProject(projectWith(t)),false);
  }
  const t=curve();t.pathSmoothness=0;assert.match(trackPathError(t),/平滑度/);
  t.pathSmoothness=1;t.x=490;assert.match(trackPathError(t),/范围/);
});

test('track stripe settings preserve legacy automatic side, custom color and line reset',()=>{
  const t=rail(),p=projectWith(t);
  assert.equal(trackLayout(p,t).bandVisible,true);assert.equal(trackLayout(p,t).bandColor,p.lines[0].color);
  for(const [bandSide,side]of [['left',-1],['right',1]]){
    Object.assign(t,{direction:'right-side',bandSide,bandVisible:false,bandColor:'#123456'});
    const layout=trackLayout(p,t);assert.equal(layout.side,side);assert.equal(layout.bandVisible,false);assert.equal(layout.bandColor,'#123456');
    t.direction='backward';assert.equal(trackLayout(p,t).forward,false);assert.equal(trackLayout(p,t).side,-1);
    assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(p))),p);
  }
  p.lines[0].color='#abcdef';assert.equal(trackLayout(p,t).bandColor,'#123456');
  delete t.bandColor;assert.equal(trackLayout(p,t).bandColor,'#abcdef');
  for(const bad of [{bandVisible:1},{bandSide:'top'},{bandColor:'red'}])assert.equal(isProject(projectWith({...t,...bad})),false);
});

test('curved stripe geometry changes sides with travel and remains on the right at every sample',()=>{
  const t=curve({bandColor:'#123456',bandSide:'left',rotation:37}),p=projectWith(t);
  for(const direction of ['forward','backward']){
    t.direction=direction;const layout=trackLayout(p,t),model=buildTrackModel(t,layout);
    const stripe=model.children.at(-1),positions=stripe.geometry.attributes.position,sign=layout.forward?1:-1;
    trackGeometry(t).samples.forEach((sample,i)=>{
      const center={x:(positions.getX(i*4)+positions.getX(i*4+1))/2,z:(positions.getZ(i*4)+positions.getZ(i*4+1))/2};
      const base=worldPoint(t,sample),band=worldPoint(t,center),tangent=worldPoint(t,{x:sample.x+sign*sample.tx,z:sample.z+sign*sample.tz});
      assert.ok((tangent.x-base.x)*(band.z-base.z)-(tangent.z-base.z)*(band.x-base.x)>0);
    });
    assert.equal(stripe.material.color.getHexString(),'123456');
    model.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  }
});

test('continuous swept rails remain finite and stripe visibility/side/color affect actual geometry',()=>{
  const t=curve({bandColor:'#123456',bandSide:'left'}),p=projectWith(t);
  const model=buildTrackModel(t,trackLayout(p,t));
  model.traverse(o=>{if(o.isMesh){assert.ok(Array.from(o.geometry.attributes.position.array).every(Number.isFinite));if(o.geometry.attributes.normal)assert.ok(Array.from(o.geometry.attributes.normal.array).every(Number.isFinite));}});
  assert.equal(model.children.at(-1).material.color.getHexString(),'123456');
  const stripeBounds=new THREE.Box3().setFromObject(model.children.at(-1));assert.ok(stripeBounds.min.z<-t.d/2);
  t.bandVisible=false;const hidden=buildTrackModel(t,trackLayout(p,t));assert.equal(hidden.children.length,model.children.length-1);
});

test('coupled train carriages follow the curve at full size in both directions',()=>{
  const track=curve({d:5}),p=projectWith(track),draft=entity('train','train','列车',0,0,{trainPreset:'custom',trainCars:2,trainUnits:2});
  const placed=placeTrain(p,draft,pointAlongTrack(track,track.l/2,true));assert.equal(placed.valid,true);
  const train=placed.entity,layout=trainLayout(train);assert.equal(layout.count,4);
  for(const forward of [true,false]){
    const model=buildTrain(train,train.color,forward,null,spec=>trainCarPose(train,track,spec,forward));
    const group=new THREE.Group();group.position.set(train.x,0,train.z);group.rotation.y=-train.rotation*Math.PI/180;group.add(model);group.updateMatrixWorld(true);
    const cars=model.children.filter(c=>c.userData.carriage);
    const angles=cars.map(c=>c.rotation.y);assert.ok(Math.max(...angles)-Math.min(...angles)>.01);
    cars.forEach((car,i)=>{
      const actual=car.getWorldPosition(new THREE.Vector3()),expected=pointAlongTrack(track,track.l/2+(forward?1:-1)*layout.cars[i].center,true);
      close(actual.x,expected.x);close(actual.z,expected.z);
    });
    assert.equal(model.children.filter(c=>c.name==='unit-coupler').length,1);
  }
  track.rotation=37;track.x+=20;syncTrains({...p,entities:[track,train]});
  close(train.rotation,pointAlongTrack(track,track.l/2,true).angle);
});

test('tight curves allow full-size carriages while arc length and width still limit capacity',()=>{
  const track=curve({d:5}),p=projectWith(track),draft=entity('train','train','列车',0,0,{trainPreset:'custom',trainCars:6});
  assert.equal(trainFit(p,trainOnTrack(p,draft,track)).valid,true);
  const tight=makeTrackPath(rail('tight'),[{x:-35,z:0},{x:0,z:20},{x:35,z:0}]);p.entities=[tight];
  const fit=trainFit(p,trainOnTrack(p,{...draft,trainCars:2},tight));assert.equal(fit.valid,true);
  const placed=placeTrain(p,{...draft,trainCars:2},pointAlongTrack(tight,tight.l/2,true));assert.equal(placed.valid,true);
  const before=structuredClone(p);p.entities.push(placed.entity);assert.equal(trainEditError(before,p),'');
  const copy=structuredClone(placed.entity);copy.id='duplicate';assert.match(trainFit(p,copy).message,/已有列车/);
  tight.d=2;assert.match(trainFit(p,placed.entity).message,/宽度不足/);
  const short=makeTrackPath(rail('short'),[{x:0,z:0},{x:10,z:1}]);p.entities=[short];
  assert.match(trainFit(p,trainOnTrack(p,draft,short)).message,/长度不足/);
});

test('rail snapping prioritizes exact endpoints and respects floor, visibility, self and disabled snapping',()=>{
  const host=curve({rotation:37});host.rotation=37;const source=rail('draft'),p=projectWith(host);
  const endpoint=pointAlongTrack(host,host.l,true),near={x:endpoint.x-1,z:endpoint.z};
  const snapped=snapRailPoint(p,source,near);assert.equal(snapped.snapKind,'endpoint');assert.equal(snapped.fraction,1);
  close(snapped.x,endpoint.x);close(snapped.z,endpoint.z);
  const middle=pointAlongTrack(host,host.l*.37,true),interior=snapRailPoint(p,source,{x:middle.x+.5,z:middle.z+.5});
  assert.equal(interior.snapKind,'track');assert.ok(projectToTrack(host,interior).distance<1e-8);
  for(const mutate of [()=>host.visible=false,()=>host.floor='B1',()=>source.id=host.id,()=>p.snapping=false]){
    host.visible=true;host.floor=source.floor;source.id='draft';p.snapping=true;mutate();
    assert.equal(snapRailPoint(p,source,near).snapped,undefined);
  }
});

test('curved track boundaries follow the swept footprint, avoiding the old bounding rectangle',()=>{
  const t=makeTrackPath(rail(),[{x:0,z:0},{x:30,z:30},{x:60,z:0}]),p=projectWith(t);
  p.zones.B2={'10,0':'paid'};assert.equal(generateBoundaries(p,'B2').length,0);
  const straight=makeTrackPath(rail(),[{x:-10,z:4},{x:10,z:4}]);p.entities=[straight];p.zones.B2={'0,0':'paid'};
  const edges=generateBoundaries(p,'B2');assert.ok(edges.length>0);
  close(edges.reduce((sum,e)=>sum+Math.hypot(e.x2-e.x1,e.z2-e.z1),0),2);
});
