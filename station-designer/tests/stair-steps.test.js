import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { stairStepLayout, buildStairSteps } from '../src/stair-steps.js';

const stairs = (extra = {}) => ({ type: 'stairs', l: 18, d: 3.5, h: 12, color: '#cdb594', ...extra });
const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-5, `${a} ≠ ${b}`);

test('step dimensions stay bounded across adjacent floors, multiple floors, long stairs and exploded views', () => {
  for (const type of ['stairs','escalator']) {
    let previous = 0;
    for (const [l,h,displayHeight] of [[18,12,12],[36,24,24],[90,36,36],[90,36,87],[500,500,687]]) {
      const e = stairs({ type, l, h }), layout = stairStepLayout(e,displayHeight);
      assert.ok(layout.count >= previous); previous = layout.count;
      assert.ok(layout.rise <= (type === 'stairs' ? .18 : .2));
      assert.ok(layout.run <= (type === 'stairs' ? .32 : .4));
      close(layout.rise * layout.count, displayHeight); close(layout.run * layout.count,l);
    }
  }
  const e = stairs({l:90,h:36});
  assert.equal(stairStepLayout(e,1.6).count,stairStepLayout(e,36).count,'flattening a plan must preserve its tread spacing');
});

test('rendered steps retain their actual sizes and meet both floor endpoints without filling the underside', () => {
  for(const height of [12,29,58]){
    const e = stairs({l:60,h:24}), layout = stairStepLayout(e,height), group = buildStairSteps(e,height);
    const [bodies,treads] = group.children;
    assert.equal(bodies.count,layout.count);assert.equal(treads.count,layout.count);
    assert.equal(group.children.length,2,'dense stairs use two instanced draw calls');
    const matrix = new THREE.Matrix4();
    for(const index of [0,Math.floor(layout.count/2),layout.count-1]){
      treads.getMatrixAt(index,matrix);
      const position = new THREE.Vector3().setFromMatrixPosition(matrix);
      close(position.x,-e.l/2+(index+.5)*layout.run);
      close(position.y+.0175,(index+1)*layout.rise+.04);
    }
    treads.geometry.computeBoundingBox();
    const size=treads.geometry.boundingBox.getSize(new THREE.Vector3());
    close(size.x,layout.run*.97);close(size.y,.035);close(size.z,e.d-.12);
    group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0,height/2-2,-10),new THREE.Vector3(0,0,1));
    assert.equal(ray.intersectObject(group,true).length,0,'a ray below the inclined steps passes through empty space');
    group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();if(o.isInstancedMesh)o.dispose();});
  }
});
