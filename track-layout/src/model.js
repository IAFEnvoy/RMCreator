import { guideThrough, projectGuide, snapGeometry, snapWithGuides } from '../../shared/snap-math.js';
import referenceInterchange from '../examples/reference-interchange.json' with { type: 'json' };
import { upgradeReferenceLink } from './migrations.js';

export const FORMAT='rmcreator-track-layout';
export const LINE_STYLES=[['solid','实线'],['dashed','虚线'],['dotted','点线'],['siding','存车线']];
export const PALETTE=['#2f6de5','#df7455','#47a58c','#a776c5','#d5a342','#526477','#de709b','#222c3c'];
export const clone=value=>structuredClone(value);
export const uid=()=>`layout-${globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
export const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
export const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
export const point=(x,y)=>({x,y});
export const round=n=>Math.round(n*1000)/1000;
const color=v=>typeof v==='string'&&/^#[\da-f]{6}$/i.test(v);
const finite=(v,min=-20000,max=20000)=>Number.isFinite(v)&&v>=min&&v<=max;
const validPoint=p=>p&&finite(p.x)&&finite(p.y);

export function blankProject(name='未命名配线') {
  return {format:FORMAT,version:1,name,objects:[],settings:{grid:true,snap:true,names:true,background:'#ffffff',title:true},updatedAt:null};
}
export function createObject(type,extra={}) {
  const base={id:uid(),type,name:{line:'线路',platform:'站台',text:'文字'}[type],visible:true,locked:false};
  if(type==='line')return {...base,points:[],color:PALETTE[0],width:5,dash:'solid',arrow:'none',...extra};
  if(type==='platform')return {...base,x:0,y:0,width:260,height:44,rotation:0,fill:'#e9edf4',color:'#b7c3d2',radius:6,...extra};
  return {...base,x:0,y:0,text:'文字标注',fontSize:18,rotation:0,color:'#36445a',...extra};
}
export function projectError(p) {
  if(!p||p.format!==FORMAT||p.version!==1)return '请打开配线工坊的 JSON 方案';
  if(typeof p.name!=='string'||!p.name.trim()||p.name.length>100)return '方案名称需为 1–100 个字符';
  const s=p.settings;
  if(!s||!['grid','snap','names','title'].every(k=>typeof s[k]==='boolean')||!color(s.background))return '画布设置无效';
  if(!Array.isArray(p.objects)||p.objects.length>500||new Set(p.objects.map(o=>o?.id)).size!==p.objects.length)return '方案最多支持 500 个独立对象';
  for(const o of p.objects){
    if(!o||!['line','platform','text'].includes(o.type)||typeof o.id!=='string'||!/^[\w-]{1,100}$/.test(o.id)||typeof o.name!=='string'||o.name.length>100||typeof o.visible!=='boolean'||typeof o.locked!=='boolean')return '对象数据无效';
    if(!color(o.color))return '对象颜色无效';
    if(o.type==='line'){
      if(o.gradient!==undefined&&(!o.gradient||typeof o.gradient!=='object'||Array.isArray(o.gradient)||!color(o.gradient.endColor)))return '渐变终点颜色无效';
      if(!Array.isArray(o.points)||o.points.length<2||o.points.length>128||!o.points.every((p,i)=>validPoint(p)&&(!p.control||i>0&&validPoint(p.control)))||!finite(o.width,1,30)||!LINE_STYLES.some(([value])=>value===o.dash)||!['none','start','end','both'].includes(o.arrow)||o.points.slice(1).some((p,i)=>distance(o.points[i],p)<.1))return '线条路径无效（需 2–128 个顶点，相邻顶点不能重合）';
    }else{
      if(!validPoint(o)||!finite(o.rotation,-360,360))return '对象位置或角度无效';
      if(o.type==='platform'&&(!finite(o.width,8,4000)||!finite(o.height,8,2000)||!finite(o.radius,0,200)||!color(o.fill)))return '站台尺寸无效';
      if(o.type==='text'&&(typeof o.text!=='string'||!o.text.trim()||o.text.length>500||!finite(o.fontSize,8,120)))return '文字需为 1–500 个字符，字号为 8–120';
    }
  }
  return '';
}
export function readProject(input) {
  const result=clone(input),error=projectError(result);if(error)throw new Error(error);
  // Upgrade only the original example's separate buffer bar, retaining custom drawings.
  for(const bar of [...result.objects]){
    if(bar.type!=='line'||bar.name!=='存车线尽端'||bar.dash!=='solid'||bar.arrow!=='none'||bar.points.length!==2||bar.points.some(p=>p.control))continue;
    const hosts=result.objects.filter(o=>o.type==='line'&&o.name==='折返线'&&o.dash==='solid'&&o.arrow==='none'&&o.color===bar.color&&o.visible===bar.visible&&o.locked===bar.locked).filter(o=>{
      const stop=lineTerminator({...o,dash:'siding'});
      return Math.abs(bar.width-stop.width)<1e-6&&((distance(bar.points[0],stop.a)<1e-6&&distance(bar.points[1],stop.b)<1e-6)||(distance(bar.points[1],stop.a)<1e-6&&distance(bar.points[0],stop.b)<1e-6));
    });
    if(hosts.length===1){hosts[0].dash='siding';result.objects=result.objects.filter(o=>o.id!==bar.id);}
  }
  upgradeReferenceLink(result,referenceInterchange);
  return result;
}
export function quadratic(a,c,b,t){const s=1-t;return {x:s*s*a.x+2*s*t*c.x+t*t*b.x,y:s*s*a.y+2*s*t*c.y+t*t*b.y};}
export function segmentPoint(o,index,t){const a=o.points[index-1],b=o.points[index];return b.control?quadratic(a,b.control,b,t):mix(a,b,t);}
export function nearestSegment(o,p){
  let best={distance:Infinity};
  for(let index=1;index<o.points.length;index++){
    const a=o.points[index-1],b=o.points[index],steps=b.control?48:1;let previous=a;
    for(let i=1;i<=steps;i++){
      const next=segmentPoint(o,index,i/steps),dx=next.x-previous.x,dy=next.y-previous.y,l=dx*dx+dy*dy;
      const f=l?Math.max(0,Math.min(1,((p.x-previous.x)*dx+(p.y-previous.y)*dy)/l)):0,q=mix(previous,next,f),d=distance(p,q);
      if(d<best.distance)best={...q,distance:d,index,t:(i-1+f)/steps};previous=next;
    }
  }
  return best;
}
export function splitSegment(o,index,t=.5){
  if(o.points.length>=128||index<1||index>=o.points.length)return o;
  const result=clone(o),a=result.points[index-1],b=result.points[index];
  if(b.control){const c0=mix(a,b.control,t),c1=mix(b.control,b,t),p=mix(c0,c1,t);result.points.splice(index,0,{...p,control:c0});result.points[index+1].control=c1;}
  else result.points.splice(index,0,mix(a,b,t));return result;
}
export function moveNode(o,index,p){
  const result=clone(o),node=result.points[index];if(!node)return result;
  const delta={x:p.x-node.x,y:p.y-node.y};node.x=p.x;node.y=p.y;
  for(const target of [node,result.points[index+1]])if(target?.control){target.control.x+=delta.x/2;target.control.y+=delta.y/2;}
  return result;
}
export function translateObject(o,dx,dy){
  const result=clone(o);
  if(o.type==='line')for(const p of result.points){p.x=round(p.x+dx);p.y=round(p.y+dy);if(p.control){p.control.x=round(p.control.x+dx);p.control.y=round(p.control.y+dy);}}
  else{result.x=round(result.x+dx);result.y=round(result.y+dy);}return result;
}
export function rotatePoint(p,center,angle){const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),x=p.x-center.x,y=p.y-center.y;return {x:center.x+x*c-y*s,y:center.y+x*s+y*c};}
export function lineTerminator(o){
  if(o.type!=='line'||o.dash!=='siding'||o.points.length<2)return null;
  const end=o.points.at(-1),previous=o.points.at(-2);
  let from=end.control||previous,dx=end.x-from.x,dy=end.y-from.y,length=Math.hypot(dx,dy);
  if(length<1e-8){from=previous;dx=end.x-from.x;dy=end.y-from.y;length=Math.hypot(dx,dy);}
  if(length<1e-8)return null;
  const half=Math.max(10,o.width*2.6),x=-dy/length*half,y=dx/length*half;
  return {a:{x:end.x-x,y:end.y-y},b:{x:end.x+x,y:end.y+y},width:Math.max(2,o.width*.8)};
}
export function objectBounds(o){
  let points;
  if(o.type==='line'){
    points=o.points.flatMap((p,i)=>i?Array.from({length:p.control?25:2},(_,j)=>segmentPoint(o,i,j/(p.control?24:1))):[p]);
    const stop=lineTerminator(o);if(stop)for(const p of [stop.a,stop.b])for(const dx of [-stop.width/2,stop.width/2])for(const dy of [-stop.width/2,stop.width/2])points.push({x:p.x+dx,y:p.y+dy});
  }
  else{
    const w=o.type==='platform'?o.width:Math.max(...o.text.split('\n').map(t=>[...t].length))*o.fontSize*.8,h=o.type==='platform'?o.height:o.fontSize*1.4*o.text.split('\n').length;
    points=[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>rotatePoint({x:o.x+x,y:o.y+y},o,o.rotation));
  }
  return {x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),right:Math.max(...points.map(p=>p.x)),bottom:Math.max(...points.map(p=>p.y))};
}
export function drawingBounds(objects){
  if(!objects.length)return {x:0,y:0,width:1000,height:600};const b=objects.map(objectBounds),x=Math.min(...b.map(p=>p.x)),y=Math.min(...b.map(p=>p.y));return {x,y,width:Math.max(1,Math.max(...b.map(p=>p.right))-x),height:Math.max(1,Math.max(...b.map(p=>p.bottom))-y)};
}
export function snapPoint(project,p,{tolerance=10,excludeIds=[],draft=[],disabled=false,anchor,constrain=false}={}){
  let q={x:p.x,y:p.y},constraint;
  if(constrain&&anchor){
    const directions=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]],index=(Math.round(Math.atan2(p.y-anchor.y,p.x-anchor.x)/(Math.PI/4))+8)%8,[dx,dy]=directions[index];
    constraint=guideThrough(anchor,{x:anchor.x+dx,y:anchor.y+dy});q=projectGuide(q,constraint);
  }
  if(disabled||!project.settings.snap)return {x:round(q.x),y:round(q.y)};
  const objects=project.objects.filter(o=>o.visible&&!excludeIds.includes(o.id)),points=[...draft],referencePoints=[],segments=[],lines=[],frames=new Map();
  const addFrame=(a,b)=>{if(distance(a,b)<1e-7)return;const angle=((Math.atan2(b.y-a.y,b.x-a.x)%Math.PI)+Math.PI)%Math.PI;frames.set(angle.toFixed(5),{x:b.x-a.x,y:b.y-a.y});};
  for(const o of objects){
    if(o.type==='line'){
      points.push(...o.points);
      for(let i=1;i<o.points.length;i++){
        const a=o.points[i-1],b=o.points[i];segments.push({a,b,control:b.control});
        if(b.control){addFrame(a,b.control);addFrame(b.control,b);}else addFrame(a,b);
      }
    }else{
      const b=objectBounds(o);points.push({x:o.x,y:o.y});referencePoints.push({x:b.x,y:b.y},{x:b.right,y:b.bottom});
      if(o.type==='platform'){
        const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>rotatePoint({x:o.x+x*o.width/2,y:o.y+y*o.height/2},o,o.rotation));
        points.push(...corners);for(let i=0;i<4;i++){const a=corners[i],b=corners[(i+1)%4];segments.push({a,b});addFrame(a,b);}
      }
    }
  }
  for(const point of [...points,...referencePoints])for(const n of [{x:1,y:0},{x:0,y:1}])lines.push({n,value:point.x*n.x+point.y*n.y,kind:'align',a:point,b:point});
  if(anchor){
    for(let i=1;i<draft.length;i++){const a=draft[i-1],b=draft[i];addFrame(b.control||a,b);}
    const framePoints=[{x:1,y:0},...frames.values()];
    for(const v of framePoints)for(const d of [v,{x:-v.y,y:v.x}]){
      const line=guideThrough(anchor,{x:anchor.x+d.x,y:anchor.y+d.y},{kind:'direction',anchor:true});if(line)lines.push(line);
    }
  }
  const grid={x:Math.round(q.x/10)*10,y:Math.round(q.y/10)*10};
  for(const n of [{x:1,y:0},{x:0,y:1}])lines.push({n,value:grid.x*n.x+grid.y*n.y,kind:'grid',grid:true,a:grid,b:grid});
  const result=snapWithGuides(q,{lines,tolerance,constraint,geometry:(point,line)=>{
    const hit=snapGeometry(point,{points,segments,tolerance,segmentTolerance:tolerance*.8,constraint:line});
    return hit?{x:hit.x,y:hit.y,snapped:hit.type==='point'?'端点':'线条',snapType:hit.type}:null;
  }});
  const guides=result.lines.filter(line=>line.kind!=='grid').map(line=>{
    const t={x:-line.n.y,y:line.n.x},values=[line.a,line.b,result.point].map(p=>p.x*t.x+p.y*t.y),base={x:line.n.x*line.value,y:line.n.y*line.value};
    const at=value=>({x:base.x+t.x*value,y:base.y+t.y*value});return {a:at(Math.min(...values)-tolerance*2),b:at(Math.max(...values)+tolerance*2)};
  });
  const snapped=result.geometry?.snapped||(guides.length?'对齐':result.lines.length?'网格':null);
  return {x:result.point.x,y:result.point.y,...(snapped?{snapped}:{}),...(guides.length?{guides}:{})};
}

export function exampleProject(kind='station'){
  if(kind==='interchange')return readProject(referenceInterchange);
  const p=blankProject(kind==='depot'?'车辆基地配线':'中央站配线示意');
  const line=(name,points,color=PALETTE[0],extra={})=>p.objects.push(createObject('line',{name,points:points.map(v=>Array.isArray(v)?point(...v):v),color,...extra}));
  const platform=(name,x,y,width=320,height=44)=>p.objects.push(createObject('platform',{name,x,y,width,height}));
  const label=(text,x,y,fontSize=16,color='#62708a')=>p.objects.push(createObject('text',{name:text,text,x,y,fontSize,color}));
  if(kind==='depot'){
    p.name='车辆基地配线';
    line('出入段线',[[100,300],[350,300],[1030,300]],PALETTE[2]);
    for(let i=0;i<5;i++){const y=390+i*65,start=300+i*75;line(`${i+1} 道`,[[start,300],{x:start+120,y,control:{x:start+120,y:300}},[1080,y]],PALETTE[2],{dash:'siding'});label(`${i+1} 道`,1125,y,16);}
    label('出入段线',160,265);label('检修 / 停车区域',850,720,19);
    return p;
  }
  line('上行正线',[[90,280],[1190,280]],PALETTE[0],{arrow:'start'});
  line('下行正线',[[90,440],[1190,440]],PALETTE[0],{arrow:'end'});
  line('站前渡线',[[160,280],[320,440]],PALETTE[0]);
  line('站前渡线',[[160,440],[320,280]],PALETTE[0]);
  line('折返线',[[800,280],{x:900,y:360,control:{x:840,y:360}},[1150,360]],PALETTE[1],{dash:'siding'});
  line('折返连接',[[800,440],{x:900,y:360,control:{x:840,y:360}}],PALETTE[1]);
  platform('1 / 2 站台',560,360,320,104);
  label('中央站',560,205,26,'#27374f');label('上行',120,245);label('下行',120,480);label('折返 / 存车线',1020,325,15,'#c46a51');
  label('A 端',75,360,15);label('B 端',1205,360,15);
  return p;
}
