import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';
import { defaultProject, entity } from '../src/project.js';
import { entityDisplayFloors, stairPlanRange } from '../src/floor-entities.js';
import { buildStairSteps, stairStepLayout } from '../src/stair-steps.js';
import { worldPoint } from '../src/track-path.js';

registerHooks({load(url,context,next){return url.includes('.svg')?{format:'module',source:'export default "<svg></svg>"',shortCircuit:true}:next(url,context);}});
const { StationScene } = await import('../src/scene.js');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
const project = () => ({...defaultProject(),floors:[{id:'B3',code:'B3',name:'下层',elevation:-12},...defaultProject().floors],entities:[]});
const stair = extra => entity('stairs', 'stairs', '跨层楼梯', 10, 5, {floor:'B3',toFloor:'B1',l:60,h:24,d:4,rotation:37,...extra});

function scene() {
  const s = Object.create(StationScene.prototype);
  Object.assign(s, {
    labels:[],groups:new Map(),zoneGroups:[],world:new THREE.Group(),materials:new Map(),grid:{},
    editGrid:{position:new THREE.Vector3()},ground:{position:new THREE.Vector3()},
    labelRenderer:{domElement:{classList:{toggle(){}}}},zoneEditor:{sync(){}},callbacks:{},
    restoreFloorFocus(){},applyFloorFocus(){},drawZones(){},updateTextCallouts(){},select(id){this.selected=id;},
    label(parent,x,y,z,content,category,id){const label=new THREE.Object3D();label.position.set(x,y,z);label.userData.labelFor=id;parent.add(label);return label;},
  });
  return s;
}

test('stairs and escalators stop only at their endpoint floors while elevators serve every crossed floor', () => {
  const p = project();
  for (const type of ['stairs', 'escalator']) {
    const e = stair({type});
    assert.deepEqual(entityDisplayFloors(p, e, 'floor'), ['B3', 'B1']);
    assert.deepEqual(entityDisplayFloors(p, e, '3d'), ['B3']);
    assert.deepEqual(stairPlanRange(e, 'B3'), {from:0,to:.5});
    assert.deepEqual(stairPlanRange(e, 'B1'), {from:.5,to:1});
    assert.equal(stairPlanRange(e, 'B2'), null);
    assert.deepEqual(entityDisplayFloors(p, {...e,toFloor:undefined}, 'floor'), ['B3']);
  }
  assert.deepEqual(entityDisplayFloors(p, stair({type:'elevator'}), 'floor'), ['B3','B2','B1']);
});

test('both plan halves retain the original tread spacing and rise, including an odd central tread', () => {
  for (const type of ['stairs', 'escalator']) for (const h of [24,type==='stairs'?34:30.1]) {
    const e=stair({type,h,l:60}), layout=stairStepLayout(e,1.6), matrix=new THREE.Matrix4();
    if(h!==24)assert.equal(layout.count%2,1);
    const halves=[{from:0,to:.5},{from:.5,to:1}].map(range=>buildStairSteps(e,1.6,undefined,range));
    for (const [index,half] of halves.entries()) {
      const [bodies,treads]=half.children,first=Math.floor(index*.5*layout.count);
      for (let i=0;i<treads.count;i++) {
        treads.getMatrixAt(i,matrix);
        near(matrix.elements[13]+.0175,(first+i+1)*layout.rise+.04);
      }
      half.updateMatrixWorld(true);
      const box=new THREE.Box3().setFromObject(bodies);
      near(index?box.min.x:box.max.x,0);
      near(index?box.max.x:box.min.x,index?e.l/2:-e.l/2);
      near(treads.geometry.parameters.width,layout.run*.97);
      near(bodies.geometry.parameters.height,layout.bodyHeight);
    }
  }
});

test('the real floor renderer draws only the local half, with the label centered over that half', () => {
  for(const type of ['stairs','escalator'])for(const rotation of [0,37,90,180,270]) {
    const p=project(),e=stair({type,rotation}),before=structuredClone(e);p.entities=[e];
    for(const [floor,sign]of [['B3',-1],['B1',1]]) {
      const s=scene();s.update(p,'floor',floor,e.id);
      assert.equal(s.groups.size,1);
      const group=s.groups.get(e.id),part=group.getObjectByName('stair-plan-half');
      assert.ok(part);near(part.position.x,sign*e.l/4);
      group.updateMatrixWorld(true);
      const label=part.children.find(child=>child.userData.labelFor===e.id),position=label.getWorldPosition(new THREE.Vector3());
      const center=worldPoint(e,{x:sign*e.l/4,z:0});near(position.x,center.x);near(position.z,center.z);
      for(const [x,visible] of [[sign*e.l/4,true],[-sign*e.l/4,false]]) {
        const at=worldPoint(e,{x,z:0}),ray=new THREE.Raycaster(new THREE.Vector3(at.x,100,at.z),new THREE.Vector3(0,-1,0));
        assert.equal(ray.intersectObject(group,true).length>0,visible,'hidden half is not selectable');
      }
    }
    assert.deepEqual(e,before,'plan rendering cannot change stored geometry');
  }
});

test('all-floor plans omit middle-floor models and labels, and single middle-floor views remain empty', () => {
  for(const type of ['stairs','escalator']) {
    const p=project(),e=stair({type});p.entities=[e];
    const s=scene();s.update(p,'floor','all',e.id);
    assert.deepEqual([...s.groups.values()].map(g=>g.userData.drawFloor),['B3','B1']);
    assert.equal(s.groups.get(e.id).getObjectByName('stair-plan-half').position.x,-15);
    assert.equal(s.groups.get(`${e.id}:endpoint:B1`).getObjectByName('stair-plan-half').position.x,15);
    s.update(p,'floor','B2',e.id);assert.equal(s.groups.size,0);
    e.visible=false;s.update(p,'floor','all',e.id);assert.equal(s.groups.size,0);
  }
});

test('3D models and placement previews keep the full flight, and elevator middle-floor models remain visible', () => {
  const p=project(),e=stair();p.entities=[e];
  const s=scene();s.update(p,'3d','all',e.id);
  assert.equal(s.groups.size,1);assert.equal(s.groups.get(e.id).getObjectByName('stair-plan-half'),undefined);
  const group=s.groups.get(e.id),steps=group.getObjectByName('stair-step-treads');
  assert.equal(steps.count,stairStepLayout(e,24).count);
  s.view='floor';s.isPreview=true;const preview=new THREE.Group();s.staircase(preview,e,false);
  assert.equal(preview.getObjectByName('stair-step-treads').count,stairStepLayout(e,1.6).count);
  assert.equal(preview.getObjectByName('stair-plan-half'),undefined);
  s.isPreview=false;p.entities=[stair({type:'elevator',l:4,d:4})];s.update(p,'floor','B2','stairs');
  assert.equal(s.groups.size,1);assert.equal(s.groups.get('stairs').userData.drawFloor,'B2');
});
