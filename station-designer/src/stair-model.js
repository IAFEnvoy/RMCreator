import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { stairRoute } from './stair-path.js';
import { buildStairSteps } from './stair-steps.js';

function landingRails(polygon,mouths) {
  const edges=[];
  for(const ring of polygon)for(let i=0;i<ring.length-1;i++){
    const a=ring[i],b=ring[i+1],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.001)continue;
    let intervals=[[0,1]];
    for(const mouth of mouths){
      const theta=mouth.angle*Math.PI/180,ux=Math.cos(theta),uz=Math.sin(theta);
      if(Math.abs(dx*ux+dz*uz)>1e-5*length||Math.abs((a[0]-mouth.x)*ux+(a[1]-mouth.z)*uz)>.001)continue;
      const at=(x,z)=>((x-a[0])*dx+(z-a[1])*dz)/(length*length),ends=[at(mouth.x-uz*mouth.width/2,mouth.z+ux*mouth.width/2),at(mouth.x+uz*mouth.width/2,mouth.z-ux*mouth.width/2)].sort((a,b)=>a-b);
      intervals=intervals.flatMap(([from,to])=>to<=ends[0]||from>=ends[1]?[[from,to]]:[[from,Math.min(to,ends[0])],[Math.max(from,ends[1]),to]].filter(([f,t])=>t>f));
    }
    for(const [from,to]of intervals)if((to-from)*length>.05)edges.push({a:{x:a[0]+dx*from,z:a[1]+dz*from},b:{x:a[0]+dx*to,z:a[1]+dz*to}});
  }
  return edges;
}

export function buildBentStair(e,height,material,range=null) {
  const root=new THREE.Group(),route=stairRoute(e,height);root.name='bent-stair';
  const box=(g,x,y,z,l,h,d,color)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(l,h,d),material(color));m.position.set(x,y,z);g.add(m);return m;};
  for(const s of route.segments) {
    const from=range?Math.max(s.from,range.from):s.from,to=range?Math.min(s.to,range.to):s.to;
    if(to<=from)continue;
    const g=new THREE.Group();g.name=s.flat?'stair-level-passage':'stair-flight';g.position.set((s.a.x+s.b.x)/2,s.yFrom,(s.a.z+s.b.z)/2);g.rotation.y=-s.angle*Math.PI/180;root.add(g);
    const localRange={from:(from-s.from)/(s.to-s.from),to:(to-s.from)/(s.to-s.from)},rise=s.yTo-s.yFrom;
    if(s.flat)box(g,(localRange.from+localRange.to-1)*s.run/2,-.08,0,s.run*(localRange.to-localRange.from),.22,e.d,e.color);
    else g.add(buildStairSteps({...e,l:s.run,h:e.h*s.run/route.riseRun},rise,material,localRange));
    const run=s.run*(localRange.to-localRange.from),h=rise*(localRange.to-localRange.from),length=Math.hypot(run,h),x=(localRange.from+localRange.to-1)*s.run/2,y=rise*(localRange.from+localRange.to)/2;
    for(const z of [-e.d/2,e.d/2]){
      const rail=box(g,x,y+1.1,z,length,.12,.12,'#8da18e');rail.rotation.z=Math.atan2(h,run);
      const beam=box(g,x,y-.12,z,length,.2,.16,'#aa9d85');beam.rotation.z=Math.atan2(h,run);
      for(let i=0;i<=4;i++)box(g,-s.run/2+(localRange.from+(localRange.to-localRange.from)*i/4)*s.run,rise*(localRange.from+(localRange.to-localRange.from)*i/4)+.55,z,.1,1.1,.1,'#9aac9b');
    }
  }
  for(const landing of route.landings) {
    if(range&&(landing.t<range.from||landing.t>range.to))continue;
    const i=route.landings.indexOf(landing),angles=[route.segments[i].angle,route.segments[i+1].angle];
    const squares=angles.map(angle=>{
      const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),p=landing.point;
      const ring=[[-landing.depth/2,-e.d/2],[landing.depth/2,-e.d/2],[landing.depth/2,e.d/2],[-landing.depth/2,e.d/2],[-landing.depth/2,-e.d/2]].map(([x,z])=>[p.x+x*c-z*s,p.z+x*s+z*c]);return [[ring]];
    });
    const incoming=route.segments[i],outgoing=route.segments[i+1];
    for(const polygon of polygonClipping.union(...squares)){
      const shape=new THREE.Shape(polygon[0].map(([x,z])=>new THREE.Vector2(x,-z)));
      const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.22,bevelEnabled:false}),material(e.color));
      mesh.name='stair-turn-landing';mesh.rotation.x=-Math.PI/2;mesh.position.y=landing.y-.18;root.add(mesh);
      for(const {a,b}of landingRails(polygon,[{...incoming.b,angle:incoming.angle,width:e.d},{...outgoing.a,angle:outgoing.angle,width:e.d}])){
        const length=Math.hypot(b.x-a.x,b.z-a.z),rail=box(root,(a.x+b.x)/2,landing.y+1.1,(a.z+b.z)/2,length,.12,.12,'#8da18e');rail.rotation.y=-Math.atan2(b.z-a.z,b.x-a.x);rail.name='stair-landing-rail';
        for(const p of [a,b])box(root,p.x,landing.y+.55,p.z,.1,1.1,.1,'#9aac9b');
      }
    }
  }
  return root;
}
