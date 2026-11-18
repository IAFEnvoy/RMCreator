import { clone, createObject, uid, distance, mix, round, projectError, objectBounds, drawingBounds, snapPoint, nearestSegment, splitSegment, moveNode, translateObject, segmentPoint } from './model.js';
import { sceneMarkup, objectMarkup, pathData } from './render.js';
export class LayoutEditor{
  constructor(svg,callbacks={}){
    this.svg=svg;this.callbacks=callbacks;this.selected=new Set();this.tool='select';this.view={x:0,y:0,width:1280,height:720};this.style={color:'#2f6de5',width:5,dash:'solid',arrow:'none'};this.draft=null;this.gesture=null;this.nodeIndex=null;
    svg.innerHTML='<defs><pattern id="layout-grid" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r=".65" fill="#c2ccdb"/></pattern><pattern id="layout-major" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#layout-grid)"/><path d="M 100 0 H 0 V 100" fill="none" stroke="#e4e9f1" stroke-width=".65"/></pattern></defs><rect id="canvas-bg"/><rect id="canvas-grid" fill="url(#layout-major)" pointer-events="none"/><g id="objects" font-family="Segoe UI,Microsoft YaHei,PingFang SC,sans-serif"></g><g id="editing-overlay"></g>';
    this.content=svg.querySelector('#objects');this.overlay=svg.querySelector('#editing-overlay');
    svg.addEventListener('pointerdown',e=>this.down(e));svg.addEventListener('pointermove',e=>this.move(e));svg.addEventListener('pointerup',e=>this.up(e));svg.addEventListener('pointercancel',()=>this.cancelGesture());
    svg.addEventListener('wheel',e=>{e.preventDefault();this.zoom(Math.exp(-e.deltaY*.0012),this.position(e));},{passive:false});
    svg.addEventListener('contextmenu',e=>e.preventDefault());
    svg.addEventListener('auxclick',e=>{if(e.button===1)e.preventDefault();});
    svg.addEventListener('dblclick',e=>this.doubleClick(e));
    this.resize=new ResizeObserver(()=>this.applyView());this.resize.observe(svg);
  }
  get scale(){return this.svg.clientWidth/this.view.width||1;}
  position(e){const matrix=this.svg.getScreenCTM();if(!matrix)return {x:0,y:0};const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());return {x:p.x,y:p.y};}
  setProject(p,{selection=true}={}){this.project=p;if(!selection)this.selected.clear();for(const id of this.selected)if(!p.objects.some(o=>o.id===id))this.selected.delete(id);this.draw();}
  setTool(tool){this.cancelGesture();const keepPath=this.draft?.type==='line'&&['line','curve'].includes(tool);if(keepPath)delete this.draft.control;else this.draft=null;this.pointer=null;this.tool=tool;this.nodeIndex=null;this.draw();this.status();this.callbacks.onTool?.(tool);}
  select(ids){this.selected=new Set(ids);this.nodeIndex=null;this.draw();this.callbacks.onSelect?.([...this.selected]);}
  applyView(){const rect=this.svg.getBoundingClientRect();if(rect.width&&rect.height)this.view.height=this.view.width*rect.height/rect.width;this.svg.setAttribute('viewBox',`${this.view.x} ${this.view.y} ${this.view.width} ${this.view.height}`);for(const id of ['canvas-bg','canvas-grid']){const el=this.svg.querySelector(`#${id}`);for(const [k,v]of Object.entries({x:this.view.x,y:this.view.y,width:this.view.width,height:this.view.height}))el.setAttribute(k,v);}this.drawOverlay();this.callbacks.onZoom?.(Math.round(this.scale*100));}
  fit(){const b=drawingBounds(this.project.objects.filter(o=>o.visible)),rect=this.svg.getBoundingClientRect(),ratio=rect.width/(rect.height||1);this.view.width=Math.max(600,b.width+220,(b.height+200)*ratio);this.view.height=this.view.width/ratio;this.view.x=b.x+b.width/2-this.view.width/2;this.view.y=b.y+b.height/2-this.view.height/2;this.applyView();}
  zoom(factor,anchor){const p=anchor||{x:this.view.x+this.view.width/2,y:this.view.y+this.view.height/2},width=Math.max(120,Math.min(12000,this.view.width/factor)),f=width/this.view.width;this.view.x=p.x-(p.x-this.view.x)*f;this.view.y=p.y-(p.y-this.view.y)*f;this.view.width=width;this.applyView();}
  draw(){if(!this.project)return;const p=this.preview?{...this.project,objects:this.project.objects.map(o=>this.preview.get(o.id)||o)}:this.project;this.content.innerHTML=sceneMarkup(p,{interactive:true});this.svg.querySelector('#canvas-bg').setAttribute('fill',this.project.settings.background);this.svg.querySelector('#canvas-grid').style.display=this.project.settings.grid?'':'none';this.svg.dataset.tool=this.tool;this.drawOverlay();}
  drawOverlay(){
    if(!this.project)return;const z=this.scale,r=5/z,stroke=1.5/z;let html='';
    const handle=(p,attrs,color='#2f6de5',square=false)=>square?`<rect x="${p.x-r}" y="${p.y-r}" width="${r*2}" height="${r*2}" rx="${1/z}" fill="white" stroke="${color}" stroke-width="${stroke}" ${attrs}/>`:`<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="white" stroke="${color}" stroke-width="${stroke}" ${attrs}/>`;
    const dotted=(a,b)=>`<path d="M ${a.x} ${a.y} L ${b.x} ${b.y}" fill="none" stroke="#98a9c1" stroke-width="${1/z}" stroke-dasharray="${4/z} ${4/z}" pointer-events="none"/>`;
    for(const id of this.selected){
      const o=this.preview?.get(id)||this.project.objects.find(o=>o.id===id);if(!o?.visible)continue;
      if(o.type==='line'){
        html+=`<path d="${pathData(o.points)}" fill="none" stroke="#2f6de5" stroke-opacity=".18" stroke-width="${o.width+8/z}" pointer-events="none"/>`;
        if(this.selected.size===1&&!o.locked){
          o.points.forEach((p,i)=>{if(p.control){html+=dotted(o.points[i-1],p.control)+dotted(p.control,p)+handle(p.control,`data-handle="control" data-index="${i}"`,'#b186ca',true);}html+=handle(p,`data-handle="node" data-index="${i}"`,this.nodeIndex===i?'#193b85':'#2f6de5');});
        }
      }else{
        const b=objectBounds(o);html+=`<rect x="${b.x-7/z}" y="${b.y-7/z}" width="${b.right-b.x+14/z}" height="${b.bottom-b.y+14/z}" rx="${4/z}" fill="none" stroke="#2f6de5" stroke-width="${1/z}" stroke-dasharray="${4/z} ${3/z}" pointer-events="none"/>`;
        if(o.type==='platform'&&this.selected.size===1&&!o.locked&&o.rotation===0)html+=handle({x:o.x+o.width/2,y:o.y+o.height/2},'data-handle="resize"','#2f6de5',true);
      }
    }
    if(this.draft?.type==='line'){
      const d=this.draft,points=clone(d.points);
      if(this.pointer&&points.length){if(this.tool==='curve'&&d.control)points.push({...this.pointer,control:d.control});else points.push({...this.pointer});}
      if(points.length>1)html+=`<g opacity=".75" pointer-events="none">${objectMarkup({type:'line',id:'layout-draft',visible:true,...this.style,points})}</g>`;
      for(const p of d.points)html+=handle(p,'pointer-events="none"');
      if(d.control){html+=dotted(d.points.at(-1),d.control);if(this.pointer)html+=dotted(d.control,this.pointer);html+=handle(d.control,'pointer-events="none"','#b186ca',true);}
    }
    if(this.draft?.type==='platform'&&this.pointer){const a=this.draft.start,b=this.pointer;html+=objectMarkup(createObject('platform',{x:(a.x+b.x)/2,y:(a.y+b.y)/2,width:Math.max(8,Math.abs(a.x-b.x)),height:Math.max(8,Math.abs(a.y-b.y)),name:'',fill:'#e9edf4'}));}
    if(this.draft?.type==='text'&&this.pointer)html+=objectMarkup(createObject('text',{...this.draft.object,...this.pointer}));
    for(const guide of this.snap?.guides||[])html+=`<path d="M ${guide.a.x} ${guide.a.y} L ${guide.b.x} ${guide.b.y}" fill="none" stroke="#77a4df" stroke-width="${1/z}" stroke-dasharray="${5/z} ${4/z}" pointer-events="none"/>`;
    if(this.snap?.snapped)html+=`<circle cx="${this.snap.x}" cy="${this.snap.y}" r="${8/z}" fill="none" stroke="#42aa91" stroke-width="${1.5/z}" pointer-events="none"/><path d="M ${this.snap.x-12/z} ${this.snap.y} h ${24/z} M ${this.snap.x} ${this.snap.y-12/z} v ${24/z}" stroke="#42aa91" stroke-width="${1/z}" pointer-events="none"/>`;
    if(this.gesture?.kind==='marquee'){const {start,end}=this.gesture;html+=`<rect x="${Math.min(start.x,end.x)}" y="${Math.min(start.y,end.y)}" width="${Math.abs(end.x-start.x)}" height="${Math.abs(end.y-start.y)}" fill="#2f6de510" stroke="#2f6de5" stroke-width="${1/z}" pointer-events="none"/>`;}
    this.overlay.innerHTML=html;
  }
  snapped(p,e,options={}){return snapPoint(this.project,p,{tolerance:10/this.scale,disabled:e.altKey,draft:this.draft?.points||[],...options});}
  status(message){const count=this.draft?.points?.length||0;this.callbacks.onStatus?.({tool:this.tool,count,pending:!!this.draft?.control,message,canFinish:this.draft?.type==='line'&&count>=2&&!this.draft.control});}
  startText(object){this.setTool('text');this.draft={type:'text',object};this.status();}
  down(e){
    if(e.button!==0&&e.button!==2)return;e.preventDefault();this.svg.focus({preventScroll:true});const raw=this.position(e);this.svg.setPointerCapture(e.pointerId);
    if(this.gesture)return;
    if(e.button===2){this.gesture={kind:'pan',client:{x:e.clientX,y:e.clientY},view:{...this.view}};this.svg.classList.add('panning');return;}
    if(this.tool==='line'||this.tool==='curve'){
      const q=this.snapped(raw,e,{anchor:this.draft?.points.at(-1),constrain:e.shiftKey});this.pointer=q;
      if(!this.draft)this.draft={type:'line',points:[]};
      if(this.tool==='line')this.lineClicks=[...(this.lineClicks||[]).slice(-1),{draft:this.draft,count:this.draft.points.length}];
      if(!this.draft.points.length)this.draft.points.push({x:q.x,y:q.y});
      else if(this.tool==='curve'&&!this.draft.control)this.draft.control={x:q.x,y:q.y};
      else{
        if(distance(q,this.draft.points.at(-1))<.1){if(this.tool!=='line')this.callbacks.onMessage?.('下一个顶点需要离开上一点');return;}
        if(this.draft.points.length>=128){this.callbacks.onMessage?.('每条线最多 128 个顶点，请先完成');return;}
        this.draft.points.push({x:q.x,y:q.y,...(this.draft.control?{control:this.draft.control}:{})});delete this.draft.control;
      }
      this.snap=q;this.drawOverlay();this.status();return;
    }
    if(this.tool==='platform'){
      const q=this.snapped(raw,e);this.pointer=q;
      if(this.draft){this.finishPlatform(q,e.shiftKey);return;}
      this.draft={type:'platform',start:q};this.gesture={kind:'platform',client:{x:e.clientX,y:e.clientY}};this.drawOverlay();this.status();return;
    }
    if(this.tool==='text'&&this.draft){const q=this.snapped(raw,e);this.add(createObject('text',{...this.draft.object,x:q.x,y:q.y,id:uid()}),e.shiftKey);return;}
    const handle=e.target.closest('[data-handle]'),id=e.target.closest('[data-object]')?.dataset.object;
    if(handle&&this.selected.size===1){
      const source=this.project.objects.find(o=>this.selected.has(o.id));if(source.locked)return;const index=Number(handle.dataset.index);this.nodeIndex=handle.dataset.handle==='node'?index:null;
      this.gesture={kind:handle.dataset.handle,index,source:clone(source),start:raw,client:{x:e.clientX,y:e.clientY}};this.callbacks.onNode?.(this.nodeIndex);return;
    }
    if(id){
      const source=this.project.objects.find(o=>o.id===id);
      if(e.shiftKey){const ids=new Set(this.selected);ids.has(id)?ids.delete(id):ids.add(id);this.select(ids);return;}
      if(!this.selected.has(id))this.select([id]);
      if(!source.locked){const sources=this.project.objects.filter(o=>this.selected.has(o.id)&&!o.locked);this.gesture={kind:'objects',sources:clone(sources),start:raw,client:{x:e.clientX,y:e.clientY}};}
    }else{const previous=e.shiftKey?[...this.selected]:[];if(!e.shiftKey)this.select([]);this.gesture={kind:'marquee',start:raw,end:raw,previous,client:{x:e.clientX,y:e.clientY}};}
  }
  doubleClick(e){
    if(e.button!==0)return;
    if(this.tool==='line'&&this.draft?.type==='line'){
      e.preventDefault();const d=this.draft,clicks=this.lineClicks||[];this.lineClicks=[];
      // PointerEvent.detail may be zero. Roll back both presses in this double
      // click so a small cursor movement still produces just one final vertex.
      if(clicks.length===2&&clicks.every(click=>click.draft===d))d.points.splice(clicks[0].count);
      const q=this.snapped(this.position(e),e,{anchor:d.points.at(-1),constrain:e.shiftKey});this.pointer=q;this.snap=q;
      if(!d.points.length||distance(q,d.points.at(-1))>=.1){
        if(d.points.length>=128){this.callbacks.onMessage?.('每条线最多 128 个顶点，请先完成');this.drawOverlay();this.status();return;}
        d.points.push({x:q.x,y:q.y});
      }
      this.finish(e.shiftKey);this.drawOverlay();this.status();return;
    }
    if(this.tool!=='select'||e.target.closest('[data-handle]'))return;
    const raw=this.position(e),id=e.target.closest('[data-object]')?.dataset.object;
    // Pointer capture can retarget dblclick to the root SVG after pointerup.
    const source=this.project.objects.find(o=>o.id===id)||this.project.objects.filter(o=>o.type==='line'&&o.visible&&!o.locked).map(o=>({o,hit:nearestSegment(o,raw)})).filter(v=>v.hit.distance<=9/this.scale).sort((a,b)=>a.hit.distance-b.hit.distance)[0]?.o;
    if(source?.type!=='line'||source.locked)return;
    const hit=nearestSegment(source,raw);if(hit.t<=.02||hit.t>=.98||source.points.length>=128)return;
    e.preventDefault();this.cancelGesture();this.selected=new Set([source.id]);
    if(this.callbacks.onChange?.(this.project.objects.map(o=>o.id===source.id?splitSegment(o,hit.index,hit.t):o))===false)return;
    this.nodeIndex=hit.index;this.draw();this.callbacks.onSelect?.([source.id]);
  }
  move(e){
    const raw=this.position(e),g=this.gesture;this.callbacks.onPointer?.(raw);
    if(g?.kind==='pan'){const unit=this.view.width/this.svg.clientWidth;this.view.x=g.view.x-(e.clientX-g.client.x)*unit;this.view.y=g.view.y-(e.clientY-g.client.y)*unit;this.applyView();return;}
    if(g&&g.kind!=='platform'){
      g.moved ||= Math.hypot(e.clientX-g.client.x,e.clientY-g.client.y)>3;if(!g.moved)return;
      if(g.kind==='marquee'){g.end=raw;this.drawOverlay();return;}
      const ids=g.sources?.map(o=>o.id)||[g.source.id];let target;
      if(g.kind==='objects'){
        const first=g.sources[0],anchor=first.type==='line'?first.points[0]:first,candidate={x:anchor.x+raw.x-g.start.x,y:anchor.y+raw.y-g.start.y};target=this.snapped(candidate,e,{excludeIds:ids,anchor,constrain:e.shiftKey});
        this.preview=new Map(g.sources.map(o=>[o.id,translateObject(o,target.x-anchor.x,target.y-anchor.y)]));
      }else if(g.kind==='resize'){
        target=this.snapped(raw,e,{excludeIds:ids});const o=g.source,left=o.x-o.width/2,top=o.y-o.height/2,width=Math.max(8,Math.min(4000,target.x-left)),height=Math.max(8,Math.min(2000,target.y-top));this.preview=new Map([[o.id,{...o,x:left+width/2,y:top+height/2,width,height}]]);
      }else{
        const o=g.source,anchor=g.kind==='node'?o.points[g.index?g.index-1:1]:o.points[g.index];target=this.snapped(raw,e,{excludeIds:ids,anchor,constrain:e.shiftKey});
        const next=g.kind==='node'?moveNode(o,g.index,target):clone(o);if(g.kind==='control')next.points[g.index].control={x:target.x,y:target.y};this.preview=new Map([[o.id,next]]);
      }
      this.snap=target;this.draw();return;
    }
    if(this.tool!=='select'){
      this.snap=this.snapped(raw,e,{anchor:this.draft?.points?.at(-1),constrain:e.shiftKey&&['line','curve'].includes(this.tool)});this.pointer=this.snap;this.drawOverlay();
    }
  }
  up(e){
    const g=this.gesture;if(!g||e.button!==(g.kind==='pan'?2:0))return;this.gesture=null;
    if(g.kind==='pan'){this.svg.classList.remove('panning');return;}
    if(g.kind==='platform'){if(Math.hypot(e.clientX-g.client.x,e.clientY-g.client.y)>4)this.finishPlatform(this.snapped(this.position(e),e),e.shiftKey);return;}
    if(g.kind==='marquee'){
      const a=g.start,b=g.end,ids=this.project.objects.filter(o=>{if(!o.visible)return false;const r=objectBounds(o);return r.x>=Math.min(a.x,b.x)&&r.right<=Math.max(a.x,b.x)&&r.y>=Math.min(a.y,b.y)&&r.bottom<=Math.max(a.y,b.y);}).map(o=>o.id);this.select([...g.previous,...ids]);return;
    }
    if(this.preview){const objects=this.project.objects.map(o=>this.preview.get(o.id)||o);this.preview=null;this.snap=null;this.callbacks.onChange?.(objects);this.callbacks.onSelect?.([...this.selected]);this.draw();}
  }
  cancelGesture(){this.gesture=null;this.preview=null;this.snap=null;this.lineClicks=[];this.svg.classList.remove('panning');if(this.project)this.draw();}
  finishPlatform(q,repeat){const a=this.draft.start,width=Math.abs(q.x-a.x),height=Math.abs(q.y-a.y);if(width<8||height<8){this.callbacks.onMessage?.('站台长宽至少为 8，请拉开距离');return;}this.add(createObject('platform',{x:(q.x+a.x)/2,y:(q.y+a.y)/2,width,height,name:`${this.project.objects.filter(o=>o.type==='platform').length+1} 站台`}),repeat);}
  add(object,repeat=false){
    const error=projectError({...this.project,objects:[...this.project.objects,object]});if(error){this.callbacks.onMessage?.(error);return false;}
    if(this.callbacks.onChange?.([...this.project.objects,object])===false)return false;
    const text=this.draft?.object;this.draft=null;this.snap=null;this.selected=new Set([object.id]);this.nodeIndex=null;
    if(!repeat)this.setTool('select');else if(this.tool==='text')this.draft={type:'text',object:text};
    this.draw();this.status();this.callbacks.onSelect?.([...this.selected]);return true;
  }
  finish(repeat=false){
    const d=this.draft;if(!d||d.type!=='line'||d.points.length<2)return;
    if(d.control){this.callbacks.onMessage?.('请先点击曲线终点，或按 Backspace 撤回控制点');return;}
    this.add(createObject('line',{...clone(this.style),points:clone(d.points),name:`线路 ${this.project.objects.filter(o=>o.type==='line').length+1}`}),repeat);
  }
  backspace(){if(this.draft?.type==='line'){this.lineClicks=[];if(this.draft.control)delete this.draft.control;else this.draft.points.pop();if(!this.draft.points.length)this.draft=null;this.snap=null;this.drawOverlay();this.status();return true;}return false;}
  escape(){this.cancelGesture();this.draft=null;this.setTool('select');this.select([]);}
}
