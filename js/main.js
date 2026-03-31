import { elements } from "./dom.js";
import {
  createRandomLineTypeId,
  createDefaultLineTypes,
  getColorListDefault,
  getLineTypeById,
  loadCustomLineTypes,
  normalizeLineType,
  persistCustomLineTypes
} from "./line/typeStore.js";
import { createLineManager } from "./line/manager.js";
import { createShapeManager } from "./shape/manager.js";
import { createStationManager } from "./station/manager.js";
import {
  getShapeParameterDefaults,
  normalizeShapeParameterDefault,
  normalizeShapeParameters
} from "./shape/utils.js";
import { createRenderer } from "./render.js";
import { createEventBinder } from "./event.js";
import { parseDrawingJson, serializeDrawingToJson } from "./serialization.js";
import { createMainClipboard } from "./clipboards.js";
import { clamp, normalizeColor } from "./utils.js";
import { appSettingsStorageKey, drawingStorageKey, geometryLabelMap } from "./constants.js";
import { createHistoryManager } from "./historyManager.js";

const { linePreview, fileUndoBtn, fileRedoBtn, canvasBg } = elements;
const defaultAppSettings = Object.freeze({
  continuousSelectMode: true,
  continuousStationMode: true,
  continuousLineMode: true,
  continuousTextMode: true,
  continuousShapeMode: true,
  showGrid: true,
  selectionGlowColor: "#2f6de5",
  selectionGlowSize: 4,
  defaultLineGeometry: "bend135",
  lineSpacingScale: 1
});

