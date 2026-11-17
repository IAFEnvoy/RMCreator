import '../../shared/theme.css';
import './style.css';
import './rmcreator.css';
import { appSwitcher } from '../../shared/shell.js';
import { icon, refreshIcons } from './icons.js';
import { facilityIcon } from './facility-icons.js';
import { StationScene } from './scene.js';
import { types, entity, defaultProject, migrateProject } from './project.js';
import { CELL_LIMIT, ZONE_KINDS, ZONE_NAMES, zoneStats, snapTrack, generateBoundaries } from './zones.js';
import { trackLayout, trainLayout } from './track.js';
import { DEFAULT_TRAIN_CARS, MAX_TRAIN_CARS, MAX_TRAIN_UNITS, TRAIN_PRESETS, TRAIN_DIMENSION_RULES, trainPreset, trainDimensions, chooseTrainPreset, editTrainDimension, validTrainDimension } from './train-presets.js';
import { TWO_POINT_TYPES, CONNECTION_TYPES, normalizeConnection, placementLimit, repeatPlacementEntity } from './placement.js';
import { isStair, stairEndpoints, editStairEndpoint } from './stair-endpoints.js';
import { connectionOpeningPaths } from './zone-openings.js';
import { trainFit, trainEditError, syncTrains, removeWithTrains } from './train-placement.js';
import { pathKnots, trackGeometry, trackPathError, syncTrackPaths, worldPoint, moveTrackKnot, splitQuadraticSegment, removeQuadraticSegment } from './track-path.js';
import { curveDrawingState } from './track-drawing.js';
import { vectorizeCells, polygonArea, pathPolygon, polygonContains } from './zone-geometry.js';
import { zonePathError, moveZoneVertices, moveZoneHandle } from './zone-path.js';
import { textError, syncText, moveText } from './text.js';
import { ProjectFiles, blankProject, projectFilename } from './project-files.js';
import { floorsTopDown, floorElevationWarnings, adjacentFloor, floorShortcut } from './floors.js';

const $ = (s) => document.querySelector(s);
let sequence = 30;
const projectFiles = new ProjectFiles({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)});
let state = projectFiles.current.project;
let selected = 'station', libraryTab = 'components', view = '3d', activeFloor = 'all', tool = 'select';
let undoStack = [], redoStack = [], isDirty = false, saveTimer, search = '', scene;
let paintKind = 'paid', paintActive = false, zoneUI = null;
let workFloor = state.floors.find(f=>f.id==='B2')?.id || state.floors[0].id;
let exportWithFooter = false, trainDraft = null;
let textDraft = null;
let filesView = 'active', filesSearch = '';
let inspectorTab = 'station', inspectorSelection = 'station';
const collapsedFloors = new Set();
let editingFloor = null;
const clone = (v) => JSON.parse(JSON.stringify(v));
const paintName = kind => ZONE_NAMES[kind] || (kind==='opening'?'区域开洞':'擦除区域');

$('#app').innerHTML = `
  <header class="app-header">
    ${appSwitcher('station')}
    <div class="header-divider"></div>
    <div class="breadcrumb"><span>我的工作空间</span>${icon('chevron-right')}<button id="project-menu" class="plain-btn" title="文件管理" aria-label="文件管理"><span id="file-title"></span>${icon('chevron-down')}</button></div>
    <div id="save-state" class="save-state">${icon('hard-drive')}<span>已保存到浏览器</span></div>
    <div class="header-actions"><button class="icon-btn" id="undo" title="撤销 Ctrl+Z" aria-label="撤销">${icon('undo-2')}</button><button class="icon-btn" id="redo" title="重做 Ctrl+Shift+Z" aria-label="重做">${icon('redo-2')}</button><button class="icon-btn" id="save-project" title="保存方案 Ctrl+S" aria-label="保存方案">${icon('save')}</button><span class="action-separator"></span><button class="button subtle" id="import">${icon('folder-open')}<span>打开方案</span></button><button class="button primary" id="export">${icon('download')}<span>导出方案</span>${icon('chevron-down')}</button><button class="avatar" id="help" title="使用帮助">${icon('circle-help')}</button></div>
  </header>
  <div class="workspace">
    <aside class="left-panel">
      <div class="project-overview"><button class="project-title" id="select-station"><span id="sidebar-name"></span>${icon('chevron-down')}</button><div class="project-meta"><div id="station-lines" class="station-lines"></div><button id="manage-lines" title="管理车站线路">线路管理</button></div></div>
      <div class="panel-tabs"><button data-library="components" class="active">${icon('blocks')}构件库</button><button data-library="layers">${icon('layers-2')}场景图层</button></div>
      <div class="library-content"><div class="search-box">${icon('search')}<input id="component-search" placeholder="搜索构件…" aria-label="搜索构件"><kbd>⌘ K</kbd></div><div id="library-body"></div></div>
      <div class="left-bottom"><button class="button" id="new-template" title="载入示例">${icon('rotate-ccw')}载入示例</button><button class="icon-btn" id="guide" title="使用帮助" aria-label="使用帮助">${icon('circle-help')}</button></div>
    </aside>
    <main class="canvas-panel">
      <div class="canvas-toolbar"><div class="view-tabs"><button data-view="3d" class="active">${icon('box')}3D 示意</button><button data-view="floor">${icon('layers-2')}分层平面</button></div><div class="floor-picker" role="group" aria-label="楼层选择"></div><div class="canvas-toolbar-right"><button class="button compact" id="camera-button">${icon('scan')}<span>等轴测视图</span>${icon('chevron-down')}</button><button class="icon-btn" id="fullscreen" title="全屏画布" aria-label="全屏画布">${icon('maximize')}</button></div></div>
      <div id="viewport" class="viewport">
        <div class="canvas-heading"><h1 id="canvas-title">上海火车站</h1><p id="canvas-subtitle">Shanghai Railway Station <span>/</span> 车站空间示意</p></div>
        <div id="paint-toolbar" class="paint-toolbar" hidden></div><div id="snap-feedback" class="snap-feedback" hidden></div>
        <div class="scene-loading"><span class="loading-icon">${icon('box')}</span><span>正在构建车站空间…</span></div>
        <div class="scene-legend"><span><i class="legend-paid"></i>付费区</span><span><i class="legend-unpaid"></i>非付费区</span><span><i class="legend-staff"></i>员工区域</span><span id="legend-lines"></span></div><div class="floor-active-label"></div>
        <div class="canvas-bottom"><div class="scale-indicator"><div></div><span>20 m</span></div><div class="scene-tools"><button data-tool="select" class="active" title="选择 V" aria-label="选择">${icon('mouse-pointer-2')}</button><button data-tool="move" title="移动构件 G" aria-label="移动构件">${icon('move')}</button><button data-tool="pan" title="平移 H" aria-label="平移">${icon('hand')}</button><i></i><button id="rotate-camera" title="旋转视角" aria-label="旋转视角">${icon('rotate-3d')}</button><button id="fit-camera" title="适应画布 F" aria-label="适应画布">${icon('scan')}</button><i></i><button id="opening-tool" title="区域开洞" aria-label="区域开洞" aria-pressed="false">${icon('scan')}<span>开洞</span></button><button id="add-text-tool" title="文字工具 T" aria-label="文字工具">${icon('type')}</button><button id="zoom-out" title="缩小" aria-label="缩小">${icon('minus')}</button><span id="zoom-value">100%</span><button id="zoom-in" title="放大" aria-label="放大">${icon('plus')}</button></div><button id="shortcuts" class="canvas-help" title="操作提示" aria-label="操作提示">${icon('keyboard')}</button></div>
      </div>
      <div class="canvas-status"><span><i></i><span id="entity-count">19 个构件</span><span class="status-sep">|</span><span id="status-selected">未选择构件</span></span><span>单位：米</span></div>
    </main>
    <aside class="right-panel">
      <div class="panel-tabs inspector-tabs" role="tablist" aria-label="设置范围">
        <button id="station-settings-tab" data-inspector="station" role="tab" aria-selected="true" aria-controls="station-settings" class="active">${icon('sliders-horizontal')}整体设置</button>
        <button id="object-properties-tab" data-inspector="object" role="tab" aria-selected="false" aria-controls="object-properties" tabindex="-1">${icon('box')}对象属性</button>
      </div>
      <section id="station-settings" class="inspector-pane" role="tabpanel" aria-labelledby="station-settings-tab" tabindex="0">
        <div id="station-settings-content"></div>
        <div class="display-settings"><div class="section-title">显示设置</div><label class="toggle-row"><span>${icon('type')}显示名称</span><input type="checkbox" data-display="names" role="switch"><i></i></label><label class="toggle-row"><span>${icon('type')}文字标注</span><input type="checkbox" data-display="texts" role="switch"><i></i></label><label class="toggle-row"><span>${icon('map-pin')}设施标记</span><input type="checkbox" data-display="markers" role="switch"><i></i></label><label class="toggle-row"><span>${icon('list-filter')}完整标记</span><input type="checkbox" data-display="fullMarkers" role="switch"><i></i></label><label class="toggle-row"><span>${icon('grid-2x2')}参考网格</span><input type="checkbox" data-display="grid" role="switch"><i></i></label><div class="display-divider"></div><label class="toggle-row exploded-toggle"><span>${icon('layers-3')}楼层分解</span><input type="checkbox" data-display="exploded" role="switch"><i></i></label></div>
      </section>
      <section id="object-properties" class="inspector-pane" role="tabpanel" aria-labelledby="object-properties-tab" tabindex="0" hidden><div id="inspector-content"></div></section>
    </aside>
  </div><div id="toast" role="status"></div><div id="modal-root"></div><input type="file" accept="application/json,.json" id="file-input" hidden>
`;

function renderLibrary() {
  document.querySelectorAll('[data-library]').forEach(b => b.classList.toggle('active', b.dataset.library === libraryTab));
  const searchInput = $('#component-search');
  searchInput.placeholder = libraryTab === 'layers' ? '搜索楼层或对象…' : '搜索构件…';
  searchInput.setAttribute('aria-label', libraryTab === 'layers' ? '搜索楼层或对象' : '搜索构件');
  if (libraryTab === 'components') {
    const filtered = Object.entries(types).filter(([, t]) => (t.name + t.en).toLowerCase().includes(search.toLowerCase()));
    $('#library-body').innerHTML = `<div class="library-section-title">区域填色</div><div class="zone-palette">${ZONE_KINDS.map(kind=>`<button data-paint="${kind}" class="zone-card ${paintActive&&paintKind===kind?'active':''}" title="钢笔绘制${ZONE_NAMES[kind]}"><i style="background:${state.zoneColors[kind]}">${icon('pen-tool')}</i><span>${ZONE_NAMES[kind]}</span></button>`).join('')}</div><div class="library-section-title">构件与标记<span>${filtered.filter(([,t])=>!['decoration','annotation'].includes(t.category)).length}</span></div><div class="component-grid">${filtered.filter(([,t])=>!['decoration','annotation'].includes(t.category)).map(([type,t])=>`<button class="component-card" data-add="${type}" title="放置${t.name}"><span class="component-preview preview-${type}">${componentArt(type)}</span><span class="component-name">${t.name}</span><span class="add-plus">+</span></button>`).join('')}</div><div class="library-section-title">文字与标注</div><button class="text-tool-card" data-add="text" title="文字工具 T">${icon('type')}<span>文字工具<small>自由文字 · T</small></span>${icon('plus')}</button><div class="library-section-title">装饰<span>${filtered.filter(([,t])=>t.category==='decoration').length}</span></div><div class="component-grid">${filtered.filter(([,t])=>t.category==='decoration').map(([type,t])=>`<button class="component-card" data-add="${type}" title="放置${t.name}"><span class="component-preview preview-${type}">${componentArt(type)}</span><span class="component-name">${t.name}</span><span class="add-plus">+</span></button>`).join('')}</div>${!filtered.length?'<div class="empty-state">没有找到匹配构件</div>':''}<button class="layer-manage-button" id="manage-floors">${icon('layers-3')}楼层与对象管理${icon('chevron-right')}</button>`;
  } else {
    renderLayerTree();
  }
  refreshIcons();
}

