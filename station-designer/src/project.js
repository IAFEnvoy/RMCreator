import { rasterizeRect, ZONE_COLORS, ZONE_KINDS, CELL_LIMIT } from './zones.js';
import { DEFAULT_TRAIN_CARS, validTrainSettings } from './train-presets.js';
import { trainOnTrack, syncTrains } from './train-placement.js';
import { syncTrackPaths, trackPathError } from './track-path.js';
import { zonePathError } from './zone-path.js';
import { TEXT_DEFAULTS, textError, detachTrackTexts } from './text.js';

export const types = {
  text:{name:'文字',icon:'type',en:'Text',category:'annotation',l:8.8,d:5.2,h:.15,color:'#52634e',floor:'B2',...TEXT_DEFAULTS},
  track:{name:'轨道',icon:'tram-front',en:'Track',l:180,d:4,h:.35,color:'#bc4554',floor:'B2',direction:'right-side',arrowVisible:false},
  train:{name:'列车',icon:'train-front',en:'Train decoration',category:'decoration',l:120,d:2.8,h:3.8,color:'#bc4554',floor:'B2',trainPreset:'metro-b',trainCars:DEFAULT_TRAIN_CARS,trainUnits:1,trainOffset:0,trainFacing:'inherit'},
  stairs:{name:'楼梯',icon:'list-filter',en:'Stairs',l:18,d:3.5,h:12,color:'#cdb594',floor:'B2'},
  escalator:{name:'自动扶梯',icon:'arrow-up-right',en:'Escalator',l:18,d:3.2,h:12,color:'#929e9b',floor:'B2'},
  elevator:{name:'无障碍电梯',icon:'accessibility',en:'Elevator',l:4,d:4,h:16,color:'#a5c6c5',floor:'B2'},
  exit:{name:'出口标记',icon:'door-open',en:'Exit',l:6,d:6,h:.15,color:'#5c856b',floor:'B1'},
  restroom:{name:'卫生间标记',icon:'toilet',en:'Restroom',l:6,d:6,h:.15,color:'#617e9e',floor:'B1'},
  gates:{name:'进出站闸机',icon:'panel-top-dashed',en:'Ticket gates',l:3,d:7.5,h:1.8,color:'#9aa9a6',floor:'B1'},
  service:{name:'服务中心',icon:'concierge-bell',en:'Service center',l:6,d:4,h:2.8,color:'#b69773',floor:'B1'},
};
export const entity = (id,type,name,x,z,extra={}) => ({...types[type],id,type,name,x,z,rotation:0,visible:true,...extra});
export const defaultFloors = () => [{id:'B2',code:'B2',name:'站台层',elevation:0},{id:'B1',code:'B1',name:'站厅层',elevation:12}];
function convertExitCorridors(p) {
  for(const e of p.entities.filter(e=>e.type==='exit')){
    const cells=p.zones[e.floor] ||= {}, corridor={};
    if(e.visible){rasterizeRect(corridor,e,'unpaid');for(const[key,kind]of Object.entries(corridor))if(!cells[key])cells[key]=kind;}
    const a=(e.rotation||0)*Math.PI/180,end=(e.z>=0?1:-1)*(e.d/2-.8);
    e.x=Math.max(-500,Math.min(500,e.x-Math.sin(a)*end));e.z=Math.max(-500,Math.min(500,e.z+Math.cos(a)*end));
    e.l=6;e.d=6;e.h=.15;if(e.color==='#d6e6e6')e.color=types.exit.color;
  }
}
export function defaultProject(){
  const zones={B2:{},B1:{}};
  rasterizeRect(zones.B2,{x:0,z:0,l:160,d:12},'paid');
  rasterizeRect(zones.B1,{x:0,z:0,l:132,d:20},'unpaid');
  rasterizeRect(zones.B1,{x:0,z:0,l:64,d:20},'paid');
  rasterizeRect(zones.B1,{x:-50,z:6,l:16,d:8},'staff');
  rasterizeRect(zones.B1,{x:50,z:6,l:16,d:8},'staff');
  const project = {version:3,name:'上海火车站',english:'Shanghai Railway Station',updatedAt:null,floorHeight:12,floors:defaultFloors(),
    lines:[{id:'line-1',name:'1 号线',color:'#bc4554'}],zones,zoneColors:{...ZONE_COLORS},snapping:true,boundaries:{railings:true,screenDoors:'half'},
    display:{names:true,markers:true,fullMarkers:true,grid:true,exploded:false},entities:[
      entity('track-north','track','往富锦路',0,-8,{lineId:'line-1',doorStyle:'inherit'}),entity('track-south','track','往莘庄',0,8,{lineId:'line-1',doorStyle:'inherit'}),
      entity('stairs-1','stairs','楼梯 A',-42,2.8,{toFloor:'B1'}),entity('escalator-1','escalator','自动扶梯 A',-42,-2.2,{toFloor:'B1'}),
      entity('stairs-2','stairs','楼梯 B',42,-2.8,{rotation:180,toFloor:'B1'}),entity('escalator-2','escalator','自动扶梯 B',42,2.2,{rotation:180,toFloor:'B1'}),
      entity('elevator-1','elevator','无障碍电梯',-8,1,{toFloor:'B1'}),entity('elevator-2','elevator','无障碍电梯',20,-2,{toFloor:'B1'}),
      entity('exit-1','exit','1 号口',52,-22,{exitNumber:'1',l:8,d:27}),entity('exit-2','exit','2 号口',0,-24,{exitNumber:'2',l:8,d:31}),entity('exit-3','exit','3 号口',-55,-22,{exitNumber:'3',l:8,d:27}),
      entity('exit-4','exit','4 号口',30,23,{exitNumber:'4',l:8,d:29}),entity('exit-5','exit','5 号口',-56,23,{exitNumber:'5',l:8,d:29}),entity('exit-6','exit','6 号口',66,13,{exitNumber:'6',l:8,rotation:90,d:25}),
      entity('restroom-1','restroom','卫生间',-59,-3),entity('restroom-2','restroom','卫生间',59,-3),
      entity('gates-1','gates','进站闸机',-32,0),entity('gates-2','gates','出站闸机',32,0),entity('service-1','service','服务中心',-4,-4.5),
    ]};
  convertExitCorridors(project);detachTrackTexts(project,entity);project.version=4;return project;
}

