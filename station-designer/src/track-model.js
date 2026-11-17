import * as THREE from 'three';
import { trackGeometry, pointAlongTrack } from './track-path.js';

export function buildTrackModel(track, layout, material) {
  const group=new THREE.Group(),{samples,length}=trackGeometry(track);
  const mat=material||((color,options={})=>new THREE.MeshStandardMaterial({color,...options}));
  const sweep=(offset,width,y,height,color,options={})=>{
    const vertices=[],indices=[];
    samples.forEach((p,i)=>{
      for(const [side,up]of [[-1,-1],[1,-1],[1,1],[-1,1]]){
        const d=offset+side*width/2;vertices.push(p.x-p.tz*d,y+up*height/2,p.z+p.tx*d);
      }
      if(i)for(let k=0;k<4;k++){
        const a=(i-1)*4+k,b=(i-1)*4+(k+1)%4,c=i*4+k,d=i*4+(k+1)%4;
        indices.push(a,b,c,b,d,c);
      }
    });
    const last=(samples.length-1)*4;indices.push(0,2,1,0,3,2,last,last+1,last+2,last,last+2,last+3);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,mat(color,{side:THREE.DoubleSide,...options}));group.add(mesh);
  };
  sweep(0,track.d,-.87,.38,'#c4cbbf');
  const sleeperCount=Math.max(1,Math.ceil(length/2.1));
  const sleepers=new THREE.InstancedMesh(new THREE.BoxGeometry(.4,.2,Math.max(.1,track.d-.45)),mat('#89998c'),sleeperCount),dummy=new THREE.Object3D();
  for(let i=0;i<sleeperCount;i++){
    const p=pointAlongTrack(track,Math.min(length,(i+.5)*length/sleeperCount));
    dummy.position.set(p.x,-.5,p.z);dummy.rotation.y=-p.angle*Math.PI/180;dummy.updateMatrix();sleepers.setMatrixAt(i,dummy.matrix);
  }
  sleepers.instanceMatrix.needsUpdate=true;group.add(sleepers);
  for(const offset of [-.85,.85]){sweep(offset,.12,-.25,.24,'#84968b',{metalness:.4});sweep(offset,.2,-.1,.08,'#bdc7bd',{metalness:.4});}
  if(layout.bandVisible)sweep(layout.side*(track.d/2+.55),.8,-.5,.22,layout.bandColor);
  return group;
}