function renderLayerTree() {
  const query = search.trim().toLowerCase();
  const warnings = floorElevationWarnings(state.floors);
  const floors = floorsTopDown(state.floors).map(f => {
    const warning=warnings.get(f.id);
    const items = state.entities.filter(e => e.floor === f.id);
    const zoneItems=(state.zonePaths||[]).filter(p=>p.floor===f.id&&(!query||`${paintName(p.kind)} 区域 轮廓`.includes(query)));
    const matchesFloor = `${f.code} ${f.name}`.toLowerCase().includes(query);
    const matches = items.filter(e => matchesFloor || `${e.name} ${types[e.type].name}`.toLowerCase().includes(query));
    if (query && !matchesFloor && !matches.length&&!zoneItems.length) return '';
    const open = !collapsedFloors.has(f.id);
    const stats = zoneStats(state, f.id);
    return `<section class="scene-floor ${activeFloor === f.id ? 'active-floor' : ''} ${warning?'has-elevation-conflict':''}" data-scene-floor="${f.id}">
      <div class="scene-floor-header">
        <button class="icon-btn floor-expand" data-toggle-floor="${f.id}" aria-expanded="${open}" aria-label="${open ? '收起' : '展开'} ${escapeHTML(f.code)} 对象">${icon(open ? 'chevron-down' : 'chevron-right')}</button>
        <button class="scene-floor-select" data-select-floor="${f.id}" aria-pressed="${activeFloor === f.id}" title="切换到 ${escapeHTML(f.code)} · ${escapeHTML(f.name)}"><span class="scene-floor-code">${escapeHTML(f.code)}</span><span class="scene-floor-name">${escapeHTML(f.name)}<small>${f.elevation.toFixed(1)} m · ${items.length} 个对象</small></span>${floorWarningIcon(warning)}</button>
        <button class="icon-btn floor-edit ${editingFloor === f.id ? 'active' : ''}" data-edit-floor="${f.id}" aria-expanded="${editingFloor === f.id}" aria-label="设置 ${escapeHTML(f.code)} 楼层" title="楼层设置">${icon('sliders-horizontal')}</button>
      </div>
      ${editingFloor === f.id ? `<div class="scene-floor-settings"><label class="field"><span>楼层简写</span><input data-floor-code="${f.id}" value="${escapeHTML(f.code)}" maxlength="10" aria-label="${escapeHTML(f.code)} 层简写"></label><label class="field"><span>楼层名称</span><input data-floor-name="${f.id}" value="${escapeHTML(f.name)}" maxlength="25" aria-label="${escapeHTML(f.code)} 层名称"></label><div class="scene-floor-setting-row"><label class="number-field"><span>标高</span><div><input type="number" data-floor-elevation="${f.id}" value="${f.elevation}" min="-100" max="400" step=".5" aria-label="${escapeHTML(f.code)} 层标高"><span>m</span></div></label><button class="icon-btn danger-text" data-delete-floor="${f.id}" ${state.floors.length < 2 ? 'disabled' : ''} aria-label="删除 ${escapeHTML(f.code)} 视图层" title="删除楼层">${icon('trash-2')}</button></div>${warning?`<p class="floor-warning-note" role="status">${icon('triangle-alert')}${escapeHTML(warning)}</p>`:''}</div>` : ''}
      ${open ? `<div class="scene-floor-objects"><div class="zone-layer-stats"><span>付费 ${stats.paid} m²</span><span>非付费 ${stats.unpaid} m²</span><span>员工 ${stats.staff} m²</span></div>${zoneItems.map((p,i)=>`<div class="layer-row ${selected===p.id?'selected':''}"><button class="layer-item" data-select="${p.id}" aria-pressed="${selected===p.id}"><i class="zone-layer-color" style="background:${state.zoneColors[p.kind]||'#e5c8c0'}"></i><span>${paintName(p.kind)} ${i+1}${p.closed?'':' · 开放'}</span></button></div>`).join('')}${matches.map(e => `<div class="layer-row ${selected === e.id ? 'selected' : ''} ${!e.visible ? 'object-hidden' : ''}"><button class="layer-item" data-select="${e.id}" aria-pressed="${selected === e.id}">${icon(types[e.type].icon)}<span>${escapeHTML(e.name)}</span></button><button class="layer-eye icon-btn" data-visibility="${e.id}" aria-label="${e.visible ? '隐藏' : '显示'} ${escapeHTML(e.name)}" title="${e.visible ? '隐藏' : '显示'}对象">${icon(e.visible ? 'eye' : 'eye-off')}</button></div>`).join('') || (!zoneItems.length?'<div class="floor-empty">暂无对象</div>':'')}</div>` : ''}
    </section>`;
  }).join('');
  $('#library-body').innerHTML = `<div class="scene-tree-toolbar"><span>楼层与对象</span><button class="button" id="add-floor" ${state.floors.length >= 12 ? 'disabled' : ''}>${icon('plus')}添加楼层</button></div><label class="scene-floor-spacing"><span>统一层间距</span><span><input type="number" id="floor-spacing" value="${state.floorHeight}" min="1" max="40" step=".5" aria-label="统一层间距"> m</span></label><div class="layer-list scene-tree"><button class="layer-item scene-root ${selected === 'station' && activeFloor === 'all' ? 'selected' : ''}" data-scene-root="true">${icon('train-front')}<span>车站整体</span><small>${state.entities.length}</small></button>${floors || '<div class="empty-state">没有匹配的楼层或对象</div>'}</div>`;
}

function componentArt(type) {
  if (['exit', 'restroom', 'service'].includes(type)) return `<span class="component-icon-tile icon-tile-${type}">${facilityIcon(type)}</span>`;
  const start = '<svg viewBox="0 0 104 56" fill="none" aria-hidden="true">';
  const end = '</svg>';
  const arts = {
    train: `<g stroke-linejoin="round" stroke-linecap="round">
      <path d="M34 46L94 30V35L34 51Z" fill="#7b9187"/>
      <ellipse cx="44" cy="49" rx="2.6" ry="3.8" fill="#526c65"/>
      <ellipse cx="84" cy="38.3" rx="2.6" ry="3.8" fill="#526c65"/>
      <path d="M34 26L94 10V31Q94 34 91 35L34 50Z" fill="#dce6df" stroke="#8da79b"/>
      <path d="M12 16L34 26V47Q34 51 30 49L15 42Q10 39 10 35V23Q10 18 12 16Z" fill="#bacfc5" stroke="#8da79b"/>
      <path d="M12 16L70 1Q72 0 75 2L94 10L34 26Z" fill="#edf2e9" stroke="#8da79b"/>
      <path d="M35 27L93 11" stroke="#f8faf4" stroke-width="1.5"/>
      <path d="M14 23L29 30V38L14 31Z" fill="#3f6063"/>
      <path d="M16 24L27 29" stroke="#769893"/>
      <path d="M39 29L49 26.3V33L39 35.7ZM65 22L75 19.3V26L65 28.7ZM89 15.6L92 14.8V21.5L89 22.3Z" fill="#46696a"/>
      <path d="M53 25.3L61 23.2V40.2L53 42.3ZM79 18.4L86 16.5V33.5L79 35.4Z" fill="#c1d3c9" stroke="#90a99d" stroke-width=".8"/>
      <path d="M54.5 27L59.5 25.7V31L54.5 32.3ZM80.5 20L84.5 18.9V24.2L80.5 25.3Z" fill="#46696a"/>
      <path d="M57 25V41M82.5 18.2V34" stroke="#90a99d" stroke-width=".6"/>
      <path d="M35 43L93 27.5" stroke="#bc4554" stroke-width="2.6"/>
      <path d="M13 34L30 42" stroke="#bc4554" stroke-width="2.6"/>
      <path d="M15 37.5L18 39M25 42.3L28 43.8" stroke="#fff1bd" stroke-width="1.8"/>
      <path d="M16 42L29 48M36 47L92 32" stroke="#839e90" stroke-width="1.1"/>
      <path d="M42 11L56 7.3L65 11.5L51 15.3Z" fill="#d8e3d9" stroke="#b4c5b7" stroke-width=".7"/>
    </g>`,
    track: '<path d="M12 33L80 11L96 21L29 44Z" fill="#c9d1c9"/><path d="M23 29l16 10m-5-14 16 10m-4-14 16 10m-4-14 16 10m-5-14 16 10" stroke="#8e9c92" stroke-width="2"/><path d="M16 33L83 11M26 40L93 18" stroke="#667d70" stroke-width="2.5"/><path d="M28 45L96 23" stroke="#c3656d" stroke-width="3"/>',
    stairs: '<path d="M25 45V36L34 33V27L43 24V18L52 15V9L78 22V30L69 33V39L60 42V48L51 51Z" fill="#dac4a7"/><path d="M25 36L51 49L60 46V40L69 37V31L78 28V22L52 9M34 27L60 40m-17-22 26 13" stroke="#b5a38c"/><path d="M22 35V23L51 3L81 19V31" stroke="#99aaa1" stroke-width="2"/>',
    escalator: '<path d="M20 40L26 34L65 10L83 20L77 26L38 50Z" fill="#a9bcb1"/><path d="M26 34L38 42L77 18" stroke="#e9efea" stroke-width="5"/><path d="M21 39V29L63 3L84 15V25M37 48V38L78 12" stroke="#728d7e" stroke-width="2.5"/><path d="M41 30l10 6m-2-11 10 6m-2-11 10 6" stroke="#879e90"/>',
    elevator: '<path d="M36 45V10L56 4L76 15V49L56 56Z" fill="#c1d8d1" fill-opacity=".8"/><path d="M36 10L56 21L76 15M56 21v35M36 45L56 56L76 49M36 10V45M76 15V49M56 4V36" stroke="#789a8b"/><path d="M43 46V23L54 29V52m6-1V28L70 25V48" stroke="#f1f6ee"/><path d="M36 10L56 4L76 15L56 21Z" fill="#e1ece5"/>',
    gates: '<path d="M20 37L72 19L90 28L38 47Z" fill="#dce5dc"/><path d="M30 35V22L40 18L47 22V35L37 39Zm17-6V16L57 12L64 16V29L54 33Zm17-6V10L74 6L81 10V23L71 27" fill="#a5b5a7" stroke="#859d8a"/><path d="M40 24l9 5m8-11 9 5m8-11 9 5" stroke="#6da785" stroke-width="2"/>',
  };
  return start + arts[type] + end;
}

