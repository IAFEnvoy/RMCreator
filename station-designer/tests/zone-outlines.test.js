import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';
import { defaultProject, entity } from '../src/project.js';
import { rectangularOpening } from '../src/zone-openings.js';
import { floorOutlineEdges } from '../src/zone-outlines.js';
import { zoneMasks, polygonEdges } from '../src/zone-geometry.js';
import { zoneOutlineEdges, generateBoundaries } from '../src/zones.js';

registerHooks({load(url, context, next) { return url.includes('.svg') ? { format: 'module', source: 'export default "<svg></svg>"', shortCircuit: true } : next(url, context); }});
const { StationScene } = await import('../src/scene.js');
const rect = (id, kind, x, z, l, d, floor = 'B2') => rectangularOpening({ id, kind, floor }, { x, z }, { x: x + l, z: z + d });
const fixture = () => ({ ...defaultProject(), entities: [], zones: { B2: {}, B1: {} }, zonePaths: [] });
const length = edges => edges.reduce((sum, e) => sum + Math.hypot(e.x2 - e.x1, e.z2 - e.z1), 0);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const covers = (edges, x, z) => edges.some(e => {
  const dx = e.x2 - e.x1, dz = e.z2 - e.z1, l = Math.hypot(dx, dz), t = ((x - e.x1) * dx + (z - e.z1) * dz) / l ** 2;
  return t >= -1e-7 && t <= 1 + 1e-7 && Math.abs((x - e.x1) * dz - (z - e.z1) * dx) / l < 1e-6;
});

test('touching public blocks share a single outer outline across colors and partial contacts', () => {
  const p = fixture();
  p.zonePaths = [rect('a', 'paid', 0, 0, 20, 20), rect('b', 'unpaid', 20, 5, 10, 10)];
  const edges = floorOutlineEdges(p, 'B2');
  near(length(edges), 100);
  assert.equal(covers(edges, 20, 10), false);
  assert.equal(covers(edges, 20, 2), true);
  assert.equal(covers(edges, 30, 10), true);
  assert.ok(generateBoundaries(p, 'B2').some(e => e.kind === 'railing'), 'real access barriers still render');
  p.zonePaths[1].kind = 'paid';
  near(length(floorOutlineEdges(p, 'B2')), 100);

  p.zonePaths[1] = rect('b', 'unpaid', 20.5, 5, 10, 10);
  near(length(floorOutlineEdges(p, 'B2')), 120);
  assert.equal(covers(floorOutlineEdges(p, 'B2'), 20, 10), true, 'a real gap is not bridged');
});

test('legacy grid fills omit paid/unpaid seams while staff boundaries remain outlined', () => {
  const p = fixture();
  p.zones.B2 = { '0,0': 'paid', '1,0': 'unpaid', '2,0': 'staff' };
  for (const edges of [floorOutlineEdges(p, 'B2'), zoneOutlineEdges(p.zones.B2)]) {
    near(length(edges), 12);
    assert.equal(covers(edges, 2, 1), false);
    assert.equal(covers(edges, 4, 1), true);
  }
});

test('stair and escalator landings cut exact-width mouths on the matching floor at any rotation', () => {
  for (const type of ['stairs', 'escalator']) for (const rotation of [0, 37, 90, 180, 270]) {
    const p = fixture(), a = rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const stair = entity('stair', type, '楼梯', 0, 0, { floor: 'B2', toFloor: 'B1', l: 30, d: 4, rotation });
    p.entities = [stair];
    for (const [floor, sign] of [['B2', -1], ['B1', 1]]) {
      const path = rect(floor, 'paid', sign < 0 ? -35 : 15, -10, 20, 20, floor);
      for (const v of path.vertices) { const { x, z } = v.pos; v.pos = { x: c * x - s * z, z: s * x + c * z }; }
      p.zonePaths.push(path);
      const edges = floorOutlineEdges(p, floor);
      near(length(edges), 76);
      assert.equal(covers(edges, sign * 15 * c, sign * 15 * s), false);
      assert.equal(covers(edges, sign * 15 * c - 5 * s, sign * 15 * s + 5 * c), true);
    }
    stair.visible = false;
    near(length(floorOutlineEdges(p, 'B2')), 80);
  }
});

