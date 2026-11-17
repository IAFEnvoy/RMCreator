import * as THREE from 'three';

export function stairStepLayout(entity, height = entity.h) {
  const escalator = entity.type === 'escalator';
  const maxRise = escalator ? .2 : .18, maxRun = escalator ? .4 : .32;
  // Exploded views also get more steps instead of stretching a fixed set.
  // Plan views retain the real stair's step density despite their flattened height.
  const count = Math.max(1, Math.ceil(Math.max(Math.abs(height), entity.h) / maxRise), Math.ceil(entity.l / maxRun));
  return { count, run: entity.l / count, rise: height / count, bodyHeight: Math.max(.035, Math.abs(height) / count + .025) };
}

export function buildStairSteps(entity, height, material, range = null) {
  const layout = stairStepLayout(entity, height), { count, run, rise, bodyHeight } = layout;
  const escalator = entity.type === 'escalator';
  const mat = material || (color => new THREE.MeshStandardMaterial({ color }));
  const group = new THREE.Group();
  const first = range ? Math.floor(range.from * count) : 0, last = range ? Math.ceil(range.to * count) : count;
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(run + .002, bodyHeight, entity.d), mat(escalator ? '#9daba3' : entity.color), last - first);
  const treads = new THREE.InstancedMesh(new THREE.BoxGeometry(run * .97, .035, Math.max(.02, entity.d - .12)), mat(escalator ? '#cad2c9' : '#e0cfb2'), last - first);
  bodies.name = 'stair-step-bodies'; treads.name = 'stair-step-treads';
  const matrix = new THREE.Matrix4();
  for (let i = first; i < last; i++) {
    const x = -entity.l / 2 + (i + .5) * run, top = (i + 1) * rise + .04;
    const place = (mesh, y, width) => {
      let center = x, scale = 1;
      if (range) {
        const left = Math.max(x - width / 2, -entity.l / 2 + range.from * entity.l);
        const right = Math.min(x + width / 2, -entity.l / 2 + range.to * entity.l);
        center = (left + right) / 2; scale = Math.max(0, right - left) / width;
      }
      mesh.setMatrixAt(i - first, matrix.makeScale(scale, 1, 1).setPosition(center, y, 0));
    };
    // Clip a middle tread in place, retaining the original spacing even for odd counts.
    place(bodies, top - .035 - bodyHeight / 2, run + .002);
    place(treads, top - .0175, run * .97);
  }
  bodies.instanceMatrix.needsUpdate = true; treads.instanceMatrix.needsUpdate = true;
  group.add(bodies, treads);
  return group;
}
