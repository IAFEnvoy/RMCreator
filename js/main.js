import { elements } from "./dom.js";
import "./modal-a11y.js";
import {
  createRandomLineTypeId,
  getColorListDefault,
  getLineTypeById,
  loadCustomLineTypes,
  normalizeLineType,
  persistCustomLineTypes
} from "./line/type-store.js";
import { createLineManager } from "./line/manager.js";
import { createColorPickerModal } from "./color-picker-modal.js";
import { createShapeManager } from "./shape/manager.js";
import { createStationManager } from "./station/manager.js";
import { createDrawingManager } from "./drawing-manager.js";
import {
  getShapeParameterDefaults,
  normalizeShapeParameterDefault,
  normalizeShapeParameters
} from "./shape/utils.js";
import { createRenderer } from "./render.js";
import { createEventBinder } from "./event.js";
import { createExportManager } from "./exports.js";
import { createContextMenu } from "./context-menu.js";
import { parseDrawingJson, serializeDrawingToJson } from "./serialization.js";
import { createMainClipboard } from "./clipboards.js";
import {
  clamp,
  normalizeColor,
  normalizeTextStyleFlags
} from "./utils.js";
import {
  activeDrawingIdStorageKey,
  appSettingsStorageKey,
  drawingsListStorageKey,
  geometryLabelMap
} from "./constants.js";
import { createHistoryManager } from "./history-manager.js";
import { preloadTemplates } from "./template-store.js";

const { linePreview, fileUndoBtn, fileRedoBtn, canvasBg } = elements;
const defaultAppSettings = Object.freeze({
  continuousSelectMode: true,
  continuousStationMode: true,
  continuousLineMode: true,
  continuousTextMode: true,
  continuousShapeMode: true,
  showGrid: true,
  arrowKeyPan: true,
  selectionGlowColor: "#2f6de5",
  selectionGlowSize: 4,
  themeAccentColor: "#2f6de5",
  defaultLineGeometry: "bend135",
  snapOverlap: true,
  snapAxisDiagonal: true,
  snapEqualSpacing: true,
  snapGrid: true,
  snapEqualSpacingOffset: 25,
  feedbackDuration: 0.63,
  enableContextMenu: true
});

const state = {
  activeTool: null,
  appSettings: { ...defaultAppSettings },
  stationTypes: [],
  lineTypes: [],
  stationPresetSource: [],
  shapePresetSource: [],
  menuSelection: {
    station: null,
    lineType: null,
    lineGeometry: null,
    shape: null
  },
  zoom: 1,
  pan: { x: 0, y: 0 },
  nodes: [],
  edges: [],
  labels: [],
  shapes: [],
  shapeLibrary: [],
  stationLibrary: [],
  selectedEntities: [],
  lineMoveMode: null,
  drag: {
    mode: null,
    stationId: null,
    lineStartStationId: null,
    moveEntities: [],
    snapTargets: null,
    snapAnchor: null,
    snapVisibleRect: null,
    marqueeStart: null,
    marqueeCurrent: null,
    didMove: false,
    lineSplitCandidate: null,
    suppressClick: false,
    fromX: 0,
    fromY: 0,
    panX: 0,
    panY: 0
  },
  lineManager: {
    selectedId: null,
    draft: null,
    isOpen: false,
    dragSegmentIndex: null
  },
  shapeManager: {
    selectedId: null,
    isOpen: false,
    primitiveType: "line",
    selectedPrimitiveIndex: null,
    selectedPrimitiveIndices: [],
    activeTab: "props",
    viewBox: { x: 0, y: 0, width: 240, height: 240 }
  },
  stationManager: {
    selectedId: null,
    isOpen: false,
    shapeQuery: ""
  },
  counter: 1
};

const getNextId = (prefix) => `${prefix}-${state.counter++}`;
const findLineType = (id) => getLineTypeById(state.lineTypes, id);
const createLineTypeId = () => createUniqueLineTypeId(new Set(state.lineTypes.map((item) => item.id)));
const createShapeId = () => createRandomLineTypeId("shape");
const createStationPresetId = () => createRandomLineTypeId("station-preset");

function moveLineInStack({ sourceId, targetId, mode }) {
  const edges = state.edges;
  const sourceIndex = edges.findIndex((edge) => edge.id === sourceId);
  if (sourceIndex < 0) {
    return false;
  }

  if (mode === "to-front") {
    if (sourceIndex === edges.length - 1) {
      return false;
    }
    edges.push(edges.splice(sourceIndex, 1)[0]);
    return true;
  }

  if (mode === "to-back") {
    if (sourceIndex === 0) {
      return false;
    }
    edges.unshift(edges.splice(sourceIndex, 1)[0]);
    return true;
  }

  if (mode === "up") {
    if (sourceIndex === edges.length - 1) {
      return false;
    }
    const nextIndex = sourceIndex + 1;
    [edges[sourceIndex], edges[nextIndex]] = [edges[nextIndex], edges[sourceIndex]];
    return true;
  }

  if (mode === "down") {
    if (sourceIndex === 0) {
      return false;
    }
    const nextIndex = sourceIndex - 1;
    [edges[sourceIndex], edges[nextIndex]] = [edges[nextIndex], edges[sourceIndex]];
    return true;
  }

  if (mode === "below" || mode === "above") {
    if (!targetId || targetId === sourceId) {
      return false;
    }

    const targetIndex = edges.findIndex((edge) => edge.id === targetId);
    if (targetIndex < 0) {
      return false;
    }

    if (mode === "below" && sourceIndex === targetIndex - 1) {
      return false;
    }

    if (mode === "above" && sourceIndex === targetIndex + 1) {
      return false;
    }

    const [edge] = edges.splice(sourceIndex, 1);
    let insertIndex = mode === "above" ? targetIndex + 1 : targetIndex;
    if (sourceIndex < insertIndex) {
      insertIndex -= 1;
    }
    edges.splice(insertIndex, 0, edge);
    return true;
  }

  return false;
}

let defaultLineTypes = [];
let lineManager = null;
let shapeManager = null;
let stationManager = null;
let drawingManager = null;
const exportManager = createExportManager({ elements });
const colorPicker = createColorPickerModal({ elements });

