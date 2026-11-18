import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { OrthographicCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { setMouseButtons } from '../src/mouse-controls.js';
import { MouseSurface } from '../../tests/helpers/mouse-surface.js';

registerHooks({ load(url, context, next) { return url.includes('.svg') ? { format: 'module', source: 'export default "<svg></svg>"', shortCircuit: true } : next(url, context); } });
const { StationScene } = await import('../src/scene.js');

function harness({ zone = false, placing = false } = {}) {
  const canvas = new MouseSurface(), doc = new MouseSurface(), selections = [], calls = [];
  canvas.ownerDocument = doc; globalThis.window = new MouseSurface();
  const camera = new OrthographicCamera(-100, 100, 60, -60, .1, 1000);
  camera.position.set(100, 150, 200); camera.lookAt(0, 0, 0);
  const controls = new OrbitControls(camera, canvas); setMouseButtons(controls);
  const s = Object.create(StationScene.prototype);
  Object.assign(s, { renderer: { domElement: canvas }, controls, camera, tool: 'select', activeFloor: 'all',
    project: { entities: [] }, callbacks: { onSelect: id => selections.push(id) },
    zoneEditor: { active: zone, drawing: zone, pointerDown: () => false, pointerMove: () => calls.push('zone'), pointerUp: () => calls.push('zone-up') },
    hit: () => null, showSnap() {}, movePlacement: () => calls.push('preview'), confirmPlacement: () => calls.push('place'),
    placement: placing ? { start: { x: 10, z: 20 }, points: [{ x: 10, z: 20 }] } : null });
  s.installPointerEvents();
  function drag(button, extra = {}) {
    const buttons = [1, 4, 2][button];
    canvas.emit('pointerdown', { button, buttons, ...extra });
    canvas.emit('pointermove', { button: -1, buttons, clientX: 170, clientY: 140, ...extra });
    canvas.emit('pointerup', { button, clientX: 170, clientY: 140, ...extra });
  }
  return { s, canvas, camera, controls, selections, calls, drag };
}

test('right pans and middle rotates the real camera; left leaves it unchanged', () => {
  const h = harness(), position = h.camera.position.clone(), target = h.controls.target.clone();
  h.drag(0); assert.ok(h.camera.position.distanceTo(position) < 1e-8); assert.deepEqual(h.controls.target, target);
  h.drag(2); assert.ok(h.controls.target.distanceTo(target) > 1); assert.ok(h.camera.position.clone().sub(position).distanceTo(h.controls.target.clone().sub(target)) < 1e-8);
  const nextTarget = h.controls.target.clone(), offset = h.camera.position.clone().sub(nextTarget);
  h.drag(1); assert.deepEqual(h.controls.target, nextTarget); assert.ok(h.camera.position.clone().sub(nextTarget).distanceTo(offset) > 1);
  assert.equal(h.camera.zoom, 1); assert.deepEqual(h.selections, []);
});

test('Shift/Ctrl/Command preserve mouse roles, including right pan in floor view', () => {
  for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey']) {
    const h = harness(), before = h.controls.target.clone(); h.controls.enableRotate = false;
    h.drag(2, { [modifier]: true }); assert.ok(h.controls.target.distanceTo(before) > 1, modifier);
    const p = h.camera.position.clone(), t = h.controls.target.clone();
    h.drag(1, { [modifier]: true }); assert.deepEqual(h.controls.target, t); assert.ok(h.camera.position.distanceTo(p) < 1e-8);
    h.controls.enableRotate = true; h.drag(1, { [modifier]: true }); assert.deepEqual(h.controls.target, t); assert.ok(h.camera.position.distanceTo(p) > 1);
  }
});

test('navigation passes through area editing and keeps unfinished placement endpoints', () => {
  for (const mode of [{ zone: true }, { placing: true }]) {
    const h = harness(mode), draft = structuredClone(h.s.placement), target = h.controls.target.clone();
    h.drag(1); h.drag(2);
    assert.ok(h.controls.target.distanceTo(target) > 1); assert.deepEqual(h.calls, []);
    assert.deepEqual(h.s.placement, draft); assert.deepEqual(h.selections, []);
    if (mode.placing) {
      h.canvas.emit('pointerdown'); h.canvas.emit('pointerup'); assert.ok(h.calls.includes('place'));
    }
  }
});

test('middle does not consume the next left selection or start browser autoscroll', () => {
  const h = harness(); h.drag(1);
  h.canvas.emit('pointerdown'); h.canvas.emit('pointerup'); assert.deepEqual(h.selections, ['station']);
  assert.equal(h.canvas.emit('auxclick', { button: 1 }).defaultPrevented, true);
});
