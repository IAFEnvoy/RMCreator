import * as THREE from 'three';
import { MAX_ZONE_VERTICES, corner, distance, flattenPath, closestOnPath, insertZoneVertex, removeZoneVertex, moveZoneVertices, moveZoneHandle, convertZoneVertices, constrainPoint, zonePathError } from './zone-path.js';
import { snapZonePoint, polygonEdges, rectPolygon } from './zone-geometry.js';
import { trackFootprints } from './track-path.js';
import { snapPlacementPoint, alignmentMessage } from './placement-snap.js';
import { rectangularOpening, openingError } from './zone-openings.js';

export class ZoneEditor {
  constructor(scene) {
    this.scene=scene;this.selected=new Set();this.mode='direct';
    this.helpers=new THREE.Group();this.helpers.userData.zoneHelper=true;scene.scene.add(this.helpers);
    this.marquee=document.createElement('div');this.marquee.className='vertex-marquee';this.marquee.hidden=true;scene.container.append(this.marquee);
  }
  get active(){return !!this.path;}
  get ring(){return this.contour<0?this.path:{vertices:this.path.holes[this.contour],closed:true};}
  set ring(value){if(this.contour<0)this.path=value;else this.path.holes[this.contour]=value.vertices;}
  begin(kind,floor) {
    this.stop();this.drawing=true;this.drawShape=kind==='opening'?'rectangle':'pen';this.contour=-1;this.path={id:`zone-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,floor,kind,closed:false,vertices:[]};this.mode='pen';this.notify();this.render();
  }
  edit(id) {
    const path=this.scene.project.zonePaths?.find(p=>p.id===id);if(!path)return;
    this.stop();this.path=structuredClone(path);this.contour=-1;this.drawing=false;this.mode='direct';this.notify();this.render();
  }
  stop(){this.path=null;this.drag=null;this.lastPointer=null;this.guides=[];this.drawing=false;this.selected.clear();this.hover=null;this.segmentHover=null;this.snap=null;this.closeHover=false;this.dirtyPreview=false;this.marquee.hidden=true;this.clear();this.scene.controls.enabled=true;this.scene.showSnap?.({});this.scene.callbacks.onSnap?.('');this.notify();}
  sync() {
    if(!this.active)return;
    if(!this.drawing&&!this.drag){const saved=this.scene.project.zonePaths?.find(p=>p.id===this.path.id);if(!saved){this.stop();return;}this.path=structuredClone(saved);if(this.contour>=0&&!this.path.holes?.[this.contour])this.contour=-1;this.selected=new Set([...this.selected].filter(i=>i<this.ring.vertices.length));}
    this.render();
  }
  notify(){this.scene.callbacks.onZoneState?.(this.active?{id:this.path.id,floor:this.path.floor,kind:this.path.kind,drawing:this.drawing,drawShape:this.drawShape,mode:this.mode,closed:this.path.closed,count:this.ring.vertices.length,selected:[...this.selected],contour:this.contour,holes:this.path.holes?.length||0,vertices:structuredClone(this.ring.vertices)}:null);}
  setMode(mode){this.mode=mode;this.notify();this.render();}
  setDrawShape(shape){
    if(!this.drawing||this.path.kind!=='opening'||!['rectangle','pen'].includes(shape))return;
    this.drawShape=shape;this.drag=null;this.hover=null;this.selected.clear();this.mode='pen';
    if(shape==='rectangle')this.path.vertices=this.path.vertices.slice(0,1).map(v=>corner(v.pos));
    this.notify();this.render();
  }
  setContour(index){this.contour=index;this.selected.clear();this.notify();this.render();}
  clear(){this.scene.clearPlacementGroup(this.helpers);}
  worldPoint(event) {
    if(this.scene.activeFloor!=='all'&&this.path.floor!==this.scene.activeFloor)return null;
    const s=this.scene;s.hit(event);const p=new THREE.Vector3(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-s.floorY(this.path.floor));
    return s.raycaster.ray.intersectPlane(plane,p)?{x:p.x,z:p.z-s.floorOffset(this.path.floor)}:null;
  }
  screen(p){const s=this.scene,q=new THREE.Vector3(p.x,s.floorY(this.path.floor)+.36,p.z+s.floorOffset(this.path.floor)).project(s.camera);return {x:(q.x+1)*s.width/2,y:(1-q.y)*s.height/2};}
  local(event){const r=this.scene.renderer.domElement.getBoundingClientRect(),y=event.clientY-r.top;return {x:event.clientX-r.left,y,z:y};}
  hitPoint(event) {
    const p=this.local(event),ring=this.ring;let best=null;
    const candidate=(q,data,radius)=>{const v=this.screen(q),d=distance(p,{x:v.x,z:v.y});if(d<radius&&(!best||d<best.distance))best={...data,distance:d};};
    // Handles have priority where they overlap a selected point's neighborhood.
    ring.vertices.forEach((v,i)=>{if(this.selected.has(i))for(const side of ['handleIn','handleOut'])if(v[side])candidate(v[side],{index:i,side},8);});
    ring.vertices.forEach((v,i)=>candidate(v.pos,{index:i},9));return best;
  }
  tolerance(){const s=this.scene;return (s.camera.right-s.camera.left)/s.camera.zoom/s.width*9;}
  snapped(p,event,{anchor,exclude=[],handles=false}={}) {
    if(event.shiftKey&&anchor)p=constrainPoint(anchor,p);
    this.guides=[];this.snap=null;this.scene.showSnap?.({});
    if(handles||event.altKey||!this.scene.project.snapping){this.scene.callbacks.onSnap?.('');return p;}
    const vertices=this.ring.vertices.filter((v,i)=>!exclude.includes(i)).map(v=>v.pos),edges=this.scene.project.entities.filter(e=>e.type==='track'&&e.floor===this.path.floor&&e.visible).flatMap(t=>trackFootprints(t).flatMap(e=>polygonEdges(rectPolygon(e))));
    const result=snapZonePoint(this.scene.project,this.path.floor,p,{tolerance:this.tolerance(),excludeId:this.path.id,vertices,anchor,constrain:!!event.shiftKey,edges});
    let constraint;
    if(event.shiftKey&&anchor){const dx=p.x-anchor.x,dz=p.z-anchor.z,length=Math.hypot(dx,dz);if(length>.001){const n={x:-dz/length,z:dx/length};constraint={n,value:anchor.x*n.x+anchor.z*n.z};}}
    const aligned=snapPlacementPoint(this.scene.project,this.path.floor,p,{references:this.scene.snapReferences?.([this.path.floor],this.path.id),tolerance:this.tolerance(),excludeId:this.path.id,vertices,anchor,constraint});
    const geometry=result.snapped==='顶点'||result.snapped==='边界';
    if(aligned.snapped&&(!geometry||distance(p,aligned.point)<distance(p,result)-1e-5)){
      this.guides=aligned.guides;this.snap=aligned.point;this.scene.showSnap?.({floor:this.path.floor,guides:this.guides});this.scene.callbacks.onSnap?.(alignmentMessage(this.guides));return {x:aligned.point.x,z:aligned.point.z};
    }
    this.snap=result.snapped?result:null;this.scene.callbacks.onSnap?.(result.snapped?`已吸附${result.snapped}`:'');return {x:result.x,z:result.z};
  }
  pointerDown(event) {
    if(!this.active||event.button!==0)return false;
    const raw=this.worldPoint(event);if(!raw)return true;const hit=this.hitPoint(event),direct=!this.drawing||event.ctrlKey||event.metaKey||this.mode==='direct';
    this.scene.controls.enabled=false;
    if(this.drawing&&!direct){
      if(this.path.kind==='opening'&&this.drawShape==='rectangle'){
        const first=this.path.vertices[0]?.pos,p=this.snapped(raw,event,{anchor:first});
        if(!first){if(Math.abs(p.x)>500||Math.abs(p.z)>500){this.message('放置范围需在 ±500 m 内');return true;}this.path.vertices=[corner(p)];this.selected=new Set([0]);this.notify();this.render();return true;}
        if(Math.abs(p.x-first.x)<.2||Math.abs(p.z-first.z)<.2){this.message('孔洞长宽均需至少 0.2 m');return true;}
        const next=rectangularOpening(this.path,first,p),error=openingError(this.scene.project,next);
        if(error){this.message(error);return true;}
        this.path=next;this.close();return true;
      }
      if(hit?.index===0&&this.ring.vertices.length>=3){this.close();return true;}
      if(this.path.vertices.length>=MAX_ZONE_VERTICES){this.message('每条轮廓最多 128 个顶点');return true;}
      const last=this.path.vertices.at(-1),p=this.snapped(raw,event,{anchor:last?.pos});
      if(Math.abs(p.x)>500||Math.abs(p.z)>500){this.message('放置范围需在 ±500 m 内');return true;}
      if(last&&distance(last.pos,p)<.02)return true;
      this.path.vertices.push(corner(p));this.selected=new Set([this.path.vertices.length-1]);
      this.drag={kind:'create',index:this.path.vertices.length-1,start:raw,client:this.local(event)};this.hover=null;this.notify();this.render();return true;
    }
    if(this.mode==='add'&&!hit){const nearest=closestOnPath(this.ring,raw);if(nearest&&nearest.distance<=this.tolerance()){this.ring=insertZoneVertex(this.ring,nearest.segment,nearest.t);this.selected=new Set([nearest.segment+1]);this.persist();}return true;}
    if(hit){
      if(this.mode==='remove'&&!hit.side){this.selected=new Set([hit.index]);this.deleteSelected();return true;}
      if(event.shiftKey&&!hit.side){if(this.selected.has(hit.index))this.selected.delete(hit.index);else this.selected.add(hit.index);}else if(!this.selected.has(hit.index))this.selected=new Set([hit.index]);
      if(this.mode==='convert'&&!hit.side){this.drag={kind:'convert',index:hit.index,base:structuredClone(this.ring),start:raw,client:this.local(event)};}
      else this.drag={kind:hit.side?'handle':'vertex',...hit,base:structuredClone(this.ring),start:raw,client:this.local(event)};
      this.notify();this.render();return true;
    }
    // An empty-space drag selects vertices; it never moves the camera while editing.
    this.drag={kind:'marquee',start:this.local(event),baseSelection:event.shiftKey?new Set(this.selected):new Set()};this.selected=this.drag.baseSelection;this.render();return true;
  }
  pointerMove(event) {
    if(!this.active)return false;this.lastPointer={clientX:event.clientX,clientY:event.clientY,shiftKey:!!event.shiftKey,ctrlKey:!!event.ctrlKey,metaKey:!!event.metaKey,altKey:!!event.altKey};const raw=this.worldPoint(event);if(!raw){this.scene.showSnap?.({});return true;}
    const d=this.drag;
    if(d?.kind==='marquee'){
      const p=this.local(event),a=d.start,minX=Math.min(a.x,p.x),maxX=Math.max(a.x,p.x),minY=Math.min(a.y,p.y),maxY=Math.max(a.y,p.y);
      this.marquee.hidden=false;Object.assign(this.marquee.style,{left:`${minX}px`,top:`${minY}px`,width:`${maxX-minX}px`,height:`${maxY-minY}px`});
      this.selected=new Set(d.baseSelection);this.ring.vertices.forEach((v,i)=>{const q=this.screen(v.pos);if(q.x>=minX&&q.x<=maxX&&q.y>=minY&&q.y<=maxY)this.selected.add(i);});this.render();return true;
    }
    if(d){
      const p=this.local(event);if(!d.moved&&Math.hypot(p.x-d.client.x,p.y-d.client.y)<4)return true;d.moved=true;
      if(d.kind==='create'||d.kind==='convert'){
        const v=(d.kind==='create'?this.path:this.ring).vertices[d.index],q=this.snapped(raw,event,{anchor:v.pos,handles:true});v.type='smooth';v.handleOut=q;v.handleIn={x:2*v.pos.x-q.x,z:2*v.pos.z-q.z};
      }else if(d.kind==='handle'){
        const anchor=d.base.vertices[d.index].pos,q=this.snapped(raw,event,{anchor,handles:true});this.ring=moveZoneHandle(d.base,d.index,d.side,q,event.altKey);
      }else if(d.kind==='vertex'){
        const origin=d.base.vertices[d.index].pos,target={x:origin.x+raw.x-d.start.x,z:origin.z+raw.z-d.start.z};
        const q=this.snapped(target,event,{anchor:origin,exclude:[...this.selected]});this.ring=moveZoneVertices(d.base,[...this.selected],{x:q.x-origin.x,z:q.z-origin.z});
      }
      this.dirtyPreview=true;this.render();return true;
    }
    const hit=this.hitPoint(event),first=this.ring.vertices[0],close=this.drawing&&this.ring.vertices.length>=3&&first&&distance(this.local(event),{x:this.screen(first.pos).x,z:this.screen(first.pos).y})<10;
    this.closeHover=close;const last=this.ring.vertices.at(-1);this.hover=this.drawing&&this.mode==='pen'&&!event.ctrlKey&&!event.metaKey?this.snapped(raw,event,{anchor:last?.pos}):null;
    if(!this.hover){this.guides=[];this.snap=null;this.scene.showSnap?.({});}
    const near=this.mode==='add'&&!hit?closestOnPath(this.ring,raw):null;this.segmentHover=near&&near.distance<=this.tolerance()?near:null;
    this.scene.renderer.domElement.style.cursor=close?'var(--pen-close-cursor), crosshair':this.mode==='remove'&&hit?'not-allowed':this.segmentHover?'copy':hit?'grab':'crosshair';this.render();return true;
  }
  pointerUp() {
    if(!this.active)return false;const d=this.drag;this.drag=null;this.marquee.hidden=true;this.scene.controls.enabled=true;
    if(d?.kind==='convert'&&!d.moved)this.ring=convertZoneVertices(this.ring,[d.index],this.ring.vertices[d.index].type==='corner'?'smooth':'corner');
    if(this.drawing){const error=zonePathError(this.path,{draft:true});if(error){if(d?.kind==='create'){const v=this.path.vertices[d.index];this.path.vertices[d.index]=corner(v.pos);}else if(d?.base)this.ring=d.base;this.message(error);}}
    if(d&&d.kind!=='marquee'&&!this.drawing&&(d.moved||d.kind==='convert'))this.persist();else{this.notify();this.render();}return true;
  }
  message(text){this.scene.callbacks.onZoneMessage?.(text);}
  close(){
    if(!this.active)return;const next=structuredClone(this.path);next.closed=true;
    if(!this.drawing&&next.vertices.length>2&&distance(next.vertices[0].pos,next.vertices.at(-1).pos)<.02){
      const first=next.vertices[0],last=next.vertices.pop();if(last.handleIn)first.handleIn=last.handleIn;
      if(first.handleIn||first.handleOut){first.type='cusp';if(first.handleIn&&first.handleOut){const a={x:first.handleIn.x-first.pos.x,z:first.handleIn.z-first.pos.z},b={x:first.handleOut.x-first.pos.x,z:first.handleOut.z-first.pos.z};if(Math.abs(a.x*b.z-a.z*b.x)<1e-6&&a.x*b.x+a.z*b.z<=0)first.type='smooth';}}
    }
    const error=next.kind==='opening'?openingError(this.scene.project,next):zonePathError(next);if(error){this.message(error);return;}
    this.path=next;this.drawing=false;this.mode='direct';this.hover=null;this.snap=null;this.guides=[];this.scene.showSnap?.({});this.closeHover=false;this.segmentHover=null;this.selected=new Set();this.drag=null;this.scene.controls.enabled=true;this.scene.callbacks.onSnap?.('');this.persist(true);
  }
  persist(created=false){
    const error=this.path.kind==='opening'?openingError(this.scene.project,this.path):zonePathError(this.path);if(error){this.message(error);const original=this.scene.project.zonePaths?.find(p=>p.id===this.path.id);if(original){this.path=structuredClone(original);this.scene.previewZone?.(this.path);}this.dirtyPreview=false;this.notify();this.render();return;}
    this.dirtyPreview=false;this.scene.callbacks.onZoneChange?.(structuredClone(this.path),created);this.notify();this.render();
  }
  undoPoint(){if(this.drawing){this.path.vertices.pop();this.selected.clear();this.hover=null;this.snap=null;this.guides=[];this.scene.showSnap?.({});this.notify();this.render();}}
  cancelDrag(){const d=this.drag;this.drag=null;this.marquee.hidden=true;if(d?.kind==='create')this.path.vertices.pop();else if(d?.base)this.ring=d.base;if(!this.drawing)this.sync();if(!this.drawing)this.scene.previewZone?.(this.path);this.dirtyPreview=false;this.scene.controls.enabled=true;this.notify();this.render();}
  deleteSelected(){
    if(!this.selected.size)return;const ring=this.ring,min=ring.closed?3:2;
    if(ring.vertices.length-this.selected.size<min){this.message(`至少保留 ${min} 个顶点；删除整个区域请使用右侧删除按钮`);return;}
    let result=ring;for(const i of [...this.selected].sort((a,b)=>b-a))result=removeZoneVertex(result,i);this.ring=result;this.selected.clear();if(this.drawing){this.notify();this.render();}else this.persist();
  }
  convert(type){if(!this.selected.size){this.message('先选择一个或多个顶点');return;}this.ring=convertZoneVertices(this.ring,[...this.selected],type);if(this.drawing){this.notify();this.render();}else this.persist();}
  toggleClosed(){if(this.contour>=0)return;if(this.path.closed){const index=[...this.selected][0]??0;this.path.vertices=[...this.path.vertices.slice(index),...this.path.vertices.slice(0,index)];const first=this.path.vertices[0],last=structuredClone(first);delete first.handleIn;delete last.handleOut;this.path.vertices.push(last);this.path.closed=false;this.selected=new Set([0]);this.persist();}else this.close();}
  key(event){
    if(!this.active)return false;const key=event.key.toLowerCase();
    if(key==='escape'){if(this.drawing){this.stop();this.scene.callbacks.onZoneCancel?.();}else{this.selected.clear();this.notify();this.render();}return true;}
    if(key==='enter'){if(this.drawing||!this.path.closed)this.close();return true;}
    if(key==='backspace'||key==='delete'){if(this.drawing)this.undoPoint();else this.deleteSelected();return true;}
    if(key==='a'&&!event.ctrlKey&&!event.metaKey){this.setMode('direct');return true;}
    if(key==='p'&&!event.ctrlKey&&!event.metaKey){if(this.drawing)this.setMode('pen');else this.setMode('add');return true;}
    if((event.ctrlKey||event.metaKey)&&key==='a'){this.selected=new Set(this.ring.vertices.map((v,i)=>i));this.notify();this.render();return true;}
    if(this.drawing&&(event.ctrlKey||event.metaKey)&&key==='z'){if(!event.shiftKey)this.undoPoint();return true;}
    return false;
  }
  flush(){if(!this.dirtyPreview||this.drawing)return;this.dirtyPreview=false;this.scene.previewZone(this.path);}
  render(){
    this.clear();this.scene.applyFloorFocus();if(!this.active||(this.scene.activeFloor!=='all'&&this.path.floor!==this.scene.activeFloor))return;const s=this.scene,y=s.floorY(this.path.floor)+.37,offset=s.floorOffset(this.path.floor),ring=this.ring;
    const line=(points,color,opacity=1,dashed=false)=>{if(points.length<2)return;const mesh=s.line(this.helpers,points.map(p=>[p.x,y,p.z+offset]),color,opacity,dashed);mesh.material.depthTest=false;mesh.material.toneMapped=false;mesh.renderOrder=50;};
    const rectangle=this.drawing&&this.path.kind==='opening'&&this.drawShape==='rectangle'&&ring.vertices.length&&this.hover?rectangularOpening(this.path,ring.vertices[0].pos,this.hover):null;
    let outline=flattenPath(rectangle||ring);if(this.drawing&&this.hover&&ring.vertices.length&&!rectangle){const ghost={vertices:[ring.vertices.at(-1),corner(this.hover)],closed:false};line(flattenPath(ghost),'#708cc6',.7,true);}
    if(this.drawing&&(ring.vertices.length>=2||rectangle)){
      const vertices=this.hover?[...ring.vertices,corner(this.hover)]:ring.vertices;
      if(vertices.length>=3||rectangle){const points=flattenPath(rectangle||{vertices,closed:true}),shape=new THREE.Shape(points.map(p=>new THREE.Vector2(p.x,-p.z)));
        const fill=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color:this.scene.project.zoneColors[this.path.kind]||'#c9756b',transparent:true,opacity:.3,depthTest:false,depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));fill.rotation.x=-Math.PI/2;fill.position.set(0,y-.01,offset);fill.renderOrder=45;this.helpers.add(fill);}
    }
    line(outline,this.path.kind==='opening'?'#b86a52':'#335fb2');
    const radius=Math.max(.12,(s.camera.right-s.camera.left)/s.camera.zoom/s.width*3.5);
    const dot=(p,selected,color='#335fb2',r=radius)=>{const mesh=new THREE.Mesh(new THREE.SphereGeometry(r,12,8),new THREE.MeshBasicMaterial({color:selected?color:'#ffffff',depthTest:false,toneMapped:false}));mesh.position.set(p.x,y+.01,p.z+offset);mesh.renderOrder=55;this.helpers.add(mesh);if(!selected){const circle=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({length:24},(_,i)=>new THREE.Vector3(Math.cos(i/24*Math.PI*2)*r,0,Math.sin(i/24*Math.PI*2)*r))),new THREE.LineBasicMaterial({color,depthTest:false,toneMapped:false}));circle.position.copy(mesh.position);circle.renderOrder=56;this.helpers.add(circle);}};
    ring.vertices.forEach((v,i)=>{const selected=this.selected.has(i);if(selected)for(const side of ['handleIn','handleOut'])if(v[side]){line([v.pos,v[side]],'#93a8cb',.75);dot(v[side],false,'#6e8ec2',radius*.8);}dot(v.pos,selected);});
    if(this.closeHover&&ring.vertices[0])dot(ring.vertices[0].pos,false,'#3f975e',radius*1.7);
    if(this.snap)dot(this.snap,true,'#45a96e',radius*1.15);
    if(this.segmentHover&&!this.drawing)dot(this.segmentHover.point,false,'#335fb2',radius*1.3);
  }
}