test('a stairwell keeps side edges and its closed end; intermediate floors do not gain imaginary landings', () => {
  const p = fixture();
  p.floors.push({ id: 'B3', code: 'B3', name: '下层', elevation: -12 });
  p.zones.B3 = {};
  p.zonePaths = [rect('floor', 'paid', -30, -10, 60, 20, 'B1'), rect('hole', 'opening', -14.6, -1.6, 29.2, 3.2, 'B1')];
  p.entities = [entity('stair', 'stairs', '楼梯', 0, 0, { floor: 'B3', toFloor: 'B1', l: 30, d: 4 })];
  const edges = floorOutlineEdges(p, 'B1');
  assert.equal(covers(edges, 14.6, 0), false);
  assert.equal(covers(edges, -14.6, 0), true, 'the far end is not a landing on this floor');
  assert.equal(covers(edges, 13, 1.6), true);
  assert.equal(covers(edges, 13, -1.6), true);
  assert.equal(covers(edges, 30, 0), true);
  p.zonePaths = p.zonePaths.map(path => ({ ...path, floor: 'B2' }));
  const masks = zoneMasks(p, 'B2');
  near(length(floorOutlineEdges(p, 'B2')), length(polygonEdges(masks.paid)));
});

test('crossing in mid-flight, unrelated floors, tracks and real holes keep their edges', () => {
  const p = fixture();
  p.zonePaths = [rect('floor', 'paid', -20, -10, 20, 20), rect('hole', 'opening', -9, -4, 4, 8)];
  p.entities = [entity('stair', 'stairs', '楼梯', 0, 0, { floor: 'B2', toFloor: 'B1', l: 30, d: 4 }), entity('track', 'track', '轨道', 0, 0, { l: 30 })];
  const edges = floorOutlineEdges(p, 'B2');
  assert.equal(covers(edges, 0, 0), true, 'mid-flight crossing is not a walkable landing');
  assert.equal(covers(edges, -5, 0), true, 'an unrelated hole stays closed');
  p.entities[0].floor = 'B1';
  near(length(floorOutlineEdges(p, 'B2')), length(polygonEdges(zoneMasks(p, 'B2').paid)));
});

test('overlapping and adjacent stair mouths merge cuts without deleting the rest of the perimeter', () => {
  const p = fixture();
  p.zonePaths = [rect('floor', 'paid', 0, -10, 20, 20)];
  p.entities = [0, 2, 5].map((z, i) => entity(`stair-${i}`, 'stairs', '楼梯', 10, z, { floor: 'B2', toFloor: 'B1', l: 20, d: 4 }));
  const edges = floorOutlineEdges(p, 'B2');
  near(length(edges), 71);
  assert.equal(covers(edges, 0, 4), false);
  assert.equal(covers(edges, 0, 8), true);
  assert.equal(covers(edges, 20, 0), true);
});

test('elevator doors open on connected floors and preserve the shaft sides and rear wall', () => {
  const p = fixture();
  p.entities = [entity('lift', 'elevator', '电梯', 0, 0, { floor: 'B2', toFloor: 'B1', l: 4, d: 4 })];
  p.zonePaths = [rect('floor', 'paid', -10, -10, 20, 20, 'B1'), rect('shaft', 'opening', -1.6, -1.6, 3.2, 3.2, 'B1')];
  const edges = floorOutlineEdges(p, 'B1');
  assert.equal(covers(edges, 0, 1.6), false);
  for (const [x, z] of [[1.6, 0], [-1.6, 0], [0, -1.6], [1.4, 1.6]]) assert.equal(covers(edges, x, z), true);
});

test('scene rendering uses the same passage-aware outlines for a single floor and all-floor layouts', () => {
  const project = fixture();
  project.zonePaths = [rect('floor', 'paid', 0, -10, 20, 20)];
  project.entities = [entity('stair', 'stairs', '楼梯', 10, 0, { floor: 'B2', toFloor: 'B1', l: 20, d: 4 })];
  for (const activeFloor of ['B2', 'all']) {
    const scene = Object.create(StationScene.prototype);
    Object.assign(scene, { project, activeFloor, view: 'floor', world: new THREE.Group(), zoneGroups: [], callbacks: {}, floorY: () => 0, floorOffset: () => 0, zoneMesh() {}, boundary() {} });
    scene.drawZones();
    const outline = scene.world.children.find(g => g.userData.drawFloor === 'B2').getObjectByName('zone-outlines');
    const coords = outline.geometry.getAttribute('position').array;
    const edges = [];
    for (let i = 0; i < coords.length; i += 6) edges.push({ x1: coords[i], z1: coords[i + 2], x2: coords[i + 3], z2: coords[i + 5] });
    near(length(edges), 76);
    assert.equal(covers(edges, 0, 0), false);
  }
});