function field(label, key, value, extra = '', scope = 'property') { return `<label class="field"><span>${label}</span><input data-${scope}="${key}" value="${escapeHTML(String(value))}" ${extra}></label>`; }
function numberField(label, key, value, unit = 'm') { return `<label class="number-field"><span>${label}</span><div><input type="number" data-property="${key}" value="${Number(Number(value).toFixed(3))}" step="${key==='rotation' ? 15 : .5}" ${['l','d','h'].includes(key) ? 'min="0.2" max="500"' : 'min="-500" max="500"'} aria-label="${label}"><span>${unit}</span></div></label>`; }
function floorOptions(id, exclude) { return floorsTopDown(state.floors).filter(f=>f.id!==exclude).map(f => `<option value="${f.id}" ${id === f.id ? 'selected' : ''}>${escapeHTML(f.code)} · ${escapeHTML(f.name)}</option>`).join(''); }
function doorOptions(value, inherit = false) { return `${inherit ? `<option value="inherit" ${value === 'inherit' ? 'selected' : ''}>跟随自动生成设置</option>` : ''}${[['none','无屏蔽门'],['half','半高屏蔽门'],['full','全高屏蔽门']].map(([v,n]) => `<option value="${v}" ${value === v ? 'selected' : ''}>${n}</option>`).join('')}`; }
function trainSettings(e, draft = false) {
  const preset = trainPreset(e.trainPreset), dimensions = trainDimensions(e), layout = trainLayout(e);
  const property = draft ? 'data-draft-property' : 'data-property';
  const dimension = draft ? 'data-draft-dimension' : 'data-train-dimension';
  const dimensionField = (label, key, unit = 'm') => {
    const [min, max, integer] = TRAIN_DIMENSION_RULES[key];
    return `<label class="number-field"><span>${label}</span><div><input type="number" ${dimension}="${key}" value="${dimensions[key]}" min="${min}" max="${max}" step="${integer ? 1 : .001}" aria-label="${label}"><span>${unit}</span></div></label>`;
  };
  return `<section class="property-section train-settings"><div class="section-title">车型与编组</div>
    <div class="train-options">
      <label class="field"><span>车型预设</span><select ${property}="trainPreset"><option value="custom" ${!preset ? 'selected' : ''}>自定义</option>${TRAIN_PRESETS.map(p => `<option value="${p.id}" ${preset?.id === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
      <div class="train-formation-fields"><label class="field"><span>每组节数</span><select ${property}="trainCars">${Array.from({ length: MAX_TRAIN_CARS }, (_, i) => i + 1).map(count => `<option value="${count}" ${(e.trainCars ?? DEFAULT_TRAIN_CARS) === count ? 'selected' : ''}>${count} 节</option>`).join('')}</select></label><label class="field"><span>重联组数</span><select ${property}="trainUnits">${Array.from({ length: MAX_TRAIN_UNITS }, (_, i) => i + 1).map(count => `<option value="${count}" ${(e.trainUnits ?? 1) === count ? 'selected' : ''}>${count === 1 ? '单组' : count + ' 组重联'}</option>`).join('')}</select></label></div>
      <div class="train-summary" aria-label="列车编组"><div class="formation-units">${Array.from({ length: layout.units }, () => `<span>${layout.perUnit}</span>`).join('<i>+</i>')}</div><strong>${layout.formation} · 共 ${layout.count} 节</strong><small>全长 ${Number(layout.nominalLength.toFixed(2))} m · 宽 ${dimensions.width} m</small></div>
      <details class="train-dimensions" ${!preset ? 'open' : ''}><summary>尺寸与车门${icon('chevron-down')}</summary><div class="dimensions">
        ${dimensionField('头车长', 'headLength') + dimensionField('中间车长', 'carLength') + dimensionField('车宽', 'width') + dimensionField('车高', 'height') + dimensionField('头车每侧门数', 'headDoors', '门') + dimensionField('中间车每侧门数', 'doors', '门') + dimensionField('车间隙', 'gap') + dimensionField('重联连接间隙', 'unitGap')}
        ${dimensionField('头等车位置', 'firstClassPosition', '节') + dimensionField('头等车每侧门数', 'firstClassDoors', '门')}
      </div><small class="train-dimension-note">车长含连接位；头等车位置 0 为无。</small></details>
      ${preset ? `<a class="train-source" href="${preset.sources[0]}" target="_blank" rel="noopener noreferrer" title="${preset.note}">参数参考${icon('external-link')}</a>${preset.id === 'mtr-r' ? '<small class="train-dimension-note">门数为示意值，可在上方修改。</small>' : ''}` : ''}
    </div></section>`;
}
function trackBandSettings(e) {
  const layout=trackLayout(state,e);
  return `<section class="property-section"><div class="section-title">轨道方向与色带</div>
    <label class="toggle-row"><span>显示箭头</span><input type="checkbox" data-property="arrowVisible" role="switch" ${layout.arrowVisible?'checked':''}><i></i></label>
    <label class="field"><span>行车方向</span><select data-property="direction"><option value="forward" ${layout.forward?'selected':''}>正向 · 起点 → 终点</option><option value="backward" ${!layout.forward?'selected':''}>反向 · 终点 → 起点</option></select></label>
    <label class="toggle-row"><span>显示色带</span><input type="checkbox" data-property="bandVisible" role="switch" ${layout.bandVisible?'checked':''}><i></i></label>
    <label class="field color-full"><span>色带颜色</span><div><input type="color" data-property="bandColor" value="${layout.bandColor}"><span>${layout.bandColor.toUpperCase()}</span></div></label><button class="layer-manage-button" id="reset-band-color">${icon('undo-2')}跟随线路颜色</button></section>`;
}
function trackPathSettings(e) {
  const knots=pathKnots(e),quadratic=e.pathKind==='quadratic';
  const rows=knots.map((p,i)=>{
    const w=worldPoint(e,p),end=i===0?'start':i===knots.length-1?'end':null,join=end&&e.joins?.[end],control=quadratic&&i%2===1;
    const role=quadratic?(i===0?'起点':control?`控制点 ${Math.ceil(i/2)}`:`终点 ${i/2}`):`路径点 ${i+1}`;
    const operations=quadratic?(control?`<button class="icon-btn" data-path-split="${(i-1)/2}" ${knots.length>=31?'disabled':''} title="拆分此段曲线" aria-label="拆分第 ${(i+1)/2} 段">${icon('plus')}</button><button class="icon-btn danger-text" data-path-segment-remove="${(i-1)/2}" ${knots.length<=3?'disabled':''} title="删除此段曲线" aria-label="删除第 ${(i+1)/2} 段">${icon('x')}</button>`:''):`<button class="icon-btn" data-path-insert="${i}" ${i===knots.length-1||knots.length>=32?'disabled':''} title="在后方插入路径点" aria-label="在点 ${i+1} 后插入">${icon('plus')}</button><button class="icon-btn danger-text" data-path-remove="${i}" ${knots.length<=2?'disabled':''} title="删除路径点" aria-label="删除点 ${i+1}">${icon('x')}</button>`;
    const tangent=quadratic?(join?`<button class="path-auto" data-path-auto="${i}">解除连接</button>`:''):`<label class="path-point-angle">切线角度<input type="number" data-path-angle="${i}" value="${p.tx===undefined?'':Number((Math.atan2(p.tz,p.tx)*180/Math.PI+e.rotation).toFixed(1))}" placeholder="自动" step="15" min="-720" max="720" aria-label="路径点 ${i+1} 切线角度"></label><button class="path-auto" data-path-auto="${i}">${join?'解除连接':'自动方向'}</button>`;
    return `<div class="path-point-row ${control?'control-point':''}" data-path-row="${i}"><span class="path-point-number">${i+1}</span><span class="path-point-role">${role}</span><label>X<input type="number" data-path-index="${i}" data-path-axis="x" value="${Number(w.x.toFixed(2))}" step=".5" min="-500" max="500" aria-label="${role} X"></label><label>Z<input type="number" data-path-index="${i}" data-path-axis="z" value="${Number(w.z.toFixed(2))}" step=".5" min="-500" max="500" aria-label="${role} Z"></label>${operations}${tangent}</div>`;
  }).join('');
  return `<section class="property-section track-path-settings"><div class="section-title">轨道路径<span>${trackGeometry(e).length.toFixed(1)} m</span></div>
    ${e.path?`${quadratic?'':`<label class="field"><span>曲线平滑度</span><input type="number" data-property="pathSmoothness" value="${e.pathSmoothness??1}" min=".1" max="1" step=".1"></label>`}<div class="path-point-list">${rows}</div><small class="train-dimension-note">${quadratic?'绿色为端点，橙色为控制点；均可拖动。':'拖动绿色路径点调整曲线；端点可吸附现有轨道。'}</small>`:`<button class="layer-manage-button" id="convert-track-path">${icon('spline')}编辑为曲线</button>`}
    <button class="layer-manage-button" id="branch-track">${icon('git-branch')}绘制道岔 / 渡线</button></section>`;
}
function stairEndpointSettings(e) {
  const endpoints=stairEndpoints(e);
  return `<section class="property-section stair-endpoint-settings"><div class="section-title">端点编辑<span>拖动圆点调整</span></div>${endpoints.map((p,index)=>`<div class="stair-endpoint-row"><strong><i class="endpoint-dot endpoint-dot-${index}"></i>${index?'终点':'起点'}</strong><label class="field"><span>楼层</span><select data-stair-endpoint="${index}" data-endpoint-axis="floor" aria-label="${index?'终点':'起点'}楼层">${index?`<option value="" ${!e.toFloor?'selected':''}>自定义高度</option>`:''}${floorOptions(p.floor,endpoints[1-index].floor)}</select></label><div class="dimensions">${['x','z'].map(axis=>`<label class="number-field"><span>${axis.toUpperCase()}</span><div><input type="number" data-stair-endpoint="${index}" data-endpoint-axis="${axis}" value="${Number(p[axis].toFixed(3))}" step=".5" min="-500" max="500" aria-label="${index?'终点':'起点'} ${axis.toUpperCase()}"><span>m</span></div></label>`).join('')}</div></div>`).join('')}</section>`;
}
function trainAttachment(e) {
  const fit = trainFit(state, e);
  return `<section class="property-section"><div class="section-title">轨道落位</div><label class="field"><span>附着轨道</span><select data-property="trackId">${state.entities.filter(t=>t.type==='track').map(t=>`<option value="${t.id}" ${t.id===e.trackId?'selected':''}>${escapeHTML(t.name)} · ${escapeHTML(state.floors.find(f=>f.id===t.floor)?.code||t.floor)}</option>`).join('')}</select></label>${numberField('沿轨道偏移','trainOffset',e.trainOffset)}<label class="field"><span>车头朝向</span><select data-property="trainFacing"><option value="inherit" ${e.trainFacing==='inherit'?'selected':''}>跟随行车方向</option><option value="reverse" ${e.trainFacing==='reverse'?'selected':''}>反向</option></select></label><div class="train-fit ${fit.valid?'':'invalid'}">${escapeHTML(fit.message)}</div><button class="layer-manage-button" id="reposition-train">${icon('move')}重新放置</button></section>`;
}
function showTrainDialog(item) {
  trainDraft = item;
  modal(`<div class="modal-icon">${icon('train-front')}</div><h2>放置列车</h2><label class="field"><span>所在楼层</span><select data-draft-property="floor">${floorOptions(item.floor)}</select></label>${trainSettings(item,true)}<div class="train-fit">选择轨道落位，按实际尺寸检查空间。</div><div class="modal-actions"><button class="button" data-close-modal>取消</button><button class="button primary" id="start-train-placement">${icon('mouse-pointer-2')}开始放置</button></div>`);
}
function startPlacement(item, existing = false) {
  cancelPlacement();
  const limit=existing?'':placementLimit(state,item.type);if(limit){toast(limit);return;}
  if(activeFloor!=='all'&&(TWO_POINT_TYPES.includes(item.type)||['train','text'].includes(item.type))&&activeFloor!==item.floor)setFloor(item.floor);
  const banner=document.createElement('div');banner.className='placement-banner';banner.innerHTML=`${item.type==='track'?`<div class="track-draw-modes" role="group" aria-label="轨道绘制方式">${[['straight','直线'],['curve','控制点曲线'],['connector','平滑连接']].map(([mode,label])=>`<button data-track-mode="${mode}" class="${(item.drawMode||'straight')===mode?'active':''}">${label}</button>`).join('')}</div>`:''}${icon('mouse-pointer-2')}<span class="placement-copy"><strong id="placement-instruction"></strong><small id="placement-details"></small></span><div id="placement-floor-controls" class="placement-floor-controls"></div>${item.type==='track'?'<button id="undo-path-point" hidden title="移除上一个点">撤回一点</button><button id="finish-track-path" hidden disabled>完成轨道</button>':''}<kbd>+ / - 换层</kbd><kbd>Alt 暂停吸附</kbd><kbd>Esc 取消</kbd>`;$('#viewport').append(banner);$(`[data-add="${item.type}"]`)?.classList.add('placing');refreshIcons();
  if(!existing)banner.insertAdjacentHTML('beforeend','<kbd>Shift 连续放置</kbd>');
  scene.beginPlacement(item,(placed,context)=>{
    const success=commit(()=>{if(existing)Object.assign(state.entities.find(e=>e.id===item.id),placed);else state.entities.push(placed);selected=placed.id;});
    if(!success)return;
    const repeat=!existing&&context.repeat;
    toast(`已放置${types[item.type].name}，位于 ${state.floors.find(f=>f.id===placed.floor)?.code} 层${repeat?' · 继续放置':''}`);
    if(repeat){
      startPlacement(repeatPlacementEntity(context.draft,placed,`${item.type}-${Date.now()}-${++sequence}`));
      if(scene.placement&&context.pointer)scene.movePlacement(context.pointer);
    }
  });
}
function textSettings(e, draft=false) {
  const attr=draft?'data-text-draft':'data-property',callout=e.textMode==='callout';
  return `<section class="property-section text-settings"><div class="section-title">文字内容</div><label class="field"><span>显示方式</span><select ${attr}="textMode"><option value="floor" ${!callout?'selected':''}>贴地文字</option><option value="callout" ${callout?'selected':''}>悬浮文字（朝向相机）</option></select></label><div data-callout-settings ${callout?'':'hidden'}><label class="toggle-row"><span>启用锚点</span><input type="checkbox" ${attr}="anchorEnabled" role="switch" ${e.anchorEnabled!==false?'checked':''}><i></i></label><label class="field"><span>文字抬升（m）</span><input type="number" ${attr}="leaderLength" value="${e.leaderLength??8}" min="1" max="100" step="1"></label></div><label class="field"><span>内容</span><textarea ${attr}="text" rows="3" maxlength="500">${escapeHTML(e.text)}</textarea></label><div class="text-settings-grid"><label class="field"><span>字号（m）</span><input type="number" ${attr}="fontSize" value="${e.fontSize}" min=".5" max="20" step=".5"></label><label class="field"><span>排列</span><select ${attr}="writingMode"><option value="horizontal" ${e.writingMode==='horizontal'?'selected':''}>横排</option><option value="vertical" ${e.writingMode==='vertical'?'selected':''}>竖排</option></select></label></div><label class="field"><span>对齐</span><select ${attr}="textAlign">${[['left',e.writingMode==='vertical'?'顶部':'左对齐'],['center','居中'],['right',e.writingMode==='vertical'?'底部':'右对齐']].map(([v,label])=>`<option value="${v}" ${e.textAlign===v?'selected':''}>${label}</option>`).join('')}</select></label><label class="field color-full"><span>文字颜色</span><div><input type="color" ${attr}="color" value="${e.color}"><span>${e.color.toUpperCase()}</span></div></label><label class="toggle-row"><span>加粗</span><input type="checkbox" ${attr}="textBold" role="switch" ${e.textBold?'checked':''}><i></i></label><label class="toggle-row"><span>反向字序</span><input type="checkbox" ${attr}="textReverse" role="switch" ${e.textReverse?'checked':''}><i></i></label></section>`;
}
function showTextDialog(item) {
  textDraft=syncText(clone(item));
  modal(`<div class="modal-icon">${icon('type')}</div><h2>放置文字</h2>${textSettings(textDraft,true)}<div class="modal-actions"><button class="button" data-close-modal>取消</button><button class="button primary" id="start-text-placement">开始放置</button></div>`);
  $('#modal-root textarea')?.focus();$('#modal-root textarea')?.select();
}
function startTextTool() {
  stopPaint();cancelPlacement();
  if(state.entities.length>=600){toast('当前方案对象总数已达上限');return;}
  if(state.entities.filter(e=>e.type==='text').length>=200){toast('当前方案最多支持 200 个文字对象');return;}
  const floor=activeFloor!=='all'?activeFloor:state.floors.find(f=>f.id==='B2')?.id||state.floors[0].id;
  showTextDialog(entity(`text-${Date.now()}-${++sequence}`,'text','文字',0,0,{floor}));
}
function startTextAnchorPlacement() {
  const item=state.entities.find(e=>e.id===selected);if(item?.type!=='text'||item.textMode!=='callout')return;
  stopPaint();cancelPlacement();if(activeFloor!==item.floor)setFloor(item.floor);
  const banner=document.createElement('div');banner.className='placement-banner';
  banner.innerHTML=`${icon('crosshair')}<span class="placement-copy"><strong id="placement-instruction">点击设置锚点</strong><small id="placement-details">文字位置保持不变</small></span><kbd>+ / - 换层</kbd><kbd>Esc 取消</kbd>`;$('#viewport').append(banner);refreshIcons();
  scene.beginPlacement(clone(item),placed=>{commit(()=>{const e=state.entities.find(e=>e.id===item.id);Object.assign(e,{anchorEnabled:true,anchorX:placed.anchorX,anchorZ:placed.anchorZ});});toast('锚点已设置');});
  scene.placement.anchorPicking=true;const original=scene.groups.get(item.id);if(original){original.visible=false;scene.placement.hiddenSource=original;}
  updatePlacementBanner({type:'text',anchorPicking:true});
}
function renderTextInspector(e) {
  $('#inspector-content').innerHTML=`<div class="selection-card"><span class="selection-icon">${icon('type')}</span><div><strong>${escapeHTML(e.name)}</strong><span>文字</span></div><span class="selection-tag">${escapeHTML(state.floors.find(f=>f.id===e.floor)?.code||e.floor)}</span></div><section class="property-section"><div class="section-title">基本信息</div>${field('对象名称','name',e.name,'maxlength="100"')}<label class="field"><span>所在楼层</span><select data-property="floor">${floorOptions(e.floor)}</select></label></section>${textSettings(e)}${e.textMode==='callout'&&e.anchorEnabled!==false?`<section class="property-section"><div class="section-title">锚点位置</div><div class="dimensions">${numberField('锚点 X','anchorX',e.anchorX??e.x)+numberField('锚点 Z','anchorZ',e.anchorZ??e.z)}</div><div class="object-actions"><button class="button" id="pick-text-anchor">${icon('crosshair')}画布取点</button><button class="button" id="reset-text-anchor">${icon('rotate-ccw')}重置锚点</button></div></section>`:''}<section class="property-section"><div class="section-title">文字位置</div><div class="dimensions">${numberField('X 轴','x',e.x)+numberField('Z 轴','z',e.z)+(e.textMode==='callout'?'':numberField('旋转','rotation',e.rotation,'°'))}</div><div class="text-direction-actions" ${e.textMode==='callout'?'hidden':''}><button class="button" data-rotate-text="-90">${icon('rotate-ccw')}左转 90°</button><button class="button" data-rotate-text="90">${icon('rotate-cw')}右转 90°</button></div><div class="object-actions"><button class="button" id="duplicate">${icon('copy')}复制</button><button class="button danger-text" id="delete-entity">${icon('trash-2')}删除</button></div></section>`;
}
function setInspectorTab(next, { focus = false } = {}) {
  inspectorTab = next === 'object' ? 'object' : 'station';
  document.querySelectorAll('[data-inspector]').forEach(button => {
    const active = button.dataset.inspector === inspectorTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  });
  $('#station-settings').hidden = inspectorTab !== 'station';
  $('#object-properties').hidden = inspectorTab !== 'object';
}
function renderInspector() {
  const e = state.entities.find(e => e.id === selected);
  const zone=state.zonePaths?.find(p=>p.id===selected);
  if (!e&&!zone) selected = 'station';
  if (selected !== inspectorSelection) {
    inspectorTab = e||zone ? 'object' : 'station';
    inspectorSelection = selected;
  }
  const floor = state.floors.find(f => f.id === activeFloor);
  const boundaries = state.floors.filter(f=>activeFloor==='all'||f.id===activeFloor).flatMap(f=>generateBoundaries(state,f.id));
  const totals = state.floors.reduce((a,f) => { const t=zoneStats(state,f.id); for(const kind of ZONE_KINDS)a[kind]+=t[kind];return a; }, {paid:0,unpaid:0,staff:0});
  const marker = e && ['exit','restroom'].includes(e.type);
  $('#station-settings-content').innerHTML = `
    <section class="property-section"><div class="section-title">基本信息</div>${field('车站名称','name',state.name,'maxlength="32"','station-property')}${field('英文名称','english',state.english,'maxlength="64"','station-property')}</section>
    <section class="property-section"><div class="section-title">车站线路<span>${state.lines.length}</span></div><div class="inspector-lines">${state.lines.map(l => `<button id="manage-lines"><i style="background:${l.color}"></i>${escapeHTML(l.name)}${icon('chevron-right')}</button>`).join('')}</div><button class="layer-manage-button" id="manage-lines">${icon('plus')}管理多条线路</button></section>
    <section class="property-section"><div class="section-title">区域面积</div><div class="area-stat-grid"><span>付费区<strong>${totals.paid}<small>m²</small></strong></span><span>非付费区<strong>${totals.unpaid}<small>m²</small></strong></span><span class="staff-stat">员工区域<strong>${totals.staff}<small>m²</small></strong></span></div><button class="layer-manage-button" id="manage-floors">${icon('layers-3')}楼层与对象管理${icon('arrow-up-right')}</button></section>
    <section class="property-section automatic-section"><div class="section-title">自动边界设施</div><label class="toggle-row"><span>${icon('fence')}付费 / 非付费区栏杆</span><input type="checkbox" id="auto-railings" role="switch" ${state.boundaries.railings?'checked':''}><i></i></label><label class="field"><span>付费区 / 轨道屏蔽门</span><select id="default-screen-doors">${doorOptions(state.boundaries.screenDoors)}</select></label><label class="toggle-row"><span title="放置与绘制时吸附边缘、中线及相等尺寸；Alt 临时关闭吸附">${icon('magnet')}几何吸附</span><input id="snap-enabled" type="checkbox" role="switch" ${state.snapping?'checked':''}><i></i></label><button class="layer-manage-button" id="snap-existing" ${!state.snapping?'disabled':''}>${icon('magnet')}贴齐现有轨道</button><div class="boundary-summary">${floor?escapeHTML(floor.code):'全部楼层'} · 栏杆 ${boundaries.filter(b=>b.kind==='railing').length} 段 · 屏蔽门 ${boundaries.filter(b=>b.kind==='screen').length} 段</div></section>
  `;
  $('#inspector-content').innerHTML = e ? `
    <div class="selection-card"><span class="selection-icon">${icon(types[e.type].icon)}</span><div><strong>${escapeHTML(e.name)}</strong><span>${types[e.type].name}</span></div><span class="selection-tag">${escapeHTML(state.floors.find(f => f.id === e.floor)?.code || e.floor)}</span></div>
    <section class="property-section"><div class="section-title">基本信息</div>${field('构件名称','name',e.name,'maxlength="32"')}<label class="field"><span>所在楼层</span><select data-property="floor">${floorOptions(e.floor)}</select></label>${['stairs','escalator','elevator'].includes(e.type) ? `<label class="field"><span>连接楼层</span><select data-property="toFloor"><option value="">不连接 · 自定义高度</option>${floorsTopDown(state.floors).filter(f => f.id !== e.floor).map(f => `<option value="${f.id}" ${e.toFloor === f.id ? 'selected' : ''}>${escapeHTML(f.code)} · ${escapeHTML(f.name)}</option>`).join('')}</select></label>` : ''}${e.type === 'exit' ? field('出口编号','exitNumber',e.exitNumber||'','maxlength="12"') : ''}${!['track','train'].includes(e.type) ? `<label class="field color-full"><span>构件颜色</span><div><input type="color" data-property="color" value="${e.color}"><span>${e.color.toUpperCase()}</span></div></label>` : ''}</section>
    ${e.type === 'train' ? trainSettings(e)+trainAttachment(e) : ''}
    ${isStair(e) ? stairEndpointSettings(e) : ''}${CONNECTION_TYPES.includes(e.type)&&e.toFloor?`<section class="property-section"><div class="section-title">楼板开洞</div><button class="layer-manage-button" id="create-connection-openings" title="按构件占地在连接经过的上层生成可编辑孔洞">${icon('scan')}按此构件开洞</button></section>`:''}
    ${e.type === 'track' ? `${trackBandSettings(e)}${trackPathSettings(e)}<section class="property-section"><div class="section-title">轨道与线路</div><label class="field"><span>所属线路</span><select data-property="lineId">${state.lines.map(l=>`<option value="${l.id}" ${l.id===e.lineId?'selected':''}>${escapeHTML(l.name)}</option>`).join('')}</select></label><label class="field"><span>屏蔽门类型</span><select data-property="doorStyle">${doorOptions(e.doorStyle||'inherit',true)}</select></label></section>` : ''}
    <section class="property-section"><div class="section-title">尺寸与位置</div><div class="dimensions">${numberField(marker?'标记长度':'长度','l',e.l)+numberField(marker?'标记宽度':'宽度','d',e.d)+(marker?'':numberField('高度','h',e.h))}</div><div class="position-label">${icon('move')}场景位置</div><div class="dimensions">${numberField('X 轴','x',e.x)+numberField('Z 轴','z',e.z)+numberField('旋转','rotation',e.rotation,'°')}</div><div class="object-actions"><button class="button" id="duplicate">${icon('copy')}复制</button><button class="button danger-text" id="delete-entity">${icon('trash-2')}删除</button></div></section>
  ` : `<div class="inspector-empty">${icon('mouse-pointer-2')}<strong>未选中对象</strong><span>在画布或场景图层中选择对象</span></div>`;
  if(zone)renderZoneInspector(zone);
  if(e?.type==='text')renderTextInspector(e);
  setInspectorTab(inspectorTab);
  document.querySelectorAll('[data-display]').forEach(input => input.checked = ['fullMarkers','texts'].includes(input.dataset.display)?state.display[input.dataset.display]!==false:state.display[input.dataset.display]);
  if(e?.type==='track'&&e.path){const input=$('#inspector-content input[data-property="l"]');input.readOnly=true;input.title='路径全长由曲线计算';}
  if(e?.type==='train'){
    $('#inspector-content select[data-property="floor"]').disabled=true;
    for(const key of ['l','d','h','x','z','rotation']){const input=$('#inspector-content input[data-property="'+key+'"]');input.readOnly=true;input.title='随编组与附着轨道自动更新';}
  }
  if (e?.toFloor) { const input = $('#inspector-content input[data-property="h"]'); input.readOnly = true; input.title = '高度随连接楼层自动更新'; }
  $('#status-selected').textContent = e ? e.name : (paintActive ? `${floor?.code||''} · ${paintName(paintKind)}` : '车站整体');
  refreshIcons();
}
function updateHeader() {
  const title = projectFiles.current.title;
  $('#file-title').textContent = title;
  document.title = `${title} · 车站设计 · RMCreator`;
  $('#sidebar-name').textContent = state.name;
  $('#canvas-title').textContent = state.name;
  $('#canvas-subtitle').textContent = state.english;
  $('#station-lines').innerHTML = state.lines.map(l=>`<span class="line-chip" style="--chip-color:${l.color}">${escapeHTML(l.name)}</span>`).join('');
  $('#legend-lines').innerHTML = state.lines.map(l=>`<span><i style="background:${l.color};border-color:${l.color}"></i>${escapeHTML(l.name)}</span>`).join('');
  document.documentElement.style.setProperty('--paid-color',state.zoneColors.paid);
  document.documentElement.style.setProperty('--unpaid-color',state.zoneColors.unpaid);
  document.documentElement.style.setProperty('--staff-color',state.zoneColors.staff);
  $('#entity-count').textContent = `${state.entities.length} 个构件`;
  $('#undo').disabled = undoStack.length === 0;
  $('#redo').disabled = redoStack.length === 0;
}
function render(rebuild = true) { if (activeFloor !== 'all' && !state.floors.some(f => f.id === activeFloor)) activeFloor = 'all'; updateHeader(); renderFloors(); renderLibrary(); renderInspector(); renderPaintToolbar(); if (rebuild && scene) scene.update(state, view, activeFloor, selected); }
function commit(action, options = {}) {
  cancelPlacement();
  const before = clone(state);
  action();
  try{syncTrackPaths(state);const invalid=state.entities.filter(e=>e.type==='track').map(trackPathError).find(Boolean)||state.entities.filter(e=>e.type==='text').map(textError).find(Boolean)||(state.zonePaths||[]).map(p=>zonePathError(p)).find(Boolean);if(invalid)throw new Error(invalid);state.entities.filter(e=>e.type==='text').forEach(syncText);}
  catch(error){state=before;render();toast(error.message);return false;}
  syncConnections(); syncTrains(state);
  const error=options.allowInvalidTrains?'':trainEditError(before,state);
  if(error){state=before;render();toast(error);return false;}
  if (JSON.stringify(before) !== JSON.stringify(state)) { undoStack.push(before); if (undoStack.length > 50) undoStack.shift(); redoStack = []; scheduleSave(); }
  render(options.rebuild !== false);
  return true;
}
function syncConnections() {
  state.entities.forEach(e=>normalizeConnection(state,e));
}
function scheduleSave() {
  isDirty = true; $('#save-state').classList.add('saving'); $('#save-state span').textContent = '正在保存…';
  $('#project-menu').classList.add('unsaved');
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 650);
}
function save(notify = false) {
  if(notify&&document.activeElement?.matches('[data-property],[data-stair-endpoint],[data-station-property],[data-path-index],[data-path-angle],[data-floor-code],[data-floor-name],[data-floor-elevation]'))document.activeElement.blur();
  clearTimeout(saveTimer);
  try {
    state.updatedAt = projectFiles.save(state).updatedAt;isDirty = false;
    $('#save-state').classList.remove('saving');$('#save-state span').textContent = '已保存到浏览器';
    $('#project-menu').classList.remove('unsaved');if(notify)toast('当前方案已保存到浏览器');return true;
  } catch (error) {
    isDirty = true;$('#save-state').classList.add('saving');$('#save-state span').textContent = '保存失败 · 请下载 JSON';
    $('#project-menu').classList.add('unsaved');toast(error.message);return false;
  }
}
function select(id, { fromLayers = false } = {}) {
  if (fromLayers) { stopPaint(); cancelPlacement(); }
  const zone=state.zonePaths?.find(p=>p.id===id);
  if(zone){
    inspectorTab='object';
    if(activeFloor!=='all'&&activeFloor!==zone.floor)setFloor(zone.floor);
    selected=id;paintKind=zone.kind;paintActive=true;libraryTab='layers';collapsedFloors.delete(zone.floor);
    scene.zoneEditor.edit(id);renderInspector();renderLibrary();renderPaintToolbar();scene.select(id);return;
  }
  if(scene?.zoneEditor.active&&!scene.zoneEditor.drawing)stopPaint();
  selected = id;
  inspectorTab = id === 'station' ? 'station' : 'object';
  const item = state.entities.find(e => e.id === id);
  if (item) {
    libraryTab = 'layers';
    collapsedFloors.delete(item.floor);
    if (!fromLayers && search) { search = ''; $('#component-search').value = ''; }
    if (fromLayers && activeFloor !== 'all' && activeFloor !== item.floor) setFloor(item.floor);
  }
  renderInspector();
  renderLibrary();
  scene.select(id);
  if (item) $(`[data-select="${id}"]`)?.scrollIntoView({ block: 'nearest' });
}
function undo() { cancelPlacement(); if (!undoStack.length) return; redoStack.push(clone(state)); state = undoStack.pop(); render(); scheduleSave(); }
function redo() { cancelPlacement(); if (!redoStack.length) return; undoStack.push(clone(state)); state = redoStack.pop(); render(); scheduleSave(); }
function setView(next) {
  stopPaint(); cancelPlacement();
  view = next; document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (next === 'floor' && activeFloor === 'all') setFloor(state.floors[state.floors.length - 1].id, false);
  if (next === '3d') setFloor('all', false);
  $('#camera-button span').textContent = next === 'floor' ? '正交俯视图' : '等轴测视图';
  updateHeader(); scene.update(state, view, activeFloor, selected); scene.setView(next); if (next === 'floor') scene.fit();
}
function setFloor(floor, update = true) {
  scene?.changePlacementFloor(floor);
  const editor=scene?.zoneEditor;
  if(floor!=='all'){
    workFloor=floor;
    if(editor?.drawing&&!editor.path.vertices.length){editor.path.floor=floor;editor.notify();}
  }
  activeFloor = floor;
  collapsedFloors.delete(floor);
  const item = state.entities.find(e => e.id === selected);
  const zone=state.zonePaths?.find(p=>p.id===selected);if(zone&&floor!==zone.floor)selected='station';
  if (floor !== 'all' && item && item.floor !== floor && item.toFloor !== floor) selected = 'station';
  renderFloors(); renderLibrary(); renderInspector();renderPaintToolbar();
  if (update) { scene.update(state, view, activeFloor, selected); if (view === 'floor') scene.fit(); }
}
function stepFloor(direction) {
  const contextFloor=scene.placement?.entity.floor||scene.zoneEditor.path?.floor||state.entities.find(e=>e.id===selected)?.floor||workFloor;
  const current=activeFloor==='all'?contextFloor:activeFloor,next=adjacentFloor(state.floors,current,direction);
  if(next)setFloor(next);
  else toast(direction>0?'已到最高层':'已到最低层');
}
function setTool(next) { stopPaint(); cancelPlacement(); tool = next; document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === next)); scene.setTool(next); }
function cancelPlacement() { scene?.cancelStairEndpointDrag();scene?.cancelPlacement(); $('.placement-banner')?.remove(); document.querySelectorAll('.component-card.placing').forEach(e => e.classList.remove('placing')); }
function updatePlacementBanner(status) {
  const instruction=$('#placement-instruction'),details=$('#placement-details');if(!instruction||!details)return;
  const p=scene.placement,controls=$('#placement-floor-controls');
  if(p&&controls){
    const connection=CONNECTION_TYPES.includes(p.entity.type),anchored=!!(p.start||p.points?.length);
    controls.innerHTML=`<label>${connection?'起点层':'放置层'}<select data-placement-floor="from" aria-label="${connection?'起点楼层':'放置楼层'}" ${anchored||p.anchorPicking?'disabled':''}>${floorOptions(p.entity.floor)}</select></label>${connection?`<label>终点层<select data-placement-floor="to" aria-label="终点楼层">${floorOptions(p.entity.toFloor,p.entity.floor)}</select></label>`:''}${activeFloor==='all'?fadeFloorsControl():''}`;
    document.querySelectorAll('[data-track-mode]').forEach(b=>b.classList.toggle('active',b.dataset.trackMode===p.trackMode));
    if($('#finish-track-path')){$('#finish-track-path').hidden=p.trackMode!=='curve';$('#undo-path-point').hidden=p.trackMode!=='curve'||!p.points?.length;}
  }
  const elevator=status.type==='elevator',connection=CONNECTION_TYPES.includes(status.type);
  if(status.type==='text'){instruction.textContent=status.anchorPicking?'点击设置锚点':'点击放置文字';details.textContent=status.anchorPicking?'文字位置保持不变 · 吸附到网格':'放置后可直接拖动 · T 添加文字';return;}
  if(status.type==='track'&&status.trackMode&&status.trackMode!=='straight'){
    const curve=status.trackMode==='curve',points=status.points||0,drawing=curveDrawingState(points);
    instruction.textContent=curve?(!points?'选择曲线起点':drawing.nextRole==='end'?'选择终点':drawing.segments?'选择下一控制点 · Enter 完成':'选择控制点'):(status.stage==='start'?'选择分叉起点':'选择连接终点');
    details.textContent=status.message||(curve?`${drawing.segments?`已绘制 ${drawing.segments} 段 · `:''}起点 → 控制点 → 终点`:'两点确定连接 · 吸附轨道并对齐切线');details.classList.toggle('invalid',status.valid===false);
    $('#finish-track-path').hidden=!curve;$('#finish-track-path').disabled=!drawing.canFinish;
    $('#undo-path-point').hidden=!curve||!points;return;
  }
  if(status.type==='train'){instruction.textContent='在轨道上点击放置列车';details.textContent=status.message||'自动吸附轨道 · 检查长度、宽度与占位';details.classList.toggle('invalid',status.valid===false);return;}
  instruction.textContent=status.twoPoint?(status.stage==='start'?(elevator?'选择井道第一个角点':connection?'选择起点':'选择轨道起点'):(elevator?'选择井道对角点':connection?'切换楼层，选择终点':'选择轨道终点')):`点击放置${types[status.type].name}`;
  details.textContent=status.message||(elevator?'矩形井道 · 竖直连接 · 长宽 2–12 m':connection?'任意方向直线 · 参考线吸附':status.twoPoint?'两点确定 · 参考线吸附':'参考线与网格吸附');
  details.classList.toggle('invalid',status.valid===false);
}
function fadeFloorsControl(){return `<label class="fade-floors-control"><input type="checkbox" data-fade-floors ${scene.fadeOtherFloors!==false?'checked':''}>虚化其他层</label>`;}
function renderPaintToolbar() {
  const root=$('#paint-toolbar');root.hidden=!paintActive;const openingButton=$('#opening-tool');openingButton.classList.toggle('active',paintActive&&paintKind==='opening');openingButton.setAttribute('aria-pressed',String(paintActive&&paintKind==='opening'));if(!paintActive)return;
  const drawing=zoneUI?.drawing!==false,opening=paintKind==='opening',rectangle=opening&&drawing&&zoneUI?.drawShape==='rectangle';
  root.classList.add('pen-toolbar');
  root.innerHTML=`<div class="pen-toolbar-row"><span class="paint-current"><i style="background:${state.zoneColors[paintKind]||'#e1e5d8'}"></i>${paintName(paintKind)}</span>${opening&&drawing?`<select id="opening-shape" aria-label="开洞方式"><option value="rectangle" ${rectangle?'selected':''}>矩形 · 两点</option><option value="pen" ${!rectangle?'selected':''}>钢笔 · 直线 / 曲线</option></select>`:''}<div class="paint-modes">${(drawing?(rectangle?[]:[['pen','钢笔','pen-tool'],['direct','选点','mouse-pointer-2']]):[['direct','选点','mouse-pointer-2'],['add','加点','plus'],['remove','减点','minus'],['convert','转换','rotate-cw']]).map(([mode,name,ico])=>`<button data-zone-mode="${mode}" class="${zoneUI?.mode===mode?'active':''}" title="${name}" aria-label="${name}">${icon(ico)}<span>${name}</span></button>`).join('')}</div><button id="zone-snap" class="${state.snapping?'active':''}" title="网格、顶点、边界与对齐参考线吸附；Alt 临时关闭" aria-label="区域吸附" aria-pressed="${state.snapping}">${icon('magnet')}</button><button id="stop-paint" title="结束区域编辑" aria-label="结束区域编辑">${icon('x')}</button></div><div class="pen-toolbar-row pen-toolbar-footer"><span>${drawing?(rectangle?(zoneUI?.count?'点击对角点开洞':'点击第一个角点'):`${zoneUI?.count||0} 个顶点 · 点击直线 / 拖动曲线`):`${zoneUI?.count||0} 个顶点 · 已选 ${zoneUI?.selected.length||0}`}</span>${drawing?`<button id="zone-undo-point" ${!zoneUI?.count?'disabled':''}>撤回一点</button><button id="zone-close" class="pen-primary" ${rectangle?'hidden':''} ${(zoneUI?.count||0)<3?'disabled':''}>闭合区域 ↵</button>`:'<button id="zone-new">新建轮廓</button><button data-paint="erase" title="绘制闭合轮廓擦除区域">轮廓擦除</button>'}</div>`;
  root.insertAdjacentHTML('afterbegin',`<div class="pen-toolbar-row editing-floor-row"><label>绘制层<select data-zone-floor aria-label="区域绘制楼层" ${!drawing||zoneUI?.count?'disabled':''}>${floorOptions(zoneUI?.floor||workFloor)}</select></label>${activeFloor==='all'?fadeFloorsControl():''}${activeFloor!=='all'&&zoneUI?.floor!==activeFloor?`<button data-floor="${escapeHTML(zoneUI.floor)}">返回绘制层</button>`:''}</div>`);
  refreshIcons();
}
function renderZoneInspector(zone){
  const ui=zoneUI?.id===zone.id?zoneUI:null,vertices=ui?.vertices||zone.vertices,indices=ui?.selected||[];
  $('#inspector-content').innerHTML=`<div class="selection-card"><span class="selection-icon">${icon('pen-tool')}</span><div><strong>${paintName(zone.kind)}轮廓</strong><span>${zone.closed?(zone.kind==='opening'?'穿透本层填色':'闭合区域'):'开放路径 · 暂不填色'}</span></div><span class="selection-tag">${state.floors.find(f=>f.id===zone.floor)?.code||''}</span></div><section class="property-section"><div class="section-title">区域属性<span>${zone.closed?polygonArea(pathPolygon(zone)).toFixed(1)+' m²':'开放'}</span></div><label class="field"><span>填色类型</span><select id="zone-kind">${[...ZONE_KINDS,'erase','opening'].map(kind=>`<option value="${kind}" ${zone.kind===kind?'selected':''}>${paintName(kind)}</option>`).join('')}</select></label>${zone.holes?.length?`<label class="field"><span>编辑轮廓</span><select id="zone-contour"><option value="-1">外轮廓</option>${zone.holes.map((_,i)=>`<option value="${i}" ${ui?.contour===i?'selected':''}>孔洞 ${i+1}</option>`).join('')}</select></label>`:''}${zone.closed&&ZONE_KINDS.includes(zone.kind)?`<button class="layer-manage-button" id="zone-opening">${icon('scan')}在此层开洞</button>`:''}<div class="zone-type-tools" role="group" aria-label="转换顶点类型">${[['corner','角点'],['smooth','平滑点'],['cusp','拐点']].map(([type,name])=>`<button class="button" data-zone-type="${type}" ${!indices.length?'disabled':''}>${name}</button>`).join('')}</div><div class="zone-edit-actions"><button class="button" id="zone-delete-points" ${!indices.length?'disabled':''}>${icon('minus')}删除选中点</button><button class="button" id="zone-toggle-closed" ${(ui?.contour??-1)>=0?'disabled':''}>${zone.closed?'开放路径':'连接首尾'}</button></div></section><section class="property-section"><div class="section-title">顶点<span>${vertices.length} · 已选 ${indices.length}</span></div><div class="zone-vertices">${vertices.map((v,i)=>`<button class="zone-vertex-row ${indices.includes(i)?'active':''}" data-zone-vertex="${i}" aria-pressed="${indices.includes(i)}"><span>${i+1}</span><strong>${{corner:'角点',smooth:'平滑点',cusp:'拐点'}[v.type]}</strong><small>${v.pos.x.toFixed(1)}, ${v.pos.z.toFixed(1)}</small></button>`).join('')}</div>${indices.length===1?(()=>{const v=vertices[indices[0]];return ['pos','handleIn','handleOut'].filter(k=>v[k]).map(key=>`<div class="zone-coordinate-label">${{pos:'顶点',handleIn:'入手柄',handleOut:'出手柄'}[key]}</div><div class="dimensions zone-coordinate">${['x','z'].map(axis=>`<label class="number-field"><span>${axis.toUpperCase()}</span><div><input type="number" step="0.1" min="-500" max="500" data-zone-coordinate="${key}" data-axis="${axis}" value="${Number(v[key][axis].toFixed(3))}" aria-label="${key} ${axis}"><span>m</span></div></label>`).join('')}</div>`).join('');})():''}</section><section class="property-section"><div class="object-actions"><button class="button" id="duplicate-zone">${icon('copy')}${zone.kind==='opening'?'复制孔洞':'复制区域'}</button><button class="button danger-text" id="delete-zone">${icon('trash-2')}${zone.kind==='opening'?'删除孔洞':'删除区域'}</button></div><div class="pen-key-hints"><span>多选 <kbd>Shift</kbd> / 框选</span><span>断开手柄 <kbd>Alt</kbd></span><span>约束角度 <kbd>Shift</kbd></span></div></section>`;
  refreshIcons();
}
function configurePaint() { if(paintActive)scene?.setPaint({kind:paintKind,floor:activeFloor==='all'?workFloor:activeFloor}); }
function startPaint(kind) {
  cancelPlacement();if(!state.floors.some(f=>f.id===workFloor))workFloor=state.floors[0].id;
  const floor=activeFloor==='all'?workFloor:activeFloor;
  if(kind!=='opening'&&Object.keys(state.zones[floor]||{}).length)commit(()=>vectorizeCells(state,floor));
  if((state.zonePaths?.length||0)>=600){toast('区域数量已达上限，请先删除部分区域');return;}
  selected='station';paintKind=kind;paintActive=true;renderLibrary();renderInspector();configurePaint();renderPaintToolbar();
}
function stopPaint() { paintActive=false;$('#opening-tool').classList.remove('active');$('#opening-tool').setAttribute('aria-pressed','false');scene?.setPaint(null);zoneUI=null;$('#paint-toolbar').hidden=true;document.querySelectorAll('.zone-card.active').forEach(e=>e.classList.remove('active')); }
function showLines() {
  modal(`<div class="modal-icon">${icon('tram-front')}</div><h2>线路管理</h2><div class="line-manager-list">${state.lines.map(l=>`<div class="line-manager-item"><input type="color" data-line-color="${l.id}" value="${l.color}" aria-label="${escapeHTML(l.name)} 颜色"><input data-line-name="${l.id}" value="${escapeHTML(l.name)}" maxlength="40" aria-label="线路名称"><small>${state.entities.filter(e=>e.type==='track'&&e.lineId===l.id).length} 段轨道</small><button class="icon-btn" data-delete-line="${l.id}" ${state.lines.length===1?'disabled':''} title="删除线路，所属轨道转入另一条线路" aria-label="删除 ${escapeHTML(l.name)}">${icon('trash-2')}</button></div>`).join('')}</div><div class="modal-actions"><button class="button" id="add-line" ${state.lines.length>=24?'disabled':''}>${icon('plus')}添加线路</button><button class="button primary" data-close-modal>完成设置</button></div>`);
}
function addLine() {
  if(state.lines.length>=24)return;const colors=['#bc4554','#e5bd45','#925da6','#487fb1','#6c9c72'];
  commit(()=>state.lines.push({id:`line-${Date.now()}`,name:`线路 ${state.lines.length+1}`,color:colors[state.lines.length%colors.length]}));showLines();
}
function removeLine(id) { if(state.lines.length<2)return;commit(()=>{const other=state.lines.find(l=>l.id!==id);state.entities.filter(e=>e.lineId===id).forEach(e=>e.lineId=other.id);state.lines=state.lines.filter(l=>l.id!==id);});showLines(); }
function floorWarningIcon(message) {
  return message?`<span class="floor-warning" role="img" aria-label="${escapeHTML(message)}" title="${escapeHTML(message)}">${icon('triangle-alert')}</span>`:'';
}
function renderFloors() {
  const warnings=floorElevationWarnings(state.floors);
  $('.floor-picker').innerHTML = `<button data-floor="all" class="${activeFloor === 'all' ? 'active' : ''}">全部楼层</button>${floorsTopDown(state.floors).map(f => `<button data-floor="${f.id}" class="${activeFloor === f.id ? 'active' : ''}"><b>${escapeHTML(f.code)}</b>${escapeHTML(f.name)}${floorWarningIcon(warnings.get(f.id))}</button>`).join('')}`;
  const f = state.floors.find(f => f.id === activeFloor);
  $('.floor-active-label').innerHTML = `${icon('layers-3')}${f ? `${escapeHTML(f.code)} · ${f.elevation} m` : ''}`;
  refreshIcons();
}
function showFloors() {
  stopPaint(); cancelPlacement();
  closeModal();
  libraryTab = 'layers'; search = ''; $('#component-search').value = '';
  editingFloor = activeFloor !== 'all' ? activeFloor : floorsTopDown(state.floors)[0].id;
  collapsedFloors.delete(editingFloor);
  renderLibrary();
  $('.scene-floor-settings')?.scrollIntoView({ block: 'nearest' });
}
function applyFloorSpacing(value) { state.floorHeight = value; const sorted = [...state.floors].sort((a,b) => a.elevation - b.elevation); const start = sorted[0].elevation; sorted.forEach((f,i) => f.elevation = start + i * value); state.entities.filter(e => ['stairs','escalator'].includes(e.type)).forEach(e => e.h = value); }
function addFloor() {
  if (state.floors.length >= 12) return;
  if (Math.max(...state.floors.map(f => f.elevation)) + (state.floorHeight || 12) > 400) { toast('最高标高不能超过 400 米，请先调整层高'); return; }
  commit(() => { const index = state.floors.length + 1; const f = { id: `L${Date.now()}`, code: `L${index}`, name: `自定义层 ${index}`, elevation: Math.max(...state.floors.map(f => f.elevation)) + (state.floorHeight || 12) }; state.floors.push(f); state.zones[f.id]={}; activeFloor = f.id; selected = 'station'; });
  showFloors(); toast('已添加视图层，选择构件即可在该层开始设计');
}
function deleteFloor(id) {
  if (state.floors.length < 2) return; const f = state.floors.find(f => f.id === id); const count = state.entities.filter(e => e.floor === id).length;
  modal(`<div class="modal-icon">${icon('layers-2')}</div><h2>删除 ${escapeHTML(f.code)} · ${escapeHTML(f.name)}？</h2><p>该层的 ${count} 个构件和填色区域将合并到相邻视图层，重叠处保留目标层填色。此操作可以撤销。</p><div class="modal-actions"><button class="button" id="manage-floors">返回设置</button><button class="button primary" data-confirm-delete-floor="${id}">删除视图层</button></div>`);
}
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 3200); }
function modal(content, focusSelector = 'form input, button:not(.icon-btn)') { $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${content}<button class="modal-close icon-btn" data-close-modal aria-label="关闭">${icon('x')}</button></div></div>`; refreshIcons(); setTimeout(() => { const target=$('.modal')?.querySelector(focusSelector);target?.focus();if(target?.tagName==='INPUT'&&target.type!=='search')target.select(); }, 0); }
function closeModal() { $('#modal-root').innerHTML = ''; trainDraft=null; }
function fileAction(action) {
  if (isDirty && !save()) return;
  try { action();updateHeader(); } catch (error) { toast(error.message); }
}
function activateProject(file) {
  clearTimeout(saveTimer);stopPaint();cancelPlacement();closeModal();
  state = clone(file.project);selected = 'station';inspectorTab = 'station';inspectorSelection = 'station';
  undoStack = [];redoStack = [];isDirty = false;search = '';editingFloor = null;collapsedFloors.clear();
  $('#component-search').value = '';tool = 'select';scene.setTool(tool);
  document.querySelectorAll('[data-tool]').forEach(button=>button.classList.toggle('active',button.dataset.tool===tool));
  syncConnections();syncTrackPaths(state);syncTrains(state);render(false);setView('3d');scene.fit();
  $('#save-state').classList.remove('saving');$('#save-state span').textContent = '已保存到浏览器';$('#project-menu').classList.remove('unsaved');
}
function fileDate(value) {
  return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
}
function showFiles() {
  cancelPlacement();
  const searchFocused=document.activeElement?.id==='files-search',searchCursor=searchFocused?document.activeElement.selectionStart:null;
  const trash=filesView==='trash',current=projectFiles.current,files=projectFiles.list(trash).filter(file=>`${file.title} ${file.project.name}`.toLowerCase().includes(filesSearch.toLowerCase()));
  modal(`<div class="file-manager-heading"><div class="modal-icon">${icon('folder-open')}</div><div><h2>我的车站方案</h2><p>保存在此浏览器 · 当前：${escapeHTML(current.title)}</p></div></div>
    <div class="file-manager-actions"><button class="button primary" id="new-project">${icon('plus')}新建方案</button><button class="button" id="open-json">${icon('file-up')}打开 JSON</button><button class="button" id="save-current-file">${icon('save')}保存当前</button><button class="button" data-copy-file="${current.id}">${icon('copy')}另存副本</button><button class="button" id="download-project">${icon('download')}下载 JSON</button></div>
    <div class="file-list-toolbar"><div role="tablist" aria-label="方案列表"><button role="tab" aria-selected="${!trash}" data-files-view="active">我的方案 <span>${projectFiles.list().length}</span></button><button role="tab" aria-selected="${trash}" data-files-view="trash">回收站 <span>${projectFiles.list(true).length}</span></button></div><label class="file-search">${icon('search')}<input id="files-search" type="search" placeholder="搜索方案" aria-label="搜索方案" value="${escapeHTML(filesSearch)}"></label></div>
    <div class="project-file-list" aria-label="${trash?'回收站方案':'已保存方案'}">${files.length?files.map(file=>{
      const active=file.id===current.id,project=active?state:file.project;
      return `<article class="project-file-row ${active?'current':''}"><span class="project-file-icon">${icon('file-json')}</span><div class="project-file-info"><button class="project-file-name" ${trash?'disabled':`data-open-file="${file.id}"`} title="${escapeHTML(file.title)}">${escapeHTML(file.title)}</button><small>${escapeHTML(project.name)} · ${project.floors.length} 层 · ${project.entities.length} 个对象</small><time datetime="${file.deletedAt||file.updatedAt}">${trash?'移入回收站':'保存于'} ${fileDate(file.deletedAt||file.updatedAt)}</time></div>${active?'<span class="file-current-badge">当前</span>':''}<div class="project-file-actions">${trash?`<button class="button" data-restore-file="${file.id}">${icon('undo-2')}恢复</button>`:`<button class="icon-btn" data-rename-file="${file.id}" aria-label="重命名 ${escapeHTML(file.title)}" title="重命名">${icon('pencil')}</button><button class="icon-btn" data-copy-file="${file.id}" aria-label="复制 ${escapeHTML(file.title)}" title="复制方案">${icon('copy')}</button><button class="icon-btn" data-trash-file="${file.id}" ${projectFiles.list().length===1?'disabled':''} aria-label="移入回收站 ${escapeHTML(file.title)}" title="移入回收站">${icon('trash-2')}</button>`}</div></article>`;
    }).join(''):`<div class="file-empty">${icon(trash?'trash-2':'search')}<strong>${filesSearch?'没有匹配的方案':trash?'回收站为空':'还没有方案'}</strong></div>`}</div>
    <div class="file-manager-footer"><span>${trash?'恢复后可在「我的方案」中打开。':'切换方案前会自动保存当前设计。'}</span><button class="button" data-close-modal>继续设计</button></div>`,searchFocused?'#files-search':'#new-project');
  $('.modal').classList.add('file-manager');
  if(searchFocused){$('#files-search').focus();$('#files-search').setSelectionRange(searchCursor,searchCursor);}
}
function showNewProject(template='blank') {
  modal(`<div class="modal-icon">${icon('file-plus-2')}</div><h2>新建车站方案</h2><p>当前方案会保留在「我的方案」中。</p><form id="new-project-form"><label class="field"><span>方案名称</span><input name="title" required maxlength="100" value="${escapeHTML(projectFiles.uniqueTitle(template==='example'?'上海火车站示例':'未命名车站'))}" autocomplete="off"></label><label class="field"><span>初始内容</span><select name="template"><option value="blank" ${template==='blank'?'selected':''}>空白车站 · 2 个楼层</option><option value="example" ${template==='example'?'selected':''}>上海火车站示例</option></select></label><div class="modal-actions"><button type="button" class="button" data-open-files>返回文件管理</button><button class="button primary" type="submit">创建方案</button></div></form>`);
}
function showFileName(id,duplicate=false) {
  const file=projectFiles.find(id),value=duplicate?projectFiles.uniqueTitle(`${file.title.slice(0,97)} 副本`):file.title;
  modal(`<div class="modal-icon">${icon(duplicate?'copy':'pencil')}</div><h2>${duplicate?'另存方案副本':'重命名方案'}</h2><form id="file-name-form" data-file-id="${id}" data-duplicate="${duplicate}"><label class="field"><span>方案名称</span><input name="title" required maxlength="100" value="${escapeHTML(value)}" autocomplete="off"></label><div class="modal-actions"><button type="button" class="button" data-open-files>取消</button><button class="button primary" type="submit">${duplicate?'创建副本':'保存名称'}</button></div></form>`);
}
function downloadProject() {
  save();download(JSON.stringify(state,null,2),projectFilename(projectFiles.current.title),'application/json');
  closeModal();toast('可编辑方案已下载');
}
function showExport() {
  cancelPlacement();
  modal(`<div class="modal-icon">${icon('package-open')}</div><h2>导出方案</h2><div class="export-image-settings"><label class="toggle-row"><span>底部文字标注</span><input type="checkbox" id="export-footer" role="switch" ${exportWithFooter?'checked':''}><i></i></label><div class="export-footer-preview" id="export-footer-preview" ${exportWithFooter?'':'hidden'}>RMCreator · ${escapeHTML(state.lines.map(line=>line.name).join(' / '))} · ${state.entities.length} 个构件<br>车站空间示意图 · 设计方案</div></div><button class="export-option" id="export-png"><span class="export-type">${icon('image')}</span><span><strong>导出高清示意图</strong><small>PNG 图片 · 当前视角 · 包含名称与标记</small></span>${icon('arrow-up-right')}</button><button class="export-option" id="export-json"><span class="export-type">${icon('file-json')}</span><span><strong>保存可编辑方案</strong><small>JSON 文件 · 保留全部构件与显示设置</small></span>${icon('arrow-up-right')}</button>`);
}
function showHelp() {
  modal(`<div class="modal-icon">${icon('mouse-pointer-2')}</div><h2>使用帮助</h2><div class="help-steps"><div><b>01</b><span><strong>选层与填色</strong>选择楼层与区域颜色。单击添加角点，按下拖动拉出曲线手柄；点击起点或 Enter 闭合，Esc 取消。</span></div><div><b>02</b><span><strong>放置与吸附</strong>轨道点击起终点，可吸附已有轨道端点或中心线；楼梯和扶梯支持任意方向，两点分别选择不同楼层，可向上、向下或跨多层连接；电梯点击井道对角点。换层保留放置，全部楼层下可虚化其他层。靠近边缘或中线显示对齐参考线，绘制区域时可匹配等宽 / 等长；按住 Alt 临时关闭吸附。红色预览不可放置，Esc 取消。</span></div><div><b>03</b><span><strong>独立文字</strong>按 T 输入文字并点击楼层放置，可选贴地文字或朝向相机的引线标注。拖动文字移动位置，属性中调整字号、横竖排和颜色；悬浮文字可启用锚点，在画布取点或拖动端点设置指向位置。</span></div></div><div class="shortcut-grid"><span>选择<kbd>V</kbd></span><span>文字<kbd>T</kbd></span><span>移动<kbd>G</kbd></span><span>平移<kbd>H</kbd></span><span>适应画布<kbd>F</kbd></span><span>撤销<kbd>Ctrl Z</kbd></span><span>删除<kbd>Delete</kbd></span><span>上一层<kbd>+</kbd></span><span>下一层<kbd>-</kbd></span><span>暂停吸附<kbd>Alt</kbd></span><span>取消选择 / 放置<kbd>Esc</kbd></span></div><button class="button primary full-width" data-close-modal>开始设计 ${icon('arrow-right')}</button>`);
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('button, [data-close-modal]');
  if (!target) { if (event.target.classList.contains('modal-backdrop')) closeModal(); return; }
  if(target.hasAttribute('data-open-files')){showFiles();return;}
  if(target.dataset.filesView){filesView=target.dataset.filesView;filesSearch='';showFiles();return;}
  if(target.dataset.openFile){fileAction(()=>{activateProject(projectFiles.open(target.dataset.openFile));toast('已打开方案');});return;}
  if(target.dataset.renameFile){fileAction(()=>showFileName(target.dataset.renameFile));return;}
  if(target.dataset.copyFile){fileAction(()=>showFileName(target.dataset.copyFile,true));return;}
  if(target.dataset.trashFile){fileAction(()=>{const active=projectFiles.current.id===target.dataset.trashFile,next=projectFiles.trash(target.dataset.trashFile);if(active)activateProject(next);showFiles();toast('方案已移入回收站，可随时恢复');});return;}
  if(target.dataset.restoreFile){fileAction(()=>{projectFiles.restore(target.dataset.restoreFile);showFiles();toast('方案已恢复');});return;}
  if (target.dataset.inspector) setInspectorTab(target.dataset.inspector);
  if (target.dataset.library) { libraryTab = target.dataset.library; renderLibrary(); }
  if (target.dataset.paint) startPaint(target.dataset.paint);
  if(target.dataset.zoneMode)scene.zoneEditor.setMode(target.dataset.zoneMode);
  if(target.dataset.zoneType)scene.zoneEditor.convert(target.dataset.zoneType);
  if(target.dataset.zoneVertex!==undefined){const index=Number(target.dataset.zoneVertex),selection=scene.zoneEditor.selected;if(event.shiftKey){selection.has(index)?selection.delete(index):selection.add(index);}else scene.zoneEditor.selected=new Set([index]);scene.zoneEditor.notify();scene.zoneEditor.render();}
  if(target.dataset.trackMode){scene.changeTrackMode(target.dataset.trackMode);return;}
  if(target.dataset.pathSplit!==undefined)commit(()=>{const e=state.entities.find(e=>e.id===selected);if(e)Object.assign(e,splitQuadraticSegment(e,Number(target.dataset.pathSplit)));});
  if(target.dataset.pathSegmentRemove!==undefined)commit(()=>{const e=state.entities.find(e=>e.id===selected);if(e)Object.assign(e,removeQuadraticSegment(e,Number(target.dataset.pathSegmentRemove)));});
  if(target.dataset.pathInsert!==undefined)commit(()=>{const e=state.entities.find(e=>e.id===selected),i=Number(target.dataset.pathInsert);if(e?.path&&i<e.path.length-1&&e.path.length<32){const a=e.path[i],b=e.path[i+1];e.path.splice(i+1,0,{x:(a.x+b.x)/2,z:(a.z+b.z)/2});}});
  if(target.dataset.pathRemove!==undefined)commit(()=>{const e=state.entities.find(e=>e.id===selected),i=Number(target.dataset.pathRemove);if(e?.path&&e.path.length>2){if(i===0)delete e.joins?.start;if(i===e.path.length-1)delete e.joins?.end;e.path.splice(i,1);}});
  if(target.dataset.pathAuto!==undefined)commit(()=>{const e=state.entities.find(e=>e.id===selected),i=Number(target.dataset.pathAuto);if(e?.path){delete e.path[i].tx;delete e.path[i].tz;if(i===0)delete e.joins?.start;if(i===e.path.length-1)delete e.joins?.end;}});
  if (target.dataset.add) {
    if(target.dataset.add==='text'){startTextTool();return;}
    stopPaint();
    if (state.entities.filter(e=>!['train','text'].includes(e.type)).length >= 200) { toast('当前方案最多支持 200 个构件'); return; }
    const type = target.dataset.add; const count = state.entities.filter(e => e.type === type).length;
    const id = `${type}-${Date.now()}-${++sequence}`;
    cancelPlacement(); const floor = activeFloor !== 'all' ? activeFloor : state.floors.find(f => f.id === types[type].floor)?.id || state.floors[0].id;
    const item = entity(id, type, `${types[type].name} ${count + 1}`, 0, 0, { floor }); if (type === 'exit') { item.exitNumber = String(count + 1); item.name = `${count+1} 号口`; } if(type === 'restroom') item.name='卫生间';
    if (type === 'train') {showTrainDialog(item);return;}
    if (type === 'track') { item.lineId = state.lines[0].id; item.color=state.lines[0].color; item.doorStyle='inherit'; item.direction='right-side'; }
    if (CONNECTION_TYPES.includes(type)) {
      const from=state.floors.find(f=>f.id===floor),next=state.floors.filter(f=>f.id!==floor).sort((a,b)=>Math.abs(a.elevation-from.elevation)-Math.abs(b.elevation-from.elevation))[0];
      if(!next){toast('请先添加另一个楼层');return;}
      item.toFloor=next.id;item.h=Math.max(.5,Math.abs(next.elevation-from.elevation)+(type==='elevator'?4:0));
      if(item.h>500){toast('连接高度不能超过 500 m，请调整楼层标高');return;}
    }
    startPlacement(item);
  }
  if (target.dataset.select) select(target.dataset.select, { fromLayers: true });
  if (target.dataset.sceneRoot) { setFloor('all'); select('station'); }
  if (target.dataset.toggleFloor) {
    const id = target.dataset.toggleFloor;
    if (collapsedFloors.has(id)) collapsedFloors.delete(id); else collapsedFloors.add(id);
    renderLibrary();
  }
  if (target.dataset.selectFloor) { selected = 'station'; setFloor(target.dataset.selectFloor); }
  if (target.dataset.editFloor) {
    const id = target.dataset.editFloor;
    editingFloor = editingFloor === id ? null : id;
    selected = 'station'; setFloor(id);
  }
  if (target.dataset.visibility) commit(() => { const e = state.entities.find(e => e.id === target.dataset.visibility); e.visible = !e.visible; });
  if(target.dataset.rotateText)commit(()=>{const e=state.entities.find(e=>e.id===selected);if(e?.type==='text')e.rotation=(e.rotation+Number(target.dataset.rotateText)+360)%360;});
  if (target.dataset.view) setView(target.dataset.view);
  if (target.dataset.floor) setFloor(target.dataset.floor);
  if (target.dataset.placeFloor) { setFloor(target.dataset.placeFloor); toast('已切换楼层'); }
  if (target.dataset.tool) setTool(target.dataset.tool);
  if (target.hasAttribute('data-close-modal')) closeModal();
  switch (target.id) {
    case 'add-text-tool': startTextTool();break;
    case 'pick-text-anchor':startTextAnchorPlacement();break;
    case 'reset-text-anchor':commit(()=>{const e=state.entities.find(e=>e.id===selected);if(e?.type==='text'){e.anchorX=e.x;e.anchorZ=e.z;}});break;
    case 'start-text-placement': {
      $('#modal-root').querySelectorAll('[data-text-draft]').forEach(input=>{const key=input.dataset.textDraft;textDraft[key]=input.type==='checkbox'?input.checked:['fontSize','leaderLength'].includes(key)?Number(input.value):input.value;});
      const error=textError(textDraft);if(error){toast(error);break;}
      const item=syncText(clone(textDraft));item.name=item.text.replace(/\s+/g,' ').slice(0,100);closeModal();startPlacement(item);break;
    }
    case 'zone-new':startPaint(paintKind);break;
    case 'opening-tool':startPaint('opening');break;
    case 'zone-opening':{const zone=state.zonePaths?.find(p=>p.id===selected);if(zone)workFloor=zone.floor;startPaint('opening');break;}
    case 'create-connection-openings':{
      const source=state.entities.find(e=>e.id===selected),paths=connectionOpeningPaths(state,source,`opening-${Date.now()}-${++sequence}`);
      if(!paths.length){toast('连接楼层没有可开洞的填色区域，或已存在开口');break;}
      if((state.zonePaths?.length||0)+paths.length>600){toast('区域数量已达上限');break;}
      if(commit(()=>{state.zonePaths||=[];state.zonePaths.push(...paths);})){select(paths.at(-1).id);toast(`已在 ${paths.length} 层生成孔洞，可独立调整轮廓`);}break;
    }
    case 'zone-snap':commit(()=>state.snapping=!state.snapping);break;
    case 'zone-close':scene.zoneEditor.close();break;
    case 'zone-undo-point':scene.zoneEditor.undoPoint();break;
    case 'zone-delete-points':scene.zoneEditor.deleteSelected();break;
    case 'zone-toggle-closed':scene.zoneEditor.toggleClosed();break;
    case 'delete-zone':removeSelected();break;
    case 'duplicate-zone':{const source=state.zonePaths?.find(p=>p.id===selected);if(source&&(state.zonePaths.length<600)){const copy=moveZoneVertices(source,source.vertices.map((v,i)=>i),{x:4,z:4});copy.id=`zone-${Date.now()}-${++sequence}`;if(copy.holes)copy.holes=copy.holes.map(vertices=>moveZoneVertices({vertices},vertices.map((v,i)=>i),{x:4,z:4}).vertices);if(commit(()=>state.zonePaths.push(copy)))select(copy.id);}break;}
    case 'start-train-placement': {const item=clone(trainDraft);closeModal();startPlacement(item);break;}
    case 'reposition-train': {const item=state.entities.find(e=>e.id===selected);if(item)startPlacement(clone(item),true);break;}
    case 'finish-track-path': scene.finishTrackPlacement(event);break;
    case 'undo-path-point': scene.undoTrackPoint();break;
    case 'convert-track-path': commit(()=>{const e=state.entities.find(e=>e.id===selected);if(e?.type==='track'&&!e.path){const [a,b]=pathKnots(e);e.path=[a,{x:(a.x+b.x)/2,z:(a.z+b.z)/2},b];e.pathKind='quadratic';delete e.pathSmoothness;}});break;
    case 'branch-track': {const source=state.entities.find(e=>e.id===selected);if(source?.type==='track'){if(state.entities.filter(e=>!['train','text'].includes(e.type)).length>=200){toast('当前方案最多支持 200 个构件');break;}stopPaint();const item=entity('track-'+Date.now(),'track','折返 / 渡线',0,0,{floor:source.floor,lineId:source.lineId,doorStyle:'none',drawMode:'connector',direction:trackLayout(state,source).forward?'forward':'backward',bandVisible:source.bandVisible,bandColor:source.bandColor});startPlacement(item);}break;}
    case 'reset-band-color': commit(()=>{const e=state.entities.find(e=>e.id===selected);if(e)delete e.bandColor;});break;
    case 'snap-existing': { let count=0; commit(()=>state.entities.filter(e=>e.type==='track'&&(activeFloor==='all'||e.floor===activeFloor)).forEach(e=>{const next=snapTrack(state,e);if(next.snapped&&(next.x!==e.x||next.z!==e.z)){e.x=next.x;e.z=next.z;count++;}}));toast(count?`已贴齐 ${count} 段轨道，边界设施已更新`:'轨道已贴齐，或附近 3 m 内没有付费区边缘');break; }
    case 'manage-lines': showLines(); break;
    case 'add-line': addLine(); break;
    case 'stop-paint': stopPaint(); select('station'); break;
    case 'manage-floors': showFloors(); break;
    case 'add-floor': addFloor(); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'select-station': case 'deselect': select('station'); break;
    case 'export': showExport(); break;
    case 'export-json': case 'download-project': downloadProject(); break;
    case 'export-png': {
      const button=$('#export');if(button.disabled)return;
      closeModal();button.disabled=true;toast('正在生成高清示意图…');
      try { await scene.exportPNG(state, { footer: exportWithFooter }); toast('高清示意图已导出'); }
      catch (error) { console.error(error);toast('图片导出失败，请重试'); }
      finally { button.disabled=false; }
      break;
    }
    case 'import': $('#file-input').click(); break;
    case 'zoom-in': scene.zoom(1.2); break;
    case 'zoom-out': scene.zoom(1 / 1.2); break;
    case 'fit-camera': scene.fit(); break;
    case 'rotate-camera': if (view === 'floor') setView('3d'); else scene.rotate(); break;
    case 'camera-button': modal(`<div class="modal-icon">${icon('camera')}</div><h2>选择观察视角</h2><p>从不同角度，理解车站空间。</p><div class="camera-options">${[['iso','box','等轴测视图'],['top','scan','正交俯视图'],['front','rectangle-horizontal','正立面视图']].map(([v,i,t]) => `<button class="button" data-camera="${v}">${icon(i)}${t}</button>`).join('')}</div>`); break;
    case 'fullscreen': if (!document.fullscreenElement) $('.canvas-panel').requestFullscreen?.(); else document.exitFullscreen?.(); break;
    case 'help': case 'guide': case 'shortcuts': showHelp(); break;
    case 'duplicate': {
      const original=state.entities.find(e=>e.id===selected);if(!original)break;
      if(state.entities.length>=600){toast('当前方案对象总数已达上限');break;}
      if(original.type==='text'&&state.entities.filter(e=>e.type==='text').length>=200){toast('当前方案最多支持 200 个文字对象');break;}
      if(!['train','text'].includes(original.type)&&state.entities.filter(e=>!['train','text'].includes(e.type)).length>=200){toast('当前方案最多支持 200 个构件');break;}
      const copy={...clone(original),id:`${original.type}-${Date.now()}-${++sequence}`,name:`${original.name.slice(0,97)} 副本`,x:original.x+8,z:original.z+5};
      if(original.type==='text'&&original.textMode==='callout'&&original.anchorEnabled!==false){copy.anchorX=(original.anchorX??original.x)+8;copy.anchorZ=(original.anchorZ??original.z)+5;}
      if(original.type==='train'){showTrainDialog(copy);break;}
      delete copy.joins;commit(()=>{state.entities.push(copy);selected=copy.id;});break;
    }
    case 'delete-entity': removeSelected(); break;
    case 'project-menu': if(isDirty)save();filesView='active';filesSearch='';showFiles();break;
    case 'new-project': fileAction(()=>showNewProject());break;
    case 'new-template': fileAction(()=>showNewProject('example'));break;
    case 'save-project': save(true);break;
    case 'save-current-file': if(save(true))showFiles();break;
    case 'open-json': $('#file-input').click();break;
  }
  if (target.dataset.deleteFloor) { deleteFloor(target.dataset.deleteFloor); return; }
  if (target.dataset.confirmDeleteFloor) { const id = target.dataset.confirmDeleteFloor; const sourceFloor=state.floors.find(f=>f.id===id),destination=state.floors.filter(f=>f.id!==id).sort((a,b)=>Math.abs(a.elevation-sourceFloor.elevation)-Math.abs(b.elevation-sourceFloor.elevation))[0];if(Object.keys({...state.zones[id],...state.zones[destination.id]}).length>CELL_LIMIT){toast('合并后区域过大，请先擦除部分填色');return;} stopPaint(); commit(() => { const source = state.floors.find(f => f.id === id); const dest = state.floors.filter(f => f.id !== id).sort((a,b) => Math.abs(a.elevation-source.elevation)-Math.abs(b.elevation-source.elevation))[0]; state.entities.forEach(e => { if (e.floor === id) e.floor = dest.id; }); vectorizeCells(state,id);vectorizeCells(state,dest.id);if(state.zonePaths)state.zonePaths=[...state.zonePaths.filter(p=>p.floor===id).map(p=>({...p,floor:dest.id})),...state.zonePaths.filter(p=>p.floor!==id)];state.zones[dest.id] = {...state.zones[id],...state.zones[dest.id]}; delete state.zones[id]; state.floors = state.floors.filter(f => f.id !== id); activeFloor = dest.id; }); showFloors(); toast('视图层已删除，构件与填色已合并到相邻层'); }
  if (target.dataset.deleteLine) { removeLine(target.dataset.deleteLine); return; }
  if (target.dataset.camera) { cancelPlacement(); const cam = target.dataset.camera; closeModal(); if (cam === 'top') setView('floor'); else { if (view === 'floor') setView('3d'); scene.cameraPreset(cam); $('#camera-button span').textContent = cam === 'front' ? '正立面视图' : '等轴测视图'; } }
});
document.addEventListener('submit',event=>{
  const form=event.target;
  if(!['new-project-form','file-name-form'].includes(form.id))return;
  event.preventDefault();const title=new FormData(form).get('title');
  fileAction(()=>{
    if(form.id==='new-project-form'){
      const project=new FormData(form).get('template')==='example'?defaultProject():blankProject(title);
      activateProject(projectFiles.create(title,project));toast('新方案已创建，原方案已保留');
    }else if(form.dataset.duplicate==='true'){
      activateProject(projectFiles.duplicate(form.dataset.fileId,title));toast('副本已保存并打开');
    }else{projectFiles.rename(form.dataset.fileId,title);showFiles();toast('方案已重命名');}
  });
});
document.addEventListener('input',event=>{
  if(event.target.id==='files-search'){filesSearch=event.target.value;if(!event.isComposing)showFiles();}
});
document.addEventListener('compositionend',event=>{if(event.target.id==='files-search'){filesSearch=event.target.value;showFiles();}});
document.addEventListener('change', (event) => {
  const input = event.target;
  if(input.hasAttribute('data-fade-floors')){
    scene.fadeOtherFloors=input.checked;scene.applyFloorFocus();
    document.querySelectorAll('[data-fade-floors]').forEach(el=>el.checked=input.checked);return;
  }
  if(input.dataset.placementFloor){
    const p=scene.placement;if(!p)return;
    scene.changePlacementFloor(input.value,input.dataset.placementFloor==='to');
    if(activeFloor!=='all'&&(input.dataset.placementFloor==='from'||p.start))setFloor(input.value);else scene.refreshPlacement();return;
  }
  if(input.hasAttribute('data-zone-floor')){
    const editor=scene.zoneEditor;if(!editor.drawing||editor.path.vertices.length)return;
    editor.path.floor=input.value;workFloor=input.value;editor.notify();
    if(activeFloor!=='all')setFloor(input.value);else editor.render();return;
  }
  if(input.dataset.textDraft){
    const key=input.dataset.textDraft,value=input.type==='checkbox'?input.checked:['fontSize','leaderLength'].includes(key)?Number(input.value):input.value;
    textDraft[key]=value;if(key==='textMode')$('#modal-root [data-callout-settings]').hidden=value!=='callout';return;
  }
  if(input.dataset.draftProperty||input.dataset.draftDimension){
    if(!trainDraft)return;
    if(input.dataset.draftDimension){
      const key=input.dataset.draftDimension,value=Number(input.value);
      if(!input.value.trim()||!validTrainDimension(key,value)){toast('请输入范围内的有效列车参数');showTrainDialog(trainDraft);return;}
      editTrainDimension(trainDraft,key,value);
    }else{
      const key=input.dataset.draftProperty;
      if(key==='trainPreset')chooseTrainPreset(trainDraft,input.value);
      else if(key==='floor')trainDraft.floor=input.value;
      else trainDraft[key]=Number(input.value);
    }
    showTrainDialog(trainDraft);return;
  }
  if (input.id === 'export-footer') { exportWithFooter=input.checked;$('#export-footer-preview').hidden=!exportWithFooter; }
  if(input.id==='zone-kind'){const zone=state.zonePaths?.find(p=>p.id===selected);if(zone){commit(()=>zone.kind=input.value);paintKind=input.value;scene.zoneEditor.edit(zone.id);}}
  if(input.id==='zone-contour')scene.zoneEditor.setContour(Number(input.value));
  if(input.id==='opening-shape')scene.zoneEditor.setDrawShape(input.value);
  if(input.dataset.zoneCoordinate){
    const editor=scene.zoneEditor,index=[...editor.selected][0],key=input.dataset.zoneCoordinate,axis=input.dataset.axis,value=Number(input.value);
    if(index!==undefined&&Number.isFinite(value)&&Math.abs(value)<=500){const v=editor.ring.vertices[index],p={...v[key],[axis]:value};editor.ring=key==='pos'?moveZoneVertices(editor.ring,[index],{x:p.x-v.pos.x,z:p.z-v.pos.z}):moveZoneHandle(editor.ring,index,key,p);editor.persist();}return;
  }
  if (input.id === 'auto-railings') commit(()=>state.boundaries.railings=input.checked);
  if (input.id === 'default-screen-doors') commit(()=>state.boundaries.screenDoors=input.value);
  if (input.id === 'snap-enabled') commit(()=>state.snapping=input.checked);
  if (input.dataset.lineName) { const name=input.value.trim(); if(name) commit(()=>state.lines.find(l=>l.id===input.dataset.lineName).name=name); }
  if (input.dataset.lineColor) commit(()=>state.lines.find(l=>l.id===input.dataset.lineColor).color=input.value);
  if (input.id === 'floor-spacing') { const n = Number(input.value); if (n < 1 || n > 40 || !Number.isFinite(n)) { toast('层间距需为 1–40 米'); renderLibrary(); return; } commit(() => applyFloorSpacing(n)); }
  if (input.dataset.floorCode) { const code=input.value.trim();if(!code||code.length>10){toast('楼层简写需为 1–10 个字符');renderLibrary();return;}commit(()=>state.floors.find(f=>f.id===input.dataset.floorCode).code=code); }
  if (input.dataset.floorName) { const name = input.value.trim(); if (!name) { renderLibrary(); return; } commit(() => state.floors.find(f => f.id === input.dataset.floorName).name = name); }
  if (input.dataset.floorElevation) { const n = Number(input.value); if (!input.value.trim() || !Number.isFinite(n) || n < -100 || n > 400) { toast('标高需为 -100–400 米'); renderLibrary(); return; } commit(() => state.floors.find(f => f.id === input.dataset.floorElevation).elevation = n); }
  if (input.dataset.display) commit(() => state.display[input.dataset.display] = input.checked);
  if (input.dataset.stationProperty) {
    const key = input.dataset.stationProperty;
    if (['name','english'].includes(key) && (input.value.trim()||key==='english')) commit(() => state[key] = input.value);
    else renderInspector();
  }
  if(input.dataset.stairEndpoint!==undefined){
    const source=state.entities.find(e=>e.id===selected);if(!isStair(source))return;
    const axis=input.dataset.endpointAxis,value=axis==='floor'?input.value:Number(input.value);
    if(axis!=='floor'&&!input.value.trim()){toast('请输入有效的端点坐标');renderInspector();return;}
    const result=editStairEndpoint(state,source,Number(input.dataset.stairEndpoint),{[axis]:value});
    if(!result.valid){toast(result.message);renderInspector();return;}
    commit(()=>{Object.assign(source,result.entity);if(!result.entity.toFloor)delete source.toFloor;});return;
  }
  if(input.dataset.pathIndex!==undefined){
    const value=Number(input.value),index=Number(input.dataset.pathIndex),axis=input.dataset.pathAxis;
    if(!input.value.trim()||!Number.isFinite(value)||Math.abs(value)>500){toast('路径坐标需在 ±500 m 内');renderInspector();return;}
    commit(()=>{const e=state.entities.find(e=>e.id===selected);if(e?.path){const point=worldPoint(e,e.path[index]);point[axis]=value;Object.assign(e,moveTrackKnot(state,e,index,point));}});return;
  }
  if(input.dataset.pathAngle!==undefined){
    const value=Number(input.value),index=Number(input.dataset.pathAngle);
    if(!Number.isFinite(value)||Math.abs(value)>720){renderInspector();return;}
    commit(()=>{const e=state.entities.find(e=>e.id===selected);if(e?.path){if(index===0)delete e.joins?.start;if(index===e.path.length-1)delete e.joins?.end;const point=e.path[index];if(!input.value.trim()){delete point.tx;delete point.tz;}else{const a=(value-e.rotation)*Math.PI/180;point.tx=Math.cos(a);point.tz=Math.sin(a);}}});return;
  }
  if (input.dataset.property) {
    const key = input.dataset.property; let value = input.type === 'checkbox' ? input.checked : input.value;
    if (key === 'trainPreset') {
      commit(() => { const e = state.entities.find(e => e.id === selected); if (e?.type === 'train') chooseTrainPreset(e, value); });
      return;
    }
    const numeric = ['l','d','h','x','z','fontSize','leaderLength','anchorX','anchorZ','rotation','floorHeight','trainCars','trainUnits','trainOffset','pathSmoothness'].includes(key);
    if (key === 'trainCars' && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > MAX_TRAIN_CARS)) { toast(`车厢数量需为 1–${MAX_TRAIN_CARS} 节`); renderInspector(); return; }
    if (key === 'trainUnits' && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > MAX_TRAIN_UNITS)) { toast(`重联组数需为 1–${MAX_TRAIN_UNITS} 组`); renderInspector(); return; }
    if (key === 'floorHeight' && (Number(value) < 1 || Number(value) > 40 || !Number.isFinite(Number(value)))) { toast('层间距需为 1–40 米'); renderInspector(); return; }
    if (numeric) { value = Number(value); if (!Number.isFinite(value) || (['l','d','h','floorHeight'].includes(key) && value < .2) || Math.abs(value) > 500) { toast('请输入有效的尺寸或坐标（最大 500）'); renderInspector(); return; } }
    else if (!String(value).trim() && key !== 'toFloor') { renderInspector(); return; }
    commit(() => {
      const e=state.entities.find(e=>e.id===selected);
      if(e) { if(e.type==='text'&&['x','z'].includes(key))Object.assign(e,moveText(e,{[key]:value}));else{if(e.type==='text'&&['anchorX','anchorZ'].includes(key)){e.anchorX??=e.x;e.anchorZ??=e.z;}e[key]=value;} if(e.type==='track'&&['x','z','rotation','floor'].includes(key))delete e.joins; if(e.type==='train'&&key==='trackId')e.trainOffset=0; if(e.type==='track'&&['x','z','l','d','rotation','floor'].includes(key)) { const snapped=snapTrack(state,e);e.x=snapped.x;e.z=snapped.z; if(snapped.snapped)toast('轨道已吸附付费区边缘'); } }
    });
  }
  if (input.dataset.trainDimension) {
    const key = input.dataset.trainDimension, value = Number(input.value);
    if (!input.value.trim() || !validTrainDimension(key, value)) { toast('请输入范围内的有效列车参数'); renderInspector(); return; }
    commit(() => { const e = state.entities.find(e => e.id === selected); if (e?.type === 'train') editTrainDimension(e, key, value); });
  }
});
$('#component-search').addEventListener('input', (e) => { search = e.target.value; if (search.trim()) collapsedFloors.clear(); renderLibrary(); });
$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try { if (file.size > 3e6) throw new Error('文件过大'); const project = migrateProject(JSON.parse(await file.text()));fileAction(()=>{activateProject(projectFiles.create(file.name.replace(/\.json$/i,'').slice(0,100)||project.name,project));toast(project.entities.some(e=>e.type==='train'&&!trainFit(project,e).valid)?'已打开方案；部分旧列车空间不足，请调整编组或轨道':'已打开车站方案，原方案已保留');}); }
  catch { toast('无法读取方案，请选择由车站设计器导出的有效 JSON 文件'); } e.target.value = '';
});
document.addEventListener('keydown', (e) => {
  if(e.isComposing)return;
  if(e.ctrlKey||e.metaKey){
    const key=e.key.toLowerCase();
    if(key==='s'){e.preventDefault();if(e.shiftKey)fileAction(()=>showFileName(projectFiles.current.id,true));else save(true);return;}
    if(key==='o'){e.preventDefault();$('#file-input').click();return;}
    if(key==='n'){e.preventDefault();fileAction(()=>showNewProject());return;}
  }
  if (e.key === 'Escape') { e.preventDefault();stopPaint(); cancelPlacement(); closeModal(); select('station'); return; }
  const editing=!!e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  if(!editing&&!$('#modal-root').children.length&&scene?.zoneEditor.key(e)){e.preventDefault();return;}
  if (e.target.matches('[data-inspector]') && ['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) {
    e.preventDefault();
    const next = e.key === 'Home' ? 'station' : e.key === 'End' ? 'object' : inspectorTab === 'station' ? 'object' : 'station';
    setInspectorTab(next, { focus: true });
    return;
  }
  if(scene?.placement?.trackMode==='curve'&&!editing&&['Enter','Backspace'].includes(e.key)){e.preventDefault();e.key==='Enter'?scene.finishTrackPlacement(e):scene.undoTrackPoint();return;}
  if (editing) { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA'&&!e.target.closest('form')) e.target.blur(); return; }
  if($('#modal-root').children.length)return;
  const floorDirection=floorShortcut(e);
  if(floorDirection){e.preventDefault();stepFloor(floorDirection);return;}
  if (e.ctrlKey || e.metaKey) { if (e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); } if (e.key.toLowerCase() === 'k') { e.preventDefault(); $('#component-search').focus(); } return; }
  if ($('#modal-root').children.length) return;
  if(e.key.toLowerCase()==='p'){e.preventDefault();startPaint(paintKind);return;}
  if(e.key.toLowerCase()==='t'&&!$('#modal-root').children.length){e.preventDefault();startTextTool();return;}
  if (e.key.toLowerCase() === 'v') setTool('select'); if (e.key.toLowerCase() === 'g') setTool('move'); if (e.key.toLowerCase() === 'h') setTool('pan'); if (e.key.toLowerCase() === 'f') scene.fit(); if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); }
});
function removeSelected() { if (selected === 'station') return; const zone=state.zonePaths?.find(p=>p.id===selected);if(zone)stopPaint();commit(() => { if(zone)state.zonePaths=state.zonePaths.filter(p=>p.id!==selected);else removeWithTrains(state,selected); selected = 'station'; }); toast(zone?'区域已删除，可撤销恢复':'构件已删除，可撤销恢复'); }
function download(data, filename, mime) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: mime })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function escapeHTML(v) { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }


render(false);
try {
  scene = new StationScene($('#viewport'), { onLegacyZoneSelect:(floor,point)=>{commit(()=>vectorizeCells(state,floor));const zone=[...(state.zonePaths||[])].reverse().find(p=>p.floor===floor&&p.kind!=='erase'&&p.closed&&polygonContains(pathPolygon(p),point));if(zone)select(zone.id);}, onZoneState:ui=>{zoneUI=ui;paintActive=!!ui;if(ui)paintKind=ui.kind;renderPaintToolbar();const zone=state.zonePaths?.find(p=>p.id===selected);if(zone&&ui)renderZoneInspector(zone);}, onZoneMessage:toast, onZoneCancel:()=>{stopPaint();select('station');}, onZoneChange:(path)=>{selected=path.id;paintKind=path.kind;paintActive=true;inspectorTab='object';libraryTab='layers';commit(()=>{state.zonePaths||=[];const i=state.zonePaths.findIndex(p=>p.id===path.id);if(i<0)state.zonePaths.push(path);else state.zonePaths[i]=path;});}, onPlacementChange:updatePlacementBanner, onSelect: select, onZoom: (z) => $('#zoom-value').textContent = `${Math.round(z * 100)}%`, onMoveStart: () => {}, onStairEndpointChange:(id,target)=>commit(()=>{const e=state.entities.find(e=>e.id===id);if(isStair(e))Object.assign(e,target);}), onPathChange:(id,target)=>commit(()=>{const e=state.entities.find(e=>e.id===id);if(e)Object.assign(e,target);}), onSnap: (message) => { const el=$('#snap-feedback');el.textContent=message;el.hidden=!message; }, onTextAnchorMove:(id,point)=>commit(()=>{const e=state.entities.find(e=>e.id===id);if(e)Object.assign(e,{anchorEnabled:true,anchorX:point.x,anchorZ:point.z});}), onMove: (id, target) => commit(()=>{const e=state.entities.find(e=>e.id===id);if(e){if(e.type==='text')Object.assign(e,moveText(e,{x:target.x,z:target.z}));else{e.x=target.x;e.z=target.z;}if(e.type==='track')delete e.joins;if(e.type==='train'){e.trackId=target.trackId;e.trainOffset=target.trainOffset;}}}) });
  syncTrackPaths(state); syncConnections(); syncTrains(state); scene.update(state, view, activeFloor, selected); scene.fit(); $('.scene-loading').remove();
} catch (error) { console.error(error); $('.scene-loading').innerHTML = `${icon('triangle-alert')}<span>3D 场景初始化失败，请使用支持 WebGL 的浏览器并开启硬件加速。</span>`; refreshIcons(); }
window.addEventListener('beforeunload', () => { if (isDirty) save(); });
if(!projectFiles.persisted)save();
if(projectFiles.warning)toast(projectFiles.warning);
