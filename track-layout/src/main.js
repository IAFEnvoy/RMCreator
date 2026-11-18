import '../../shared/theme.css';
import { appSwitcher } from '../../shared/shell.js';
import { LAYOUT_STORAGE_KEYS } from '../../shared/storage-keys.js';
import './style.css';
import { createIcons, MousePointer2, PenLine, Spline, RectangleHorizontal, Type, Plus, Minus, Magnet, Grid2x2, Scan, Undo2, Redo2, Save, FolderOpen, FilePlus2, Download, ChevronDown, X, Check, Trash2, Copy, Eye, EyeOff, LockKeyhole, UnlockKeyhole, CircleHelp, RotateCcw, FileJson, Image, Layers3, ArrowRight, SlidersHorizontal } from 'lucide';
import { clone, uid, blankProject, exampleProject, createObject, readProject, projectError, PALETTE, LINE_STYLES, mix, distance, splitSegment, moveNode } from './model.js';
import { LayoutEditor } from './editor.js';
import { LayoutFiles, filename } from './files.js';
import { escapeHTML as esc, exportSVG } from './render.js';

const icons={MousePointer2,PenLine,Spline,RectangleHorizontal,Type,Plus,Minus,Magnet,Grid2x2,Scan,Undo2,Redo2,Save,FolderOpen,FilePlus2,Download,ChevronDown,X,Check,Trash2,Copy,Eye,EyeOff,LockKeyhole,UnlockKeyhole,CircleHelp,RotateCcw,FileJson,Image,Layers3,ArrowRight,SlidersHorizontal};
const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
const refresh=()=>createIcons({icons,attrs:{'stroke-width':1.7}});
const $=s=>document.querySelector(s);
let files;
try{files=new LayoutFiles(localStorage);}catch{const cache=new Map();files=new LayoutFiles({getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)});files.warning='浏览器存储不可用，请下载 JSON 保存作品。';}
let state=files.current.project,undoStack=[],redoStack=[],dirty=false,saveTimer,toastTimer,panel='object',trashView=false;
const tools=[['select','选择','mouse-pointer-2','V'],['line','折线','pen-line','L'],['curve','曲线','spline','C'],['platform','站台','rectangle-horizontal','R'],['text','文字','type','T']];
$('#app').innerHTML=`
  <header class="workshop-header">${appSwitcher('layout')}<button id="project-menu" class="project-name" aria-label="配线方案管理"><span></span>${icon('chevron-down')}</button><div class="header-spacer"></div><span id="save-status" role="status" title="保存在当前浏览器">${icon('check')}<span>已保存</span></span><div class="history-buttons"><button id="undo" class="icon-btn" title="撤销 Ctrl+Z" aria-label="撤销">${icon('undo-2')}</button><button id="redo" class="icon-btn" title="重做 Ctrl+Shift+Z" aria-label="重做">${icon('redo-2')}</button></div><button id="save" class="icon-btn" title="保存 Ctrl+S" aria-label="保存方案">${icon('save')}</button><button id="files" class="button">${icon('folder-open')}<span>我的配线</span></button><details class="export-menu"><summary class="button primary">${icon('download')}导出${icon('chevron-down')}</summary><nav aria-label="导出格式"><button data-export="svg">${icon('pen-line')}矢量图 SVG</button><button data-export="png">${icon('image')}图片 PNG</button><button data-export="json">${icon('file-json')}JSON</button></nav></details><button id="help" class="icon-btn" title="操作帮助" aria-label="操作帮助">${icon('circle-help')}</button></header>
  <main class="workshop-body">
    <aside class="left-panel panel"><div class="workshop-title"><h1>配线工坊</h1></div><section class="tool-section"><div class="section-title">绘制工具</div><div class="drawing-tools">${tools.map(([id,name,ico,key])=>`<button data-tool="${id}" title="${name} ${key}" ${id==='select'?'class="active"':''}>${icon(ico)}<span>${name}</span><kbd>${key}</kbd></button>`).join('')}</div></section><section class="tool-section style-section"><div class="section-title">新线条样式<span id="current-color-name">BLUE</span></div><div class="palette">${PALETTE.map(c=>`<button data-color="${c}" style="--swatch:${c}" aria-label="线条颜色 ${c}" title="${c}"></button>`).join('')}<label class="custom-color" title="自定义颜色">${icon('plus')}<input type="color" id="drawing-color" value="#2f6de5" aria-label="新线条自定义颜色"></label></div><div class="style-row"><label>线宽<select id="drawing-width" aria-label="新线条粗细">${[2,3,4,5,6,8,10].map(w=>`<option value="${w}" ${w===5?'selected':''}>${w} px</option>`).join('')}</select></label><label>线型<select id="drawing-dash" aria-label="新线条线型">${LINE_STYLES.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label></div></section><section class="objects-section"><div class="objects-heading"><div class="section-title">画布对象<span id="object-count"></span></div><button id="new" class="icon-btn" title="新建配线方案" aria-label="新建配线方案">${icon('file-plus-2')}</button></div><div id="object-list"></div></section><div class="left-footer"><button id="examples" class="button full">${icon('layers-3')}载入示例</button></div></aside>
    <section class="canvas-panel panel"><div class="canvas-toolbar"><div class="view-title"><span class="live-dot"></span>平面配线<span class="view-separator">/</span><span id="diagram-name"></span></div><div class="canvas-controls"><button id="toggle-snap" class="icon-btn" title="吸附 · Alt 临时关闭" aria-label="几何吸附">${icon('magnet')}</button><button id="toggle-grid" class="icon-btn" title="参考网格" aria-label="参考网格">${icon('grid-2x2')}</button><span></span><button id="fit" class="icon-btn" title="适应画布 F" aria-label="适应画布">${icon('scan')}</button></div></div><div class="canvas-stage"><svg id="drawing-canvas" role="img" aria-label="可交互的平面配线设计画布" tabindex="0" preserveAspectRatio="none"></svg><div class="canvas-heading"><strong id="canvas-title"></strong></div><div id="drawing-hint" class="drawing-hint" hidden><span></span><button id="finish-line">完成线条 ↵</button><button id="cancel-drawing" class="icon-btn" aria-label="取消绘制">${icon('x')}</button></div><div class="canvas-bottom"><div class="zoom-control"><button id="zoom-out" class="icon-btn" aria-label="缩小">${icon('minus')}</button><button id="zoom-value" title="适应画布">100%</button><button id="zoom-in" class="icon-btn" aria-label="放大">${icon('plus')}</button></div></div></div><footer class="canvas-status"><span><i></i><span id="mode-status">选择</span></span><span id="pointer-status">X 0 · Y 0</span></footer></section>
    <aside class="right-panel panel"><div class="inspector-tabs" role="tablist" aria-label="设置范围"><button role="tab" data-panel="object" aria-selected="true">${icon('sliders-horizontal')}对象属性</button><button role="tab" data-panel="canvas" aria-selected="false">${icon('grid-2x2')}画布设置</button></div><div id="inspector"></div></aside>
  </main><div id="toast" role="status" hidden></div><div id="modal-root"></div><input id="file-input" type="file" accept=".json,application/json" hidden>`;
