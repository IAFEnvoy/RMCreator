import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';
import { defaultProject, entity, isProject } from '../src/project.js';
import { twoPointPlacement, repeatPlacementEntity, placementLimit } from '../src/placement.js';
import { curveDraft } from '../src/track-drawing.js';
import { placeTrain } from '../src/train-placement.js';

registerHooks({load(url,context,next){return url.includes('.svg')?{format:'module',source:'export default "<svg></svg>"',shortCircuit:true}:next(url,context);}});
const { StationScene } = await import('../src/scene.js');

// Keep the real pointer/placement logic; replace only GPU drawing and the camera ray.
function pointerScene(type) {
  const s = Object.create(StationScene.prototype), saved = [];
  Object.assign(s, {
    project: { ...defaultProject(), snapping: false, entities: [], zones: { B1: {}, B2: {} } }, activeFloor: 'B2',
    scene: new THREE.Scene(), controls: {}, renderer: { domElement: { style: {} } },
    width: 1000, camera: { left: -50, right: 50, zoom: 1 }, callbacks: {},
    floorY: () => 0, floorOffset: () => 0,
    hit(event) { this.raycaster = { ray: new THREE.Ray(new THREE.Vector3(event.clientX, 100, event.clientY), new THREE.Vector3(0, -1, 0)) }; },
    placementPreview() {}, placementGuide() {}, curvePlacementGuide() {}, showSnap() {}, clearPlacementGroup() {}, applyFloorFocus() {}, setTool() {},
  });
  const onPlace = (placed, context) => {
    saved.push(placed); s.project.entities.push(placed);
    if (context.repeat) s.beginPlacement(repeatPlacementEntity(context.draft, placed, `placed-${saved.length + 1}`), onPlace);
  };
  s.beginPlacement(entity('placed-1', type, '放置', 0, 0, { floor: 'B2', lineId: 'line-1' }), onPlace);
  return { s, saved };
}

test('Shift on final confirmation repeats the real pointer flow; releasing it ends the next placement', () => {
  const { s, saved } = pointerScene('restroom');
  s.confirmPlacement({ clientX: 20, clientY: 30, shiftKey: true });
  assert.equal(saved.length, 1);
  assert.ok(s.placement);
  s.confirmPlacement({ clientX: 40, clientY: 60, shiftKey: false });
  assert.equal(saved.length, 2);
  assert.equal(s.placement, null);
  assert.notEqual(saved[0].id, saved[1].id);
  assert.deepEqual(saved.map(e => [e.x, e.z]), [[20, 30], [40, 60]]);
});

test('two-point placement checks Shift at the endpoint, rejects invalid landings and resets both points', () => {
  const { s, saved } = pointerScene('track');
  s.confirmPlacement({ clientX: 0, clientY: 0, shiftKey: false });
  s.confirmPlacement({ clientX: 0, clientY: 0, shiftKey: true });
  assert.equal(saved.length, 0);
  assert.ok(s.placement.start);
  s.confirmPlacement({ clientX: 30, clientY: 0, shiftKey: true });
  assert.equal(saved.length, 1);
  assert.equal(s.placement.start, undefined);
  assert.equal(s.placement.points, undefined);
  s.confirmPlacement({ clientX: 0, clientY: 20, shiftKey: true });
  s.confirmPlacement({ clientX: 30, clientY: 20, shiftKey: false });
  assert.equal(saved.length, 2);
  assert.equal(s.placement, null);
});

test('Shift completion repeats curves with no old control points; anchor picking stays single-use', () => {
  const { s, saved } = pointerScene('track');
  s.changeTrackMode('curve');
  for (const [clientX, clientY] of [[0, 0], [15, 20], [30, 0]]) s.confirmPlacement({ clientX, clientY });
  s.finishTrackPlacement({ shiftKey: true });
  assert.equal(saved.length, 1);
  assert.equal(s.placement.trackMode, 'curve');
  assert.equal(s.placement.start, undefined);
  assert.equal(s.placement.points, undefined);

  const anchor = pointerScene('text');
  anchor.s.placement.anchorPicking = true;
  anchor.s.confirmPlacement({ clientX: 10, clientY: 20, shiftKey: true });
  assert.equal(anchor.saved.length, 1);
  assert.equal(anchor.s.placement, null);
});

