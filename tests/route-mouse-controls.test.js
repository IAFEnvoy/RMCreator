import test from 'node:test';
import assert from 'node:assert/strict';
import { MouseSurface } from './helpers/mouse-surface.js';

globalThis.document = { getElementById: () => null };
globalThis.HTMLElement = class {};
const { createEventBinder } = await import('../route-map/js/event.js');
const { createContextMenu } = await import('../route-map/js/context-menu.js');

function harness(activeTool = null) {
  const svg = new MouseSurface(), win = new MouseSurface(), selected = [], changes = [];
  globalThis.window = win;
  const station = { id: 'station-1', x: 25, y: 35 }, blank = { closest: () => null };
  const stationElement = { closest: selector => selector.includes('[data-station-id]') ? { dataset: { stationId: station.id } } : null };
  const state = { activeTool, pan: { x: 10, y: 20 }, zoom: 1, nodes: [station], edges: [], shapes: [], texts: [], subDrawings: [],
    selectedEntities: [], drag: { mode: null }, menuSelection: { station: 'preset', lineType: 'line-1', lineGeometry: 'straight' } };
  const binder = createEventBinder({ state, elements: { svg, viewport: svg },
    renderer: { updateDragCursor() {}, updateViewportTransform() {} },
    selectEntity: entity => selected.push(entity), selectEntities: entities => selected.push(...entities),
    clearSelection: () => selected.push('clear'), onStateChanged: change => changes.push(change) });
  binder.bindCanvas();
  const down = (button, target = blank) => svg.emit('mousedown', { button, target });
  const move = (x, y) => win.emit('mousemove', { clientX: x, clientY: y, target: blank });
  const up = button => win.emit('mouseup', { button, target: blank });
  return { svg, state, station, stationElement, blank, selected, changes, down, move, up };
}

test('route right pans over objects without selecting, moving or changing the drawing tool', () => {
  const h = harness('line'), before = structuredClone(h.station), menu = structuredClone(h.state.menuSelection);
  h.down(2, h.stationElement); h.move(170, 140);
  assert.deepEqual(h.state.pan, { x: 80, y: 60 }); assert.deepEqual(h.station, before);
  h.up(1); assert.equal(h.state.drag.mode, 'pan'); h.up(2);
  assert.equal(h.state.drag.mode, null); assert.deepEqual(h.selected, []); assert.deepEqual(h.state.menuSelection, menu);
  assert.equal(h.state.activeTool, 'line'); assert.equal(Boolean(h.state.drag.suppressClick), false);
  assert.deepEqual(h.changes, [{ coalesceKey: 'viewport' }]);
  h.svg.emit('click', { target: h.stationElement }); assert.deepEqual(h.selected, [{ type: 'station', id: 'station-1' }]);
});

test('left on blank canvas selects instead of panning; drawing tools keep left for placement', () => {
  const h = harness(); h.down(0); assert.equal(h.state.drag.mode, 'marquee');
  h.up(0); assert.deepEqual(h.state.pan, { x: 10, y: 20 });
  for (const tool of ['station', 'shape', 'line', 'text', 'subDrawing']) {
    const drawing = harness(tool); drawing.down(0); assert.equal(drawing.state.drag.mode, null);
    assert.deepEqual(drawing.state.pan, { x: 10, y: 20 });
  }
});

test('route navigation cannot place objects; middle is inactive and autoscroll is suppressed', () => {
  const h = harness(); h.down(1, h.stationElement); assert.equal(h.state.drag.mode, null); h.up(1);
  h.down(2, h.stationElement); h.up(2);
  h.svg.emit('click', { button: 2, target: h.stationElement }); assert.deepEqual(h.selected, []);
  assert.equal(h.svg.emit('auxclick', { button: 1 }).defaultPrevented, true);
});

test('right drag suppresses context menus without blocking the next stationary right click', () => {
  const h = harness();
  // With the custom menu disabled, stationary clicks retain the browser menu.
  h.state.appSettings = { enableContextMenu: false };
  createContextMenu({ state: h.state, elements: { svg: h.svg } }).bind();
  h.down(2); h.move(170, 140);
  assert.equal(h.svg.emit('contextmenu').defaultPrevented, true);
  h.up(2); assert.equal(h.svg.emit('contextmenu').defaultPrevented, true);
  h.down(2); h.up(2);
  assert.equal(Boolean(h.svg.emit('contextmenu').defaultPrevented), false);
});