export function migrateProject(input){
  if(!input||typeof input!=='object')throw new Error('无效方案');
  const p=structuredClone(input);
  if(p.version===1){
    if (!Array.isArray(p.entities) || p.entities.length > 200 || (p.floors && (!Array.isArray(p.floors) || p.floors.length > 12))) throw new Error('无效方案');
    p.floorHeight ||= 12;
    p.floors ||= defaultFloors();p.lines=[{id:'line-1',name:`${p.line||'1'} 号线`,color:p.color||'#bc4554'}];p.zones=Object.fromEntries(p.floors.map(f=>[f.id,{}]));
    for(const e of p.entities||[]){if(!p.zones[e.floor])continue;if(e.type==='platform')rasterizeRect(p.zones[e.floor],e,'paid');
      if(e.type==='concourse'){rasterizeRect(p.zones[e.floor],e,'unpaid');rasterizeRect(p.zones[e.floor],{...e,l:e.l*.47},'paid');}}
    p.entities=p.entities.filter(e=>!['platform','concourse'].includes(e.type));
    p.entities.filter(e=>e.type==='track').forEach(e=>{e.lineId='line-1';e.doorStyle='inherit';});
    p.zoneColors={...ZONE_COLORS};p.snapping=true;p.boundaries={railings:true,screenDoors:'half'};p.version=2;delete p.line;delete p.color;
  }
  if(p.version===2){
    p.zoneColors={...ZONE_COLORS,...p.zoneColors};
    if(!p.zones||!Array.isArray(p.entities)||p.entities.length>200)throw new Error('无效方案');
    convertExitCorridors(p);
    p.entities.filter(e=>e.type==='track').forEach(e=>e.direction='right-side');
    p.version=3;
  }
  if(p.display&&typeof p.display==='object')delete p.display.shadows;
  if(!isProject(p))throw new Error('无效方案');
  for(const track of p.entities.filter(e=>e.type==='track')){
    if(track.trainEnabled){
      let id=`${track.id.slice(0,65)}-train`,n=1;
      while(p.entities.some(e=>e.id===id))id=`${track.id.slice(0,60)}-train-${n++}`;
      const train=entity(id,'train',`${track.name.slice(0,95)} 列车`,track.x,track.z);
      for(const key of ['trainPreset','trainCars','trainUnits','trainCustom'])if(track[key]!==undefined)train[key]=track[key];
      if(!track.trainPreset)train.trainPreset='custom';
      p.entities.push(trainOnTrack(p,train,track,0));
    }
    for(const key of ['trainEnabled','trainPreset','trainCars','trainUnits','trainCustom'])delete track[key];
  }
  syncTrackPaths(p);syncTrains(p);
  if(p.version===3){detachTrackTexts(p,entity);p.display.texts=p.display.trackDirections!==false;p.version=4;}
  delete p.display.trackDirections;
  if(!isProject(p))throw new Error('无效方案');return p;
}

