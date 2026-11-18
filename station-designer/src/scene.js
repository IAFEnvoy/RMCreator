import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ZONE_KINDS, generateBoundaries, snapTrack } from './zones.js';
import { trackLayout } from './track.js';
import { floorsTopDown } from './floors.js';
import { textLayout, calloutLayout, drawText, drawCallout } from './text.js';
import { buildTextCallout, updateTextCallout } from './text-callout.js';
import { buildTrain } from './train.js';
import { buildTrackModel } from './track-model.js';
import { buildStairSteps } from './stair-steps.js';
import { buildBentStair } from './stair-model.js';
import { stairWorldNodes, stairRoute, stairRoutePoint, moveStairPoint, stairPathError } from './stair-path.js';
import { placeTrain, trainFit, trainCarPose, syncTrains } from './train-placement.js';
import { connectedTrainRoute } from './train-route.js';
import { trackGeometry, pointAlongTrack, worldPoint, snapRailPoint, makeTrackPath, trackPathError, moveTrackKnot, syncTrackPaths } from './track-path.js';
import { curveDraft, curveDrawingState, changeTrackMode, inheritTrackStyle } from './track-drawing.js';
import { gateLayout } from './gates.js';
import { TWO_POINT_TYPES, CONNECTION_TYPES, placementPoint, twoPointPlacement, retargetPlacement, placementInputFloor, connectionFloors } from './placement.js';
import { facilityIcon, drawFacilityIcon } from './facility-icons.js';
import { captureViewport, appendExportFooter } from './export-image.js';
import { zoneMasks, cutOpenings, pathPolygon, polygonContains } from './zone-geometry.js';
import { floorOutlineEdges } from './zone-outlines.js';
import { closestOnPath } from './zone-path.js';
import { ZoneEditor } from './zone-editor.js';
import { placementReferences, snapPlacementPoint, alignmentMessage } from './placement-snap.js';
import { isStair, stairEndpoints, editStairEndpoint } from './stair-endpoints.js';
import { entityDisplayFloors, stairPlanRange } from './floor-entities.js';
import { setMouseButtons } from './mouse-controls.js';

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const facilityIcons = {
  elevator: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="4" r="1.5"/><path d="M9 7v5h5l2 5M9 9H6a5 5 0 1 0 6 7M9 7h5"/></svg>',
  stairs: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 17h5v-5h5V7h5V2"/></svg>',
  escalator: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 15h4L14 5h4v4h-3L7 19H2Z"/></svg>',
  service: facilityIcon('service'),
  gates: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 17V5h4v12m6 0V5h4v12M7 9l6 3"/></svg>',
};