const state = {
  activeTool: null,
  appSettings: { ...defaultAppSettings },
  stationTypes: [],
  lineTypes: [],
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
  drag: {
    mode: null,
    stationId: null,
    lineStartStationId: null,
    moveEntities: [],
    marqueeStart: null,
    marqueeCurrent: null,
    didMove: false,
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

let defaultLineTypes = [];
let lineManager = null;
let shapeManager = null;
let stationManager = null;

const renderer = createRenderer({
  state,
  elements,
  findLineType,
  getColorListDefault,
  openLineManager: () => lineManager?.open(),
  openShapeManager: () => shapeManager?.open(),
  openStationManager: () => stationManager?.open(),
  onAppSettingsChanged: updateAppSettings,
  applyStationType,
  getStationTypeIndexByStation,
  onStateChanged: commitStateChange
});

lineManager = createLineManager({
  state,
  elements,
  createLineTypeId,
  renderSubmenu: renderer.renderSubmenu,
  renderLines: renderer.renderLines,
  onLineTypeUpdated,
  onStateChanged: commitStateChange
});

shapeManager = createShapeManager({
  state,
  elements,
  createShapeId,
  renderSubmenu: renderer.renderSubmenu,
  onPlacedShapeDefaultsUpdated: commitStateChange
});

stationManager = createStationManager({
  state,
  elements,
  createStationPresetId,
  renderSubmenu: renderer.renderSubmenu
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
  pasteSelection: () => (
    state.shapeManager?.isOpen
      ? shapeManager?.pasteSelection?.()
      : mainClipboard.paste()
  )
};

const eventBinder = createEventBinder({
  state,
  elements,
  renderer,
  findLineType,
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
  loadDrawingFromFile,
  undo,
  redo,
  shapeUndo: () => shapeManager?.undo?.(),
  shapeRedo: () => shapeManager?.redo?.(),
  copySelection: clipboardController.copySelection,
  cutSelection: clipboardController.cutSelection,
  pasteSelection: clipboardController.pasteSelection,
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
  await loadMenus();
  loadAppSettings();
  applyAppSettings();
  restoreDrawingFromLocalStorage();
  initHistoryBaseline();

  eventBinder.bindToolbar();
  eventBinder.bindCanvas();
  eventBinder.bindKeyboard();
  eventBinder.bindFileMenu();
  lineManager.bind();
  shapeManager.bind();
  stationManager.bind();

  renderer.renderSubmenu();
  rerenderScene();
  renderer.renderSettings();
  renderer.updateViewportTransform();
  renderer.updateZoomIndicator();
}

function updateAppSettings(patch = {}) {
  const hasDefaultLineGeometryPatch = Object.prototype.hasOwnProperty.call(patch, "defaultLineGeometry");
  const hasLineSpacingScalePatch = Object.prototype.hasOwnProperty.call(patch, "lineSpacingScale");

  state.appSettings = sanitizeAppSettings({ ...state.appSettings, ...patch });
  persistAppSettings();
  applyAppSettings();

  if (hasDefaultLineGeometryPatch && state.activeTool === "line") {
    state.menuSelection.lineGeometry = state.appSettings.defaultLineGeometry;
    renderer.renderSubmenu();
  }

  if (hasLineSpacingScalePatch) {
    renderer.renderLines();
    if (state.activeTool === "settings") {
      renderer.renderSubmenu();
    }
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
  const glow = toRgba(state.appSettings.selectionGlowColor, 0.45);
  document.documentElement.style.setProperty("--selection-glow-color", glow);
  document.documentElement.style.setProperty(
    "--selection-glow-size",
    `${state.appSettings.selectionGlowSize}px`
  );

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
    selectionGlowColor: normalizeHexColor(next.selectionGlowColor, defaultAppSettings.selectionGlowColor),
    selectionGlowSize: clamp(Number(next.selectionGlowSize) || defaultAppSettings.selectionGlowSize, 1, 30),
    defaultLineGeometry,
    lineSpacingScale: clamp(Number(next.lineSpacingScale) || 1, 0.5, 1.8)
  };
}

function normalizeHexColor(input, fallback) {
  const value = String(input || "").trim();
  if (/^#[0-9a-fA-F]{3}$/.test(value) || /^#[0-9a-fA-F]{6}$/.test(value)) {
    return value.toLowerCase();
  }
  return fallback;
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
  const [stationsRes, linesRes] = await Promise.all([
    fetch("data/station.json"),
    fetch("data/line.json")
  ]);

  state.stationTypes = await stationsRes.json();

  const lineJson = await linesRes.json();
  defaultLineTypes = createDefaultLineTypes(lineJson);
  const customs = loadCustomLineTypes();
  const { customLineTypes, hasIdRepair } = resolveCustomLineTypes(customs);
  state.lineTypes = [...defaultLineTypes.map((item) => structuredClone(item)), ...customLineTypes];

  if (hasIdRepair) {
    persistCustomLineTypes(state.lineTypes);
  }
}

function createNewDrawing() {
  if (!confirmOverwrite("新建绘图会覆盖当前内容，是否继续？")) {
    return;
  }

  state.nodes = [];
  state.edges = [];
  state.labels = [];
  state.shapes = [];
  state.selectedEntities = [];
  state.drag = {
    mode: null,
    stationId: null,
    lineStartStationId: null,
    moveEntities: [],
    marqueeStart: null,
    marqueeCurrent: null,
    didMove: false,
    suppressClick: false,
    fromX: 0,
    fromY: 0,
    panX: 0,
    panY: 0
  };
  state.zoom = 1;
  state.pan = { x: 0, y: 0 };

  resetLineTypesForBlankDrawing();

  if (state.menuSelection.lineType && !state.lineTypes.some((item) => item.id === state.menuSelection.lineType)) {
    state.menuSelection.lineType = null;
  }

  if (state.lineManager.selectedId && !state.lineTypes.some((item) => item.id === state.lineManager.selectedId)) {
    state.lineManager.selectedId = null;
    state.lineManager.draft = null;
  }

  if (state.lineManager.isOpen) {
    lineManager.close();
  }

  if (state.shapeManager.isOpen) {
    shapeManager.close();
  }

  if (state.stationManager.isOpen) {
    stationManager.close();
  }

  state.counter = Math.max(1, computeNextCounter());

  linePreview.setAttribute("visibility", "hidden");
  linePreview.setAttribute("d", "");

  rerenderScene();
  renderer.renderSubmenu();
  renderer.renderSettings();
  renderer.updateViewportTransform();
  renderer.updateZoomIndicator();
  initHistoryBaseline();
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
    textPlacement: node.textPlacement && typeof node.textPlacement === "object"
      ? { ...node.textPlacement }
      : { slot: "s" }
  }));
  state.edges = nextEdges;
  state.labels = drawing.labels.map((label) => ({ ...label }));
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
  const snapshot = localStorage.getItem(drawingStorageKey);
  if (!snapshot) {
    return;
  }

  try {
    const drawing = parseDrawingJson(snapshot);
    applyDrawingData(drawing, {
      persistSnapshot: false,
      markTemporaryImported: false,
      includePersistedPermanentCustoms: true
    });
  } catch {
    localStorage.removeItem(drawingStorageKey);
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

function persistDrawingSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  try {
    localStorage.setItem(drawingStorageKey, snapshot);
  } catch {
    // Ignore localStorage quota/availability errors.
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

function addText(x, y) {
  const label = {
    id: getNextId("text"),
    x,
    y,
    value: "Text",
    fontSize: 20,
    color: "#23344d",
    fontFamily: "Segoe UI"
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