const validColor=v=>typeof v==='string'&&/^#[\da-f]{6}$/i.test(v);
const validId=v=>typeof v==='string'&&/^[\w-]{1,80}$/.test(v);
function validTrackJoins(project) {
  const tracks=project.entities.filter(e=>e?.type==='track'),done=new Set(),visiting=new Set();
  const visit=track=>{
    if(done.has(track.id))return true;if(visiting.has(track.id))return false;visiting.add(track.id);
    if(track.joins!==undefined){
      if(!track.joins||typeof track.joins!=='object'||Array.isArray(track.joins))return false;
      for(const[key,j]of Object.entries(track.joins)){
        if(!['start','end'].includes(key)||!track.path||!j||!validId(j.trackId)||!Number.isFinite(j.t)||j.t<0||j.t>1||typeof j.reverse!=='boolean')return false;
        const host=tracks.find(t=>t.id===j.trackId);if(!host||!visit(host))return false;
      }
    }
    visiting.delete(track.id);done.add(track.id);return true;
  };
  return tracks.every(visit);
}
export function isProject(p){
  if(!p||![3,4].includes(p.version)||typeof p.name!=='string'||p.name.length>100||typeof p.english!=='string'||p.english.length>200)return false;
  if(!Array.isArray(p.floors)||p.floors.length<1||p.floors.length>12||new Set(p.floors.map(f=>f?.id)).size!==p.floors.length)return false;
  if(!p.floors.every(f=>f&&validId(f.id)&&typeof f.code==='string'&&f.code.length<=10&&typeof f.name==='string'&&f.name.length<=40&&Number.isFinite(f.elevation)&&Math.abs(f.elevation)<=500))return false;
  const hasFloor=id=>p.floors.some(f=>f.id===id);
  if(p.zonePaths!==undefined&&(!Array.isArray(p.zonePaths)||p.zonePaths.length>600||new Set(p.zonePaths.map(p=>p?.id)).size!==p.zonePaths.length||!p.zonePaths.every(path=>path&&validId(path.id)&&hasFloor(path.floor)&&[...ZONE_KINDS,'erase','opening'].includes(path.kind)&&!zonePathError(path))))return false;
  if(!Array.isArray(p.lines)||!p.lines.length||p.lines.length>24||new Set(p.lines.map(l=>l?.id)).size!==p.lines.length||!p.lines.every(l=>l&&validId(l.id)&&typeof l.name==='string'&&l.name.trim()&&l.name.length<=40&&validColor(l.color)))return false;
  if(!p.zones||typeof p.zones!=='object'||Array.isArray(p.zones)||!Object.entries(p.zones).every(([id,cells])=>hasFloor(id)&&cells&&typeof cells==='object'&&!Array.isArray(cells)&&Object.keys(cells).length<=CELL_LIMIT&&Object.entries(cells).every(([key,kind])=>/^-?\d{1,3},-?\d{1,3}$/.test(key)&&key.split(',').every(n=>Number(n)>=-250&&Number(n)<250)&&ZONE_KINDS.includes(kind))))return false;
  if(!p.zoneColors||!ZONE_KINDS.every(kind=>validColor(p.zoneColors[kind]))||typeof p.snapping!=='boolean'||!p.boundaries||typeof p.boundaries.railings!=='boolean'||!['none','half','full'].includes(p.boundaries.screenDoors))return false;
  if(!p.display||!['names','markers','grid','exploded'].every(k=>typeof p.display[k]==='boolean')||!['fullMarkers','trackDirections','texts'].every(k=>p.display[k]===undefined||typeof p.display[k]==='boolean')||!Number.isFinite(p.floorHeight)||p.floorHeight<1||p.floorHeight>40)return false;
  return Array.isArray(p.entities)&&p.entities.length<=600&&p.entities.filter(e=>!['train','text'].includes(e?.type)).length<=200&&p.entities.filter(e=>e?.type==='text').length<=200&&new Set(p.entities.map(e=>e?.id)).size===p.entities.length&&p.entities.every(e=>e&&Object.hasOwn(types,e.type)&&validId(e.id)&&typeof e.name==='string'&&e.name.length<=100&&hasFloor(e.floor)&&['x','z','l','d','h','rotation'].every(k=>Number.isFinite(e[k])&&Math.abs(e[k])<=(e.type==='train'?1800:500))&&['l','d','h'].every(k=>e[k]>0)&&validColor(e.color)&&(!e.toFloor||hasFloor(e.toFloor))&&typeof e.visible==='boolean'&&['labelX','labelZ'].every(k=>e[k]===undefined||(Number.isFinite(e[k])&&Math.abs(e[k])<=500))&&(e.labelRotation===undefined||([0,90,180,270].includes(e.labelRotation)))&&(e.exitNumber===undefined||(typeof e.exitNumber==='string'&&e.exitNumber.length<=12))&&(e.type!=='text'||!textError(e))&&(e.type!=='track'||(p.lines.some(l=>l.id===e.lineId)&&['inherit','none','half','full'].includes(e.doorStyle||'inherit')&&['right-side','forward','backward'].includes(e.direction)&&validTrainSettings(e)&&!trackPathError(e)&&(e.arrowVisible===undefined||typeof e.arrowVisible==='boolean')&&(e.bandVisible===undefined||typeof e.bandVisible==='boolean')&&(e.bandSide===undefined||['auto','left','right'].includes(e.bandSide))&&(e.bandColor===undefined||validColor(e.bandColor))))&&(e.type!=='train'||(validTrainSettings(e)&&Number.isFinite(e.trainOffset)&&Math.abs(e.trainOffset)<=500&&['inherit','reverse'].includes(e.trainFacing)&&p.entities.some(t=>t?.type==='track'&&t.id===e.trackId))))&&validTrackJoins(p);
}