const renderer = createRenderer({
  state,
  elements,
  findLineType,
  getColorListDefault,
  colorPicker,
  openLineManager: () => lineManager?.open(),
  openShapeManager: () => shapeManager?.open(),
  openStationManager: () => stationManager?.open(),
  onAppSettingsChanged: updateAppSettings,
  moveLineInStack,
  applyStationType,
  getStationTypeIndexByStation,
  copySelection: () => clipboardController?.copySelection?.(),
  duplicateSelection: () => clipboardController?.duplicateSelection?.(),
  deleteSelectedEntity,
  onStateChanged: commitStateChange
});

lineManager = createLineManager({
  state,
  elements,
  createLineTypeId,
  colorPicker,
  renderSubmenu: renderer.renderSubmenu,
  renderLines: renderer.renderLines,
  onLineTypeUpdated,
  onStateChanged: commitStateChange
});

shapeManager = createShapeManager({
  state,
  elements,
  createShapeId,
  colorPicker,
  renderSubmenu: renderer.renderSubmenu,
  onPlacedShapeDefaultsUpdated: commitStateChange,
  onStateChanged: commitStateChange,
  rerenderScene
});

stationManager = createStationManager({
  state,
  elements,
  createStationPresetId,
  colorPicker,
  renderSubmenu: renderer.renderSubmenu,
  onStateChanged: commitStateChange,
  rerenderScene
});

drawingManager = createDrawingManager({
  state,
  elements,
  parseDrawingJson,
  safeSerializeSnapshot,
  applyDrawingData,
  confirmOverwrite
});

const mainClipboard = createMainClipboard({
  state,
  getNextId,
  selectEntities,
  rerenderScene,
  commitStateChange,
  deleteSelectedEntity
});

const clipboardController = {
  copySelection: () => (
    state.shapeManager?.isOpen
      ? shapeManager?.copySelection?.()
      : mainClipboard.copySelection()
  ),
  cutSelection: () => (
    state.shapeManager?.isOpen
      ? shapeManager?.cutSelection?.()
      : mainClipboard.cutSelection()
  ),
  duplicateSelection: () => (
    state.shapeManager?.isOpen
      ? shapeManager?.duplicateSelection?.()
      : mainClipboard.duplicateSelection()
  ),
  pasteSelection: () => (
    state.shapeManager?.isOpen
      ? shapeManager?.pasteSelection?.()
      : mainClipboard.paste()
  ),
  hasClipboard: () => mainClipboard.hasData()
};

const contextMenu = createContextMenu({
  state,
  elements,
  renderer,
  rerenderScene,
  copySelection: clipboardController.copySelection,
  cutSelection: clipboardController.cutSelection,
  pasteSelection: clipboardController.pasteSelection,
  deleteSelectedEntity,
  moveLineInStack,
  onStateChanged: commitStateChange,
  selectEntity,
  hasClipboard: clipboardController.hasClipboard
});

const eventBinder = createEventBinder({
  state,
  elements,
  renderer,
  findLineType,
  moveLineInStack,
  addStation,
  addLine,
  addText,
  addShape,
  selectEntity,
  selectEntities,
  toggleEntitySelection,
  clearSelection,
  deleteSelectedEntity,
  createNewDrawing,
  saveDrawing,
  exportDrawingAsSvg: exportManager.exportDrawingAsSvg,
  openPngExportModal: exportManager.openPngExportModal,
  importDataFromFile,
  openDrawingManager: () => drawingManager?.open?.(),
  undo,
  redo,
  shapeUndo: () => shapeManager?.undo?.(),
  shapeRedo: () => shapeManager?.redo?.(),
  copySelection: clipboardController.copySelection,
  cutSelection: clipboardController.cutSelection,
  pasteSelection: clipboardController.pasteSelection,
  insertStationOnLine,
  onStateChanged: commitStateChange
});

const historyManager = createHistoryManager({
  maxEntries: 120,
  applySnapshot: (snapshot) => {
    const drawing = parseDrawingJson(snapshot);
    applyDrawingData(drawing, { persistSnapshot: false, markTemporaryImported: false });
  },
  persistSnapshot: persistDrawingSnapshot
});

init();

async function init() {
  await preloadTemplates();
  await loadMenus();
  loadAppSettings();
  applyAppSettings();
  restoreDrawingFromLocalStorage();
  initHistoryBaseline();

  eventBinder.bindToolbar();
  eventBinder.bindCanvas();
  eventBinder.bindKeyboard();
  eventBinder.bindFileMenu();
  exportManager.bind();
  lineManager.bind();
  shapeManager.bind();
  stationManager.bind();
  drawingManager.bind();
  contextMenu.bind();

  renderer.renderSubmenu();
  rerenderScene();
  renderer.renderSettings();
  renderer.updateViewportTransform();
  renderer.updateZoomIndicator();
  registerServiceWorker();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  if (!window.isSecureContext) {
    return;
  }

  navigator.serviceWorker.register("/js/sw.js").catch(() => {
    // Ignore registration errors (offline or unsupported hosting).
  });
}

function updateAppSettings(patch = {}) {
  const hasDefaultLineGeometryPatch = Object.prototype.hasOwnProperty.call(patch, "defaultLineGeometry");

  state.appSettings = sanitizeAppSettings({ ...state.appSettings, ...patch });
  persistAppSettings();
  applyAppSettings();

  if (hasDefaultLineGeometryPatch && state.activeTool === "line") {
    state.menuSelection.lineGeometry = state.appSettings.defaultLineGeometry;
    renderer.renderSubmenu();
  }
}

function loadAppSettings() {
  try {
    const raw = localStorage.getItem(appSettingsStorageKey);
    if (!raw) {
      state.appSettings = { ...defaultAppSettings };
      return;
    }

    const parsed = JSON.parse(raw);
    state.appSettings = sanitizeAppSettings({ ...defaultAppSettings, ...parsed });
  } catch {
    state.appSettings = { ...defaultAppSettings };
  }
}

function persistAppSettings() {
  try {
    localStorage.setItem(appSettingsStorageKey, JSON.stringify(state.appSettings));
  } catch {
    // Ignore localStorage quota/availability errors.
  }
}

