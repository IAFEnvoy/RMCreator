import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import clipping from 'polygon-clipping';
import { isProject, migrateProject } from '../src/project.js';
import { zoneMasks, polygonContains, pathPolygon, rectPolygon, polygonArea } from '../src/zone-geometry.js';
import { stairEndpoints } from '../src/stair-endpoints.js';
import { stairRoute, stairPathError } from '../src/stair-path.js';
import { trainFit } from '../src/train-placement.js';

const example=()=>JSON.parse(fs.readFileSync(new URL('../examples/长寿路站-7号线-13号线-全6A.json',import.meta.url),'utf8'));

test('the Changshou example has one connected concourse and five complete bank openings without automatic slivers',()=>{
  const p=example(),masks=zoneMasks(p,'B1');assert(isProject(p));assert(isProject(migrateProject(p)));
  assert.equal(masks.paid.length,1);assert.equal(masks.unpaid.length,1);assert.equal(clipping.union(...Object.values(masks).filter(p=>p.length)).length,1);
  for(const bank of ['7-west','7-east','13-north','13-middle','13-south']){
    const hole=p.zonePaths.find(p=>p.id===`opening-${bank}`);assert.equal(hole.vertices.length,4);
    for(const e of p.entities.filter(e=>e.id===`stairs-${bank}`||e.id.startsWith(`escalator-${bank}-`)))assert(polygonArea(clipping.difference(rectPolygon(e,-.4),pathPolygon(hole)))<1e-6,`${e.id} must fit its shared opening`);
  }
});

test('the direct transfer uses two turning flights and every connection reaches paid floor space',()=>{
  const p=example(),transfer=p.entities.find(e=>e.id==='stairs-transfer'),route=stairRoute(transfer);
  assert.equal(transfer.floor,'B3');assert.equal(transfer.toFloor,'B2');assert.equal(route.segments.length,2);assert.equal(route.landings.length,1);assert.equal(stairPathError(transfer,{slope:true}),'');
  assert.notEqual(route.segments[0].angle,route.segments[1].angle);
  const base={...p,zonePaths:p.zonePaths.filter(p=>p.kind!=='opening')};
  for(const e of p.entities.filter(e=>['stairs','escalator'].includes(e.type)&&e.toFloor))for(const point of stairEndpoints(e))assert(polygonContains(zoneMasks(base,point.floor).paid,point),e.id);
  const trains=p.entities.filter(e=>e.type==='train');assert.equal(trains.length,4);
  for(const e of trains){assert.equal(e.trainCars,6);assert.equal(e.trainPreset,'metro-a');assert.equal(e.trainUnits,1);assert(trainFit(p,e).valid);}
});