export class StationScene {
  constructor(container, callbacks) {
    this.container = container; this.callbacks = callbacks; this.materials = new Map(); this.tool = 'select'; this.view = '3d'; this.selected = 'station'; this.zoomLevel = 1; this.labels = []; this.groups = new Map(); this.zoneGroups = [];this.textCallouts=[];
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#f6f8fb');
    this.camera = new THREE.OrthographicCamera(-130, 130, 100, -100, .1, 1800);
    this.camera.position.set(-155, 185, 255); this.camera.lookAt(0, 6, 0);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.02;
    this.renderer.domElement.setAttribute('aria-label', '可交互的地铁车站三维设计场景'); this.renderer.domElement.tabIndex = 0; container.prepend(this.renderer.domElement);
    this.labelRenderer = new CSS2DRenderer(); this.labelRenderer.domElement.className = 'label-renderer'; container.append(this.labelRenderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true; this.controls.dampingFactor = .1; this.controls.target.set(0, 6, 0); this.controls.minZoom = .3; this.controls.maxZoom = 6; this.controls.maxPolarAngle = Math.PI / 2.03; this.controls.minPolarAngle = .05;
    setMouseButtons(this.controls);
    this.controls.addEventListener('change', () => { const zoom = this.camera.zoom; if (this.zoomLevel !== zoom) { this.zoomLevel = zoom; this.callbacks.onZoom(zoom);this.refreshStairEndpoints(); } if(this.zoneEditor?.active)this.zoneEditor.render(); });
    const ambient = new THREE.HemisphereLight('#ffffff', '#c6cbb9', 2.1); this.scene.add(ambient);
    const keyLight = new THREE.DirectionalLight('#fffdf0', 2.8); keyLight.position.set(-50, 150, -70); this.scene.add(keyLight);
    const fill = new THREE.DirectionalLight('#e9f2ef', 1.4); fill.position.set(60, 70, 100); this.scene.add(fill);
    this.world = new THREE.Group(); this.scene.add(this.world);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(2500, 2500), this.mat('#f6f8fb')); this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -2.1; this.scene.add(this.ground);
    this.grid = new THREE.GridHelper(1000, 100, '#b0c1a4', '#ced9c3'); this.grid.position.y = -2.05; this.grid.material.transparent = true; this.grid.material.opacity = .25; this.scene.add(this.grid);
    this.editGrid = new THREE.GridHelper(1000, 500, '#b0c1a4', '#ced9c3'); this.editGrid.material.transparent = true; this.editGrid.material.opacity = .35; this.scene.add(this.editGrid);
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); this.dragPoint = new THREE.Vector3();
    this.zoneEditor=new ZoneEditor(this);this.installPointerEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container); this.resize();
    this.animate = this.animate.bind(this); this.renderer.setAnimationLoop(this.animate);
  }
  mat(color, options = {}) {
    const key = color + JSON.stringify(options); if (!this.materials.has(key)) this.materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: .85, metalness: .02, ...options })); return this.materials.get(key);
  }
  box(parent, x, y, z, w, h, d, color, options = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, .02), Math.max(h, .02), Math.max(d, .02)), this.mat(color, options)); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  floorGraphic(parent, x, y, z, width, depth, draw, category, canvasWidth = 1024, canvasHeight = 192) {
    const canvas=document.createElement('canvas');canvas.width=canvasWidth;canvas.height=canvasHeight;
    draw(canvas.getContext('2d'),canvasWidth,canvasHeight);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=this.renderer.capabilities.getMaxAnisotropy();
    const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,depth),material);
    mesh.rotation.x=-Math.PI/2;mesh.position.set(x,y,z);mesh.userData.ownedGraphic=true;
    mesh.visible=this.isPreview||category===undefined||(category==='texts'?this.project.display[category]!==false:this.project.display[category]);parent.add(mesh);return mesh;
  }
  uprightGraphic(parent, e, draw) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;draw(canvas.getContext('2d'),512,512);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,toneMapped:false}));
    sprite.position.set(0,e.d/2+.25,0);sprite.scale.set(e.l,e.d,1);sprite.userData.ownedGraphic=true;
    sprite.visible=this.isPreview||this.project.display.markers;parent.add(sprite);return sprite;
  }
  line(parent, points, color = '#aeb9a0', opacity = 1, dashed = false) {
    const g = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
    const m = dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 1.2, gapSize: .8 }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    const line = new THREE.Line(g, m); if (dashed) line.computeLineDistances(); parent.add(line); return line;
  }
  label(parent, x, y, z, content, category = 'names', entityId = null, requiresFullMarkers = false) {
    if (this.isPreview) return null;
    const div = document.createElement('div'); div.className = 'scene-label'; div.innerHTML = content;
    const label = new CSS2DObject(div); label.position.set(x, y, z); parent.add(label); this.labels.push({ label, div, category, entityId, requiresFullMarkers }); return label;
  }
  labelVisible({category,requiresFullMarkers}) {
    return this.project.display[category] && (!requiresFullMarkers || this.project.display.fullMarkers!==false);
  }
  floorY(id) {
    const floors = this.project.floors || [{ id: 'B2', elevation: 0 }, { id: 'B1', elevation: this.project.floorHeight || 12 }];
    const floor = floors.find(f => f.id === id); let y = floor?.elevation ?? 0;
    if (this.project.display.exploded && this.view === '3d') { const sorted = [...floors].sort((a,b) => a.elevation - b.elevation); y += sorted.findIndex(f => f.id === id) * 17; }
    return y;
  }
  floorOffset(id) {
    if(this.view!=='floor'||this.activeFloor!=='all')return 0;
    const floors=floorsTopDown(this.project.floors);return (floors.findIndex(f=>f.id===id)-(floors.length-1)/2)*110;
  }
  restoreFloorFocus() {
    for(const root of this.world.children)root.traverse(o=>{
      const original=o.userData.focusMaterial;if(!original)return;
      for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();
      o.material=original;delete o.userData.focusMaterial;
    });
    this.labels.forEach(l=>l.div.style.opacity='');this.focusKey=null;
  }
  applyFloorFocus() {
    if(!this.project)return;
    const floor=this.placement?placementInputFloor(this.placement,this.activeFloor):this.zoneEditor.path?.floor;
    const enabled=this.activeFloor==='all'&&!!floor&&this.fadeOtherFloors!==false;
    const key=`${floor}:${enabled}`;if(this.focusKey===key)return;
    this.restoreFloorFocus();this.focusKey=key;
    if(this.activeFloor==='all'){
      this.editGrid.visible=!!floor;this.editGrid.position.set(0,floor?this.floorY(floor)+.075:-2.05,floor?this.floorOffset(floor):0);
    }else this.editGrid.position.set(0,this.floorY(this.activeFloor)+.075,0);
    if(!enabled)return;
    for(const root of this.world.children){
      if(!root.userData.drawFloor||root.userData.drawFloor===floor)continue;
      root.traverse(o=>{if(!o.material)return;o.userData.focusMaterial=o.material;
        const fade=m=>{const material=m.clone();material.transparent=true;material.opacity=m.opacity*.16;material.depthWrite=false;return material;};
        o.material=Array.isArray(o.material)?o.material.map(fade):fade(o.material);
      });
    }
    this.labels.forEach(({label,div})=>{let root=label;while(root&&!root.userData.drawFloor)root=root.parent;if(root&&root.userData.drawFloor!==floor)div.style.opacity='.16';});
  }
  update(project, view = '3d', floor = 'all', selected = 'station') {
    this.restoreFloorFocus();this.referenceCache=null;
    this.project = project; this.view = view; this.activeFloor = floor;
    this.labels.forEach(l => l.div.remove()); this.labels = []; this.groups.clear(); this.zoneGroups = [];this.textCallouts=[];
    this.world.traverse(o => { if(o.isInstancedMesh)o.dispose();if(!o.isSprite)o.geometry?.dispose(); if(o.userData.ownedGraphic){o.material.map?.dispose();o.material.dispose();}else if (o.isLine||o.userData.ownedHandle) o.material?.dispose(); }); this.world.clear();
    this.grid.visible = project.display.grid && floor === 'all'; this.editGrid.visible = floor !== 'all';
    this.labelRenderer.domElement.classList.toggle('no-names', !project.display.names);
    this.editGrid.position.y = floor === 'all' ? -2.05 : this.floorY(floor) + .075;
    this.ground.position.y = Math.min(-2.1, ...project.floors.map(f => this.floorY(f.id) - 2.1));
    this.drawZones();
    project.entities.forEach(e => {
      if (!e.visible || (e.type==='train'&&!project.entities.find(t=>t.id===e.trackId)?.visible)) return;
      for (const drawFloor of entityDisplayFloors(project,e,view)) {
        if (floor !== 'all' && drawFloor !== floor) continue;
        const group = new THREE.Group(); group.userData.entityId = e.id; group.userData.drawFloor = drawFloor; group.position.set(e.x, this.floorY(drawFloor), e.z + this.floorOffset(drawFloor)); group.rotation.y = -THREE.MathUtils.degToRad(e.rotation);
        this.world.add(group); this.groups.set(floor !== 'all' || drawFloor === e.floor ? e.id : `${e.id}:endpoint:${drawFloor}`, group);
        this.buildEntity(group, e);
      }
    });
    const floors = project.floors || [{ id: 'B2', code: 'B2', name: '站台层', elevation: 0 }, { id: 'B1', code: 'B1', name: '站厅层', elevation: 12 }];
    if (floor !== 'all') {
      const y = this.floorY(floor)-.9;
      this.line(this.world, [[-98,y,-46],[98,y,-46],[98,y,46],[-98,y,46],[-98,y,-46]], '#9cad8f', .5, true);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(196,92),this.mat('#e4edda',{transparent:true,opacity:.1,depthWrite:false}));plane.rotation.x=-Math.PI/2;plane.position.y=y;this.world.add(plane);
    }
    floors.forEach(f => { if (floor !== 'all' && floor !== f.id) return; const y = this.floorY(f.id); const label=this.label(this.world, -93, y + .5, view === '3d' ? 8 : this.floorOffset(f.id)-40, `<div class="floor-scene-label"><b>${esc(f.code || f.id)}</b>${esc(f.name)}</div>`, 'names');label.userData.drawFloor=f.id; });
    this.labels.forEach(l => l.div.classList.toggle('hidden-label', !this.labelVisible(l)));this.updateTextCallouts(); this.select(selected);this.zoneEditor.sync();
    if(this.placement)this.refreshPlacement();
    this.applyFloorFocus();
  }
  buildEntity(group,e) {
    switch(e.type) {
      case 'text':this.text(group,e);break;
      case 'track':this.track(group,e);break;
      case 'train':{
        const track=this.project.entities.find(t=>t.id===e.trackId&&t.type==='track');
        const forward=track?trackLayout(this.project,track).forward:true;
        const facing=e.trainFacing==='reverse'?!forward:forward;
        const route=connectedTrainRoute(this.project,track);
        group.add(buildTrain(e,e.color,facing,this.mat.bind(this),route?spec=>trainCarPose(e,track,spec,facing,route):null));
        if(!this.isPreview&&!trainFit(this.project,e).valid){
          const half=e.l/2;this.line(group,[[-half,.1,-e.d/2],[half,.1,-e.d/2],[half,.1,e.d/2],[-half,.1,e.d/2],[-half,.1,-e.d/2]],'#cc6655');
        }
        break;
      }
      case 'stairs':this.staircase(group,e,false);break;
      case 'escalator':this.staircase(group,e,true);break;
      case 'elevator':this.elevator(group,e);break;
      case 'exit':this.exit(group,e);break;
      case 'restroom':this.marker(group,e);break;
      case 'gates':this.gates(group,e);break;
      case 'service':this.service(group,e);break;
    }
  }
  beginPlacement(entity,onPlace) {
    this.cancelPlacement();this.referenceCache=null; const group=new THREE.Group();
    const helper=new THREE.Group();
    const guide=new THREE.Group();helper.add(guide);
    const twoPoint=TWO_POINT_TYPES.includes(entity.type);
    this.scene.add(group,helper);this.placement={entity,group,helper,guide,onPlace,twoPoint};
    if(!twoPoint&&entity.type!=='train')this.placementPreview(entity,true);else group.visible=false;
    this.controls.enabled=true;this.renderer.domElement.style.cursor='crosshair';
    if(entity.type==='track')this.placement.trackMode=entity.drawMode||'straight';
    this.callbacks.onPlacementChange?.({stage:'start',valid:true,twoPoint,type:entity.type,trackMode:this.placement.trackMode});
    this.applyFloorFocus();
  }
  changeTrackMode(mode) {
    if(changeTrackMode(this.placement,mode))this.refreshPlacement();
  }
  changePlacementFloor(floor,endpoint=false) {
    retargetPlacement(this.project,this.placement,floor,endpoint);
  }
  refreshPlacement() {
    const p=this.placement;if(!p)return;
    p.result=null;p.point=null;this.showSnap({snapped:false});p.group.visible=false;
    delete p.previewKey;
    if(!CONNECTION_TYPES.includes(p.entity.type)&&placementInputFloor(p,this.activeFloor)!==p.entity.floor){
      this.clearPlacementGroup(p.guide);this.callbacks.onPlacementChange?.({stage:'end',type:p.entity.type,twoPoint:p.twoPoint,trackMode:p.trackMode,points:p.points?.length||0,valid:false,message:'请切回起点楼层或全部楼层继续'});
      this.applyFloorFocus();return;
    }
    if(p.trackMode==='curve')this.refreshCurvePlacement();
    else {
      if(p.start)this.placementGuide(p.start,null,true);else this.clearPlacementGroup(p.guide);
      if(!p.twoPoint&&p.entity.type!=='train')this.placementPreview(p.entity,true);
      this.callbacks.onPlacementChange?.({stage:p.start?'end':'start',type:p.entity.type,twoPoint:p.twoPoint,trackMode:p.trackMode,valid:true});
    }
    this.controls.enabled=true;this.renderer.domElement.style.cursor='crosshair';this.applyFloorFocus();
  }
  clearPlacementGroup(group) {
    const materials=new Set(),textures=new Set();
    group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(!o.isSprite)o.geometry?.dispose();if(o.material)materials.add(o.material);if(o.userData.ownedGraphic&&o.material.map)textures.add(o.material.map);});
    textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());group.clear();
  }
  placementPreview(entity,valid) {
    const p=this.placement,key=JSON.stringify([entity.floor,entity.toFloor,entity.lineId,entity.l,entity.d,entity.h,entity.rotation,entity.path,entity.stairPath,entity.landingDepth,entity.pathKind,entity.direction,entity.arrowVisible,entity.bandVisible,entity.bandSide,entity.bandColor,entity.type==='track'?Math.sign(entity.z):0,entity.trackId,entity.trainOffset,entity.color,entity.text,entity.fontSize,entity.writingMode,entity.textAlign,entity.textReverse,entity.textBold,entity.textMode,entity.leaderLength,entity.anchorEnabled,entity.anchorX,entity.anchorZ,valid]);
    if(p.previewKey!==key){
      this.clearPlacementGroup(p.group);
      this.isPreview=true;try{this.buildEntity(p.group,entity);}finally{this.isPreview=false;}
      p.group.traverse(o=>{if(o.isMesh||o.isSprite){const original=o.material;o.material=original.clone();if(o.userData.ownedGraphic)original.dispose();o.material.transparent=true;o.material.opacity=.65;o.material.depthWrite=false;if(!valid)o.material.color?.set('#cc6655');}});
      p.previewKey=key;
    }
    const floor=this.view==='floor'&&entity.toFloor===this.activeFloor?this.activeFloor:entity.floor;
    p.group.visible=true;p.group.position.set(entity.x,this.floorY(floor),entity.z+this.floorOffset(floor));p.group.rotation.y=-THREE.MathUtils.degToRad(entity.rotation);
  }
  placementGuide(start,end,valid) {
    const {guide,entity}=this.placement;this.clearPlacementGroup(guide);
    const color=valid?'#477d44':'#c56352',connection=CONNECTION_TYPES.includes(entity.type);
    const floorAt=i=>connection?(i?entity.toFloor:entity.floor):entity.floor;
    const position=(point,i)=>{const floor=this.view==='floor'&&this.activeFloor!=='all'?this.activeFloor:floorAt(i);return [point.x,this.floorY(floor)+.18,point.z+this.floorOffset(floor)];};
    if(end)this.line(guide,[position(start,0),position(end,1)],color,1,true);
    for(const [i,p] of (end?[start,end]:[start]).entries()){
      const [x,y,z]=position(p,i);
      this.line(guide,[[x-.7,y,z],[x+.7,y,z]],color);
      this.line(guide,[[x,y,z-.7],[x,y,z+.7]],color);
    }
  }
  curvePlacementGuide(points,valid) {
    const {guide,entity}=this.placement;this.clearPlacementGroup(guide);
    const y=this.floorY(entity.floor)+.5,offset=this.floorOffset(entity.floor),color=valid?'#477d44':'#c56352';
    if(points.length>1)this.line(guide,points.map(p=>[p.x,y,p.z+offset]),color,.85,true);
    points.forEach((p,i)=>{
      const control=i%2===1,mesh=new THREE.Mesh(control?new THREE.BoxGeometry(1.7,.45,1.7):new THREE.SphereGeometry(1,10,8),new THREE.MeshBasicMaterial({color:valid?(control?'#bd8843':color):color,depthTest:false}));
      mesh.position.set(p.x,y,p.z+offset);mesh.renderOrder=20;guide.add(mesh);
    });
  }
  cancelPlacement() {
    this.showSnap({snapped:false});
    if(!this.placement)return;
    const {group,helper,hiddenSource}=this.placement;this.scene.remove(group,helper);
    if(hiddenSource)hiddenSource.visible=true;
    this.clearPlacementGroup(group);this.clearPlacementGroup(helper);
    this.placement=null;this.lastPlacementPointer=null;this.controls.enabled=true;this.setTool(this.tool);
    this.applyFloorFocus();
  }
  snapTolerance() {
    return Math.max(.12,Math.min(2,(this.camera.right-this.camera.left)/this.camera.zoom/this.width*7));
  }
  snapReferences(floors,excludeId) {
    const key=JSON.stringify([floors,excludeId]);
    if(!this.referenceCache||this.referenceCache.key!==key)this.referenceCache={key,references:placementReferences(this.project,{floors,excludeId})};
    return this.referenceCache.references;
  }
  movePlacement(event) {
    const p=this.placement;if(!p)return;
    this.lastPlacementPointer={clientX:event.clientX,clientY:event.clientY,altKey:!!event.altKey};
    p.point=null;p.alignmentGuides=[];this.showSnap({});
    const entity=p.entity,inputFloor=placementInputFloor(p,this.activeFloor),connection=CONNECTION_TYPES.includes(entity.type);
    this.hit(event);const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-this.floorY(inputFloor)),point=new THREE.Vector3();
    if(!this.raycaster.ray.intersectPlane(plane,point))return;
    const anchored=!!(p.start||p.points?.length);
    if((!connection&&inputFloor!==entity.floor)||(connection&&p.start&&inputFloor===entity.floor)){
      p.result={valid:false};p.group.visible=false;this.clearPlacementGroup(p.guide);
      this.callbacks.onPlacementChange?.({stage:anchored?'end':'start',type:entity.type,twoPoint:p.twoPoint,trackMode:p.trackMode,points:p.points?.length||0,valid:false,message:connection?'请选择另一楼层放置终点':'请切回起点楼层或全部楼层继续'});return;
    }
    const disabled=event.altKey||!this.project.snapping,project=disabled?{...this.project,snapping:false}:this.project;
    const raw={x:Math.max(-500,Math.min(500,point.x)),z:Math.max(-500,Math.min(500,point.z-this.floorOffset(inputFloor)))};
    const fallback=disabled?raw:placementPoint(raw),curve=entity.type==='track'&&p.trackMode==='curve';
    const control=curve&&curveDrawingState((p.points||[]).length).nextRole==='control';
    const anchor=p.points?.at(-1)||p.start;
    const floors=connection&&p.start?[...new Set([entity.floor,inputFloor])]:[inputFloor],tolerance=this.snapTolerance();
    const references=this.snapReferences(floors,entity.id);
    let constraint;
    if(entity.type==='track'&&p.trackMode==='straight'&&p.start){
      const alongX=Math.abs(raw.x-p.start.x)>=Math.abs(raw.z-p.start.z);
      constraint={n:alongX?{x:0,z:1}:{x:1,z:0},value:alongX?p.start.z:p.start.x};
      if(!disabled){
        let best=Math.abs(raw.x*constraint.n.x+raw.z*constraint.n.z-constraint.value);
        const angles=[...references.map(ref=>ref.angle),...(Number.isFinite(p.start.angle)?[p.start.angle*Math.PI/180]:[])];
        for(const angle of angles)for(const a of [angle,angle+Math.PI/2]){
          const n={x:-Math.sin(a),z:Math.cos(a)},value=p.start.x*n.x+p.start.z*n.z,d=Math.abs(raw.x*n.x+raw.z*n.z-value);
          if(d<=tolerance&&d<best-1e-7){best=d;constraint={n,value};}
        }
      }
    }
    const constrained=q=>{if(!constraint)return q;const d=constraint.value-q.x*constraint.n.x-q.z*constraint.n.z;return {...q,x:q.x+constraint.n.x*d,z:q.z+constraint.n.z*d};};
    let dedicated;
    if(entity.type!=='train'){
      const railCache={};
      const aligned=snapPlacementPoint(project,inputFloor,constrained(raw),{references,tolerance,anchor,vertices:p.points||[],excludeId:entity.id,disabled,constraint,moving:!p.twoPoint&&!p.anchorPicking?{...entity,...raw}:undefined,
        snapGeometry:entity.type==='track'&&!control?(point,line)=>snapRailPoint(project,entity,point,tolerance,line,railCache):undefined});
      p.point=aligned.snapped?aligned.point:constrained(fallback);p.alignmentGuides=aligned.guides;
      if(aligned.geometry)dedicated=aligned.geometry;
      // A track starts alongside a platform, rather than on the platform edge.
      // Resolve that contact before the first click so it never moves a picked point.
      if(entity.type==='track'&&!anchored&&!aligned.snapped&&!disabled){
        const side=snapTrack(project,{...entity,...p.point});
        if(side.snapped){p.point={x:side.x,z:side.z,aligned:true};dedicated=side;}
      }
    }else p.point=fallback;
    const feedback=()=>this.showSnap({...p.point,...dedicated,floor:inputFloor,guides:p.alignmentGuides});
    if(p.anchorPicking){
      const target={...entity,anchorEnabled:true,anchorX:p.point.x,anchorZ:p.point.z};p.result={entity:target,valid:true};
      this.placementPreview(target,true);feedback();this.callbacks.onPlacementChange?.({type:'text',anchorPicking:true});return;
    }
    if(curve){
      const points=p.points||[],state=curveDrawingState(points.length);
      const result=curveDraft(inheritTrackStyle(this.project,entity,points[0]||p.point,state.nextRole==='end'?p.point:null),points,p.point);p.result=result;
      if(result.entity)this.placementPreview(result.entity,result.valid);else p.group.visible=false;
      this.curvePlacementGuide(result.guide,result.valid);feedback();
      this.callbacks.onPlacementChange?.({stage:'points',type:'track',trackMode:'curve',points:points.length,...result});return;
    }
    if(entity.type==='track'&&p.trackMode!=='straight'){
      if(!p.start){this.placementGuide(p.point,null,true);feedback();return;}
      const candidate=makeTrackPath(inheritTrackStyle(this.project,entity,p.start,p.point),[p.start,p.point],p.trackMode),message=trackPathError(candidate);
      p.result={entity:candidate,valid:!message,message:message||`${candidate.l.toFixed(1)} m`};
      this.placementPreview(candidate,!message);this.placementGuide(p.start,p.point,!message);feedback();
      this.callbacks.onPlacementChange?.({stage:'end',type:'track',trackMode:p.trackMode,...p.result});return;
    }
    if(p.twoPoint){
      if(!p.start){this.placementGuide(p.point,null,true);feedback();return;}
      const result=twoPointPlacement(project,entity,p.start,p.point,{prepared:true});p.result=result;
      this.placementPreview(result.entity,result.valid);this.placementGuide(result.start,result.end,result.valid);feedback();
      this.callbacks.onPlacementChange?.({stage:'end',type:entity.type,twoPoint:true,...result});return;
    }
    if(entity.type==='train'){
      const result=placeTrain(this.project,entity,p.point);p.result=result;
      this.placementPreview(result.entity,result.valid);this.callbacks.onPlacementChange?.({stage:'end',type:'train',...result});return;
    }
    const target={...entity,x:p.point.x,z:p.point.z};p.result={entity:target,valid:true};
    this.placementPreview(target,true);feedback();
  }
  confirmPlacement(event) {
    this.movePlacement(event);const p=this.placement;if(!p?.point)return;
    if(p.entity.type==='track'&&!p.start&&!p.points?.length)p.entity=inheritTrackStyle(this.project,p.entity,p.point);
    if(p.entity.type==='track'&&p.trackMode==='curve'){
      if(!p.result?.valid||!p.result.canAdd)return;
      (p.points||=[]).push({...p.point});
      p.start={...p.points[0]};
      this.refreshCurvePlacement();
      return;
    }
    if(p.twoPoint&&!p.start){
      p.start={...p.point};this.applyFloorFocus();this.movePlacement(event);return;
    }
    if(!p.result?.valid)return;
    this.completePlacement(p.result.entity,event);
  }
  completePlacement(entity,event={}) {
    const p=this.placement,placed={...entity},draft=structuredClone(p.entity);
    delete placed.snapEdge;delete placed.snapped;delete placed.drawMode;
    if(p.entity.type==='track')draft.drawMode=p.trackMode;
    const context={repeat:!!event.shiftKey&&!p.anchorPicking,draft,pointer:this.lastPlacementPointer};
    const onPlace=p.onPlace;this.cancelPlacement();onPlace(placed,context);
  }
  finishTrackPlacement(event={}) {
    const p=this.placement;if(p?.trackMode!=='curve')return;
    const result=curveDraft(inheritTrackStyle(this.project,p.entity,p.points?.[0],p.points?.at(-1)),p.points||[]);
    if(!result.canFinish){this.callbacks.onPlacementChange?.({stage:'points',type:'track',trackMode:'curve',points:p.points?.length||0,...result,message:result.nextRole==='end'?'请先放置终点，或撤回控制点':''});return;}
    const {entity,message}=result;
    if(message){this.callbacks.onPlacementChange?.({stage:'points',type:'track',trackMode:'curve',points:p.points.length,valid:false,message});return;}
    this.completePlacement(entity,event);
  }
  undoTrackPoint() {
    const p=this.placement;if(p?.trackMode!=='curve'||!p.points?.length)return;
    p.points.pop();p.start=p.points[0]?{...p.points[0]}:undefined;this.refreshCurvePlacement();
  }
  refreshCurvePlacement() {
    this.showSnap({snapped:false});
    const p=this.placement,result=curveDraft(inheritTrackStyle(this.project,p.entity,p.points?.[0],p.points?.at(-1)),p.points||[]);p.result=result;
    if(result.entity)this.placementPreview(result.entity,result.valid);else p.group.visible=false;
    this.curvePlacementGuide(p.points||[],result.valid);
    this.callbacks.onPlacementChange?.({stage:'points',type:'track',trackMode:'curve',points:p.points?.length||0,...result});
  }
  showSnap(target={}) {
    const guides=target.guides||[];
    this.callbacks.onSnap?.(alignmentMessage(guides)||(target.snapped?(target.trackId?target.snapKind==='endpoint'?'已吸附轨道端点':'已吸附轨道中心线':'已吸附付费区边缘'):''));
    if(this.snapGuide){this.scene.remove(this.snapGuide);this.clearPlacementGroup(this.snapGuide);this.snapGuide=null;}
    if(!target.snapped&&!guides.length)return;
    const edge=target.snapEdge,y=target.guideY??this.floorY(target.floor)+.6,offset=this.floorOffset(target.floor);
    this.snapGuide=new THREE.Group();this.scene.add(this.snapGuide);
    const draw=(points,color='#527fae',dashed=true)=>{
      const line=this.line(this.snapGuide,points.map(p=>[p.x,y,p.z+offset]),color,1,dashed);
      line.material.depthTest=false;line.material.toneMapped=false;line.renderOrder=60;return line;
    };
    if(edge)draw([{x:edge.x1,z:edge.z1},{x:edge.x2,z:edge.z2}],'#477d44',false);
    else if(target.snapped&&Number.isFinite(target.x)&&Number.isFinite(target.z)){
      const size=this.snapTolerance()*.65;
      const marker=new THREE.Mesh(new THREE.TorusGeometry(size,size*.1,6,24),new THREE.MeshBasicMaterial({color:'#3f8952',depthTest:false,toneMapped:false}));
      marker.rotation.x=-Math.PI/2;marker.position.set(target.x,y,target.z+offset);marker.renderOrder=60;this.snapGuide.add(marker);
      if(target.trackId){const angle=(target.angle||0)*Math.PI/180,dx=Math.cos(angle)*size*2,dz=Math.sin(angle)*size*2;draw([{x:target.x-dx,z:target.z-dz},{x:target.x+dx,z:target.z+dz}],'#3f8952',false);}
    }
    for(const guide of guides){
      draw([guide.a,guide.b],guide.kind==='equal'?'#a56cbb':'#527fae');
      const p=guide.contact,r=this.snapTolerance()*.3;
      draw([{x:p.x-r,z:p.z-r},{x:p.x+r,z:p.z+r}],'#527fae',false);
      draw([{x:p.x-r,z:p.z+r},{x:p.x+r,z:p.z-r}],'#527fae',false);
      if(guide.measure){
        const {a,b,reference}=guide.measure;
        const dimension=(a,b)=>{draw([a,b],'#a56cbb',false);const dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz)||1,t={x:-dz/l*r*2,z:dx/l*r*2};for(const p of [a,b])draw([{x:p.x-t.x,z:p.z-t.z},{x:p.x+t.x,z:p.z+t.z}],'#a56cbb',false);};
        dimension(a,b);dimension(...reference);
        const div=document.createElement('div');div.className='alignment-dimension';div.textContent=`${Number(guide.measure.length.toFixed(2))} m`;
        const label=new CSS2DObject(div);label.position.set((a.x+b.x)/2,y,(a.z+b.z)/2+offset);this.snapGuide.add(label);
      }
    }
  }
  setPaint(settings) {
    if(settings)this.zoneEditor.begin(settings.kind,settings.floor);else this.zoneEditor.stop();
    this.setTool(this.tool);this.showSnap({snapped:false});
    this.applyFloorFocus();
  }
  drawZones() {
    let rails=0,doors=0;
    for (const floor of this.project.floors) {
      if(this.activeFloor!=='all' && this.activeFloor!==floor.id)continue;
      const root=new THREE.Group();root.position.set(0,this.floorY(floor.id),this.floorOffset(floor.id));root.userData.entityId='station';root.userData.drawFloor=floor.id;
      const openings=this.project.entities.filter(e=>e.visible&&e.floor!==floor.id&&e.toFloor&&CONNECTION_TYPES.includes(e.type)&&connectionFloors(this.project,e).includes(floor.id));
      const masks=zoneMasks(this.project,floor.id);
      for(const kind of ZONE_KINDS){
        const polygons=this.view==='3d'?cutOpenings(masks[kind],openings):masks[kind];
        this.zoneMesh(root,polygons,this.project.zoneColors[kind]);
      }
      if(this.view==='floor'){
        const points=floorOutlineEdges(this.project,floor.id,masks).flatMap(e=>[e.x1,.1,e.z1,e.x2,.1,e.z2]);
        if(points.length){
          const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
          const outline=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#000000',toneMapped:false}));
          outline.name='zone-outlines';root.add(outline);
        }
      }
      this.world.add(root);this.zoneGroups.push(root);
      const boundaries=generateBoundaries(this.project,floor.id);
      for(const edge of boundaries){this.boundary(root,edge);if(edge.kind==='railing')rails++;else doors++;}
    }
    this.callbacks.onBoundarySummary?.({rails,doors});
  }
  zoneMesh(parent,polygons,color){
    for(const poly of polygons){
      const shape=new THREE.Shape(poly[0].map(([x,z])=>new THREE.Vector2(x,-z)));
      for(const ring of poly.slice(1))shape.holes.push(new THREE.Path(ring.map(([x,z])=>new THREE.Vector2(x,-z))));
      const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.3,bevelEnabled:false,steps:1}),this.mat(color));
      mesh.rotation.x=-Math.PI/2;mesh.position.y=-.26;parent.add(mesh);
    }
  }
  previewZone(path){
    this.restoreFloorFocus();
    const base=this.project,preview={...base,zonePaths:(base.zonePaths||[]).map(p=>p.id===path.id?path:p)};
    this.zoneGroups.forEach(g=>{this.world.remove(g);g.traverse(o=>{o.geometry?.dispose();if(o.isLine)o.material.dispose();});});this.zoneGroups=[];
    this.project=preview;try{this.drawZones();}finally{this.project=base;}
    this.applyFloorFocus();
  }
  boundary(parent,edge) {
    const dx=edge.x2-edge.x1,dz=edge.z2-edge.z1,length=Math.hypot(dx,dz);if(length<.001)return;
    const g=new THREE.Group();g.position.set((edge.x1+edge.x2)/2,.08,(edge.z1+edge.z2)/2);g.rotation.y=-Math.atan2(dz,dx);parent.add(g);
    const railing=edge.kind==='railing',h=railing?1.15:edge.style==='full'?2.8:1.4;
    const n=Math.max(1,Math.ceil(length/(railing?2:3))),pitch=length/n;
    const track=this.project.entities.find(e=>e.id===edge.trackId),color=this.project.lines.find(l=>l.id===track?.lineId)?.color||'#738f7b';
    for(let i=0;i<=n;i++)this.box(g,-length/2+i*pitch,h/2,0,.08,h,.12,'#7f998c',{metalness:.3});
    this.box(g,0,h,0,length,.08,.12,'#809b8b');
    if(railing){this.box(g,0,.38,0,length,.055,.08,'#a5b8a7');return;}
    this.box(g,0,.1,0,length,.16,.17,'#b5c4b5');
    for(let i=0;i<n;i++){
      const x=-length/2+(i+.5)*pitch;
      this.box(g,x,h/2,0,Math.max(.04,pitch-.12),h-.2,.055,'#bad5ce',{transparent:true,opacity:.5,depthWrite:false,roughness:.25});
      this.box(g,x,h/2,0,.035,h-.2,.09,'#9db6a6');
      this.box(g,x,h*.64,.04,Math.max(.04,pitch-.12),.075,.045,color);
    }
    // Place the tactile strip on the paid-area side of the shared edge.
    this.box(g,0,.08,-.45*(dx/length*edge.nz-dz/length*edge.nx),length,.04,.28,'#d7c987');
  }
  track(g,e) {
    const layout=trackLayout(this.project,e),{side,forward}=layout;
    g.add(buildTrackModel(e,layout,this.mat.bind(this)));
    if(layout.arrowVisible){
      const point=pointAlongTrack(e,forward?Math.max(0,trackGeometry(e).length-4):4),angle=point.angle*Math.PI/180;
      const arrow=new THREE.Group();arrow.position.set(point.x-Math.sin(angle)*side*(e.d/2+4),0,point.z+Math.cos(angle)*side*(e.d/2+4));arrow.rotation.y=-angle;g.add(arrow);
      this.floorGraphic(arrow,0,.14,0,8,6,(ctx,w,h)=>{
        ctx.strokeStyle=layout.color;ctx.lineWidth=15;ctx.lineJoin='round';ctx.lineCap='round';
        const tip=forward?w*.86:w*.14,tail=forward?w*.14:w*.86,sign=forward?1:-1;
        ctx.beginPath();ctx.moveTo(tail,h/2);ctx.lineTo(tip,h/2);ctx.moveTo(tip-sign*w*.22,h*.2);ctx.lineTo(tip,h/2);ctx.lineTo(tip-sign*w*.22,h*.8);ctx.stroke();
      },undefined,256,192);
    }
    if(e.path&&!this.isPreview)for(let i=0;i<e.path.length;i++){
      const control=e.pathKind==='quadratic'&&i%2===1;
      const p=e.path[i],handle=new THREE.Mesh(control?new THREE.BoxGeometry(2,.6,2):new THREE.SphereGeometry(1.2,12,8),new THREE.MeshBasicMaterial({color:control?'#bd8843':'#477d44',depthTest:false}));
      handle.position.set(p.x,.55,p.z);handle.userData.pathIndex=i;handle.renderOrder=20;handle.visible=false;handle.userData.ownedHandle=true;g.add(handle);
    }
    if(e.pathKind==='quadratic'&&!this.isPreview){
      const guide=this.line(g,e.path.map(p=>[p.x,.5,p.z]),'#bd8843',.7,true);
      guide.userData.pathGuide=true;guide.visible=false;
    }
  }
  text(g,e) {
    const callout=e.textMode==='callout',layout=callout?calloutLayout(e):textLayout(e),ratio=layout.l/layout.d;
    const width=Math.min(4096,Math.max(128,Math.ceil(ratio>=1?Math.min(4096,layout.l/layout.size*128):256)));
    const height=Math.min(4096,Math.max(128,Math.ceil(width/ratio)));
    if(callout){
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;drawCallout(canvas.getContext('2d'),width,height,e);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=this.renderer.capabilities.getMaxAnisotropy();
      const annotation=buildTextCallout(e,texture,this.floorOffset(e.floor));annotation.visible=this.isPreview||this.project.display.texts!==false;g.add(annotation);
      const ring=new THREE.Mesh(new THREE.RingGeometry(.65,1,24),new THREE.MeshBasicMaterial({color:'#709c56',depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
      ring.rotation.x=-Math.PI/2;ring.position.y=.05;ring.renderOrder=24;ring.visible=false;ring.userData.calloutSelection=true;ring.userData.textAnchor=true;ring.userData.ownedHandle=true;annotation.userData.callout.anchor.add(ring);
      if(!this.isPreview)this.textCallouts.push(annotation);
    }else this.floorGraphic(g,0,.22,0,layout.l,layout.d,(ctx,w,h)=>drawText(ctx,w,h,e),'texts',width,height);
  }
  updateTextCallouts() {
    if(!this.textCallouts.length&&!this.placement)return;
    this.camera.updateMatrixWorld();
    for(const group of this.textCallouts){group.updateWorldMatrix(true,false);updateTextCallout(group,this.camera);}
    if(this.placement){this.placement.group.updateMatrixWorld(true);this.placement.group.traverse(group=>{if(group.userData.callout)updateTextCallout(group,this.camera);});}
  }
  highlightTextCallout(group,selected) {
    const data=group.userData.callout;if(data.selected===selected)return;data.selected=selected;
    const canvas=data.card.material.map.image;
    drawCallout(canvas.getContext('2d'),canvas.width,canvas.height,data.source,selected);data.card.material.map.needsUpdate=true;
  }
  staircase(g,e,escalator) {
    let height=this.view==='floor'?Math.min(e.h,1.6):e.toFloor?this.floorY(e.toFloor)-this.floorY(e.floor):e.h;
    const range=this.view==='floor'&&!this.isPreview?stairPlanRange(e,g.userData.drawFloor):null;
    if(this.view==='floor'&&!this.isPreview&&!range)return;
    if(e.stairPath){
      g.add(buildBentStair(e,height,this.mat.bind(this),range));
      const p=stairRoutePoint(e,range?(range.from+range.to)/2:.5,height);
      this.label(g,p.x,p.y+3,p.z,`<div class="facility-label"><span class="facility-symbol">${facilityIcons.stairs}</span><span>${esc(e.name)}</span></div>`,'markers',e.id,true);return;
    }
    g.add(buildStairSteps(e,height,this.mat.bind(this),range));
    if(range){
      const part=new THREE.Group();part.name='stair-plan-half';
      part.position.set((range.from+range.to-1)*e.l/2,range.from*height,0);g.add(part);g=part;
      e={...e,l:e.l*(range.to-range.from)};height*=range.to-range.from;
    }
    // The shallow inclined carriage leaves the entire underside open.
    const carriageLength=Math.hypot(e.l,height),slope=Math.atan2(height,e.l);
    for(const z of [-e.d/2+.18,e.d/2-.18]){const beam=this.box(g,0,height/2-.12,z,carriageLength,.3,.2,escalator?'#778c81':'#aa9d85');beam.rotation.z=slope;}
    const length=Math.sqrt(e.l**2+height**2);const angle=-Math.atan2(height,e.l);
    for(const z of [-e.d/2,e.d/2]) {
      const rail=this.box(g,0,height/2+2,z,length,.17,.16,escalator?'#71887b':'#8da18e');rail.rotation.z=-angle;
      if(escalator){const glass=this.box(g,0,height/2+1.3,z,length,1.5,.1,'#b1c7bd',{transparent:true,opacity:.6});glass.rotation.z=-angle;}
      else for(let i=0;i<5;i++){const x=-e.l/2+i*e.l/4;this.box(g,x,(i/4)*height+1.2,z,.1,2,.1,'#9aac9b');}
    }
    const arrow=this.box(g,0,height/2+.35,0,e.l*.55,.05,.14,escalator?'#f0efe1':'#bca780');arrow.rotation.z=-angle;
    this.label(g,0,height/2+3,0,`<div class="facility-label"><span class="facility-symbol">${facilityIcons[escalator?'escalator':'stairs']}</span><span>${esc(e.name)}</span></div>`,'markers',e.id,true);
  }
  elevator(g,e) {
    const h=this.view==='floor'?3:e.toFloor?this.floorY(e.toFloor)-this.floorY(e.floor)+4:e.h;
    this.box(g,0,h/2,0,e.l,h,e.d,e.color,{transparent:true,opacity:.3,roughness:.25,depthWrite:false});
    for(const x of [-e.l/2,e.l/2])for(const z of [-e.d/2,e.d/2])this.box(g,x,h/2,z,.16,h,.16,'#829d91');
    for(const y of [0,h*.7,h]){this.box(g,0,y,0,e.l+.25,.18,e.d+.25,'#93ada1');}
    this.box(g,0,h+.15,0,e.l+.4,.25,e.d+.4,'#c3d6cb');
    for(const x of [-.6,.6]) this.box(g,x,2.1,e.d/2+.02,1.12,3.8,.09,'#b6c7bb',{metalness:.3});
    this.box(g,0,2.1,e.d/2+.09,.08,3.8,.06,'#80998b');
    this.label(g,0,h+2,0,`<div class="facility-label"><span class="facility-symbol">${facilityIcons.elevator}</span><span>${esc(e.name)}</span></div>`,'markers',e.id);
  }
  exit(g,e) {
    this.marker(g,e);
  }
  marker(g,e) {
    this.uprightGraphic(g,e,(ctx,w,h)=>{
      ctx.fillStyle=e.color;ctx.beginPath();ctx.roundRect(16,16,w-32,h-32,60);ctx.fill();
      drawFacilityIcon(ctx,e.type,90,90,332);
      if(e.type==='exit'&&e.exitNumber){
        ctx.fillStyle='#ffffff';ctx.beginPath();ctx.roundRect(340,340,132,132,25);ctx.fill();
        ctx.fillStyle=e.color;ctx.font='700 108px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(e.exitNumber,406,410,112);
      }
    });
    this.label(g,0,e.d+1.4,0,`<div class="marker-name">${esc(e.name)}</div>`,'names',e.id);
  }
  gates(g,e) {
    const {centers,cabinetWidth}=gateLayout(e);
    centers.forEach((z,i)=>{this.box(g,0,e.h/2,z,e.l,e.h,cabinetWidth,e.color,{metalness:.25});this.box(g,-e.l/2+.4,e.h+.08,z,.6,.1,.27,'#5b9376');if(i<centers.length-1)this.box(g,0,e.h*.65,z+.47,.1,e.h*.5,.5,'#89bc9a',{transparent:true,opacity:.6});});
    this.label(g,0,e.h+2,-e.d/2-.8,`<div class="facility-label"><span class="facility-symbol">${facilityIcons.gates}</span><span>${esc(e.name)}</span></div>`,'markers',e.id,true);
  }
  service(g,e) {
    this.box(g,0,e.h/2,0,e.l,e.h,e.d,e.color);this.box(g,0,e.h+.1,0,e.l+.3,.25,e.d+.3,'#e7d6b5');
    this.box(g,0,e.h*.7,e.d/2+.03,e.l-.8,.45,.08,'#cdbb97');this.box(g,0,e.h+.6,0,.13,1.2,.13,'#819c85');this.box(g,0,e.h+1.3,0,1.8,.9,.13,'#71967c');
    this.label(g,0,e.h+3,0,`<div class="facility-label"><span class="facility-symbol">${facilityIcons.service}</span><span>${esc(e.name)}</span></div>`,'markers',e.id);
  }
  stairEndpointPosition(entity,index) {
    const bend=index>1,endpoint=bend?stairWorldNodes(entity)[index-1]:stairEndpoints(entity)[index],floor=bend?entity.floor:endpoint.floor||entity.floor;
    const drawFloor=this.view==='floor'&&this.activeFloor!=='all'?this.activeFloor:floor;
    const rise=entity.toFloor?this.floorY(entity.toFloor)-this.floorY(entity.floor):entity.h;
    const height=this.view==='floor'?0:bend?stairRoute(entity,rise).landings[index-2].y:index&&!entity.toFloor?entity.h:0;
    return {floor,drawFloor,position:new THREE.Vector3(endpoint.x,this.floorY(drawFloor)+height+.6,endpoint.z+this.floorOffset(drawFloor))};
  }
  refreshStairEndpoints() {
    if(this.stairHandles){this.scene.remove(this.stairHandles);this.clearPlacementGroup(this.stairHandles);this.stairHandles=null;}
    const entity=this.project?.entities.find(e=>e.id===this.selected);
    if(!isStair(entity)||!this.groups.get(entity.id))return;
    const root=new THREE.Group();root.userData.entityId=entity.id;this.stairHandles=root;this.scene.add(root);
    const radius=Math.max(.15,Math.min(3,(this.camera.right-this.camera.left)/this.camera.zoom/this.width*6));
    for(const index of [0,1,...(entity.stairPath?entity.stairPath.slice(1,-1).map((p,i)=>i+2):[])]){
      const bend=index>1,endpoint=bend?{...stairWorldNodes(entity)[index-1],floor:this.activeFloor==='all'?entity.floor:this.activeFloor}:stairEndpoints(entity)[index];
      if(this.view==='floor'&&(!endpoint.floor||this.activeFloor!=='all'&&endpoint.floor!==this.activeFloor))continue;
      if(bend&&this.view==='floor'){const range=stairPlanRange(entity,endpoint.floor),t=stairRoute(entity).landings[index-2].t;if(!range||t<range.from||t>range.to)continue;}
      const {position,drawFloor}=this.stairEndpointPosition(entity,index),invalid=this.endpointDrag?.index===index&&this.endpointDrag.result?.valid===false;
      const color=invalid?'#c56352':bend?'#dd9b42':index?'#9b6bb3':'#467fb5';
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(radius,16,10),new THREE.MeshBasicMaterial({color,depthTest:false,toneMapped:false}));
      mesh.position.copy(position);mesh.userData.stairEndpoint=index;mesh.userData.drawFloor=drawFloor;mesh.renderOrder=60;root.add(mesh);
      const div=document.createElement('div');div.className=`stair-endpoint-label endpoint-${index}`;
      const floor=endpoint.floor;
      div.textContent=bend?`转折 ${index-1}`:`${index?'终点':'起点'} · ${this.project.floors.find(f=>f.id===floor)?.code||'自定义高度'}`;
      const label=new CSS2DObject(div);label.position.copy(position);label.center.set(.5,1.6);root.add(label);
    }
  }
  beginStairEndpointDrag(event,hit) {
    const source=this.project.entities.find(e=>e.id===hit.id);if(!isStair(source))return;
    const index=hit.stairEndpoint,{position,drawFloor,floor}=this.stairEndpointPosition(source,index),point=new THREE.Vector3();
    this.plane.constant=-position.y;
    if(!this.raycaster.ray.intersectPlane(this.plane,point))return;
    const endpoints=stairEndpoints(source);
    this.endpointDrag={id:source.id,index,source:structuredClone(source),base:this.project,floor,drawFloor,guideY:position.y,offset:position.clone().sub(point),client:{x:event.clientX,y:event.clientY},started:false,references:placementReferences(this.project,{floors:[...new Set([source.floor,source.toFloor].filter(Boolean))],excludeId:source.id}),anchor:index>1?stairWorldNodes(source)[index-2]:endpoints[1-index]};
    this.controls.enabled=false;this.renderer.domElement.style.cursor='grabbing';
  }
  moveStairEndpointDrag(event) {
    const d=this.endpointDrag;if(!d)return;
    d.pointer={clientX:event.clientX,clientY:event.clientY,altKey:!!event.altKey};
    if(!d.started&&Math.hypot(event.clientX-d.client.x,event.clientY-d.client.y)<3)return;
    d.started=true;this.hit(event);const point=new THREE.Vector3();if(!this.raycaster.ray.intersectPlane(this.plane,point))return;
    point.add(d.offset);const raw={x:point.x,z:point.z-this.floorOffset(d.drawFloor)},disabled=event.altKey||!d.base.snapping;
    const aligned=snapPlacementPoint(d.base,d.floor,raw,{references:d.references,tolerance:this.snapTolerance(),excludeId:d.id,anchor:d.anchor,disabled});
    const target=aligned.snapped?aligned.point:disabled?raw:placementPoint(raw);
    if(d.index>1){const entity=moveStairPoint(d.source,d.index-1,{x:target.x,z:target.z}),message=stairPathError(entity,{slope:true});d.result={entity,valid:!message,message};}
    else d.result=editStairEndpoint(d.base,d.source,d.index,{x:target.x,z:target.z});
    const preview=d.result.valid?{...d.base,entities:d.base.entities.map(e=>e.id===d.id?d.result.entity:e)}:d.base;
    this.update(preview,this.view,this.activeFloor,d.id);
    this.showSnap({floor:d.drawFloor,guideY:d.guideY,guides:aligned.guides});
    if(!d.result.valid)this.callbacks.onSnap?.(d.result.message);
  }
  finishStairEndpointDrag(cancel=false) {
    const d=this.endpointDrag;if(!d)return;
    this.endpointDrag=null;this.controls.enabled=true;this.showSnap({});this.setTool(this.tool);
    this.update(d.base,this.view,this.activeFloor,this.selected);
    if(!cancel&&d.started&&d.result?.valid)this.callbacks.onStairEndpointChange?.(d.id,d.result.entity);
  }
  cancelStairEndpointDrag() {this.finishStairEndpointDrag(true);}
  select(id) {
    this.selected=id; if(this.selectionBox){this.world.remove(this.selectionBox);this.selectionBox.geometry.dispose();this.selectionBox.material.dispose();this.selectionBox=null;}
    this.labels.forEach(l=>l.div.classList.toggle('selected-label',l.entityId===id));
    for(const annotation of this.textCallouts)this.highlightTextCallout(annotation,annotation.parent.userData.entityId===id);
    this.groups.forEach(g=>g.traverse(o=>{if(o.userData.calloutSelection)o.visible=g.userData.entityId===id;if(o.userData.pathIndex!==undefined||o.userData.pathGuide)o.visible=g.userData.entityId===id;}));
    this.refreshStairEndpoints();
    const group=this.groups.get(id);if(!group)return;
    if(this.project.entities.find(e=>e.id===id)?.textMode==='callout')return;
    const box=new THREE.Box3();this.groups.forEach(g=>{if(g.userData.entityId===id)box.expandByObject(g);});this.selectionBox=new THREE.Box3Helper(box,'#709c56');this.selectionBox.material.transparent=true;this.selectionBox.material.opacity=.65;this.selectionBox.material.depthTest=false;this.selectionBox.renderOrder=9;this.world.add(this.selectionBox);
  }
  layoutLabels() {
    const occupied=[];const ordered=[...this.labels].sort((a,b)=>{
      const priority=l=>l.div.querySelector('.exit-label')?0:l.category==='markers'?1:2;return priority(a)-priority(b);
    });
    ordered.forEach(entry=>{
      if(!this.labelVisible(entry))return;const {label,div}=entry;const p=new THREE.Vector3();label.getWorldPosition(p);p.project(this.camera);if(p.z<-1||p.z>1)return;
      const x=(p.x*.5+.5)*this.width,y=(-p.y*.5+.5)*this.height;const w=div.offsetWidth,h=div.offsetHeight;
      let shift=0;
      for(const candidate of [0,-20,-40,-60,-80,20,40]){
        const rect={left:x-w/2-3,right:x+w/2+3,top:y-h/2+candidate-3,bottom:y+h/2+candidate+3};
        if(!occupied.some(r=>rect.left<r.right&&rect.right>r.left&&rect.top<r.bottom&&rect.bottom>r.top)){shift=candidate;occupied.push(rect);break;}
      }
      div.style.marginTop=`${shift}px`;div.style.setProperty('--label-rise',`${Math.max(0,-shift)}px`);div.classList.toggle('label-lifted',shift<0);
    });
  }
  resize() {
    const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.width=w;this.height=h;
    const aspect=w/h;this.baseSpan= Math.max(157, 222/aspect);const span=this.baseSpan;
    this.camera.left=-span*aspect/2;this.camera.right=span*aspect/2;this.camera.top=span*.505;this.camera.bottom=-span*.495;this.camera.updateProjectionMatrix();
    this.renderer.setSize(w,h);this.labelRenderer.setSize(w,h);
  }
  setView(view) {
    this.view=view;this.controls.enableRotate=view!=='floor';
    this.cameraPreset(view==='floor'?'top':'iso');
  }
  cameraPreset(preset) {
    const floorY=this.activeFloor==='all'?6:this.floorY(this.activeFloor);
    this.controls.target.set(0,preset==='top'?floorY:6,0);
    if(preset==='top') {this.camera.position.set(0,floorY+320,.001);this.camera.up.set(0,0,-1);this.controls.enableRotate=false;}
    else {this.camera.up.set(0,1,0);this.controls.enableRotate=true;this.camera.position.set(...(preset==='front'?[-.001,50,320]:[-155,185,255]));}
    this.camera.lookAt(this.controls.target);this.camera.zoom=1;this.camera.updateProjectionMatrix();this.controls.update();this.callbacks.onZoom(1);
  }
  fit() {
    this.cameraPreset(this.view==='floor'?'top':'iso');
    this.updateTextCallouts();
    const bounds=new THREE.Box3();[...this.groups.values(),...this.zoneGroups].forEach(g=>bounds.expandByObject(g));
    if(bounds.isEmpty())return;
    const center=bounds.getCenter(new THREE.Vector3());const delta=this.camera.position.clone().sub(this.controls.target);this.controls.target.copy(center);this.camera.position.copy(center).add(delta);this.camera.lookAt(center);this.camera.updateMatrixWorld();
    const right=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,1);let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    [...this.groups.values(),...this.zoneGroups].forEach(g=>{const b=new THREE.Box3().setFromObject(g);if(b.isEmpty())return;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const p=new THREE.Vector3(x,y,z).sub(center),px=p.dot(right),py=p.dot(up);minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);}});
    const aspect=this.width/this.height;const span=Math.max((maxX-minX)/aspect/.86,(maxY-minY)/.57,85);this.camera.left=-span*aspect/2;this.camera.right=span*aspect/2;this.camera.top=span*.545;this.camera.bottom=-span*.455;this.camera.zoom=1;this.camera.updateProjectionMatrix();this.controls.update();
  }
  rotate() {const offset=this.camera.position.clone().sub(this.controls.target);offset.applyAxisAngle(new THREE.Vector3(0,1,0),Math.PI/4);this.camera.position.copy(this.controls.target).add(offset);this.camera.lookAt(this.controls.target);this.controls.update();}
  zoom(factor) {this.camera.zoom=THREE.MathUtils.clamp(this.camera.zoom*factor,.3,6);this.camera.updateProjectionMatrix();this.callbacks.onZoom(this.camera.zoom);}
  setTool(tool) {this.tool=tool;this.renderer.domElement.style.cursor=this.zoneEditor.active?'crosshair':tool==='move'?'move':'default';}
  hit(event) {
    const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);
    const hits=[...(this.stairHandles?this.raycaster.intersectObject(this.stairHandles,true):[]),...this.raycaster.intersectObjects([...this.groups.values(),...this.zoneGroups],true)];
    for(const hit of hits){if(!hit.object.visible)continue;let p=hit.object,trackLabel=false,pathIndex,stairEndpoint,hidden=false;while(p&&!p.userData.entityId){trackLabel ||= !!p.userData.trackLabel;if(p.userData.pathIndex!==undefined)pathIndex=p.userData.pathIndex;if(p.userData.stairEndpoint!==undefined)stairEndpoint=p.userData.stairEndpoint;hidden ||= !p.visible;p=p.parent;}if(p&&!hidden&&p.visible)return {group:p,id:p.userData.entityId,hit,trackLabel,pathIndex,stairEndpoint};}return null;
  }
  installPointerEvents() {
    const canvas=this.renderer.domElement;
    canvas.addEventListener('pointerdown',event=>{
      setMouseButtons(this.controls,event);
      if(event.button===1||event.button===2){
        event.preventDefault();
        canvas.focus({preventScroll:true});
      }
    },true);
    canvas.addEventListener('auxclick',event=>{if(event.button===1)event.preventDefault();});
    const refreshModifier=event=>{
      if(event.key!=='Alt')return;
      if(this.placement&&this.lastPlacementPointer){event.preventDefault();this.movePlacement({...this.lastPlacementPointer,altKey:event.type==='keydown'});}
      else if(this.endpointDrag?.pointer){event.preventDefault();this.moveStairEndpointDrag({...this.endpointDrag.pointer,altKey:event.type==='keydown'});}
      else if(this.zoneEditor.active&&this.zoneEditor.lastPointer){event.preventDefault();this.zoneEditor.pointerMove({...this.zoneEditor.lastPointer,altKey:event.type==='keydown'});}
    };
    window.addEventListener('keydown',refreshModifier);window.addEventListener('keyup',refreshModifier);
    canvas.addEventListener('pointerleave',()=>{this.lastPlacementPointer=null;this.zoneEditor.lastPointer=null;this.showSnap({});});
    canvas.addEventListener('pointerdown',event=>{
      if(this.placement||this.tool==='pan'||event.button!==0)return;
      if(!this.zoneEditor.drawing&&this.activeFloor!=='all'&&(!this.zoneEditor.active||!this.zoneEditor.hitPoint(event))){
        const hit=this.hit(event);
        if(this.zoneEditor.active&&hit&&hit.id!=='station'){this.callbacks.onSelect(hit.id);return;}
        if(!hit||hit.id==='station'){
          const p=new THREE.Vector3(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-this.floorY(this.activeFloor));
          if(this.raycaster.ray.intersectPlane(plane,p)){
            const q={x:p.x,z:p.z-this.floorOffset(this.activeFloor)},paths=(this.project.zonePaths||[]).filter(p=>p.floor===this.activeFloor);
            let found;
            // Openings remain selectable through their empty center, even beneath later paint.
            const ordered=[...paths].reverse().sort((a,b)=>Number(b.kind==='opening')-Number(a.kind==='opening'));
            for(const path of ordered){
              if(path.closed&&polygonContains(pathPolygon(path),q)){found=path;break;}
              const near=[path,...(path.holes||[]).map(vertices=>({vertices,closed:true}))].map(ring=>closestOnPath(ring,q)).filter(Boolean).sort((a,b)=>a.distance-b.distance)[0];if(near&&near.distance<(this.camera.right-this.camera.left)/this.camera.zoom/this.width*7){found=path;break;}
            }
            if(found&&this.zoneEditor.path?.id!==found.id)this.callbacks.onSelect(found.id);
            else if(!found&&!this.zoneEditor.active&&this.project.zones[this.activeFloor]?.[`${Math.floor(q.x/2)},${Math.floor(q.z/2)}`])this.callbacks.onLegacyZoneSelect?.(this.activeFloor,q);
          }
        }
      }
      if(this.zoneEditor.pointerDown(event)){event.stopImmediatePropagation();event.preventDefault();canvas.focus();canvas.setPointerCapture(event.pointerId);}
    },true);
    canvas.addEventListener('pointermove',event=>{if(this.zoneEditor.active&&this.tool!=='pan'&&!(event.buttons&6)){event.stopImmediatePropagation();this.zoneEditor.pointerMove(event);}},true);
    canvas.addEventListener('pointerup',event=>{if(this.zoneEditor.active&&event.button===0&&this.tool!=='pan'){event.stopImmediatePropagation();this.zoneEditor.pointerUp(event);}},true);
    canvas.addEventListener('dblclick',event=>{if(this.zoneEditor.drawing){event.preventDefault();this.zoneEditor.close();}},true);
    canvas.addEventListener('pointerdown',event=>{if(this.placement&&event.button===0){event.stopImmediatePropagation();event.preventDefault();canvas.focus({preventScroll:true});this.placement.pointerDown={x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);this.movePlacement(event);}},true);
    canvas.addEventListener('pointerup',event=>{if(this.placement&&event.button===0){event.stopImmediatePropagation();const down=this.placement.pointerDown;delete this.placement.pointerDown;if(down&&Math.hypot(event.clientX-down.x,event.clientY-down.y)<6)this.confirmPlacement(event);}},true);
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||this.zoneEditor.active||this.placement||this.tool==='pan')return;
      const hit=this.hit(event);if(hit?.stairEndpoint===undefined||hit.id!==this.selected)return;
      event.stopImmediatePropagation();event.preventDefault();canvas.focus({preventScroll:true});
      this.beginStairEndpointDrag(event,hit);canvas.setPointerCapture(event.pointerId);
    },true);
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||this.zoneEditor.active||this.placement||this.tool==='pan')return;
      const hit=this.hit(event);if(hit?.pathIndex===undefined||hit.id!==this.selected)return;
      event.stopImmediatePropagation();event.preventDefault();
      const source=this.project.entities.find(e=>e.id===hit.id);
      this.pathDrag={id:hit.id,index:hit.pathIndex,source:structuredClone(source),base:this.project,references:placementReferences(this.project,{floors:[source.floor],excludeId:source.id})};
      this.plane.constant=-this.floorY(source.floor);this.controls.enabled=false;canvas.setPointerCapture(event.pointerId);
    },true);
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||this.zoneEditor.active||this.placement||this.tool==='pan')return;
      const hit=this.hit(event);if(this.project.entities.find(e=>e.id===hit?.id)?.type!=='text')return;
      this.callbacks.onSelect(hit.id);
      event.stopImmediatePropagation();event.preventDefault();const group=hit.group;
      this.plane.constant=-this.floorY(this.project.entities.find(e=>e.id===hit.id).floor);const point=new THREE.Vector3();this.raycaster.ray.intersectPlane(this.plane,point);
      const annotation=group.children.find(child=>child.userData.callout),anchorOnly=!!hit.hit.object.userData.textAnchor;
      const anchor=new THREE.Vector3();(anchorOnly?annotation.userData.callout.anchor:group).getWorldPosition(anchor);
      this.textDrag={id:hit.id,group,annotation,anchorOnly,offset:anchor.sub(point),startX:event.clientX,startY:event.clientY,started:false};
      this.controls.enabled=false;canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';
    },true);
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;this.down={x:event.clientX,y:event.clientY};
      if(this.tool==='move') {const hit=this.hit(event);if(hit&&hit.id!=='station'){this.callbacks.onSelect(hit.id);this.plane.constant=-hit.group.position.y;this.raycaster.ray.intersectPlane(this.plane,this.dragPoint);this.drag={id:hit.id,group:hit.group,offset:hit.group.position.clone().sub(this.dragPoint),started:false,base:this.project};this.controls.enabled=false;canvas.setPointerCapture(event.pointerId);}}
    });
    canvas.addEventListener('pointermove',event=>{
      if(event.buttons&6)return;
      if(this.endpointDrag){this.moveStairEndpointDrag(event);return;}
      if(this.pathDrag){
        const d=this.pathDrag,point=new THREE.Vector3();this.hit(event);if(!this.raycaster.ray.intersectPlane(this.plane,point))return;
        const source=d.source,raw={x:point.x,z:point.z-this.floorOffset(source.floor)},anchor=worldPoint(source,source.path[d.index===0?1:d.index-1]);
        const disabled=event.altKey||!d.base.snapping,end=d.index===0||d.index===source.path.length-1,cache={};
        const aligned=snapPlacementPoint(d.base,source.floor,raw,{references:d.references,anchor,tolerance:this.snapTolerance(),disabled,
          snapGeometry:end?(p,line)=>snapRailPoint(d.base,source,p,this.snapTolerance(),line,cache):undefined});
        const position=aligned.snapped?aligned.point:disabled?raw:placementPoint(raw),target=moveTrackKnot(d.base,source,d.index,position,{prepared:true});
        const error=trackPathError(target);d.target=target;
        if(error){this.callbacks.onSnap?.(error);return;}
        const preview=structuredClone(d.base);preview.entities[preview.entities.findIndex(e=>e.id===d.id)]=target;
        try{syncTrackPaths(preview);syncTrains(preview);this.update(preview,this.view,this.activeFloor,d.id);this.showSnap({...aligned.point,floor:source.floor,guides:aligned.guides});}catch{}
        return;
      }
      if(this.textDrag){const d=this.textDrag,point=new THREE.Vector3();this.hit(event);if(!this.raycaster.ray.intersectPlane(this.plane,point))return;
        if(!d.started&&Math.hypot(event.clientX-d.startX,event.clientY-d.startY)<3)return;d.started=true;point.add(d.offset);
        const e=this.project.entities.find(e=>e.id===d.id),pos=placementPoint({x:point.x,z:point.z-this.floorOffset(e.floor)});
        if(d.anchorOnly){d.target=pos;Object.assign(d.annotation.userData.callout,{anchorX:pos.x,anchorZ:pos.z});}
        else d.group.position.set(pos.x,this.floorY(e.floor),pos.z+this.floorOffset(e.floor));this.select(d.id);return;}
      if(this.placement){this.movePlacement(event);return;}
      if(!this.drag){const hit=this.hit(event);canvas.style.cursor=hit?.stairEndpoint!==undefined?'grab':this.project.entities.find(e=>e.id===hit?.id)?.type==='text'&&this.tool!=='pan'?'grab':this.tool==='pan'?'grab':this.tool==='move'?'move':'default';return;}this.hit(event);const point=new THREE.Vector3();if(!this.raycaster.ray.intersectPlane(this.plane,point))return;
      if(!this.drag.started&&Math.hypot(event.clientX-this.down.x,event.clientY-this.down.y)>3){this.drag.started=true;this.callbacks.onMoveStart();}
      if(this.drag.started){
        point.add(this.drag.offset);
        const entity=this.drag.base.entities.find(e=>e.id===this.drag.id),offset=this.floorOffset(this.drag.group.userData.drawFloor||entity.floor);
        const position={x:Math.round(point.x*2)/2,z:Math.round((point.z-offset)*2)/2};
        let target;
        if(entity.type==='train'){
          const result=placeTrain(this.project,entity,position);
          this.callbacks.onSnap?.(result.valid?'已吸附轨道':result.message);
          if(!result.valid)return;
          target=result.entity;
        }else{target=snapTrack(this.project,{...entity,...position});this.showSnap(target);}
        this.drag.target=target;this.drag.group.position.x=target.x;this.drag.group.position.z=target.z+offset;
        this.drag.group.rotation.y=-THREE.MathUtils.degToRad(target.rotation);
        if(entity.type==='train'){
          // Carriage poses are local to the moving train and must be rebuilt as its
          // centre crosses a curve or another rail, rather than translated rigidly.
          this.drag.group.traverse(o=>{o.geometry?.dispose();if(o.isLine)o.material?.dispose();});
          this.drag.group.clear();this.buildEntity(this.drag.group,target);
        }
        if(entity.type==='track'){
          const preview=structuredClone(this.drag.base),moved=preview.entities.find(e=>e.id===entity.id);
          Object.assign(moved,target);delete moved.joins;
          try{syncTrackPaths(preview);syncTrains(preview);this.update(preview,this.view,this.activeFloor,this.drag.id);this.drag.group=this.groups.get(this.drag.id);}catch{}
        }
        this.select(this.drag.id);
      }
    });
    const end=event=>{
      if(event.button!==0)return;
      if(this.endpointDrag){this.finishStairEndpointDrag();return;}
      if(this.pathDrag){const d=this.pathDrag;this.pathDrag=null;this.controls.enabled=true;this.showSnap({snapped:false});if(d.target)this.callbacks.onPathChange(d.id,d.target);else this.update(d.base,this.view,this.activeFloor,d.id);return;}
      if(this.textDrag){const d=this.textDrag;this.textDrag=null;this.controls.enabled=true;this.setTool(this.tool);if(d.started){const e=this.project.entities.find(e=>e.id===d.id);if(d.anchorOnly)this.callbacks.onTextAnchorMove(d.id,d.target);else this.callbacks.onMove(d.id,{x:d.group.position.x,z:d.group.position.z-this.floorOffset(e.floor)});}return;}
      if(this.drag){const d=this.drag;this.drag=null;this.controls.enabled=true;this.showSnap({snapped:false});if(d.started&&d.target)this.callbacks.onMove(d.id,d.target);this.down=null;return;}
      if(this.down&&Math.hypot(event.clientX-this.down.x,event.clientY-this.down.y)<5&&event.button===0&&this.tool!=='pan'){const hit=this.hit(event);this.callbacks.onSelect(hit?.id||'station');}this.down=null;
    };
    canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',()=>{if(this.endpointDrag){this.cancelStairEndpointDrag();return;}if(this.zoneEditor.active){this.zoneEditor.cancelDrag();return;}if(this.placement){delete this.placement.pointerDown;return;}if(this.pathDrag){const d=this.pathDrag;this.pathDrag=null;this.update(d.base,this.view,this.activeFloor,d.id);}if(this.textDrag){this.textDrag=null;this.update(this.project,this.view,this.activeFloor,this.selected);}const base=this.drag?.base;this.drag=null;if(base)this.update(base,this.view,this.activeFloor,this.selected);this.down=null;this.controls.enabled=true;this.showSnap({snapped:false});this.setTool(this.tool);});
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
  }
  async exportPNG(project, options = {}) {
    const previousRatio=this.renderer.getPixelRatio(),controlsEnabled=this.controls.enabled;
    this.restoreFloorFocus();
    const editingHelpers=[];
    if(this.activeFloor==='all'){editingHelpers.push([this.editGrid,this.editGrid.visible]);this.editGrid.visible=false;}
    const selectedCallouts=this.textCallouts.filter(group=>group.userData.callout.selected);selectedCallouts.forEach(group=>this.highlightTextCallout(group,false));
    for(const helper of [this.zoneEditor.helpers,this.snapGuide,this.stairHandles,this.placement?.group,this.placement?.helper].filter(Boolean)){editingHelpers.push([helper,helper.visible]);helper.visible=false;}
    this.world.traverse(o=>{if(o.userData.pathIndex!==undefined||o.userData.pathGuide||o.userData.calloutSelection||o===this.selectionBox){editingHelpers.push([o,o.visible]);o.visible=false;}});
    const filename=`${project.name}-${this.view==='floor'?'分层平面':'3D示意图'}.png`;
    let out;
    this.renderer.setAnimationLoop(null);this.controls.enabled=false;
    try {
      await document.fonts.ready;
      this.renderer.setPixelRatio(2);
      this.updateTextCallouts();
      this.renderer.render(this.scene,this.camera);
      this.labelRenderer.render(this.scene,this.camera);this.layoutLabels();
      out=await captureViewport(this.container,this.width,this.height);
      if(options.footer) out=appendExportFooter(out,[`RMCreator     ${project.lines.map(line=>line.name).join(' / ')} · ${project.entities.length} 个构件`,'车站空间示意图 · 设计方案'],getComputedStyle(this.container).fontFamily);
    } finally {
      selectedCallouts.forEach(group=>this.highlightTextCallout(group,true));
      editingHelpers.forEach(([o,visible])=>o.visible=visible);
      this.renderer.setPixelRatio(previousRatio);this.controls.enabled=controlsEnabled;
      this.applyFloorFocus();
      this.renderer.setAnimationLoop(this.animate);
    }
    const blob=await new Promise((resolve,reject)=>out.toBlob(value=>value?resolve(value):reject(new Error('无法生成 PNG 图片')),'image/png'));
    const a=document.createElement('a'),url=URL.createObjectURL(blob);a.download=filename;a.href=url;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
  }
  animate() {this.controls.update();this.zoneEditor.flush();this.updateTextCallouts();this.renderer.render(this.scene,this.camera);this.labelRenderer.render(this.scene,this.camera);if(this.project)this.layoutLabels();}
}