function applyAppSettings() {
  const glowBase = stripHexAlpha(
    state.appSettings.selectionGlowColor,
    defaultAppSettings.selectionGlowColor
  );
  const glow = toRgba(glowBase, 0.45);
  document.documentElement.style.setProperty("--selection-glow-color", glow);
  document.documentElement.style.setProperty(
    "--selection-glow-size",
    `${state.appSettings.selectionGlowSize}px`
  );

  const accent = stripHexAlpha(
    state.appSettings.themeAccentColor,
    defaultAppSettings.themeAccentColor
  );
  const accentRgb = hexToRgb(accent);
  const accentStrong = mixHexColors(accent, "#000000", 0.18);
  const accentSoft = mixHexColors(accent, "#ffffff", 0.88);
  const accentFocus = mixHexColors(accent, "#ffffff", 0.55);
  const accentInk = mixHexColors(accent, "#000000", 0.55);
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-rgb", `${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}`);
  document.documentElement.style.setProperty("--accent-strong", accentStrong);
  document.documentElement.style.setProperty("--accent-soft", accentSoft);
  document.documentElement.style.setProperty("--accent-focus", accentFocus);
  document.documentElement.style.setProperty("--accent-ink", accentInk);
  document.documentElement.style.setProperty("--soft", accentSoft);

  if (canvasBg) {
    canvasBg.setAttribute("visibility", state.appSettings.showGrid === false ? "hidden" : "visible");
  }
}

function sanitizeAppSettings(rawSettings) {
  const next = {
    ...defaultAppSettings,
    ...(rawSettings && typeof rawSettings === "object" ? rawSettings : {})
  };

  const validGeometries = Object.keys(geometryLabelMap);
  const defaultLineGeometry = validGeometries.includes(next.defaultLineGeometry)
    ? next.defaultLineGeometry
    : defaultAppSettings.defaultLineGeometry;

  return {
    continuousSelectMode: Boolean(next.continuousSelectMode),
    continuousStationMode: Boolean(next.continuousStationMode),
    continuousLineMode: Boolean(next.continuousLineMode),
    continuousTextMode: Boolean(next.continuousTextMode),
    continuousShapeMode: Boolean(next.continuousShapeMode),
    showGrid: next.showGrid !== false,
    arrowKeyPan: next.arrowKeyPan !== false,
    selectionGlowColor: normalizeHexColor(next.selectionGlowColor, defaultAppSettings.selectionGlowColor),
    selectionGlowSize: clamp(Number(next.selectionGlowSize) || defaultAppSettings.selectionGlowSize, 1, 30),
    themeAccentColor: normalizeHexColor(next.themeAccentColor, defaultAppSettings.themeAccentColor),
    defaultLineGeometry,
    snapOverlap: next.snapOverlap !== false,
    snapAxisDiagonal: next.snapAxisDiagonal !== false,
    snapEqualSpacing: next.snapEqualSpacing !== false,
    snapGrid: next.snapGrid !== false,
    snapEqualSpacingOffset: clamp(Number(next.snapEqualSpacingOffset) || defaultAppSettings.snapEqualSpacingOffset, 4, 80),
    feedbackDuration: clamp(
      Number(next.feedbackDuration) || defaultAppSettings.feedbackDuration,
      0,
      5
    ),
    enableContextMenu: next.enableContextMenu !== false
  };
}

function normalizeHexColor(input, fallback) {
  const value = String(input || "").trim();
  if (
    /^#[0-9a-fA-F]{3}$/.test(value)
    || /^#[0-9a-fA-F]{6}$/.test(value)
    || /^#[0-9a-fA-F]{8}$/.test(value)
  ) {
    return value.toLowerCase();
  }
  return fallback;
}

function stripHexAlpha(input, fallback) {
  const normalized = normalizeHexColor(input, fallback);
  return normalized.length === 9 ? normalized.slice(0, 7) : normalized;
}

function hexToRgb(hexColor) {
  const normalized = normalizeHexColor(hexColor, "#000000");
  const hex = normalized.length === 4
    ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
    : normalized;

  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16)
  };
}

function clampColorChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mixHexColors(baseColor, mixColor, mixRatio) {
  const base = hexToRgb(baseColor);
  const mix = hexToRgb(mixColor);
  const ratio = clamp(Number(mixRatio) || 0, 0, 1);
  const r = base.r + (mix.r - base.r) * ratio;
  const g = base.g + (mix.g - base.g) * ratio;
  const b = base.b + (mix.b - base.b) * ratio;
  const toHex = (channel) => clampColorChannel(channel).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toRgba(hexColor, alpha = 1) {
  const normalized = normalizeHexColor(hexColor, defaultAppSettings.selectionGlowColor);
  const hex = normalized.length === 4
    ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
    : normalized;

  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  const opacity = clamp(Number(alpha), 0, 1);

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

async function loadMenus() {
  const [stationRaw, lineRaw, shapeRaw] = await Promise.all([
    loadPresetJson("preset/stations.json"),
    loadPresetJson("preset/lines.json"),
    loadPresetJson("preset/shapes.json")
  ]);

  state.stationPresetSource = normalizePresetEntries(stationRaw);
  state.shapePresetSource = normalizePresetEntries(shapeRaw);

  const presetLineTypes = normalizePresetLineTypes(lineRaw);
  defaultLineTypes = presetLineTypes.map((item) => structuredClone(item));

  const customs = loadCustomLineTypes();
  const { customLineTypes, hasIdRepair } = resolveCustomLineTypes(customs);
  state.lineTypes = [...defaultLineTypes.map((item) => structuredClone(item)), ...customLineTypes];

  if (hasIdRepair) {
    persistCustomLineTypes(state.lineTypes);
  }
}

async function loadPresetJson(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

function normalizePresetEntries(raw) {
  if (!raw) {
    return [];
  }
  return Array.isArray(raw) ? raw : [raw];
}

function normalizePresetLineTypes(raw) {
  const entries = normalizePresetEntries(raw);
  const usedIds = new Set();

  return entries
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const baseId = String(entry.id || "").trim() || `preset-line-${index + 1}`;
      let nextId = baseId;
      let suffix = 2;
      while (usedIds.has(nextId)) {
        nextId = `${baseId}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(nextId);

      const normalized = normalizeLineType({
        ...entry,
        id: nextId,
        source: "custom"
      });
      if (!normalized) {
        return null;
      }

      return {
        ...normalized,
        id: nextId,
        source: "preset",
        isTemporaryImported: false
      };
    })
    .filter(Boolean);
}

function createNewDrawing() {
  if (!confirmOverwrite("新增贴图会覆盖当前内容，是否继续？")) {
    return;
  }
  const snapshot = createEmptySnapshot();
  const name = `未命名绘图 ${new Date().toLocaleString()}`;
  const record = createDrawingRecord(snapshot, name);
  const list = readDrawingsList();
  list.unshift(record);
  persistDrawingsList(list);
  setActiveDrawingId(record.id);

  try {
    const drawing = parseDrawingJson(snapshot);
    applyDrawingData(drawing, {
      persistSnapshot: true,
      markTemporaryImported: false,
      includePersistedPermanentCustoms: true
    });
    initHistoryBaseline();
  } catch {
    // ignore parse errors for empty snapshot
  }
}

function saveDrawing() {
  const json = serializeDrawingToJson(state);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  a.href = url;
  a.download = `rmcreator-drawing-${timestamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function loadDrawingFromFile(file) {
  if (!file) {
    return;
  }

  if (!confirmOverwrite("加载绘图会覆盖当前内容，是否继续？")) {
    return;
  }

  try {
    const text = await file.text();
    const drawing = parseDrawingJson(text);
    applyDrawingData(drawing, {
      persistSnapshot: true,
      markTemporaryImported: true,
      includePersistedPermanentCustoms: true
    });
    initHistoryBaseline();
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    window.alert(`加载失败：${message}`);
  }
}

async function importDataFromFile(file) {
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const payload = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (!payload || typeof payload !== "object") {
      window.alert("导入失败：文件格式无效。");
      return;
    }

    const type = String(payload.type || "").trim();
    const data = Array.isArray(payload.data) ? payload.data : [];
    if (!type) {
      window.alert("导入失败：缺少类型标识 type。");
      return;
    }
    if (!data.length) {
      window.alert("导入失败：文件中没有可导入的数据。");
      return;
    }

    if (type === "drawing") {
      drawingManager?.openImportSelection?.(data, file.name);
      return;
    }
    if (type === "lineType") {
      lineManager?.openImportSelection?.(data, file.name);
      return;
    }
    if (type === "shapeType") {
      shapeManager?.openImportSelection?.(data, file.name);
      return;
    }
    if (type === "stationType") {
      stationManager?.openImportSelection?.(data, file.name);
      return;
    }

    window.alert("导入失败：文件类型不匹配。仅支持 drawing、lineType、shapeType、stationType。");
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    window.alert(`导入失败：${message}`);
  }
}

function applyDrawingData(drawing, {
  persistSnapshot = true,
  markTemporaryImported = false,
  includePersistedPermanentCustoms = false
} = {}) {
  const incomingCustomLineTypes = drawing.customLineTypes
    .map((lineType) => normalizeLineType({ ...lineType, source: "custom" }))
    .filter(Boolean);

  const nextEdges = drawing.edges.map((edge) => ({
    ...edge,
    colorList: Array.isArray(edge.colorList) ? [...edge.colorList] : []
  }));

  const persistedPermanentCustoms = includePersistedPermanentCustoms
    ? loadCustomLineTypes().map((lineType) => ({
      ...lineType,
      source: "custom",
      isTemporaryImported: false
    }))
    : [];

  const dedupedIncomingCustoms = dedupeIncomingLineTypesAgainstPersisted(
    incomingCustomLineTypes,
    persistedPermanentCustoms,
    nextEdges,
    { enabled: includePersistedPermanentCustoms && !markTemporaryImported }
  );

  const reservedLineTypeIds = new Set(persistedPermanentCustoms.map((item) => item.id));

  const { customLineTypes } = resolveCustomLineTypes(dedupedIncomingCustoms, {
    edgesToRemap: nextEdges,
    markAsTemporaryImported: markTemporaryImported,
    reservedIds: [...reservedLineTypeIds]
  });

  state.lineTypes = [
    ...defaultLineTypes.map((item) => structuredClone(item)),
    ...persistedPermanentCustoms,
    ...customLineTypes
  ];

  state.nodes = drawing.nodes.map((node) => ({
    ...node,
    paramValues: node.paramValues && typeof node.paramValues === "object" ? { ...node.paramValues } : {},
    textValues: node.textValues && typeof node.textValues === "object" ? { ...node.textValues } : {},
    textStyleValues: node.textStyleValues && typeof node.textStyleValues === "object"
      ? Object.fromEntries(
        Object.entries(node.textStyleValues).map(([key, style]) => [key, normalizeTextStyleFlags(style)])
      )
      : {},
    textPlacement: node.textPlacement && typeof node.textPlacement === "object"
      ? { ...node.textPlacement }
      : { slot: "s" }
  }));
  state.edges = nextEdges;
  state.labels = drawing.labels.map((label) => ({
    ...label,
    ...normalizeTextStyleFlags(label)
  }));
  state.shapes = drawing.shapes.map((shape) => ({
    ...shape,
    paramValues: shape.paramValues && typeof shape.paramValues === "object" ? { ...shape.paramValues } : {}
  }));
  state.selectedEntities = [];
  state.drag = {
    mode: null,
    stationId: null,
    lineStartStationId: null,
    moveEntities: [],
    marqueeStart: null,
    marqueeCurrent: null,
    didMove: false,
    lineSplitCandidate: null,
    suppressClick: false,
    fromX: 0,
    fromY: 0,
    panX: 0,
    panY: 0
  };

  state.zoom = clamp(Number(drawing.viewport?.zoom) || 1, 0.3, 4);
  state.pan = {
    x: Number(drawing.viewport?.pan?.x) || 0,
    y: Number(drawing.viewport?.pan?.y) || 0
  };

  state.counter = Math.max(Number(drawing.counter) || 1, computeNextCounter());

  linePreview.setAttribute("visibility", "hidden");
  linePreview.setAttribute("d", "");

  if (state.lineManager.isOpen) {
    lineManager.close();
  }

  if (state.shapeManager.isOpen) {
    shapeManager.close();
  }

  if (state.stationManager.isOpen) {
    stationManager.close();
  }

  renderer.renderSubmenu();
  rerenderScene();
  renderer.renderSettings();
  renderer.updateViewportTransform();
  renderer.updateZoomIndicator();

  if (persistSnapshot) {
    persistDrawingSnapshot(safeSerializeSnapshot());
  }
}

function restoreDrawingFromLocalStorage() {
  const list = readDrawingsList();
  const activeId = localStorage.getItem(activeDrawingIdStorageKey);
  if (!list.length) {
    const snapshot = createEmptySnapshot();
    const name = `未命名绘图 ${new Date().toLocaleString()}`;
    const saved = createDrawingRecord(snapshot, name);
    persistDrawingsList([saved]);
    setActiveDrawingId(saved.id);
    try {
      const drawing = parseDrawingJson(saved.snapshot);
      applyDrawingData(drawing, {
        persistSnapshot: false,
        markTemporaryImported: false,
        includePersistedPermanentCustoms: true
      });
      return;
    } catch {
      // ignore initial apply errors
    }
  }
  if (activeId) {
    const saved = list.find((item) => String(item.id) === String(activeId));
    if (saved?.snapshot) {
      try {
        const drawing = parseDrawingJson(saved.snapshot);
        applyDrawingData(drawing, {
          persistSnapshot: false,
          markTemporaryImported: false,
          includePersistedPermanentCustoms: true
        });
        setActiveDrawingId(activeId);
        return;
      } catch {
        localStorage.removeItem(activeDrawingIdStorageKey);
      }
    } else {
      localStorage.removeItem(activeDrawingIdStorageKey);
    }
  }

  if (list.length) {
    const fallback = list[0];
    if (fallback?.snapshot) {
      try {
        const drawing = parseDrawingJson(fallback.snapshot);
        applyDrawingData(drawing, {
          persistSnapshot: false,
          markTemporaryImported: false,
          includePersistedPermanentCustoms: true
        });
        setActiveDrawingId(fallback.id);
        return;
      } catch {
        // ignore fallback errors
      }
    }
  }
}

function initHistoryBaseline() {
  historyManager.initBaseline(safeSerializeSnapshot());
  updateMainUndoRedoUI();
}

function commitStateChange(options) {
  const snapshot = safeSerializeSnapshot();
  historyManager.commit(snapshot, options);
  updateMainUndoRedoUI();
}

function undo() {
  try {
    historyManager.undo();
    updateMainUndoRedoUI();
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    window.alert(`撤销失败：${message}`);
  }
}

function redo() {
  try {
    historyManager.redo();
    updateMainUndoRedoUI();
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    window.alert(`重做失败：${message}`);
  }
}

function updateMainUndoRedoUI() {
  if (fileUndoBtn) {
    fileUndoBtn.disabled = !historyManager.canUndo();
    fileUndoBtn.setAttribute("aria-disabled", String(fileUndoBtn.disabled));
  }

  if (fileRedoBtn) {
    fileRedoBtn.disabled = !historyManager.canRedo();
    fileRedoBtn.setAttribute("aria-disabled", String(fileRedoBtn.disabled));
  }
}

function safeSerializeSnapshot() {
  try {
    return serializeDrawingToJson(state);
  } catch {
    return "";
  }
}

function createEmptySnapshot() {
  return JSON.stringify({
    version: 1,
    counter: 1,
    viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    nodes: [],
    edges: [],
    labels: [],
    shapes: [],
    customLineTypes: []
  });
}

function createDrawingRecord(snapshot, name) {
  const id = `drawing-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  let counts = { nodes: 0, edges: 0, labels: 0, shapes: 0 };
  try {
    const parsed = parseDrawingJson(snapshot);
    counts = {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes.length : 0,
      edges: Array.isArray(parsed.edges) ? parsed.edges.length : 0,
      labels: Array.isArray(parsed.labels) ? parsed.labels.length : 0,
      shapes: Array.isArray(parsed.shapes) ? parsed.shapes.length : 0
    };
  } catch {
    // keep defaults
  }
  const now = new Date().toISOString();
  return {
    id,
    name: String(name || `绘图 ${now}`),
    author: "",
    snapshot: String(snapshot),
    createdAt: now,
    modifiedAt: now,
    counts
  };
}

function readDrawingsList() {
  try {
    const raw = localStorage.getItem(drawingsListStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistDrawingsList(list) {
  try {
    localStorage.setItem(drawingsListStorageKey, JSON.stringify(list));
  } catch {
    // ignore storage errors
  }
}

function setActiveDrawingId(id) {
  if (state.drawingManager) {
    state.drawingManager.activeId = id || null;
  }
  if (id) {
    localStorage.setItem(activeDrawingIdStorageKey, String(id));
  } else {
    localStorage.removeItem(activeDrawingIdStorageKey);
  }
}

function updateActiveDrawingSnapshot(snapshot) {
  const activeId = state.drawingManager?.activeId || localStorage.getItem(activeDrawingIdStorageKey);
  if (!activeId) return false;
  const list = readDrawingsList();
  const idx = list.findIndex((item) => String(item.id) === String(activeId));
  if (idx < 0) return false;

  try {
    const parsed = parseDrawingJson(snapshot);
    const counts = {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes.length : 0,
      edges: Array.isArray(parsed.edges) ? parsed.edges.length : 0,
      labels: Array.isArray(parsed.labels) ? parsed.labels.length : 0,
      shapes: Array.isArray(parsed.shapes) ? parsed.shapes.length : 0
    };
    list[idx] = {
      ...list[idx],
      snapshot,
      counts,
      modifiedAt: new Date().toISOString()
    };
    persistDrawingsList(list);
    return true;
  } catch {
    return false;
  }
}

function persistDrawingSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }
  if (updateActiveDrawingSnapshot(snapshot)) {
    return;
  }
}

function hasDrawingContent() {
  return state.nodes.length > 0 || state.edges.length > 0 || state.labels.length > 0 || state.shapes.length > 0;
}

function confirmOverwrite(message) {
  if (!hasDrawingContent()) {
    return true;
  }

  return window.confirm(message);
}

function computeNextCounter() {
  const idSources = [
    ...state.nodes.map((item) => item.id),
    ...state.edges.map((item) => item.id),
    ...state.labels.map((item) => item.id),
    ...state.shapes.map((item) => item.id),
    ...state.lineTypes.map((item) => item.id)
  ];

  const maxIdNumber = idSources.reduce((max, id) => {
    const match = String(id || "").match(/-(\d+)$/);
    if (!match) {
      return max;
    }
    return Math.max(max, Number(match[1]) || 0);
  }, 0);

  return maxIdNumber + 1;
}

function resolveCustomLineTypes(customLineTypes, {
  edgesToRemap = null,
  markAsTemporaryImported = false,
  reservedIds = []
} = {}) {
  const defaultIds = new Set(defaultLineTypes.map((item) => item.id));
  const baseReservedIds = new Set([
    ...defaultIds,
    ...(Array.isArray(reservedIds) ? reservedIds.map((id) => String(id || "")).filter(Boolean) : [])
  ]);
  const usedIds = new Set(baseReservedIds);
  const idRemap = new Map();
  let hasIdRepair = false;

  const normalizedCustoms = (Array.isArray(customLineTypes) ? customLineTypes : [])
    .map((lineType) => normalizeLineType({ ...lineType, source: "custom" }))
    .filter(Boolean);

  const resolvedCustoms = normalizedCustoms.map((lineType) => {
    const rawId = String(lineType.id || "").trim();
    const candidateId = rawId || createUniqueLineTypeId(usedIds);
    const collidesWithBase = rawId && baseReservedIds.has(rawId);
    const shouldRepair = !rawId || usedIds.has(candidateId);
    let resolvedId = candidateId;

    if (shouldRepair) {
      resolvedId = createUniqueLineTypeId(usedIds);
      hasIdRepair = true;

      if (collidesWithBase) {
        idRemap.set(rawId, resolvedId);
      }
    }

    usedIds.add(resolvedId);

    return {
      ...lineType,
      source: "custom",
      isTemporaryImported: markAsTemporaryImported ? true : Boolean(lineType.isTemporaryImported),
      id: resolvedId
    };
  });

  if (Array.isArray(edgesToRemap) && idRemap.size) {
    edgesToRemap.forEach((edge) => {
      const currentId = String(edge.lineTypeId || "");
      const remappedId = idRemap.get(currentId);
      if (remappedId) {
        edge.lineTypeId = remappedId;
      }
    });
  }

  return {
    customLineTypes: resolvedCustoms,
    hasIdRepair
  };
}

function dedupeIncomingLineTypesAgainstPersisted(incoming, persisted, edges, { enabled } = {}) {
  if (!enabled || !Array.isArray(incoming) || !incoming.length || !Array.isArray(persisted) || !persisted.length) {
    return incoming;
  }

  const persistedById = new Map();
  const persistedBySignature = new Map();

  persisted.forEach((item) => {
    const id = String(item?.id || "").trim();
    if (id) {
      persistedById.set(id, item);
    }

    const signature = createLineTypeSignature(item);
    if (signature && !persistedBySignature.has(signature)) {
      persistedBySignature.set(signature, item);
    }
  });

  return incoming.filter((item) => {
    const id = String(item?.id || "").trim();
    if (id && persistedById.has(id)) {
      return false;
    }

    const signature = createLineTypeSignature(item);
    if (!signature) {
      return true;
    }

    const matched = persistedBySignature.get(signature);
    if (!matched) {
      return true;
    }

    const targetId = String(matched.id || "");
    if (!targetId) {
      return true;
    }

    if (id && Array.isArray(edges)) {
      edges.forEach((edge) => {
        if (String(edge?.lineTypeId || "") === id) {
          edge.lineTypeId = targetId;
        }
      });
    }

    return false;
  });
}

function createLineTypeSignature(lineType) {
  if (!lineType || typeof lineType !== "object") {
    return "";
  }

  const signature = {
    name: String(lineType.name || "").trim(),
    colorList: Array.isArray(lineType.colorList)
      ? lineType.colorList.map((color) => normalizeColor(color))
      : [],
    segments: Array.isArray(lineType.segments)
      ? lineType.segments.map((segment) => ({
        width: Number(segment.width) || 0,
        strokeStyle: String(segment.strokeStyle || "solid"),
        colorMode: String(segment.colorMode || "fixed"),
        paletteIndex: Number(segment.paletteIndex) || 0,
        fixedColor: normalizeColor(segment.fixedColor)
      }))
      : []
  };

  return JSON.stringify(signature);
}

function getUniqueCustomLineTypeId(usedIds) {
  let nextId = createRandomLineTypeId("custom-line");
  while (usedIds.has(nextId)) {
    nextId = createRandomLineTypeId("custom-line");
  }
  return nextId;
}

function createUniqueLineTypeId(usedIds) {
  return getUniqueCustomLineTypeId(usedIds);
}

function resetLineTypesForBlankDrawing() {
  const customs = loadCustomLineTypes();
  const { customLineTypes } = resolveCustomLineTypes(customs, { markAsTemporaryImported: false });
  state.lineTypes = [...defaultLineTypes.map((item) => structuredClone(item)), ...customLineTypes];
  persistCustomLineTypes(state.lineTypes);
}

function onLineTypeUpdated({ previousLineType, nextLineType, syncUsage = true } = {}) {
  if (!nextLineType || !syncUsage) {
    return;
  }

  const previousColorList = Array.isArray(previousLineType?.colorList)
    ? previousLineType.colorList.map((color) => normalizeColor(color))
    : [];
  const nextColorList = Array.isArray(nextLineType.colorList)
    ? nextLineType.colorList.map((color) => normalizeColor(color))
    : [];

  state.edges.forEach((edge) => {
    if (edge.lineTypeId !== nextLineType.id) {
      return;
    }

    const currentColorList = Array.isArray(edge.colorList)
      ? edge.colorList.map((color) => normalizeColor(color))
      : [];

    edge.colorList = nextColorList.map((nextColor, index) => {
      const currentColor = currentColorList[index];
      const previousColor = previousColorList[index];

      if (!currentColor) {
        return nextColor;
      }

      if (!previousColor) {
        return currentColor;
      }

      return currentColor === previousColor ? nextColor : currentColor;
    });
  });
}

function addStation(x, y, typeIndex) {
  const sourceType = state.stationTypes[typeIndex];
  if (!sourceType) {
    return;
  }

  const station = {
    id: getNextId("station"),
    x,
    y,
    name: sourceType.name,
    radius: Number(sourceType.radius) || 10,
    oval: Boolean(sourceType.oval),
    stationTypeIndex: typeIndex,
    paramValues: resolveStationParamDefaultsByTypeIndex(typeIndex),
    textValues: resolveStationTextDefaultsByTypeIndex(typeIndex),
    textStyleValues: resolveStationTextStyleDefaultsByTypeIndex(typeIndex),
    textPlacement: resolveStationTextPlacementByTypeIndex(typeIndex)
  };

  state.nodes.push(station);
  renderer.renderStations();
  selectEntity({ type: "station", id: station.id });
  commitStateChange();
}

function addLine(fromStationId, toStationId, lineTypeId, geometry) {
  const type = findLineType(lineTypeId);
  if (!type) {
    return;
  }

  const edge = {
    id: getNextId("line"),
    fromStationId,
    toStationId,
    lineTypeId,
    geometry,
    colorList: getColorListDefault(type),
    flip: false,
    flipColor: false,
    cornerRadius: 18,
    startOffset: 0,
    endOffset: 0
  };

  state.edges.push(edge);
  renderer.renderLines();
  selectEntity({ type: "line", id: edge.id });
  commitStateChange();
}

function insertStationOnLine({ edgeId, point, stationTypeIndex, stationId, commit = true, selectStation = true } = {}) {
  const targetId = String(edgeId || "");
  if (!targetId || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }

  const edgeIndex = state.edges.findIndex((edge) => String(edge.id || "") === targetId);
  if (edgeIndex < 0) {
    return null;
  }

  const edge = state.edges[edgeIndex];
  const fromId = edge?.fromStationId;
  const toId = edge?.toStationId;
  if (!fromId || !toId) {
    return null;
  }

  let station = stationId
    ? state.nodes.find((node) => String(node.id || "") === String(stationId))
    : null;

  if (!station) {
    const sourceType = state.stationTypes[stationTypeIndex];
    if (!sourceType) {
      return null;
    }

    station = {
      id: getNextId("station"),
      x: point.x,
      y: point.y,
      name: sourceType.name,
      radius: Number(sourceType.radius) || 10,
      oval: Boolean(sourceType.oval),
      stationTypeIndex,
      paramValues: resolveStationParamDefaultsByTypeIndex(stationTypeIndex),
      textValues: resolveStationTextDefaultsByTypeIndex(stationTypeIndex),
      textStyleValues: resolveStationTextStyleDefaultsByTypeIndex(stationTypeIndex),
      textPlacement: resolveStationTextPlacementByTypeIndex(stationTypeIndex)
    };

    state.nodes.push(station);
  } else {
    station.x = point.x;
    station.y = point.y;
  }

  if (String(station.id) === String(fromId) || String(station.id) === String(toId)) {
    return null;
  }

  const lineType = findLineType(edge.lineTypeId);
  const fallbackColors = lineType ? getColorListDefault(lineType) : [];
  const baseColors = Array.isArray(edge.colorList) && edge.colorList.length
    ? edge.colorList.map((color) => normalizeColor(color))
    : fallbackColors.map((color) => normalizeColor(color));

  const buildSplitEdge = (fromStationId, toStationId) => ({
    ...edge,
    id: getNextId("line"),
    fromStationId,
    toStationId,
    colorList: [...baseColors]
  });

  const leftEdge = buildSplitEdge(fromId, station.id);
  const rightEdge = buildSplitEdge(station.id, toId);
  state.edges.splice(edgeIndex, 1, leftEdge, rightEdge);

  renderer.renderStations();
  renderer.renderLines();
  renderer.renderSettings();

  if (selectStation) {
    selectEntity({ type: "station", id: station.id });
  }

  if (commit) {
    commitStateChange();
  }

  return station;
}

function addText(x, y) {
  const label = {
    id: getNextId("text"),
    x,
    y,
    value: "Text",
    fontSize: 20,
    color: "#23344d",
    fontFamily: "Segoe UI",
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false
  };

  state.labels.push(label);
  renderer.renderTexts();
  selectEntity({ type: "text", id: label.id });
  commitStateChange();
}

function addShape(x, y, shapeId) {
  const preset = state.shapeLibrary.find((item) => item.id === shapeId);
  if (!preset) {
    return;
  }

  const shapeInstance = {
    id: getNextId("shape"),
    shapeId: preset.id,
    x,
    y,
    scale: 0.25,
    paramValues: getShapeParameterDefaults(preset)
  };

  state.shapes.push(shapeInstance);
  renderer.renderShapes();
  selectEntity({ type: "shape", id: shapeInstance.id });
  commitStateChange();
}

function selectEntity(entity) {
  selectEntities([entity]);
}

function selectEntities(entities, options = {}) {
  const { additive = false } = options;
  const normalized = normalizeEntities(entities);
  if (!normalized.length) {
    if (!additive && state.selectedEntities.length) {
      state.selectedEntities = [];
      rerenderScene();
      renderer.renderSettings();
    }
    return;
  }

  if (additive) {
    const keySet = new Set(state.selectedEntities.map((item) => `${item.type}:${item.id}`));
    normalized.forEach((item) => {
      const key = `${item.type}:${item.id}`;
      if (!keySet.has(key)) {
        keySet.add(key);
        state.selectedEntities.push(item);
      }
    });
  } else {
    state.selectedEntities = normalized;
  }

  rerenderScene();
  renderer.renderSettings();
}

function toggleEntitySelection(entity) {
  const normalized = normalizeEntities([entity]);
  if (!normalized.length) {
    return;
  }

  const target = normalized[0];
  const index = state.selectedEntities.findIndex((item) => item.type === target.type && item.id === target.id);
  if (index >= 0) {
    state.selectedEntities = state.selectedEntities.filter((_, idx) => idx !== index);
  } else {
    state.selectedEntities = [...state.selectedEntities, target];
  }

  rerenderScene();
  renderer.renderSettings();
}

function clearSelection() {
  state.selectedEntities = [];
  rerenderScene();
  renderer.renderSettings();
}

function deleteSelectedEntity() {
  if (!Array.isArray(state.selectedEntities) || !state.selectedEntities.length) {
    return;
  }

  const selectedStationIds = new Set(
    state.selectedEntities.filter((item) => item.type === "station").map((item) => item.id)
  );
  const selectedLineIds = new Set(
    state.selectedEntities.filter((item) => item.type === "line").map((item) => item.id)
  );
  const selectedTextIds = new Set(
    state.selectedEntities.filter((item) => item.type === "text").map((item) => item.id)
  );
  const selectedShapeIds = new Set(
    state.selectedEntities.filter((item) => item.type === "shape").map((item) => item.id)
  );

  if (selectedStationIds.size) {
    state.nodes = state.nodes.filter((node) => !selectedStationIds.has(node.id));
  }

  state.edges = state.edges.filter((edge) => (
    !selectedLineIds.has(edge.id)
    && !selectedStationIds.has(edge.fromStationId)
    && !selectedStationIds.has(edge.toStationId)
  ));

  if (selectedTextIds.size) {
    state.labels = state.labels.filter((label) => !selectedTextIds.has(label.id));
  }

  if (selectedShapeIds.size) {
    state.shapes = state.shapes.filter((shape) => !selectedShapeIds.has(shape.id));
  }

  clearSelection();
  commitStateChange();
}

function normalizeEntities(entities) {
  if (!Array.isArray(entities)) {
    return [];
  }

  const keySet = new Set();
  const normalized = [];

  entities.forEach((entity) => {
    if (!entity || !entity.type || !entity.id) {
      return;
    }

    const type = String(entity.type);
    const id = String(entity.id);
    const key = `${type}:${id}`;
    if (keySet.has(key)) {
      return;
    }
    keySet.add(key);

    if (type === "station" && state.nodes.some((item) => item.id === id)) {
      normalized.push({ type, id });
      return;
    }

    if (type === "line" && state.edges.some((item) => item.id === id)) {
      normalized.push({ type, id });
      return;
    }

    if (type === "text" && state.labels.some((item) => item.id === id)) {
      normalized.push({ type, id });
      return;
    }

    if (type === "shape" && state.shapes.some((item) => item.id === id)) {
      normalized.push({ type, id });
    }
  });

  return normalized;
}

function rerenderScene() {
  renderer.renderStations();
  renderer.renderLines();
  renderer.renderShapes();
  renderer.renderTexts();
}

function getStationTypeIndexByStation(station) {
  if (
    Number.isInteger(station.stationTypeIndex) &&
    station.stationTypeIndex >= 0 &&
    station.stationTypeIndex < state.stationTypes.length
  ) {
    return station.stationTypeIndex;
  }

  const byShape = state.stationTypes.findIndex((type) => (
    Number(type.radius) === Number(station.radius) && Boolean(type.oval) === Boolean(station.oval)
  ));
  if (byShape >= 0) {
    return byShape;
  }

  return 0;
}

function applyStationType(station, typeIndex) {
  const sourceType = state.stationTypes[typeIndex];
  if (!sourceType) {
    return;
  }

  station.name = sourceType.name;
  station.radius = Number(sourceType.radius) || 10;
  station.oval = Boolean(sourceType.oval);
  station.stationTypeIndex = typeIndex;
  station.paramValues = resolveStationParamDefaultsByTypeIndex(typeIndex);
  station.textValues = resolveStationTextDefaultsByTypeIndex(typeIndex);
  station.textStyleValues = resolveStationTextStyleDefaultsByTypeIndex(typeIndex);
  station.textPlacement = resolveStationTextPlacementByTypeIndex(typeIndex);
}

function resolveStationTextDefaultsByTypeIndex(typeIndex) {
  const preset = getStationPresetByTypeIndex(typeIndex);
  if (!preset) {
    return {};
  }

  const out = {};
  const cards = Array.isArray(preset.textCards) ? preset.textCards : [];
  cards.forEach((card) => {
    const cardId = String(card?.id || "").trim();
    if (!cardId) {
      return;
    }

    out[cardId] = String(card?.defaultValue || "");
  });

  return out;
}

function resolveStationTextStyleDefaultsByTypeIndex(typeIndex) {
  const preset = getStationPresetByTypeIndex(typeIndex);
  if (!preset) {
    return {};
  }

  const out = {};
  const cards = Array.isArray(preset.textCards) ? preset.textCards : [];
  cards.forEach((card) => {
    const cardId = String(card?.id || "").trim();
    if (!cardId) {
      return;
    }

    out[cardId] = normalizeTextStyleFlags(card);
  });

  return out;
}

function resolveStationTextPlacementByTypeIndex(typeIndex) {
  const preset = getStationPresetByTypeIndex(typeIndex);
  return {
    slot: normalizeStationTextSlot(preset?.textPlacement?.slot)
  };
}

function normalizeStationTextSlot(rawSlot) {
  const slot = String(rawSlot || "").toLowerCase();
  const slots = new Set(["nw", "n", "ne", "w", "e", "sw", "s", "se"]);
  return slots.has(slot) ? slot : "s";
}

function resolveStationParamDefaultsByTypeIndex(typeIndex) {
  const preset = getStationPresetByTypeIndex(typeIndex);
  if (!preset) {
    return {};
  }

  const defaults = {};

  normalizeShapeParameters(preset.params).forEach((param) => {
    defaults[param.id] = normalizeShapeParameterDefault(param.type, param.defaultValue);
  });

  const shape = state.shapeLibrary.find((item) => item.id === preset.shapeId);
  const shapeParams = normalizeShapeParameters(shape?.parameters);
  const settings = preset.shapeParamSettings && typeof preset.shapeParamSettings === "object"
    ? preset.shapeParamSettings
    : {};

  shapeParams.forEach((param) => {
    const setting = settings[param.id];
    const mode = setting?.mode === "default" || setting?.mode === "locked"
      ? setting.mode
      : "inherit";
    const nextValue = mode === "inherit"
      ? param.defaultValue
      : setting?.value;
    defaults[param.id] = normalizeShapeParameterDefault(param.type, nextValue);
  });

  return defaults;
}

function getStationPresetByTypeIndex(typeIndex) {
  const sourceType = state.stationTypes[typeIndex];
  if (!sourceType) {
    return null;
  }

  const presetId = sourceType.stationPresetId ? String(sourceType.stationPresetId) : "";
  if (presetId) {
    const byId = state.stationLibrary.find((item) => item.id === presetId);
    if (byId) {
      return byId;
    }
  }

  if (typeIndex >= 0 && typeIndex < state.stationLibrary.length) {
    return state.stationLibrary[typeIndex] || null;
  }

  return null;
}
