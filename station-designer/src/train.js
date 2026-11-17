import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { trainLayout } from './track.js';

export function buildTrain(track, color, forward, material, routePose) {
  const layout = trainLayout(track);
  if (!layout) return null;
  const cached = new Map();
  const mat = material || (color => {
    if (!cached.has(color)) cached.set(color, new THREE.MeshStandardMaterial({ color, roughness: .65, metalness: .15 }));
    return cached.get(color);
  });
  const train = new THREE.Group();
  train.name = 'track-train';
  train.userData.train = true;
  train.userData.carCount = layout.count;
  train.userData.units = layout.units;
  train.userData.formation = layout.formation;
  train.rotation.y = routePose ? 0 : forward ? 0 : Math.PI;
  train.scale.setScalar(layout.scale);
  const shell = '#dce4df', roof = '#f0f2e9', glass = '#405c60', trim = '#7b8e87', door = '#b9c9c1';

  for (let i = 0; i < layout.count; i++) {
    const spec = layout.cars[i];
    const car = new THREE.Group();
    car.name = `carriage-${i + 1}`;
    car.userData.carriage = i + 1;
    Object.assign(car.userData, spec);
    car.position.x = spec.center;
    if(routePose){const pose=routePose(spec);car.position.set(pose.x,0,pose.z);car.rotation.y=-pose.angle*Math.PI/180;}
    car.scale.set(spec.length / 20, layout.dimensions.height / 3.8, layout.dimensions.width / 2.8);
    train.add(car);
    const rear = spec.rearCab, front = spec.frontCab;
    const batches = new Map();
    const add = (geometry, color, kind = 'body') => {
      const key = `${kind}:${color}`, batch = batches.get(key) || { color, kind, parts: [] };
      if (geometry.index) { const source = geometry; geometry = source.toNonIndexed(); source.dispose(); }
      batch.parts.push(geometry);
      batches.set(key, batch);
    };
    const box = (x, y, z, w, h, d, color, rotation = 0, kind = 'body') => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      geometry.rotateZ(rotation).translate(x, y, z);
      add(geometry, color, kind);
    };

    // Sloping cab ends distinguish the first and last cars from the trailers.
    const profile = new THREE.Shape();
    profile.moveTo(-10, .76); profile.lineTo(10, .76); profile.lineTo(10, 1.35);
    profile.lineTo(front ? 9.25 : 10, 3.25); profile.lineTo(rear ? -9.25 : -10, 3.25);
    profile.lineTo(-10, 1.35); profile.closePath();
    const body = new THREE.ExtrudeGeometry(profile, { depth: 2.8, bevelEnabled: true, bevelSize: .055, bevelThickness: .04, bevelSegments: 1, steps: 1 });
    body.translate(0, 0, -1.4); add(body, shell);
    box(0, .7, 0, 19.8, .25, 2.65, trim);
    box(0, 3.28, 0, front || rear ? 18.45 : 19.65, .2, 2.55, roof);

    const doorXs = Array.from({ length: spec.doors }, (_, n) => -8.4 + (n + .5) * 16.8 / spec.doors);
    const doorWidth = Math.min(1.3, 16.8 / spec.doors * .5);
    for (const side of [-1, 1]) {
      const z = side * 1.46;
      for (const x of doorXs) {
        box(x, 1.96, z, doorWidth, 1.95, .045, door, 0, 'passenger-doors');
        box(x, 2.47, z + side * .035, doorWidth * .75, .65, .03, glass);
        box(x, 1.93, z + side * .055, .035, 1.82, .025, trim);
      }
      for (let n = 1; n < spec.doors; n++) {
        const x = (doorXs[n - 1] + doorXs[n]) / 2;
        box(x, 2.45, z, Math.min(3.7, doorXs[n] - doorXs[n - 1] - doorWidth - .55), .88, .045, glass);
      }
      for (const x of [-8.8, 8.8]) box(x, 2.44, z, .9, .8, .045, glass);
      box(0, 1.38, z + side * .055, 19.5, .24, .045, color);
      if (spec.firstClass) box(0, 2.99, z + side * .03, 19.3, .19, .04, '#c89c45');
    }

    // Wheels, roof equipment and gangways also read clearly in a plan view.
    for (const x of [-6, 6]) {
      box(x, .42, 0, 2.6, .28, 1.95, trim);
      for (const dx of [-.7, .7]) for (const z of [-.91, .91]) {
        const wheel = new THREE.CylinderGeometry(.36, .36, .22, 8);
        wheel.rotateX(Math.PI / 2).translate(x + dx, .32, z);
        add(wheel, glass);
      }
    }
    for (const x of [-4.5, 4.5]) {
      box(x, 3.56, 0, 2.8, .38, 1.7, door);
      for (let vent = -3; vent <= 3; vent++) box(x + vent * .28, 3.76, 0, .065, .025, 1.2, trim);
    }
    for (const [end, cab] of [[-1, rear], [1, front]]) {
      if (!cab) { box(end * 10.08, 1.67, 0, .15, 1.7, 1.65, trim); continue; }
      const slope = end * Math.atan2(.75, 1.9);
      box(end * 9.64, 2.45, 0, .055, .93, 2.0, glass, slope);
      const outer = (end === -1 && i === 0) || (end === 1 && i === layout.count - 1);
      for (const z of [-.85, .85]) box(end * 10.06, 1.12, z, .06, .19, .3, outer ? end === 1 ? '#fff1bb' : '#c85b60' : trim);
      box(end * 10.06, .86, 0, .09, .18, 2.2, color);
    }
    for (const { color, kind, parts } of batches.values()) {
      const geometry = mergeGeometries(parts);
      parts.forEach(part => part.dispose());
      const mesh = new THREE.Mesh(geometry, mat(color));
      mesh.name = kind;
      if (kind === 'passenger-doors') mesh.userData.doorCount = spec.doors * 2;
      car.add(mesh);
    }
  }
  const carriages=train.children.filter(child=>child.userData.carriage);
  for(let i=0;i<carriages.length-1;i++){
    const a=carriages[i],b=carriages[i+1],spec=layout.cars[i],next=layout.cars[i+1];
    const end=(car,sign)=>new THREE.Vector3(sign*10*car.scale.x,0,0).applyEuler(car.rotation).add(car.position);
    const start=end(a,1),finish=end(b,-1),length=start.distanceTo(finish);
    const coupler=new THREE.Mesh(new THREE.BoxGeometry(Math.max(.05,length+.12),.2,.5),mat(trim));
    coupler.name=spec.unit===next.unit?'car-coupler':'unit-coupler';
    coupler.position.copy(start).add(finish).multiplyScalar(.5);coupler.position.y=.65*layout.dimensions.height/3.8;
    coupler.rotation.y=-Math.atan2(finish.z-start.z,finish.x-start.x);train.add(coupler);
  }
  return train;
}