// Keep icon imports explicit so the new workshop loads independently of Three.js.
const editor=new LayoutEditor($('#drawing-canvas'),{
  onChange:objects=>commit(()=>state.objects=objects),onSelect:()=>{renderObjects();renderInspector();},onNode:()=>renderInspector(),
  onTool:tool=>{document.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool));});},
  onMessage:toast,onStatus:renderStatus,onZoom:zoom=>$('#zoom-value').textContent=`${zoom}%`,onPointer:p=>$('#pointer-status').textContent=`X ${Math.round(p.x)} · Y ${Math.round(p.y)}`,
});
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);}
function currentObjects(){return state.objects.filter(o=>editor.selected.has(o.id));}
function updateHeader(){
  $('#project-menu span').textContent=files.current.title;$('#project-menu').classList.toggle('unsaved',dirty);document.title=`${files.current.title} · 配线工坊 · RMCreator`;
  $('#diagram-name').textContent=state.name;$('#canvas-title').textContent=state.name;$('.canvas-heading').hidden=!state.settings.title;
  $('#undo').disabled=!undoStack.length;$('#redo').disabled=!redoStack.length;
  for(const key of ['grid','snap']){const b=$(`#toggle-${key}`);b.classList.toggle('active',state.settings[key]);b.setAttribute('aria-pressed',String(state.settings[key]));}
  document.querySelectorAll('[data-color]').forEach(b=>{b.classList.toggle('active',b.dataset.color===editor.style.color);b.setAttribute('aria-pressed',String(b.dataset.color===editor.style.color));});
  $('#drawing-color').value=editor.style.color;$('#current-color-name').textContent=editor.style.color.toUpperCase();
}
function render(){editor.setProject(state);updateHeader();renderObjects();renderInspector();refresh();}
function commit(action){const before=clone(state);try{action();const error=projectError(state);if(error)throw new Error(error);}catch(error){state=before;editor.preview=null;render();toast(error.message);return false;}
  if(JSON.stringify(before)!==JSON.stringify(state)){undoStack.push(before);if(undoStack.length>80)undoStack.shift();redoStack=[];scheduleSave();}
  render();return true;
}
function scheduleSave(){dirty=true;clearTimeout(saveTimer);$('#save-status').innerHTML=`${icon('save')}<span>正在保存…</span>`;saveTimer=setTimeout(()=>save(),600);}
function save(notify=false){clearTimeout(saveTimer);try{files.save(state);dirty=false;$('#save-status').innerHTML=`${icon('check')}<span>已保存</span>`;updateHeader();refresh();if(notify)toast('已保存');return true;}catch(error){dirty=true;$('#save-status').innerHTML='<span>未保存 · 请下载 JSON</span>';toast(error.message);return false;}}
function activate(file){clearTimeout(saveTimer);editor.escape();state=file.project;dirty=false;undoStack=[];redoStack=[];closeModal();render();editor.fit();}
function safely(action){try{action();}catch(error){toast(error.message);}}
function undo(){editor.escape();if(!undoStack.length)return;redoStack.push(clone(state));state=undoStack.pop();render();scheduleSave();}
function redo(){editor.escape();if(!redoStack.length)return;undoStack.push(clone(state));state=redoStack.pop();render();scheduleSave();}
function renderObjects(){
  $('#object-count').textContent=state.objects.length;
  $('#object-list').innerHTML=state.objects.length?[...state.objects].reverse().map(o=>`<div class="object-row ${editor.selected.has(o.id)?'selected':''} ${!o.visible?'hidden-object':''}"><button data-select="${o.id}" class="object-select" aria-pressed="${editor.selected.has(o.id)}"><span class="object-glyph ${o.type}" style="--object-color:${o.type==='platform'?o.fill:o.color}">${icon(o.type==='line'?'spline':o.type==='platform'?'rectangle-horizontal':'type')}</span><span>${esc(o.name||o.text||'未命名对象')}</span>${o.locked?icon('lock-keyhole'):''}</button><button data-visibility="${o.id}" class="icon-btn" title="${o.visible?'隐藏':'显示'}对象" aria-label="${o.visible?'隐藏':'显示'} ${esc(o.name)}">${icon(o.visible?'eye':'eye-off')}</button></div>`).join(''):'<div class="list-empty">暂无对象</div>';
  refresh();
}
const numberField=(label,key,value,{min=-20000,max=20000,step=1}={})=>`<label class="field"><span>${label}</span><input type="number" data-property="${key}" value="${Math.round(value*1000)/1000}" min="${min}" max="${max}" step="${step}"></label>`;
const selectField=(label,key,value,options)=>`<label class="field"><span>${label}</span><select data-property="${key}">${options.map(([v,t])=>`<option value="${v}" ${value===v?'selected':''}>${t}</option>`).join('')}</select></label>`;
const colorField=(label,key,value)=>`<label class="field color-field"><span>${label}</span><div><input type="color" data-property="${key}" value="${value}"><span>${value.toUpperCase()}</span></div></label>`;
function renderInspector(){
  document.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.panel===panel)));
  const root=$('#inspector'),objects=currentObjects();
  if(panel==='canvas'){
    root.innerHTML=`<section class="property-section"><div class="section-title">方案信息</div><label class="field"><span>图纸名称</span><input id="diagram-title" value="${esc(state.name)}" maxlength="100"></label></section><section class="property-section"><div class="section-title">显示与吸附</div>${[['grid','参考网格'],['snap','几何吸附'],['names','站台名称'],['title','图纸标题']].map(([k,t])=>`<label class="switch-row"><span>${t}</span><input type="checkbox" role="switch" data-setting="${k}" ${state.settings[k]?'checked':''}></label>`).join('')}${colorField('画布底色','background',state.settings.background)}</section><section class="property-section"><div class="section-title">图纸概况</div><div class="stat-grid">${[['line','线条'],['platform','站台'],['text','标注']].map(([type,name])=>`<div><strong>${state.objects.filter(o=>o.type===type).length}</strong><span>${name}</span></div>`).join('')}</div></section><section class="property-section"><div class="section-title">导出</div><button class="button full" data-export="svg">${icon('download')}导出 SVG</button><button class="button full secondary-export" data-export="png">${icon('image')}导出 PNG</button></section>`;
  }else if(!objects.length){
    root.innerHTML='<div class="empty-inspector">未选择对象</div>';
  }else if(objects.length>1){
    const lines=objects.filter(o=>o.type==='line');root.innerHTML=`<div class="selection-card">${icon('layers-3')}<div><strong>已选 ${objects.length} 个对象</strong></div></div>${lines.length?`<section class="property-section"><div class="section-title">批量样式</div>${colorField('线条颜色','color',lines[0].color)}${numberField('线条粗细','width',lines[0].width,{min:1,max:30})}${selectField('线型','dash',lines[0].dash,LINE_STYLES)}</section>`:''}${objectActions(objects)}`;
  }else{
    const o=objects[0],labels={line:'线条',platform:'站台',text:'文字标注'};
    root.innerHTML=`<div class="selection-card"><span class="selection-symbol" style="color:${o.color}">${icon(o.type==='line'?'spline':o.type==='platform'?'rectangle-horizontal':'type')}</span><div><strong>${labels[o.type]}</strong>${o.type==='line'?`<span>${o.points.length} 个顶点</span>`:''}</div>${o.locked?icon('lock-keyhole'):''}</div><section class="property-section"><div class="section-title">基本属性</div><label class="field"><span>对象名称</span><input data-property="name" value="${esc(o.name)}" maxlength="100"></label>${o.type==='line'?lineProperties(o):o.type==='platform'?platformProperties(o):textProperties(o)}</section>${o.type==='line'?pathProperties(o):''}${objectActions(objects)}`;
  }
  refresh();
}
function lineProperties(o){return `${colorField('线条颜色','color',o.color)}<div class="field-grid">${numberField('粗细（px）','width',o.width,{min:1,max:30,step:.5})}${selectField('线型','dash',o.dash,LINE_STYLES)}</div>${selectField('方向箭头','arrow',o.arrow,[['none','不显示'],['start','起点'],['end','终点'],['both','两端']])}`;}
function platformProperties(o){return `${colorField('填充颜色','fill',o.fill)}${colorField('边框颜色','color',o.color)}<div class="field-grid">${numberField('长度','width',o.width,{min:8,max:4000})}${numberField('宽度','height',o.height,{min:8,max:2000})}${numberField('X','x',o.x)}${numberField('Y','y',o.y)}${numberField('角度（°）','rotation',o.rotation,{min:-360,max:360})}${numberField('圆角','radius',o.radius,{min:0,max:200})}</div>`;}
function textProperties(o){return `<label class="field"><span>文字内容</span><textarea data-property="text" maxlength="500" rows="3">${esc(o.text)}</textarea></label>${colorField('文字颜色','color',o.color)}<div class="field-grid">${numberField('字号','fontSize',o.fontSize,{min:8,max:120})}${numberField('角度（°）','rotation',o.rotation,{min:-360,max:360})}${numberField('X','x',o.x)}${numberField('Y','y',o.y)}</div>`;}
function pathProperties(o){
  const selected=editor.nodeIndex,p=o.points[selected];
  return `<section class="property-section"><div class="section-title">路径顶点<span>${o.points.length}</span></div><div class="path-list">${o.points.map((p,i)=>`<div class="path-row"><button data-node="${i}" class="${selected===i?'active':''}"><b>${i+1}</b><span>${i===0?'起点':i===o.points.length-1?'终点':'顶点'}</span><small>${Math.round(p.x)}, ${Math.round(p.y)}</small></button>${i?`<button data-segment="${i}" class="segment-mode" title="切换为${p.control?'直线':'曲线'}">${icon(p.control?'spline':'pen-line')}</button>`:''}</div>`).join('')}</div>${p?`<div class="node-coordinates"><div class="section-title">顶点 ${selected+1}<button id="delete-node" class="icon-btn" aria-label="删除选中顶点" ${o.points.length<=2?'disabled':''}>${icon('trash-2')}</button></div><div class="field-grid">${['x','y'].map(k=>`<label class="field"><span>${k.toUpperCase()}</span><input type="number" data-node-coordinate="${k}" value="${Math.round(p[k]*1000)/1000}" step="1" min="-20000" max="20000"></label>`).join('')}</div>${p.control?`<div class="section-title">曲线控制点</div><div class="field-grid">${['x','y'].map(k=>`<label class="field"><span>${k.toUpperCase()}</span><input type="number" data-control-coordinate="${k}" value="${Math.round(p.control[k]*1000)/1000}" step="1" min="-20000" max="20000"></label>`).join('')}</div>`:''}</div>`:''}<div class="path-actions"><button id="add-node" class="button">${icon('plus')}添加顶点</button><button id="reverse-line" class="button">${icon('rotate-ccw')}反转路径</button></div></section>`;
}
function objectActions(objects){return `<section class="property-section object-actions"><button id="duplicate" class="button">${icon('copy')}复制</button><button id="lock" class="button">${icon(objects.every(o=>o.locked)?'unlock-keyhole':'lock-keyhole')}${objects.every(o=>o.locked)?'解锁':'锁定'}</button><button id="delete" class="button danger">${icon('trash-2')}删除对象</button></section>`;}
function renderStatus(status){
  const hints={line:status.count?'添加顶点 · 双击 / Enter 完成':'选择起点',curve:!status.count?'选择起点':status.pending?'选择终点':'选择控制点',platform:editor?.draft?'选择对角点':'拖动或选择两点',text:'选择文字位置'};
  const name=tools.find(([id])=>id===status.tool)?.[1]||'';
  $('#mode-status').textContent=status.message||`${name}${status.count?` · ${status.count} 个顶点`:''}`;
  const hint=$('#drawing-hint');hint.hidden=status.tool==='select';hint.querySelector('span').textContent=hints[status.tool]||'';$('#finish-line').hidden=!['line','curve'].includes(status.tool);$('#finish-line').disabled=!status.canFinish;
}
function modal(html){editor.cancelGesture();$('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${html}<button data-close class="icon-btn modal-close" aria-label="关闭">${icon('x')}</button></section></div>`;refresh();$('#modal-root input, #modal-root button')?.focus();}
function closeModal(){$('#modal-root').innerHTML='';}
function showNew(preset='blank'){
  modal(`<h2 id="modal-title">新建配线方案</h2><form id="new-form"><label class="field"><span>方案名称</span><input name="title" value="${esc(files.unique(preset==='station'?'中央站配线示意':preset==='depot'?'车辆基地配线':'未命名配线'))}" maxlength="100" required></label><label class="field"><span>初始内容</span><select name="template">${[['blank','空白画布'],['station','车站配线 · 站前渡线与折返线'],['depot','车辆基地 · 扇形存车线']].map(([v,t])=>`<option value="${v}" ${v===preset?'selected':''}>${t}</option>`).join('')}</select></label><div class="modal-actions"><button type="button" data-close class="button">取消</button><button type="submit" class="button primary">${icon('plus')}创建方案</button></div></form>`);
}
function showFiles(){
  if(dirty&&!save())return;
  const list=files.list(trashView);
  modal(`<h2 id="modal-title">我的配线</h2><div class="file-toolbar"><div class="file-tabs"><button data-file-tab="active" class="${!trashView?'active':''}">方案 ${files.list().length}</button><button data-file-tab="trash" class="${trashView?'active':''}">回收站 ${files.list(true).length}</button></div><button id="modal-new" class="button primary">${icon('plus')}新建</button><button id="import-json" class="icon-btn" aria-label="打开 JSON" title="打开 JSON">${icon('folder-open')}</button></div><div class="file-list">${list.length?list.map(f=>`<article class="file-row"><span class="file-icon">${icon('pen-line')}</span><div><strong>${esc(f.title)}</strong><small>${f.project.objects.length} 个对象 · ${new Date(f.updatedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}${f.id===files.current.id?' · 当前':''}</small></div><div class="file-actions">${trashView?`<button class="button" data-file-restore="${f.id}">恢复</button>`:`<button class="button" data-file-open="${f.id}">${f.id===files.current.id?'继续编辑':'打开'}</button><button class="icon-btn" data-file-rename="${f.id}" title="重命名" aria-label="重命名 ${esc(f.title)}">${icon('pen-line')}</button><button class="icon-btn" data-file-copy="${f.id}" title="另存副本" aria-label="复制 ${esc(f.title)}">${icon('copy')}</button><button class="icon-btn" data-file-trash="${f.id}" title="移入回收站" aria-label="移入回收站 ${esc(f.title)}">${icon('trash-2')}</button>`}</div></article>`).join(''):'<div class="list-empty">回收站是空的</div>'}</div>`);
}
function showRename(id){const f=files.list().find(f=>f.id===id);modal(`<h2 id="modal-title">重命名配线方案</h2><form id="rename-form" data-file-id="${id}"><label class="field"><span>方案名称</span><input name="title" value="${esc(f.title)}" maxlength="100" required></label><div class="modal-actions"><button type="button" data-close class="button">取消</button><button type="submit" class="button primary">保存名称</button></div></form>`);}
function showText(){modal(`<h2 id="modal-title">添加文字标注</h2><form id="text-form"><label class="field"><span>文字内容</span><textarea name="text" rows="3" maxlength="500" required placeholder="输入车站、股道或方向名称"></textarea></label><div class="modal-actions"><button type="button" data-close class="button">取消</button><button type="submit" class="button primary">在画布放置 ${icon('arrow-right')}</button></div></form>`);$('#text-form textarea').focus();}
function showHelp(){modal(`<h2 id="modal-title">操作帮助</h2><div class="help-items"><p><b>折线 L</b>依次点击顶点，双击放置终点并完成，也可按 Enter 完成。Shift 可约束水平、垂直和 45°。</p><p><b>曲线 C</b>按「起点 → 控制点 → 终点」绘制，之后继续「控制点 → 终点」。Backspace 撤回一步。</p><p><b>站台 R</b>拖动拉框，或点击两个对角点。选中后可调整大小、颜色和角度。</p><p><b>编辑 V</b>拖动对象移动，拖动圆点调整顶点，拖动紫色方块调整曲线。双击线段加点，右侧切换某段为直线或曲线。</p><p><b>吸附</b>靠近已有线条、顶点或网格自动吸附；Alt 临时关闭。Shift 点击 / 框选多选，右键拖动画布，滚轮缩放。</p></div><div class="shortcut-grid"><span>文字<kbd>T</kbd></span><span>适应画布<kbd>F</kbd></span><span>取消<kbd>Esc</kbd></span><span>撤销<kbd>Ctrl Z</kbd></span><span>复制<kbd>Ctrl D</kbd></span><span>删除<kbd>Delete</kbd></span><span>连续放置<kbd>Shift</kbd></span></div><button class="button primary full" data-close>关闭</button>`);}
function removeSelection(){if(!editor.selected.size)return;const ids=new Set(currentObjects().filter(o=>!o.locked).map(o=>o.id));if(!ids.size){toast('请先解锁对象');return;}commit(()=>state.objects=state.objects.filter(o=>!ids.has(o.id)));editor.select([]);}
function duplicateSelection(){const source=currentObjects();if(!source.length)return;const copies=source.map(o=>{const c=clone(o);c.id=uid();c.locked=false;c.name=(c.name+' 副本').slice(0,100);if(c.type==='line')for(const p of c.points){p.x+=20;p.y+=20;if(p.control){p.control.x+=20;p.control.y+=20;}}else{c.x+=20;c.y+=20;}return c;});if(commit(()=>state.objects.push(...copies)))editor.select(copies.map(o=>o.id));}
function deleteNode(){const [o]=currentObjects(),i=editor.nodeIndex;if(o?.type!=='line'||o.locked||i===null||o.points.length<=2)return;commit(()=>{o.points.splice(i,1);if(i===0)delete o.points[0].control;});editor.nodeIndex=null;renderInspector();}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
async function exportFile(format){
  document.querySelectorAll('.export-menu[open]').forEach(el=>el.open=false);
  const title=files.current.title;
  if(format==='json'){download(new Blob([JSON.stringify(state)],{type:'application/json'}),filename(title));toast('JSON 已导出');return;}
  const {source,width,height}=exportSVG(state),blob=new Blob([source],{type:'image/svg+xml;charset=utf-8'});
  if(format==='svg'){download(blob,filename(title,'svg'));toast('SVG 已导出');return;}
  const url=URL.createObjectURL(blob);
  try{
    const image=new window.Image();image.src=url;await image.decode();const scale=Math.min(2,6000/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.drawImage(image,0,0,width,height);
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!png)throw new Error('图片生成失败');download(png,filename(title,'png'));toast('PNG 已导出');
  }catch(error){toast(`导出失败：${error.message}`);}finally{URL.revokeObjectURL(url);}
}

document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-close')){closeModal();return;}
  if(b.dataset.tool){if(b.dataset.tool==='text')showText();else editor.setTool(b.dataset.tool);return;}
  if(b.dataset.panel){panel=b.dataset.panel;renderInspector();return;}
  if(b.dataset.color){editor.style.color=b.dataset.color;updateHeader();editor.drawOverlay();return;}
  if(b.dataset.select){panel='object';const ids=new Set(event.shiftKey?editor.selected:[]);ids.has(b.dataset.select)?ids.delete(b.dataset.select):ids.add(b.dataset.select);editor.select(ids);return;}
  if(b.dataset.visibility){commit(()=>{const o=state.objects.find(o=>o.id===b.dataset.visibility);o.visible=!o.visible;});return;}
  if(b.dataset.node!==undefined){editor.nodeIndex=Number(b.dataset.node);editor.drawOverlay();renderInspector();return;}
  if(b.dataset.segment!==undefined){const [o]=currentObjects(),i=Number(b.dataset.segment);if(o?.locked)return;commit(()=>{const p=o.points[i];if(p.control)delete p.control;else{const a=o.points[i-1],m=mix(a,p,.5),l=distance(a,p)||1;p.control={x:m.x-(p.y-a.y)/l*40,y:m.y+(p.x-a.x)/l*40};}});return;}
  if(b.dataset.export){exportFile(b.dataset.export);return;}
  if(b.dataset.fileTab){trashView=b.dataset.fileTab==='trash';showFiles();return;}
  if(b.dataset.fileOpen){safely(()=>activate(files.open(b.dataset.fileOpen)));return;}
  if(b.dataset.fileRename){showRename(b.dataset.fileRename);return;}
  if(b.dataset.fileCopy){safely(()=>{const f=files.list().find(f=>f.id===b.dataset.fileCopy);activate(files.create(f.title+' 副本',f.project));toast('副本已创建');});return;}
  if(b.dataset.fileTrash){safely(()=>{activate(files.trash(b.dataset.fileTrash));showFiles();});return;}
  if(b.dataset.fileRestore){safely(()=>{files.restore(b.dataset.fileRestore);showFiles();});return;}
  switch(b.id){
    case 'project-menu':case 'files':showFiles();break;
    case 'new':case 'modal-new':showNew();break;
    case 'examples':showNew('station');break;
    case 'import-json':$('#file-input').click();break;
    case 'save':save(true);break;
    case 'undo':undo();break;case 'redo':redo();break;
    case 'fit':case 'zoom-value':editor.fit();break;
    case 'zoom-in':editor.zoom(1.25);break;case 'zoom-out':editor.zoom(.8);break;
    case 'toggle-grid':commit(()=>state.settings.grid=!state.settings.grid);break;
    case 'toggle-snap':commit(()=>state.settings.snap=!state.settings.snap);break;
    case 'finish-line':editor.finish(event.shiftKey);break;
    case 'cancel-drawing':editor.escape();break;
    case 'help':showHelp();break;
    case 'delete':removeSelection();break;
    case 'duplicate':duplicateSelection();break;
    case 'lock':{const selected=currentObjects(),lock=!selected.every(o=>o.locked);commit(()=>selected.forEach(o=>o.locked=lock));break;}
    case 'delete-node':deleteNode();break;
    case 'add-node':{const [o]=currentObjects();if(o?.type==='line'&&!o.locked){const index=editor.nodeIndex===null?o.points.length-1:Math.min(o.points.length-1,Math.max(1,editor.nodeIndex+1));commit(()=>state.objects=state.objects.map(v=>v.id===o.id?splitSegment(o,index,.5):v));}break;}
    case 'reverse-line':{const [o]=currentObjects();if(o?.type==='line'&&!o.locked)commit(()=>{const points=o.points;o.points=[...points].reverse().map((p,i)=>{const c={x:p.x,y:p.y};if(i>0&&points[points.length-i]?.control)c.control=clone(points[points.length-i].control);return c;});});break;}
  }
});
document.addEventListener('change',event=>{
  const input=event.target;
  if(input.id==='drawing-color'){editor.style.color=input.value;updateHeader();editor.drawOverlay();return;}
  if(input.id==='drawing-width'){editor.style.width=Number(input.value);editor.drawOverlay();return;}
  if(input.id==='drawing-dash'){editor.style.dash=input.value;editor.drawOverlay();return;}
  if(input.name==='template'){$('#new-form [name="title"]').value=files.unique(input.value==='station'?'中央站配线示意':input.value==='depot'?'车辆基地配线':'未命名配线');return;}
  if(input.dataset.setting){commit(()=>state.settings[input.dataset.setting]=input.checked);return;}
  if(input.id==='diagram-title'){commit(()=>state.name=input.value.trim());return;}
  if(input.dataset.property){
    const key=input.dataset.property;if(key==='background'){commit(()=>state.settings.background=input.value);return;}
    const numeric=['width','height','x','y','rotation','radius','fontSize'].includes(key),value=numeric?Number(input.value):input.value;
    if(numeric&&(!input.value.trim()||!Number.isFinite(value))){toast('请输入有效数值');renderInspector();return;}
    commit(()=>{for(const o of currentObjects()){if(o.locked)continue;if(currentObjects().length>1&&o.type!=='line')continue;o[key]=value;}});return;
  }
  if(input.dataset.nodeCoordinate||input.dataset.controlCoordinate){const [o]=currentObjects(),index=editor.nodeIndex,value=Number(input.value);if(!o||o.locked||index===null||!input.value.trim()||!Number.isFinite(value))return;
    commit(()=>{if(input.dataset.controlCoordinate)o.points[index].control[input.dataset.controlCoordinate]=value;else state.objects=state.objects.map(v=>v.id===o.id?moveNode(o,index,{...o.points[index],[input.dataset.nodeCoordinate]:value}):v);});}
});
document.addEventListener('submit',event=>{
  const form=event.target;if(!['new-form','rename-form','text-form'].includes(form.id))return;event.preventDefault();const data=new FormData(form);
  safely(()=>{
    if(form.id==='new-form'){if(!save())return;const name=data.get('title').trim(),template=data.get('template'),p=template==='blank'?blankProject(name):exampleProject(template);p.name=name;activate(files.create(name,p));}
    if(form.id==='rename-form'){const name=data.get('title').trim();files.rename(form.dataset.fileId,name);if(form.dataset.fileId===files.current.id){commit(()=>state.name=name);save();}showFiles();}
    if(form.id==='text-form'){const text=data.get('text').trim();if(!text)throw new Error('请输入文字');closeModal();editor.startText(createObject('text',{text,name:text.split('\n')[0].slice(0,100)}));}
  });
});
$('#file-input').addEventListener('change',async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  if(file.size>5*1024*1024){toast('JSON 文件不能超过 5 MB');return;}
  try{const p=readProject(JSON.parse(await file.text()));if(!save())return;activate(files.create(file.name.replace(/\.json$/i,'')||p.name,p));toast('已打开配线方案，原方案已保留');}catch(error){toast(`无法打开：${error.message}`);}
});
document.addEventListener('keydown',event=>{
  const editing=event.target.closest('input,textarea,select,[contenteditable="true"]'),modalOpen=!!$('#modal-root').children.length,mod=event.ctrlKey||event.metaKey;
  if(event.key==='Escape'){event.preventDefault();if(modalOpen)closeModal();else editor.escape();return;}
  if(modalOpen)return;
  if(mod&&event.key.toLowerCase()==='s'){event.preventDefault();if(editing)event.target.blur();save(true);return;}
  if(editing)return;
  if(mod&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();return;}
  if(mod&&event.key.toLowerCase()==='d'){event.preventDefault();duplicateSelection();return;}
  if(mod&&event.key.toLowerCase()==='n'){event.preventDefault();showNew();return;}
  if(mod&&event.key.toLowerCase()==='o'){event.preventDefault();$('#file-input').click();return;}
  if(event.key==='Enter'){event.preventDefault();editor.finish(event.shiftKey);return;}
  if(event.key==='Backspace'||event.key==='Delete'){event.preventDefault();if(!editor.backspace()){if(editor.nodeIndex!==null)deleteNode();else removeSelection();}return;}
  if(mod||event.altKey)return;const tool=tools.find(t=>t[3].toLowerCase()===event.key.toLowerCase());
  if(tool){event.preventDefault();if(tool[0]==='text')showText();else editor.setTool(tool[0]);return;}
  if(event.key.toLowerCase()==='f'){editor.fit();return;}
  if(event.key==='+'||event.key==='=')editor.zoom(1.2);if(event.key==='-')editor.zoom(1/1.2);
});
window.addEventListener('blur',()=>editor.cancelGesture());
window.addEventListener('beforeunload',event=>{if(dirty&&!save()){event.preventDefault();event.returnValue='';}});
window.addEventListener('storage',event=>{
  if(event.key!==LAYOUT_STORAGE_KEYS.workspace)return;
  if(dirty||editor.draft||editor.gesture){toast('其他窗口已更新方案库；请下载 JSON 保留当前修改。');return;}
  safely(()=>{files=new LayoutFiles(localStorage);activate(files.current);toast('已同步其他窗口的方案');});
});
render();editor.fit();editor.status();if(files.warning)toast(files.warning);else if(!files.raw)save();
