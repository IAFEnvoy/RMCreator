import * as THREE from 'three';
import { calloutLayout } from './text.js';

export function buildTextCallout(text,texture,floorOffset=0) {
  const group=new THREE.Group(),layout=calloutLayout(text);
  const card=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));
  card.center.set(.5,0);card.scale.set(layout.l,layout.d,1);card.renderOrder=22;card.userData.ownedGraphic=true;group.add(card);
  const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,.25,0),new THREE.Vector3(0,8.25,0)]);
  const leader=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:text.color,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));
  leader.renderOrder=21;group.add(leader);
  const anchor=new THREE.Mesh(new THREE.SphereGeometry(.4,12,8),new THREE.MeshBasicMaterial({color:text.color,depthTest:false,depthWrite:false,toneMapped:false}));
  anchor.position.y=.25;anchor.renderOrder=23;anchor.userData.ownedHandle=true;anchor.userData.textAnchor=true;group.add(anchor);
  group.userData.callout={card,leader,anchor,leaderLength:text.leaderLength??8,enabled:text.anchorEnabled!==false,anchorX:text.anchorX,anchorZ:text.anchorZ,floorOffset,source:text};
  return group;
}

// Keep the card screen-up and the optional target fixed in world space, even while moving the text.
export function updateTextCallout(group,camera) {
  const data=group.userData.callout,{card,leader,anchor,leaderLength,enabled}=data;
  const inverse=new THREE.Matrix4().copy(group.matrixWorld).invert();
  const up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1).transformDirection(inverse);
  card.position.set(0,.25,0).addScaledVector(up,leaderLength);
  const base=new THREE.Vector3().setFromMatrixPosition(group.matrixWorld);
  data.initialAnchor??=base.clone();
  const target=new THREE.Vector3(data.anchorX??data.initialAnchor.x,base.y+.25,(data.anchorZ===undefined?data.initialAnchor.z:data.anchorZ+data.floorOffset));
  anchor.position.copy(target).applyMatrix4(inverse);anchor.visible=enabled;leader.visible=enabled;
  const points=leader.geometry.attributes.position;
  points.setXYZ(0,anchor.position.x,anchor.position.y,anchor.position.z);
  points.setXYZ(1,card.position.x,card.position.y,card.position.z);
  points.needsUpdate=true;leader.geometry.computeBoundingSphere();
  card.updateMatrixWorld();
}