test('repeated descending connections keep the picked floor order and get independent endpoints', () => {
  const project = { ...defaultProject(), snapping: false, entities: [] };
  for (const type of ['stairs', 'escalator', 'elevator']) {
    const draft = entity(`${type}-1`, type, '连接', 0, 0, { floor: 'B1', toFloor: 'B2', d: 4 });
    const end = type === 'elevator' ? { x: 4, z: 4 } : { x: 25, z: 10 };
    const first = twoPointPlacement(project, draft, { x: 0, z: 0 }, end);
    assert.equal(first.valid, true);
    assert.equal(first.entity.floor, 'B2');
    const next = repeatPlacementEntity(draft, first.entity, `${type}-2`);
    assert.equal(next.floor, 'B1');
    assert.equal(next.toFloor, 'B2');
    assert.equal(next.d, first.entity.d);
    const second = twoPointPlacement(project, next, { x: 40, z: 0 }, { x: end.x + 40, z: end.z });
    assert.equal(second.valid, true);
    assert.equal(second.entity.x, first.entity.x + 40);
    assert.ok(isProject({ ...project, entities: [first.entity, second.entity] }));
  }
});

test('repeated curves retain rail appearance and drawing mode but start a new independent path', () => {
  const draft = entity('track-1', 'track', '支线', 0, 0, { floor: 'B2', lineId: 'line-1', drawMode: 'curve', bandColor: '#123456', bandVisible: true, arrowVisible: true, direction: 'backward', d: 5 });
  const first = curveDraft(draft, [{ x: 0, z: 0 }, { x: 20, z: 20 }, { x: 40, z: 0 }]);
  assert.equal(first.canFinish, true);
  first.entity.joins = { start: { trackId: 'host', s: 0 } };
  const before = structuredClone(first.entity);
  const next = repeatPlacementEntity(draft, first.entity, 'track-2');
  assert.equal(next.drawMode, 'curve');
  for (const key of ['bandColor', 'bandVisible', 'arrowVisible', 'direction', 'd', 'lineId']) assert.equal(next[key], first.entity[key]);
  assert.equal(next.path, undefined);
  assert.equal(next.joins, undefined);
  const second = curveDraft(next, [{ x: 0, z: 40 }, { x: 30, z: 60 }, { x: 60, z: 40 }]);
  assert.equal(second.canFinish, true);
  assert.notDeepEqual(second.entity.path, first.entity.path);
  assert.deepEqual(first.entity, before);
});

test('continuous trains retain formation and still reject an occupied section of rail', () => {
  const project = defaultProject();
  project.entities = project.entities.filter(e => e.type === 'track');
  const draft = entity('train-1', 'train', '列车', 0, 0, { floor: 'B2', trainCars: 1, trainUnits: 2 });
  const first = placeTrain(project, draft, { x: -55, z: -8 });
  assert.equal(first.valid, true);
  project.entities.push(first.entity);
  const next = repeatPlacementEntity(draft, first.entity, 'train-2');
  assert.equal(next.trainCars, 1);
  assert.equal(next.trainUnits, 2);
  const occupied = placeTrain(project, next, { x: -55, z: -8 });
  assert.equal(occupied.valid, false);
  assert.match(occupied.message, /已有列车/);
  const clear = placeTrain(project, next, { x: 55, z: -8 });
  assert.equal(clear.valid, true);
  project.entities.push(clear.entity);
  assert.ok(isProject(project));
});

test('continuous placement stops at object limits without blocking other allowed types', () => {
  const project = { entities: Array.from({ length: 199 }, () => ({ type: 'stairs' })) };
  assert.equal(placementLimit(project, 'stairs'), '');
  project.entities.push({ type: 'stairs' });
  assert.match(placementLimit(project, 'stairs'), /200 个构件/);
  assert.equal(placementLimit(project, 'train'), '');
  project.entities.push(...Array.from({ length: 200 }, () => ({ type: 'text' })));
  assert.match(placementLimit(project, 'text'), /200 个文字/);
  project.entities.push(...Array.from({ length: 200 }, () => ({ type: 'train' })));
  assert.match(placementLimit(project, 'train'), /总数已达上限/);
});
