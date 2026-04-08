import { shapeStorageKey } from "../constants.js";
import { createShapeManagerClipboard } from "../clipboards.js";
import { createHistoryManager } from "../history-manager.js";
import { svgNs } from "../dom.js";
import { applyTextInputStyle, formatColorWithAlpha, normalizeColor, normalizeTextStyleFlags } from "../utils.js";
import {
  boundsToViewBox,
  buildSvgFromEditableElements,
  clampNumber,
  clampPrimitiveIndex,
  computeEditableBounds,
  createPrimitiveElement,
  createPrimitiveNode,
  getFirstPrimitiveIndex,
  getPrimitiveParamBinding,
  getPrimitiveParamBindings,
  getPrimitiveRadii,
  normalizeEditableElements,
  normalizeImportedSvg,
  normalizeNumber,
  normalizeShapeParameterDefault,
  normalizeShapeParameters,
  parseSvg,
  primitiveTypeLabel,
  resolveEditableElementsWithParameters,
  resolvePrimitiveFieldValue,
  resolvePrimitiveWithParameters,
  setPrimitiveParamBinding,
  shapeParameterTypeDefinitions,
  stripUnsafeAttributes,
  toNumber,
  toSvgDataUrl
} from "./utils.js";

const defaultViewBox = Object.freeze({ x: 0, y: 0, width: 240, height: 240 });
const snapConfig = Object.freeze({
  gridStep: 10,
  axisX: 120,
  axisY: 120,
  pixelTolerance: 8
});

const textFontOptions = Object.freeze([
  "Segoe UI",
  "Microsoft YaHei",
  "SimSun",
  "Arial",
  "Noto Sans SC"
]);

const textStyleToolbarItems = Object.freeze([
  { flag: "bold", icon: "/img/icon-bold.svg", label: "加粗" },
  { flag: "italic", icon: "/img/icon-italic.svg", label: "斜体" },
  { flag: "underline", icon: "/img/icon-underline.svg", label: "下划线" },
  { flag: "strikethrough", icon: "/img/icon-strikethrough.svg", label: "删除线" }
]);

export function createShapeManager({
  state,
  elements,
  createShapeId,
  colorPicker,
  renderSubmenu,
  onPlacedShapeDefaultsUpdated,
  onStateChanged,
  rerenderScene
}) {
  const {
    shapeManagerModal,
    closeShapeManagerBtn,
    newShapeBtn,
    shapeLibraryList,
    shapeSelectAllInput,
    shapeNameInput,
    shapePrimitiveSelect,
    shapeAddPrimitiveBtn,
    shapeResetViewBtn,
    shapeImportSvgBtn,
    shapeImportSvgInput,
    shapeUndoBtn,
    shapeRedoBtn,
    shapeEditorCanvasWrap,
    shapeEditorCanvas,
    shapeTabPropsBtn,
    shapeTabParamsBtn,
    shapePropsPanel,
    shapeParamsPanel,
    shapePropsList,
    shapeParamTypeSelect,
    shapeAddParamBtn,
    shapeParamList,
    deleteShapeBtn,
    downloadShapeBtn,
    importShapeBtn,
    shapeImportInput
  } = elements;

  const panState = {
    isPanning: false,
    startClientX: 0,
    startClientY: 0,
    startCanvasPoint: null,
    startViewBox: { ...defaultViewBox },
    didPan: false
  };

  const handleState = {
    isDragging: false,
    primitiveIndex: null,
    handleKey: null,
    moved: false,
    dirty: false
  };
  const transformState = {
    isDragging: false,
    mode: null,
    primitiveIndex: null,
    handleKey: null,
    startPoint: null,
    startBounds: null,
    startPrimitive: null,
    dirty: false,
    moved: false
  };
  let suppressCanvasClick = false;
  let layerMoveMode = null;

  const clipboard = createShapeManagerClipboard({
    state,
    createShapeId,
    setSelectedPrimitiveIndices,
    getSelectedShape,
    ensureEditableShape,
    getFirstPrimitiveIndex,
    syncShapeSvg,
    persistShapeLibrary,
    renderShapeManager,
    renderSubmenu,
    resetViewToSelectedShape,
    deleteCurrentSelection
  });

  const historyManager = createHistoryManager({
    maxEntries: 120,
    applySnapshot: applyShapeHistorySnapshot
  });

  function getCheckedShapeIds() {
    return Array.isArray(state.shapeManager.checkedIds)
      ? state.shapeManager.checkedIds.map((id) => String(id))
      : [];
  }

  function setCheckedShapeIds(ids) {
    const validIds = new Set((Array.isArray(state.shapeLibrary) ? state.shapeLibrary : []).map((shape) => String(shape.id)));
    const seen = new Set();
    const next = [];
    (Array.isArray(ids) ? ids : []).forEach((id) => {
      const key = String(id || "");
      if (!key || !validIds.has(key) || seen.has(key)) {
        return;
      }
      seen.add(key);
      next.push(key);
    });
    state.shapeManager.checkedIds = next;
  }

  function resolveShapeTargets() {
    const checkedIds = getCheckedShapeIds();
    if (checkedIds.length) {
      return checkedIds
        .map((id) => (Array.isArray(state.shapeLibrary) ? state.shapeLibrary : []).find((shape) => shape.id === id))
        .filter(Boolean);
    }

    const selected = getSelectedShape();
    return selected ? [selected] : [];
  }

  function syncShapeBulkActionState() {
    const totalCount = Array.isArray(state.shapeLibrary) ? state.shapeLibrary.length : 0;
    const checkedCount = getCheckedShapeIds().length;

    shapeSelectAllInput.checked = totalCount > 0 && checkedCount === totalCount;
    shapeSelectAllInput.indeterminate = checkedCount > 0 && checkedCount < totalCount;

    const hasChecked = checkedCount > 0;
    const selectedShape = getSelectedShape();
    deleteShapeBtn.disabled = !(hasChecked || selectedShape);
    downloadShapeBtn.disabled = !(hasChecked || selectedShape);
  }

  function getSelectedPrimitiveIndices(shape) {
    if (!shape || !Array.isArray(shape.editableElements)) {
      return [];
    }

    const length = shape.editableElements.length;
    const indices = Array.isArray(state.shapeManager.selectedPrimitiveIndices)
      ? state.shapeManager.selectedPrimitiveIndices
      : [];
    const result = [];
    const seen = new Set();

    indices.forEach((index) => {
      if (!Number.isInteger(index)) {
        return;
      }
      const clamped = clampPrimitiveIndex(index, length);
      if (seen.has(clamped)) {
        return;
      }
      seen.add(clamped);
      result.push(clamped);
    });

    if (Number.isInteger(state.shapeManager.selectedPrimitiveIndex)) {
      const primary = clampPrimitiveIndex(state.shapeManager.selectedPrimitiveIndex, length);
      if (!seen.has(primary)) {
        result.push(primary);
      }
    }

    return result;
  }

  function setSelectedPrimitiveIndices(shape, indices, options = {}) {
    if (!shape || !Array.isArray(shape.editableElements)) {
      state.shapeManager.selectedPrimitiveIndices = [];
      state.shapeManager.selectedPrimitiveIndex = null;
      return;
    }

    const length = shape.editableElements.length;
    const result = [];
    const seen = new Set();

    (Array.isArray(indices) ? indices : []).forEach((index) => {
      if (!Number.isInteger(index)) {
        return;
      }
      const clamped = clampPrimitiveIndex(index, length);
      if (seen.has(clamped)) {
        return;
      }
      seen.add(clamped);
      result.push(clamped);
    });

    let nextPrimary = null;
    if (result.length) {
      if (Number.isInteger(options.primaryIndex)) {
        const primary = clampPrimitiveIndex(options.primaryIndex, length);
        nextPrimary = primary;
        if (!seen.has(primary)) {
          result.push(primary);
        }
      } else if (
        Number.isInteger(state.shapeManager.selectedPrimitiveIndex)
        && seen.has(state.shapeManager.selectedPrimitiveIndex)
      ) {
        nextPrimary = state.shapeManager.selectedPrimitiveIndex;
      } else {
        nextPrimary = result[result.length - 1];
      }
    }

    state.shapeManager.selectedPrimitiveIndices = result;
    state.shapeManager.selectedPrimitiveIndex = result.length ? nextPrimary : null;
  }

  function setSingleSelectedPrimitive(shape, index) {
    if (!Number.isInteger(index)) {
      setSelectedPrimitiveIndices(shape, []);
      return;
    }
    setSelectedPrimitiveIndices(shape, [index], { primaryIndex: index });
  }

  function getSingleSelectedPrimitiveIndex(shape) {
    const indices = getSelectedPrimitiveIndices(shape);
    return indices.length === 1 ? indices[0] : null;
  }

  function bind() {
    if (
      !shapeManagerModal
      || !closeShapeManagerBtn
      || !newShapeBtn
      || !shapeLibraryList
      || !shapeSelectAllInput
      || !shapeNameInput
      || !shapePrimitiveSelect
      || !shapeAddPrimitiveBtn
      || !shapeResetViewBtn
      || !shapeImportSvgBtn
      || !shapeImportSvgInput
      || !shapeUndoBtn
      || !shapeRedoBtn
      || !shapeEditorCanvasWrap
      || !shapeEditorCanvas
      || !shapeTabPropsBtn
      || !shapeTabParamsBtn
      || !shapePropsPanel
      || !shapeParamsPanel
      || !shapePropsList
      || !shapeParamTypeSelect
      || !shapeAddParamBtn
      || !shapeParamList
      || !deleteShapeBtn
      || !downloadShapeBtn
      || !importShapeBtn
      || !shapeImportInput
    ) {
      return;
    }

    ensureShapeManagerState();
    loadShapeLibraryFromStorage();

    if (!Array.isArray(state.shapeManager.checkedIds)) {
      state.shapeManager.checkedIds = [];
    }

    closeShapeManagerBtn.addEventListener("click", close);
    newShapeBtn.addEventListener("click", createEmptyShape);

    shapeNameInput.addEventListener("input", () => {
      const shape = getSelectedShape();
      if (!shape) {
        return;
      }

      const nextName = String(shapeNameInput.value || "").trim() || "图形";
      shape.name = nextName;
      persistShapeLibrary();
      renderShapeLibraryList();
      renderSubmenu();
    });

    shapePrimitiveSelect.addEventListener("change", () => {
      state.shapeManager.primitiveType = shapePrimitiveSelect.value;
    });

    shapeAddPrimitiveBtn.addEventListener("click", addPrimitiveToCurrentShape);
    shapeResetViewBtn.addEventListener("click", () => {
      resetViewToSelectedShape();
      renderEditorCanvas(getSelectedShape());
    });

    shapeImportSvgBtn.addEventListener("click", () => shapeImportSvgInput.click());
    shapeImportSvgInput.addEventListener("change", importExternalSvgShape);
    deleteShapeBtn.addEventListener("click", deleteSelectedShapeDefinition);
    downloadShapeBtn.addEventListener("click", downloadSelectedShape);
    importShapeBtn.addEventListener("click", () => shapeImportInput.click());
    shapeImportInput.addEventListener("change", importShapesFromFile);
    shapeSelectAllInput.addEventListener("change", () => {
      if (shapeSelectAllInput.checked) {
        setCheckedShapeIds((Array.isArray(state.shapeLibrary) ? state.shapeLibrary : []).map((shape) => shape.id));
      } else {
        setCheckedShapeIds([]);
      }
      renderShapeManager();
    });

    shapeUndoBtn.addEventListener("click", undo);
    shapeRedoBtn.addEventListener("click", redo);

    shapeTabPropsBtn.addEventListener("click", () => {
      state.shapeManager.activeTab = "props";
      syncTabVisibility();
      renderPropertiesPanel(getSelectedShape());
    });

    shapeTabParamsBtn.addEventListener("click", () => {
      state.shapeManager.activeTab = "params";
      syncTabVisibility();
      renderParameterList(getSelectedShape());
    });

    shapeParamTypeSelect.addEventListener("change", () => {
      state.shapeManager.parameterType = shapeParamTypeSelect.value;
    });

    shapeAddParamBtn.addEventListener("click", () => {
      addParameter(shapeParamTypeSelect.value);
    });

    shapeEditorCanvas.addEventListener("click", onCanvasClick);
    shapeEditorCanvas.addEventListener("mousedown", onCanvasMouseDown);
    shapeEditorCanvas.addEventListener("wheel", onCanvasWheel, { passive: false });
    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);
    window.addEventListener("keydown", onWindowKeyDown);

    shapeManagerModal.hidden = true;
  }

  function open() {
    if (!shapeManagerModal) {
      return;
    }

    ensureShapeManagerState();
    state.shapeManager.isOpen = true;
    shapeManagerModal.hidden = false;

    ensureSelectedShape();
    resetViewToSelectedShape();
    renderShapeManager();
  }

  function close() {
    if (!shapeManagerModal) {
      return;
    }

    state.shapeManager.isOpen = false;
    shapeManagerModal.hidden = true;
    stopPanning();
    resetHandleDragState();
    clipboard.clear();
  }

  function undo() {
    historyManager.undo();
  }

  function redo() {
    historyManager.redo();
  }

  function renderShapeManager() {
    const selectedShape = getSelectedShape();

    renderShapeLibraryList();
    updateShapeHistoryUI();
    shapePrimitiveSelect.value = state.shapeManager.primitiveType || "line";
    shapeParamTypeSelect.value = shapeParameterTypeDefinitions[state.shapeManager.parameterType || "color"]
      ? state.shapeManager.parameterType || "color"
      : "color";
    shapeNameInput.value = selectedShape?.name || "";

    syncTabVisibility();
    renderEditorCanvas(selectedShape);
    renderPropertiesPanel(selectedShape);
    renderParameterList(selectedShape);
    syncShapeBulkActionState();
  }

  function deleteSelectedShapeDefinition() {
    const targets = resolveShapeTargets();
    if (!targets.length) {
      return;
    }

    const removedShapeIds = new Set(targets.map((shape) => String(shape.id)));

    const removedShapeInstanceIds = new Set(
      (Array.isArray(state.shapes) ? state.shapes : [])
        .filter((item) => removedShapeIds.has(String(item?.shapeId || "")))
        .map((item) => String(item.id))
    );

    const stationUsageCount = Array.isArray(state.stationLibrary)
      ? state.stationLibrary.filter((preset) => removedShapeIds.has(String(preset?.shapeId || ""))).length
      : 0;

    const warningLines = [`将删除 ${targets.length} 个图形。`];
    if (removedShapeInstanceIds.size > 0) {
      warningLines.push(`当前绘图中有 ${removedShapeInstanceIds.size} 个图形实例在使用它们，删除后这些图形实例会被一并删除。`);
    }
    if (stationUsageCount > 0) {
      warningLines.push(`有 ${stationUsageCount} 个车站预设引用它们，删除后这些预设将回退为无图形显示。`);
    }
    warningLines.push("此操作不可撤销，是否继续？");

    if (!window.confirm(warningLines.join("\n"))) {
      return;
    }
    if (!window.confirm("请再次确认删除：该操作执行后无法恢复。")) {
      return;
    }

    state.shapeLibrary = state.shapeLibrary.filter((item) => !removedShapeIds.has(String(item.id)));
    if (removedShapeInstanceIds.size) {
      state.shapes = state.shapes.filter((item) => !removedShapeInstanceIds.has(String(item.id)));
      if (Array.isArray(state.selectedEntities) && state.selectedEntities.length) {
        state.selectedEntities = state.selectedEntities.filter((entity) => (
          entity?.type !== "shape" || !removedShapeInstanceIds.has(String(entity.id))
        ));
      }
    }

    if (removedShapeIds.has(String(state.menuSelection?.shape || ""))) {
      state.menuSelection.shape = null;
    }

    setCheckedShapeIds(getCheckedShapeIds().filter((id) => !removedShapeIds.has(String(id))));

    const hasSelected = state.shapeLibrary.some((item) => item.id === state.shapeManager.selectedId);
    if (!hasSelected) {
      state.shapeManager.selectedId = state.shapeLibrary[0]?.id || null;
    }

    const nextShape = getSelectedShape();
    if (nextShape) {
      setSingleSelectedPrimitive(nextShape, getFirstPrimitiveIndex(nextShape));
    } else {
      state.shapeManager.selectedPrimitiveIndices = [];
      state.shapeManager.selectedPrimitiveIndex = null;
    }

    resetViewToSelectedShape();
    persistShapeLibrary();
    renderShapeManager();
    renderSubmenu();

    if (removedShapeInstanceIds.size > 0 || stationUsageCount > 0) {
      rerenderScene?.();
    }
    onStateChanged?.();
  }

  function downloadSelectedShape() {
    const targets = resolveShapeTargets();
    if (!targets.length) {
      return;
    }

    const payloadList = targets
      .map((shape) => sanitizeShape(shape))
      .filter(Boolean)
      .map((safeShape) => ({
        name: safeShape.name,
        svg: safeShape.svg,
        editableElements: safeShape.editableElements,
        parameters: safeShape.parameters,
        imported: Boolean(safeShape.imported)
      }));
    if (!payloadList.length) {
      return;
    }

    const payload = payloadList.length === 1 ? payloadList[0] : payloadList;
    const downloadName = payloadList.length === 1
      ? `${payloadList[0].name}.json`
      : "图形-批量导出.json";

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importShapesFromFile(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const entries = Array.isArray(raw) ? raw : [raw];
      const imported = entries
        .map((item) => sanitizeShape(item))
        .filter(Boolean)
        .map((shape, index) => ({
          ...shape,
          id: createShapeId(),
          name: String(shape.name || `图形 ${state.shapeLibrary.length + index + 1}`).trim() || `图形 ${state.shapeLibrary.length + index + 1}`
        }));

      if (!imported.length) {
        return;
      }

      state.shapeLibrary.push(...imported);
      state.shapeManager.selectedId = imported[0].id;
      setSingleSelectedPrimitive(imported[0], getFirstPrimitiveIndex(imported[0]));
      resetViewToSelectedShape();
      persistShapeLibrary();
      renderShapeManager();
      renderSubmenu();
    } catch {
      window.alert("导入失败：JSON 文件格式无效。\n支持导入单个图形对象或图形数组。");
    } finally {
      shapeImportInput.value = "";
    }
  }

  // param drag state handlers
  function onParamDragStart(event) {
    const handle = event.currentTarget;
    const row = handle.closest(".shape-param-item");
    if (!row) return;
    state.shapeManager.dragParamIndex = Number(row.dataset.paramIndex);
    row.classList.add("dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(state.shapeManager.dragParamIndex));
    }
  }

  function onParamDragOver(event) {
    if (!Number.isInteger(state.shapeManager.dragParamIndex)) return;
    event.preventDefault();
  }

  function onParamDrop(event) {
    event.preventDefault();
    const targetRow = event.currentTarget;
    const toIndex = Number(targetRow.dataset.paramIndex);
    const fromIndex = state.shapeManager.dragParamIndex;
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) {
      return;
    }
    const currentShape = getSelectedShape();
    if (!currentShape) return;
    const params = normalizeShapeParameters(currentShape.parameters || []);
    const moved = params.splice(fromIndex, 1)[0];
    const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    params.splice(insertIndex, 0, moved);
    currentShape.parameters = params;
    state.shapeManager.dragParamIndex = null;
    persistShapeLibrary();
    renderParameterList(currentShape);
  }

  function onParamDragEnd() {
    shapeParamList.querySelectorAll(".shape-param-item.dragging").forEach((item) => item.classList.remove("dragging"));
    state.shapeManager.dragParamIndex = null;
  }

  function renderShapeLibraryList() {
    shapeLibraryList.innerHTML = "";
    setCheckedShapeIds(getCheckedShapeIds());
    const checkedSet = new Set(getCheckedShapeIds());

    if (!state.shapeLibrary.length) {
      const empty = document.createElement("div");
      empty.className = "kv";
      empty.textContent = "图形库为空，请创建或导入 SVG 图形。";
      shapeLibraryList.appendChild(empty);
      return;
    }

    const placedUsageCountByShapeId = new Map();
    (Array.isArray(state.shapes) ? state.shapes : []).forEach((item) => {
      const key = String(item?.shapeId || "");
      if (!key) {
        return;
      }
      placedUsageCountByShapeId.set(key, (placedUsageCountByShapeId.get(key) || 0) + 1);
    });

    const stationUsageCountByShapeId = new Map();
    (Array.isArray(state.stationLibrary) ? state.stationLibrary : []).forEach((preset) => {
      const key = String(preset?.shapeId || "");
      if (!key) {
        return;
      }
      stationUsageCountByShapeId.set(key, (stationUsageCountByShapeId.get(key) || 0) + 1);
    });

    state.shapeLibrary.forEach((shape) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "line-library-item";
      item.classList.toggle("active", shape.id === state.shapeManager.selectedId);

      const row = document.createElement("div");
      row.className = "line-library-item-row";

      const lead = document.createElement("div");
      lead.className = "line-library-item-lead";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "library-item-checkbox";
      checkbox.checked = checkedSet.has(shape.id);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", (event) => {
        event.stopPropagation();
        const next = new Set(getCheckedShapeIds());
        if (checkbox.checked) {
          next.add(shape.id);
        } else {
          next.delete(shape.id);
        }
        setCheckedShapeIds([...next]);
        syncShapeBulkActionState();
      });

      const title = document.createElement("span");
      title.className = "line-library-item-title";
      const placedUsageCount = placedUsageCountByShapeId.get(shape.id) || 0;
      const stationUsageCount = stationUsageCountByShapeId.get(shape.id) || 0;
      const usageCount = placedUsageCount + stationUsageCount;
      title.textContent = `${shape.name} (${usageCount})`;
      title.title = `${shape.name}（总引用 ${usageCount}：图形实例 ${placedUsageCount}，车站预设 ${stationUsageCount}）`;

      const preview = document.createElement("img");
      preview.className = "shape-library-preview-inline";
      preview.alt = `${shape.name}预览`;
      preview.src = toSvgDataUrl(shape.svg);

      lead.appendChild(checkbox);
      lead.appendChild(title);
      row.appendChild(lead);
      row.appendChild(preview);
      item.appendChild(row);

      const tag = document.createElement("span");
      tag.className = "line-library-item-tag";
      tag.textContent = shape.imported ? "外部SVG" : "编辑图形";
      item.appendChild(tag);

      item.addEventListener("click", () => {
        state.shapeManager.selectedId = shape.id;
        setSingleSelectedPrimitive(shape, getFirstPrimitiveIndex(shape));
        resetViewToSelectedShape();
        renderShapeManager();
      });

      shapeLibraryList.appendChild(item);
    });
  }

  function syncTabVisibility() {
    const propsActive = state.shapeManager.activeTab !== "params";
    shapeTabPropsBtn.classList.toggle("active", propsActive);
    shapeTabParamsBtn.classList.toggle("active", !propsActive);
    shapePropsPanel.hidden = !propsActive;
    shapeParamsPanel.hidden = propsActive;
  }

  function renderEditorCanvas(shape) {
    shapeEditorCanvas.innerHTML = "";
    const vb = getCurrentViewBox();
    shapeEditorCanvas.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);

    const defs = document.createElementNS(svgNs, "defs");
    const pattern = document.createElementNS(svgNs, "pattern");
    pattern.setAttribute("id", "shapeGridPatternEditor");
    pattern.setAttribute("width", "20");
    pattern.setAttribute("height", "20");
    pattern.setAttribute("patternUnits", "userSpaceOnUse");

    const gridPath = document.createElementNS(svgNs, "path");
    gridPath.setAttribute("d", "M 20 0 L 0 0 0 20");
    gridPath.setAttribute("fill", "none");
    gridPath.setAttribute("stroke", "#e8edf6");
    gridPath.setAttribute("stroke-width", "1");

    pattern.appendChild(gridPath);
    defs.appendChild(pattern);
    shapeEditorCanvas.appendChild(defs);

    const bg = document.createElementNS(svgNs, "rect");
    bg.setAttribute("x", String(vb.x - vb.width));
    bg.setAttribute("y", String(vb.y - vb.height));
    bg.setAttribute("width", String(vb.width * 3));
    bg.setAttribute("height", String(vb.height * 3));
    bg.setAttribute("fill", "url(#shapeGridPatternEditor)");
    shapeEditorCanvas.appendChild(bg);

    const axisX = document.createElementNS(svgNs, "line");
    axisX.setAttribute("x1", "-5000");
    axisX.setAttribute("y1", "120");
    axisX.setAttribute("x2", "5000");
    axisX.setAttribute("y2", "120");
    axisX.setAttribute("stroke", "#7b8da8");
    axisX.setAttribute("stroke-width", "1.4");
    shapeEditorCanvas.appendChild(axisX);

    const axisY = document.createElementNS(svgNs, "line");
    axisY.setAttribute("x1", "120");
    axisY.setAttribute("y1", "-5000");
    axisY.setAttribute("x2", "120");
    axisY.setAttribute("y2", "5000");
    axisY.setAttribute("stroke", "#7b8da8");
    axisY.setAttribute("stroke-width", "1.4");
    shapeEditorCanvas.appendChild(axisY);

    if (!shape) {
      return;
    }

    if (Array.isArray(shape.editableElements)) {
      const layer = document.createElementNS(svgNs, "g");
      const selectedSet = new Set(getSelectedPrimitiveIndices(shape));
      shape.editableElements.forEach((primitive, index) => {
        const effectivePrimitive = resolvePrimitiveWithParameters(primitive, shape.parameters);
        const node = createPrimitiveNode(effectivePrimitive);
        if (!node) {
          return;
        }

        node.setAttribute("data-primitive-index", String(index));
        node.classList.add("shape-primitive");
        if (selectedSet.has(index)) {
          node.classList.add("shape-primitive-selected");
        }

        layer.appendChild(node);
      });

      shapeEditorCanvas.appendChild(layer);
      renderControlHandles(shape);
      return;
    }

    if (!shape.svg) {
      return;
    }

    const parsed = parseSvg(shape.svg);
    if (!parsed) {
      return;
    }

    const importedLayer = document.createElementNS(svgNs, "g");
    Array.from(parsed.root.children).forEach((child) => {
      const tag = child.tagName.toLowerCase();
      if (tag === "script" || tag === "foreignobject") {
        return;
      }

      const clone = child.cloneNode(true);
      stripUnsafeAttributes(clone);
      importedLayer.appendChild(shapeEditorCanvas.ownerDocument.importNode(clone, true));
    });

    shapeEditorCanvas.appendChild(importedLayer);
  }

  function renderPropertiesPanel(shape) {
    shapePropsList.innerHTML = "";

    if (!shape) {
      appendInfo(shapePropsList, "请先创建或选择图形。", "shape-prop-empty");
      return;
    }

    if (!Array.isArray(shape.editableElements)) {
      appendInfo(shapePropsList, "外部导入 SVG 暂不支持逐图元编辑属性。", "shape-prop-empty");
      return;
    }

    if (!shape.editableElements.length) {
      appendInfo(shapePropsList, "暂无图元，请先添加图元。", "shape-prop-empty");
      return;
    }

    const selectedIndices = getSelectedPrimitiveIndices(shape);
    if (selectedIndices.length !== 1) {
      layerMoveMode = null;
    }
    if (!selectedIndices.length) {
      appendInfo(shapePropsList, "已取消图元选择，可点击画布中的图元继续编辑。", "shape-prop-empty");
      return;
    }
    const primitives = selectedIndices.map((index) => shape.editableElements[index]).filter(Boolean);

    if (selectedIndices.length > 1) {
      const typeSet = new Set(primitives.map((item) => item.type));
      if (typeSet.size !== 1) {
        appendInfo(shapePropsList, "多选图元类型不同，无法批量编辑属性。", "shape-prop-empty");
        return;
      }

      const type = primitives[0].type;
      const title = document.createElement("div");
      title.className = "shape-prop-title";
      title.textContent = `批量编辑: ${primitiveTypeLabel(type)} (${selectedIndices.length})`;
      shapePropsList.appendChild(title);

      if (type === "line" || type === "bezier") {
        appendInfo(shapePropsList, "可直接在中间画布拖拽控制点调整端点/控制点位置。", "shape-prop-tip");
      }

      appendInfo(shapePropsList, "拖拽支持自动吸附（网格/轴线/其他图元关键点），按住 Alt 可临时关闭吸附。", "shape-prop-tip");

      const row = document.createElement("div");
      row.className = "shape-prop-grid";
      shapePropsList.appendChild(row);

      renderPrimitiveFields(row, shape, selectedIndices, primitives);
      return;
    }

    const index = selectedIndices[0];
    setSingleSelectedPrimitive(shape, index);
    const primitive = shape.editableElements[index];

    const title = document.createElement("div");
    title.className = "shape-prop-title";
    title.textContent = `当前图元: ${primitiveTypeLabel(primitive.type)} #${index + 1}`;
    shapePropsList.appendChild(title);

    const layerTitle = document.createElement("div");
    layerTitle.className = "shape-layer-title";
    layerTitle.textContent = "排列";
    shapePropsList.appendChild(layerTitle);

    const layerActions = document.createElement("div");
    layerActions.className = "shape-layer-actions";
    const isMoveMode = layerMoveMode && layerMoveMode.sourceIndex === index;
    const canTargetMove = shape.editableElements.length > 1;
    layerActions.appendChild(createLayerActionButton({
      label: "置顶",
      shape,
      action: "top",
      icon: "/img/layer/icon-layer-bring-to-front.svg",
      disabled: index >= shape.editableElements.length - 1
    }));
    layerActions.appendChild(createLayerActionButton({
      label: "置底",
      shape,
      action: "bottom",
      icon: "/img/layer/icon-layer-send-to-back.svg",
      disabled: index <= 0
    }));
    layerActions.appendChild(createLayerActionButton({
      label: "上移",
      shape,
      action: "up",
      icon: "/img/layer/icon-layer-bring-forward.svg",
      disabled: index >= shape.editableElements.length - 1
    }));
    layerActions.appendChild(createLayerActionButton({
      label: "下移",
      shape,
      action: "down",
      icon: "/img/layer/icon-layer-send-backward.svg",
      disabled: index <= 0
    }));
    layerActions.appendChild(createLayerActionButton({
      label: "移到下方",
      shape,
      action: "move-under",
      icon: "/img/layer/icon-layer-down-to.svg",
      active: Boolean(isMoveMode && layerMoveMode.mode === "below"),
      disabled: !canTargetMove
    }));
    layerActions.appendChild(createLayerActionButton({
      label: "移到上方",
      shape,
      action: "move-over",
      icon: "/img/layer/icon-layer-up-to.svg",
      active: Boolean(isMoveMode && layerMoveMode.mode === "above"),
      disabled: !canTargetMove
    }));
    shapePropsList.appendChild(layerActions);

    if (primitive.type === "line" || primitive.type === "bezier") {
      appendInfo(shapePropsList, "可直接在中间画布拖拽控制点调整端点/控制点位置。", "shape-prop-tip");
    }

    appendInfo(shapePropsList, "拖拽支持自动吸附（网格/轴线/其他图元关键点），按住 Alt 可临时关闭吸附。", "shape-prop-tip");

    const row = document.createElement("div");
    row.className = "shape-prop-grid";
    shapePropsList.appendChild(row);

    renderPrimitiveFields(row, shape, [index], [primitive]);
  }

  function renderPrimitiveFields(container, shape, indices, primitives) {
    const shapeParameters = normalizeShapeParameters(shape.parameters);
    shape.parameters = shapeParameters;
    const primary = primitives[0];

    const commit = ({ rerenderProps = false, refreshLibrary = true } = {}) => {
      syncShapeSvg(shape);
      persistShapeLibrary();
      renderEditorCanvas(shape);
      if (refreshLibrary) {
        renderShapeLibraryList();
        renderSubmenu();
      }
      if (rerenderProps) {
        renderPropertiesPanel(shape);
      }
    };

    const resolveFieldValue = (key, paramType, fallback) => {
      return resolvePrimitiveFieldValue(primary, shapeParameters, key, paramType, fallback);
    };

    const applyColorButton = (button, value) => {
      const normalized = normalizeColor(value || "#2f5d9dff");
      button.dataset.colorValue = normalized;
      const swatch = button.querySelector(".color-modal-swatch");
      if (swatch) {
        swatch.style.setProperty("--swatch-color", normalized);
      }
      const text = button.querySelector(".color-modal-text");
      if (text) {
        text.textContent = formatColorWithAlpha(normalized);
      }
    };

    const createColorButton = ({ value, title, onConfirm }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-modal-trigger";
      const swatch = document.createElement("span");
      swatch.className = "color-modal-swatch";
      const text = document.createElement("span");
      text.className = "color-modal-text";
      button.appendChild(swatch);
      button.appendChild(text);
      applyColorButton(button, value);
      button.addEventListener("click", () => {
        if (!colorPicker) {
          return;
        }
        colorPicker.open({
          color: button.dataset.colorValue,
          title: title || "颜色",
          onConfirm: (nextColor) => {
            applyColorButton(button, nextColor);
            onConfirm?.(nextColor);
          }
        });
      });
      return button;
    };

    const applyPrimitiveValue = (key, value) => {
      primitives.forEach((item) => {
        item[key] = value;
      });
    };

    const attachParameterBinding = (field, key, paramType, onModeChange) => {
      const params = shapeParameters.filter((param) => param.type === paramType);
      const label = field.querySelector(".shape-prop-label");
      if (!label) {
        onModeChange(false);
        return;
      }

      const labelRow = document.createElement("div");
      labelRow.className = "shape-prop-label-row";
      label.parentNode.insertBefore(labelRow, label);
      labelRow.appendChild(label);

      const toggleWrap = document.createElement("div");
      toggleWrap.className = "shape-prop-param-toggle";
      const toggleText = document.createElement("span");
      toggleText.textContent = "参数";
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.className = "toggle-checkbox";
      const toggleId = `shape-prop-param-toggle-${shape.id}-${key}-${Math.random().toString(36).slice(2, 8)}`;
      toggle.id = toggleId;
      const slider = document.createElement("span");
      slider.className = "toggle-slider";
      slider.setAttribute("aria-hidden", "true");
      const switchRoot = document.createElement("label");
      switchRoot.className = "toggle-switch";
      switchRoot.setAttribute("for", toggleId);
      switchRoot.appendChild(toggle);
      switchRoot.appendChild(slider);
      toggleWrap.appendChild(toggleText);
      toggleWrap.appendChild(switchRoot);
      labelRow.appendChild(toggleWrap);

      const paramSelect = document.createElement("select");
      paramSelect.className = "shape-prop-param-select";
      if (params.length) {
        params.forEach((param) => {
          const option = document.createElement("option");
          option.value = param.id;
          option.textContent = param.label;
          paramSelect.appendChild(option);
        });
      } else {
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "暂无可用参数";
        paramSelect.appendChild(empty);
      }
      field.appendChild(paramSelect);

      const bindings = primitives.map((item) => getPrimitiveParamBinding(item, key, paramType));
      const firstBinding = bindings[0] || null;
      const allSame = bindings.every((binding) => (
        (binding?.paramId ?? null) === (firstBinding?.paramId ?? null)
      ));
      let selectedParamId = firstBinding?.paramId && params.some((param) => param.id === firstBinding.paramId)
        ? firstBinding.paramId
        : (params[0]?.id || "");

      if (selectedParamId) {
        paramSelect.value = selectedParamId;
      }

      toggle.disabled = !params.length;
      if (!params.length) {
        const typeLabel = shapeParameterTypeDefinitions[paramType]?.label || "同类型参数";
        const disabledHint = `暂无可用${typeLabel}，请先在“参数列表”中添加。`;
        toggleWrap.classList.add("is-disabled");
        switchRoot.classList.add("is-disabled");
        toggleWrap.title = disabledHint;
        switchRoot.title = disabledHint;
      }
      toggle.checked = Boolean(params.length && selectedParamId && firstBinding && allSame);

      const applyMode = () => {
        const useParam = Boolean(toggle.checked && params.length);
        paramSelect.hidden = !useParam;
        paramSelect.disabled = !useParam;

        if (useParam) {
          selectedParamId = paramSelect.value || params[0].id;
          paramSelect.value = selectedParamId;
          primitives.forEach((item) => {
            setPrimitiveParamBinding(item, key, { type: paramType, paramId: selectedParamId });
          });
        } else {
          primitives.forEach((item) => {
            setPrimitiveParamBinding(item, key, null);
          });
        }

        onModeChange(useParam);
      };

      toggle.addEventListener("change", () => {
        applyMode();
        commit({ rerenderProps: true, refreshLibrary: false });
      });

      paramSelect.addEventListener("change", () => {
        applyMode();
        commit({ rerenderProps: true, refreshLibrary: false });
      });

      applyMode();
    };

    const addNumber = (labelText, key, options = {}) => {
      const field = createPropField(labelText);
      const input = document.createElement("input");
      input.type = "number";
      if (Number.isFinite(options.min)) {
        input.min = String(options.min);
      }
      if (Number.isFinite(options.max)) {
        input.max = String(options.max);
      }
      input.step = String(options.step || 1);
      const defaultValue = options.defaultValue || 0;
      input.value = String(toNumber(resolveFieldValue(key, "number", defaultValue), defaultValue));
      input.addEventListener("change", () => {
        const normalized = normalizeNumber(input.value, defaultValue, options.min, options.max);
        applyPrimitiveValue(key, normalized);
        input.value = String(normalized);
        commit();
      });
      attachParameterBinding(field, key, "number", (useParam) => {
        input.disabled = useParam;
        if (useParam) {
          input.value = String(toNumber(resolveFieldValue(key, "number", defaultValue), defaultValue));
        }
      });
      field.appendChild(input);
      container.appendChild(field);
    };

    const addColor = (labelText, key, fallback = "#2f5d9d") => {
      const field = createPropField(labelText);
      const initialValue = resolveFieldValue(key, "color", fallback) || fallback;
      const button = createColorButton({
        value: initialValue,
        title: labelText,
        onConfirm: (nextColor) => {
          const normalized = normalizeColor(nextColor || fallback);
          applyPrimitiveValue(key, normalized);
          commit();
        }
      });
      attachParameterBinding(field, key, "color", (useParam) => {
        button.disabled = useParam;
        const nextValue = useParam
          ? resolveFieldValue(key, "color", fallback)
          : (primary[key] || fallback);
        applyColorButton(button, nextValue || fallback);
      });
      field.appendChild(button);
      container.appendChild(field);
    };

    const addFill = (labelText, key) => {
      const field = createPropField(labelText);
      const select = document.createElement("select");
      [
        { value: "none", text: "无填充" },
        { value: "custom", text: "自定义颜色" }
      ].forEach((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.text;
        select.appendChild(option);
      });

      const button = createColorButton({
        value: primary[key] || "#2f5d9d",
        title: labelText,
        onConfirm: (nextColor) => {
          if (select.value === "none") {
            return;
          }
          const normalized = normalizeColor(nextColor || "#2f5d9d");
          applyPrimitiveValue(key, normalized);
          commit();
        }
      });

      const syncFillFixedState = (useParam) => {
        if (useParam) {
          select.value = "custom";
          select.disabled = true;
          button.disabled = true;
          applyColorButton(button, resolveFieldValue(key, "color", "#2f5d9d") || "#2f5d9d");
          return;
        }

        const isNone = String(primary[key] || "none") === "none";
        select.disabled = false;
        select.value = isNone ? "none" : "custom";
        button.disabled = isNone;
        applyColorButton(button, primary[key] || "#2f5d9d");
      };

      syncFillFixedState(false);

      select.addEventListener("change", () => {
        if (select.value === "none") {
          applyPrimitiveValue(key, "none");
          button.disabled = true;
        } else {
          const nextColor = button.dataset.colorValue || "#2f5d9d";
          applyPrimitiveValue(key, normalizeColor(nextColor));
          button.disabled = false;
        }
        commit();
      });

      attachParameterBinding(field, key, "color", (useParam) => {
        syncFillFixedState(useParam);
      });

      field.appendChild(select);
      field.appendChild(button);
      container.appendChild(field);
    };

    const addText = (labelText, key, fallback = "") => {
      const field = createPropField(labelText);
      const input = document.createElement("input");
      input.type = "text";
      input.value = String(resolveFieldValue(key, "text", fallback) ?? fallback);
      input.addEventListener("input", () => {
        applyPrimitiveValue(key, String(input.value || fallback));
        commit();
      });
      attachParameterBinding(field, key, "text", (useParam) => {
        input.disabled = useParam;
        if (useParam) {
          input.value = String(resolveFieldValue(key, "text", fallback) ?? fallback);
        }
      });
      field.appendChild(input);
      container.appendChild(field);
      return input;
    };

    const addTextSelect = (labelText, key, options, fallback = "") => {
      const field = createPropField(labelText);
      const select = document.createElement("select");
      const list = Array.isArray(options) ? options : [];
      const currentValue = String(resolveFieldValue(key, "text", fallback) ?? fallback);
      const ensureOption = (value) => {
        if (!value) {
          return;
        }
        if (Array.from(select.options).some((option) => option.value === value)) {
          return;
        }
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      };

      list.forEach((font) => {
        const option = document.createElement("option");
        option.value = font;
        option.textContent = font;
        select.appendChild(option);
      });

      ensureOption(currentValue);
      select.value = currentValue || fallback;

      select.addEventListener("change", () => {
        applyPrimitiveValue(key, select.value);
        commit();
      });

      attachParameterBinding(field, key, "text", (useParam) => {
        select.disabled = useParam;
        if (useParam) {
          const resolved = String(resolveFieldValue(key, "text", fallback) ?? fallback);
          ensureOption(resolved);
          select.value = resolved;
        }
      });

      field.appendChild(select);
      container.appendChild(field);
      return select;
    };

    const addTextStyleToolbar = (labelText, valueInput, fontSelect) => {
      const field = createPropField(labelText);
      const toolbar = document.createElement("div");
      toolbar.className = "text-style-toolbar";

      const applyPreview = () => {
        if (valueInput) {
          applyTextInputStyle(valueInput, normalizeTextStyleFlags(primary));
          if (fontSelect) {
            valueInput.style.fontFamily = fontSelect.value || "Segoe UI";
          }
        }
      };

      const buttons = new Map();

      textStyleToolbarItems.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "text-style-btn";
        button.setAttribute("aria-label", item.label);
        toolbar.appendChild(button);

        const img = document.createElement("img");
        img.src = item.icon;
        img.alt = item.label;
        button.appendChild(img);
        buttons.set(item.flag, button);

        button.addEventListener("click", () => {
          const current = normalizeTextStyleFlags(primary);
          const nextValue = !current[item.flag];
          applyPrimitiveValue(item.flag, nextValue);
          const updated = normalizeTextStyleFlags(primary);
          buttons.forEach((btn, flag) => {
            const isActive = Boolean(updated[flag]);
            btn.classList.toggle("active", isActive);
            btn.setAttribute("aria-pressed", isActive ? "true" : "false");
          });
          applyPreview();
          commit();
        });
      });

      field.appendChild(toolbar);
      container.appendChild(field);

      const initial = normalizeTextStyleFlags(primary);
      buttons.forEach((btn, flag) => {
        const isActive = Boolean(initial[flag]);
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
      applyPreview();
    };

    const addToggle = (labelText, key, { rerenderProps = false, onChange, parameterizable = true } = {}) => {
      const field = createPropField(labelText);
      field.classList.add("shape-prop-toggle");
      const toggle = document.createElement("label");
      toggle.className = "toggle-switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "toggle-checkbox";
      input.checked = Boolean(resolveFieldValue(key, "checkbox", primary[key]));
      const slider = document.createElement("span");
      slider.className = "toggle-slider";
      slider.setAttribute("aria-hidden", "true");
      input.addEventListener("change", () => {
        if (input.disabled) {
          return;
        }
        const checked = Boolean(input.checked);
        applyPrimitiveValue(key, checked);
        if (typeof onChange === "function") {
          primitives.forEach((item) => {
            onChange(checked, item);
          });
        }
        commit({ rerenderProps });
      });

      if (parameterizable) {
        attachParameterBinding(field, key, "checkbox", (useParam) => {
          input.disabled = useParam;
          if (useParam) {
            input.checked = Boolean(resolveFieldValue(key, "checkbox", primary[key]));
          }
        });
      }

      toggle.appendChild(input);
      toggle.appendChild(slider);
      field.appendChild(toggle);
      container.appendChild(field);
      return input;
    };

    if (primary.type === "line") {
      addNumber("起点 X", "x1", { defaultValue: 40 });
      addNumber("起点 Y", "y1", { defaultValue: 60 });
      addNumber("终点 X", "x2", { defaultValue: 200 });
      addNumber("终点 Y", "y2", { defaultValue: 180 });
      addNumber("旋转", "rotation", { defaultValue: 0, min: -360, max: 360, step: 1 });
      addNumber("线宽", "strokeWidth", { defaultValue: 8, min: 0.1, max: 100, step: 0.1 });
      addColor("描边颜色", "stroke", "#2f5d9d");
      addToggle("端点圆头", "roundCap");
      return;
    }

    if (primary.type === "circle") {
      addNumber("中心 X", "cx", { defaultValue: 120 });
      addNumber("中心 Y", "cy", { defaultValue: 120 });
      addNumber("半径 X", "radiusX", { defaultValue: 40, min: 1, max: 300 });
      addNumber("半径 Y", "radiusY", { defaultValue: 40, min: 1, max: 300 });
      addNumber("旋转", "rotation", { defaultValue: 0, min: -360, max: 360, step: 1 });
      addNumber("线宽", "strokeWidth", { defaultValue: 8, min: 0.1, max: 100, step: 0.1 });
      addColor("描边颜色", "stroke", "#2f5d9d");
      addFill("填充", "fill");
      return;
    }

    if (primary.type === "rect") {
      addNumber("左上 X", "x", { defaultValue: 56 });
      addNumber("左上 Y", "y", { defaultValue: 56 });
      addNumber("宽度", "width", { defaultValue: 128, min: 1, max: 500 });
      addNumber("高度", "height", { defaultValue: 128, min: 1, max: 500 });
      addToggle("圆角", "rounded", {
        rerenderProps: true,
        onChange: (checked, item) => {
          if (checked && toNumber(item.rx, 0) <= 0) {
            item.rx = 10;
          }
        }
      });

      const rxField = createPropField("圆角半径");
      const rxInput = document.createElement("input");
      rxInput.type = "number";
      rxInput.min = "0";
      rxInput.max = "200";
      rxInput.step = "1";
      rxInput.value = String(toNumber(primary.rx, 10));
      rxInput.disabled = primary.rounded === false;
      rxInput.addEventListener("change", () => {
        const normalized = normalizeNumber(rxInput.value, 10, 0, 200);
        applyPrimitiveValue("rx", normalized);
        rxInput.value = String(normalized);
        commit();
      });
      rxField.appendChild(rxInput);
      container.appendChild(rxField);

      addNumber("旋转", "rotation", { defaultValue: 0, min: -360, max: 360, step: 1 });
      addNumber("线宽", "strokeWidth", { defaultValue: 8, min: 0.1, max: 100, step: 0.1 });
      addColor("描边颜色", "stroke", "#2f5d9d");
      addFill("填充", "fill");
      return;
    }

    if (primary.type === "hexagon" || primary.type === "octagon") {
      addNumber("中心 X", "cx", { defaultValue: 120 });
      addNumber("中心 Y", "cy", { defaultValue: 120 });
      addNumber("半径 X", "radiusX", { defaultValue: 52, min: 1, max: 400 });
      addNumber("半径 Y", "radiusY", { defaultValue: 52, min: 1, max: 400 });
      addNumber("旋转", "rotation", { defaultValue: 0, min: -360, max: 360, step: 1 });
      addNumber("线宽", "strokeWidth", { defaultValue: 8, min: 0.1, max: 100, step: 0.1 });
      addColor("描边颜色", "stroke", "#2f5d9d");
      addFill("填充", "fill");
      return;
    }

    if (primary.type === "bezier") {
      addNumber("起点 X", "x1", { defaultValue: 40 });
      addNumber("起点 Y", "y1", { defaultValue: 170 });
      addNumber("控制点1 X", "cx1", { defaultValue: 90 });
      addNumber("控制点1 Y", "cy1", { defaultValue: 60 });
      addNumber("控制点2 X", "cx2", { defaultValue: 150 });
      addNumber("控制点2 Y", "cy2", { defaultValue: 180 });
      addNumber("终点 X", "x2", { defaultValue: 200 });
      addNumber("终点 Y", "y2", { defaultValue: 70 });
      addNumber("旋转", "rotation", { defaultValue: 0, min: -360, max: 360, step: 1 });
      addNumber("线宽", "strokeWidth", { defaultValue: 8, min: 0.1, max: 100, step: 0.1 });
      addColor("描边颜色", "stroke", "#2f5d9d");
      addToggle("端点圆头", "roundCap");
      return;
    }

    if (primary.type === "text") {
      const valueInput = addText("文本内容", "value", "文本");
      const fontSelect = addTextSelect("字体", "fontFamily", textFontOptions, "Segoe UI");
      if (valueInput && fontSelect) {
        valueInput.style.fontFamily = fontSelect.value || "Segoe UI";
        fontSelect.addEventListener("change", () => {
          valueInput.style.fontFamily = fontSelect.value || "Segoe UI";
        });
      }
      addTextStyleToolbar("文字样式", valueInput, fontSelect);
      addNumber("位置 X", "x", { defaultValue: 120 });
      addNumber("位置 Y", "y", { defaultValue: 120 });
      addNumber("字号", "fontSize", { defaultValue: 26, min: 1, max: 200 });
      addNumber("旋转", "rotation", { defaultValue: 0, min: -360, max: 360, step: 1 });
      addColor("文字颜色", "fill", "#2f5d9d");
      return;
    }

    appendInfo(container, "该图元类型暂不支持编辑。", "shape-prop-empty");
  }

  function renderParameterList(shape) {
    shapeParamList.innerHTML = "";

    const params = normalizeShapeParameters(shape?.parameters);
    if (shape) {
      shape.parameters = params;
    }

    if (!params.length) {
      const empty = document.createElement("div");
      empty.className = "shape-param-item";
      empty.textContent = "暂无参数（可通过上方下拉框选择类型后添加）";
      shapeParamList.appendChild(empty);
      return;
    }

    params.forEach((param, index) => {
      const row = document.createElement("div");
      row.className = "shape-param-item";
      row.dataset.paramIndex = String(index);

      const head = document.createElement("div");
      head.className = "shape-param-head";
      const typeBadge = document.createElement("span");
      typeBadge.className = "shape-param-type";
      typeBadge.textContent = shapeParameterTypeDefinitions[param.type]?.label || "参数";
      head.appendChild(typeBadge);

      const dragHandle = document.createElement("button");
      dragHandle.className = "param-drag-handle";
      dragHandle.type = "button";
      dragHandle.title = "拖拽排序";
      dragHandle.setAttribute("data-drag-handle-index", String(index));
      dragHandle.draggable = true;
      dragHandle.innerHTML = `<img src="img/icon-drag-vertical.svg" alt="" />`;
      head.appendChild(dragHandle);

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-ghost param-remove-btn";
      removeBtn.type = "button";
      removeBtn.textContent = "删除";
      removeBtn.setAttribute("data-remove-param-index", String(index));

      // determine if this parameter is referenced by any primitive
      const isReferenced = (Array.isArray(shape.editableElements) ? shape.editableElements : []).some((prim) => {
        const bindings = getPrimitiveParamBindings(prim);
        return Object.values(bindings || {}).some((b) => String(b.paramId || "") === String(param.id));
      });

      removeBtn.disabled = isReferenced;
      if (removeBtn.disabled) {
        removeBtn.title = "该参数已被图元引用，无法删除";
      }

      // if disabled, wrap so tooltip appears
      if (removeBtn.disabled) {
        const wrapper = document.createElement("span");
        wrapper.className = "disabled-wrapper";
        wrapper.title = removeBtn.title || "该参数已被图元引用，无法删除";
        wrapper.appendChild(removeBtn);
        head.appendChild(wrapper);
      } else {
        head.appendChild(removeBtn);
      }
      row.appendChild(head);

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.value = String(param.label || "参数");
      labelInput.placeholder = "参数名称";
      labelInput.addEventListener("change", () => {
        param.label = String(labelInput.value || "参数").trim() || "参数";
        labelInput.value = param.label;
        persistShapeLibrary();
        renderParameterList(shape);
        renderPropertiesPanel(shape);
      });
      row.appendChild(labelInput);

      const defaultBlock = document.createElement("div");
      defaultBlock.className = "shape-param-default";
      const defaultLabel = document.createElement("span");
      defaultLabel.className = "shape-param-default-label";
      defaultLabel.textContent = "默认值";
      defaultBlock.appendChild(defaultLabel);

      const commitDefault = ({ refreshLibrary = true } = {}) => {
        syncShapeSvg(shape, { preserveParameters: true });
        persistShapeLibrary();
        renderEditorCanvas(shape);
        renderPropertiesPanel(shape);
        if (refreshLibrary) {
          renderShapeLibraryList();
          renderSubmenu();
        }
      };

      const defaultInput = createParameterDefaultInput(param, commitDefault, (previousValue) => {
        const changed = freezePlacedShapeDefaults(shape.id, param.id, param.type, previousValue);
        if (changed) {
          onPlacedShapeDefaultsUpdated?.({ coalesceKey: "shape-default-freeze" });
        }
      });
      defaultBlock.appendChild(defaultInput);
      row.appendChild(defaultBlock);

      // drag/drop handlers
      row.addEventListener("dragover", onParamDragOver);
      row.addEventListener("drop", onParamDrop);
      dragHandle.addEventListener("dragstart", onParamDragStart);
      dragHandle.addEventListener("dragend", onParamDragEnd);

      removeBtn.addEventListener("click", () => {
        if (removeBtn.disabled) {
          return;
        }
        const liveParams = normalizeShapeParameters(shape.parameters || []);
        liveParams.splice(index, 1);
        shape.parameters = liveParams;
        persistShapeLibrary();
        renderParameterList(shape);
        renderPropertiesPanel(shape);
      });

      shapeParamList.appendChild(row);
    });
  }

  function createPropField(labelText) {
    const field = document.createElement("div");
    field.className = "shape-prop-item";

    const title = document.createElement("span");
    title.className = "shape-prop-label";
    title.textContent = labelText;

    field.appendChild(title);
    return field;
  }

  function appendInfo(container, message, className) {
    const info = document.createElement("div");
    info.className = className;
    info.textContent = message;
    container.appendChild(info);
  }

  function findPrimitiveIndex(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    const hit = target.closest("[data-primitive-index]");
    if (!hit) {
      return null;
    }

    const index = Number(hit.getAttribute("data-primitive-index"));
    return Number.isInteger(index) ? index : null;
  }

  function createEmptyShape() {
    const shape = {
      id: createShapeId(),
      name: `图形 ${state.shapeLibrary.length + 1}`,
      svg: "",
      editableElements: [],
      parameters: [],
      imported: false
    };

    syncShapeSvg(shape);
    state.shapeLibrary.push(shape);
    state.shapeManager.selectedId = shape.id;
    setSelectedPrimitiveIndices(shape, []);
    resetViewToSelectedShape();
    persistShapeLibrary();
    renderShapeManager();
    renderSubmenu();
  }

  function ensureEditableShape() {
    let shape = getSelectedShape();
    if (!shape || !Array.isArray(shape.editableElements)) {
      createEmptyShape();
      shape = getSelectedShape();
    }
    return shape || null;
  }

  function addPrimitiveToCurrentShape() {
    let shape = getSelectedShape();
    if (!shape || !Array.isArray(shape.editableElements)) {
      createEmptyShape();
      shape = getSelectedShape();
      if (!shape) {
        return;
      }
    }

    const nextIndex = shape.editableElements.length;
    shape.editableElements.push(createPrimitiveElement(state.shapeManager.primitiveType, nextIndex));
    setSingleSelectedPrimitive(shape, nextIndex);
    syncShapeSvg(shape);

    persistShapeLibrary();
    renderShapeManager();
    renderSubmenu();
  }

  async function importExternalSvgShape(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const normalized = normalizeImportedSvg(text);
      if (!normalized) {
        return;
      }

      const shape = {
        id: createShapeId(),
        name: (file.name || "导入图形").replace(/\.svg$/i, "") || `图形 ${state.shapeLibrary.length + 1}`,
        svg: normalized,
        editableElements: null,
        parameters: [],
        imported: true
      };

      state.shapeLibrary.push(shape);
      state.shapeManager.selectedId = shape.id;
      state.shapeManager.selectedPrimitiveIndices = [];
      state.shapeManager.selectedPrimitiveIndex = null;
      resetViewToSelectedShape();
      persistShapeLibrary();
      renderShapeManager();
      renderSubmenu();
    } catch {
      window.alert("导入失败：SVG 文件格式无效。");
    } finally {
      shapeImportSvgInput.value = "";
    }
  }

  function addParameter(type) {
    const shape = getSelectedShape();
    if (!shape) {
      return;
    }

    if (!Array.isArray(shape.parameters)) {
      shape.parameters = [];
    }

    const normalizedType = shapeParameterTypeDefinitions[type] ? type : "text";

    const nextNo = shape.parameters.length + 1;
    const definition = shapeParameterTypeDefinitions[normalizedType] || shapeParameterTypeDefinitions.text;
    const parameter = {
      id: createShapeId(),
      type: normalizedType,
      label: `${definition.label} ${nextNo}`,
      defaultValue: normalizeShapeParameterDefault(normalizedType, definition.defaultValue),
      conditions: [],
      extensions: {}
    };

    shape.parameters.push(parameter);
    persistShapeLibrary();
    renderPropertiesPanel(shape);
    renderParameterList(shape);
  }

  function createParameterDefaultInput(param, commitDefault, onBeforeDefaultChange) {
    if (param.type === "color") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-modal-trigger";
      const swatch = document.createElement("span");
      swatch.className = "color-modal-swatch";
      const text = document.createElement("span");
      text.className = "color-modal-text";
      button.appendChild(swatch);
      button.appendChild(text);

      const applyValue = (value) => {
        const normalized = normalizeColor(value || "#2f5d9dff");
        button.dataset.colorValue = normalized;
        swatch.style.setProperty("--swatch-color", normalized);
        text.textContent = formatColorWithAlpha(normalized);
      };

      applyValue(param.defaultValue || "#2f5d9d");

      button.addEventListener("click", () => {
        if (!colorPicker) {
          return;
        }
        colorPicker.open({
          color: button.dataset.colorValue,
          title: "参数默认颜色",
          onConfirm: (nextColor) => {
            const previous = param.defaultValue;
            onBeforeDefaultChange?.(previous);
            const normalized = normalizeColor(nextColor || "#2f5d9d");
            param.defaultValue = normalized;
            applyValue(normalized);
            commitDefault({ refreshLibrary: true });
          }
        });
      });

      return button;
    }

    if (param.type === "number") {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.1";
      input.value = String(toNumber(param.defaultValue, 0));
      input.addEventListener("input", () => {
        const previous = param.defaultValue;
        onBeforeDefaultChange?.(previous);
        const normalized = normalizeNumber(input.value, 0, -100000, 100000);
        param.defaultValue = normalized;
        input.value = String(normalized);
        commitDefault({ refreshLibrary: true });
      });
      input.addEventListener("change", () => {
        const previous = param.defaultValue;
        onBeforeDefaultChange?.(previous);
        const normalized = normalizeNumber(input.value, 0, -100000, 100000);
        param.defaultValue = normalized;
        input.value = String(normalized);
        commitDefault({ refreshLibrary: true });
      });
      return input;
    }

    if (param.type === "checkbox") {
      const wrapper = document.createElement("label");
      wrapper.className = "toggle-switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "toggle-checkbox";
      input.checked = Boolean(param.defaultValue);
      const slider = document.createElement("span");
      slider.className = "toggle-slider";
      slider.setAttribute("aria-hidden", "true");
      input.addEventListener("change", () => {
        const previous = param.defaultValue;
        onBeforeDefaultChange?.(previous);
        param.defaultValue = Boolean(input.checked);
        commitDefault({ refreshLibrary: true });
      });
      wrapper.appendChild(input);
      wrapper.appendChild(slider);
      return wrapper;
    }

    const input = document.createElement("input");
    input.type = "text";
    input.value = String(param.defaultValue || "");
    input.addEventListener("input", () => {
      const previous = param.defaultValue;
      onBeforeDefaultChange?.(previous);
      param.defaultValue = String(input.value || "");
      commitDefault({ refreshLibrary: true });
    });
    input.addEventListener("change", () => {
      const previous = param.defaultValue;
      onBeforeDefaultChange?.(previous);
      param.defaultValue = String(input.value || "");
      commitDefault({ refreshLibrary: true });
    });
    return input;
  }

  function freezePlacedShapeDefaults(shapeId, paramId, paramType, previousValue) {
    const oldNormalized = normalizeShapeParameterDefault(paramType, previousValue);
    let changed = false;

    (Array.isArray(state.shapes) ? state.shapes : []).forEach((instance) => {
      if (!instance || instance.shapeId !== shapeId) {
        return;
      }

      if (!instance.paramValues || typeof instance.paramValues !== "object") {
        instance.paramValues = {};
      }

      if (Object.prototype.hasOwnProperty.call(instance.paramValues, paramId)) {
        return;
      }

      instance.paramValues[paramId] = oldNormalized;
      changed = true;
    });

    return changed;
  }

  function onCanvasClick(event) {
    if (suppressCanvasClick) {
      suppressCanvasClick = false;
      return;
    }

    if (!state.shapeManager.isOpen || panState.didPan) {
      panState.didPan = false;
      return;
    }

    const shape = getSelectedShape();
    if (!shape || !Array.isArray(shape.editableElements)) {
      return;
    }

    const primitiveIndex = findPrimitiveIndex(event.target);
    const multiSelect = event.shiftKey;

    if (layerMoveMode) {
      if (Number.isInteger(primitiveIndex)) {
        if (primitiveIndex !== layerMoveMode.sourceIndex) {
          movePrimitiveRelativeToTarget(shape, layerMoveMode.sourceIndex, primitiveIndex, layerMoveMode.mode);
        }
        layerMoveMode = null;
        renderEditorCanvas(shape);
        renderPropertiesPanel(shape);
        return;
      }

      if (!multiSelect) {
        layerMoveMode = null;
      }
    }
    if (Number.isInteger(primitiveIndex)) {
      if (multiSelect) {
        const current = new Set(getSelectedPrimitiveIndices(shape));
        if (current.has(primitiveIndex)) {
          current.delete(primitiveIndex);
        } else {
          current.add(primitiveIndex);
        }
        setSelectedPrimitiveIndices(shape, Array.from(current), { primaryIndex: primitiveIndex });
      } else {
        setSingleSelectedPrimitive(shape, primitiveIndex);
      }
    } else if (!multiSelect) {
      setSelectedPrimitiveIndices(shape, []);
    }
    state.shapeManager.activeTab = "props";
    syncTabVisibility();
    renderEditorCanvas(shape);
    renderPropertiesPanel(shape);
  }

  function onCanvasMouseDown(event) {
    if (!state.shapeManager.isOpen || event.button !== 0) {
      return;
    }

    const handleHit = findHandleHit(event.target);
    if (handleHit) {
      startHandleDrag(handleHit.primitiveIndex, handleHit.handleKey);
      event.preventDefault();
      return;
    }

    const transformHandleHit = findTransformHandleHit(event.target);
    if (transformHandleHit) {
      const startPoint = clientToCanvasPoint(event.clientX, event.clientY);
      if (!startPoint) {
        return;
      }
      startTransformDrag("resize", transformHandleHit.primitiveIndex, transformHandleHit.handleKey, startPoint);
      event.preventDefault();
      return;
    }

    const transformMoveHit = findTransformMoveHit(event.target);
    if (transformMoveHit) {
      const startPoint = clientToCanvasPoint(event.clientX, event.clientY);
      if (!startPoint) {
        return;
      }
      startTransformDrag("move", transformMoveHit.primitiveIndex, "move", startPoint);
      event.preventDefault();
      return;
    }

    if (findPrimitiveIndex(event.target) !== null) {
      return;
    }

    panState.isPanning = true;
    panState.didPan = false;
    panState.startClientX = event.clientX;
    panState.startClientY = event.clientY;
    panState.startCanvasPoint = clientToCanvasPoint(event.clientX, event.clientY);
    panState.startViewBox = { ...getCurrentViewBox() };
    shapeEditorCanvasWrap.classList.add("panning");
    event.preventDefault();
  }

  function onWindowMouseMove(event) {
    if (handleState.isDragging && state.shapeManager.isOpen) {
      const shape = getSelectedShape();
      if (!shape || !Array.isArray(shape.editableElements)) {
        resetHandleDragState();
        return;
      }

      const primitive = shape.editableElements[handleState.primitiveIndex];
      if (!primitive) {
        resetHandleDragState();
        return;
      }

      const rawPoint = clientToCanvasPoint(event.clientX, event.clientY);
      const point = applyAutoSnap(rawPoint, event, getSnapTargetsForShape(shape, handleState.primitiveIndex));
      if (updatePrimitiveByHandle(shape, primitive, handleState.handleKey, point)) {
        handleState.dirty = true;
        handleState.moved = true;
        suppressCanvasClick = true;
        syncShapeSvg(shape);
        renderEditorCanvas(shape);
      }
      return;
    }

    if (transformState.isDragging && state.shapeManager.isOpen) {
      const shape = getSelectedShape();
      if (!shape || !Array.isArray(shape.editableElements)) {
        resetTransformDragState();
        return;
      }

      const primitive = shape.editableElements[transformState.primitiveIndex];
      if (!primitive || !transformState.startPoint || !transformState.startPrimitive) {
        resetTransformDragState();
        return;
      }

      const rawPoint = clientToCanvasPoint(event.clientX, event.clientY);
      const point = transformState.mode === "resize"
        ? rawPoint
        : applyAutoSnap(rawPoint, event, getSnapTargetsForShape(shape, transformState.primitiveIndex));
      if (!point) {
        return;
      }

      let updated = false;
      if (transformState.mode === "move") {
        updated = applyPrimitiveMove(shape, primitive, transformState.startPrimitive, transformState.startPoint, point);
      } else if (transformState.mode === "resize") {
        updated = applyPrimitiveResize(
          shape,
          primitive,
          transformState.startPrimitive,
          transformState.startBounds,
          transformState.handleKey,
          point,
          event.ctrlKey
        );
      }

      if (updated) {
        transformState.dirty = true;
        transformState.moved = true;
        suppressCanvasClick = true;
        syncShapeSvg(shape);
        renderEditorCanvas(shape);
      }

      return;
    }

    if (!panState.isPanning || !state.shapeManager.isOpen) {
      return;
    }

    const startPoint = panState.startCanvasPoint;
    const currentPoint = clientToCanvasPoint(event.clientX, event.clientY);
    if (!startPoint || !currentPoint) {
      return;
    }

    const dxPx = event.clientX - panState.startClientX;
    const dyPx = event.clientY - panState.startClientY;
    if (Math.abs(dxPx) > 1 || Math.abs(dyPx) > 1) {
      panState.didPan = true;
    }

    const dx = currentPoint.x - startPoint.x;
    const dy = currentPoint.y - startPoint.y;

    state.shapeManager.viewBox = {
      x: panState.startViewBox.x - dx,
      y: panState.startViewBox.y - dy,
      width: panState.startViewBox.width,
      height: panState.startViewBox.height
    };

    renderEditorCanvas(getSelectedShape());
  }

  function onWindowMouseUp() {
    if (handleState.isDragging) {
      finishHandleDrag();
      return;
    }

    if (transformState.isDragging) {
      finishTransformDrag();
      return;
    }

    if (!panState.isPanning) {
      return;
    }

    stopPanning();
  }

  function onWindowKeyDown(event) {
    if (!state.shapeManager.isOpen) {
      return;
    }

    const hasModifier = event.ctrlKey || event.metaKey;
    if (hasModifier && !event.altKey && !isTypingElement(event.target)) {
      const key = event.key.toLowerCase();
      if (key === "c") {
        if (clipboard.copySelection()) {
          event.preventDefault();
        }
        return;
      }

      if (key === "x") {
        if (clipboard.cutSelection()) {
          event.preventDefault();
        }
        return;
      }

      if (key === "v") {
        if (clipboard.paste()) {
          event.preventDefault();
        }
        return;
      }
    }

    if (event.key !== "Delete" && event.key !== "Backspace") {
      return;
    }

    if (isTypingElement(event.target)) {
      return;
    }

    if (deleteCurrentSelection()) {
      event.preventDefault();
    }
  }

  function stopPanning() {
    panState.isPanning = false;
    panState.startCanvasPoint = null;
    shapeEditorCanvasWrap.classList.remove("panning");
  }

  function startHandleDrag(primitiveIndex, handleKey) {
    const shape = getSelectedShape();
    if (shape) {
      setSingleSelectedPrimitive(shape, primitiveIndex);
    }
    handleState.isDragging = true;
    handleState.primitiveIndex = primitiveIndex;
    handleState.handleKey = handleKey;
    handleState.moved = false;
    handleState.dirty = false;
  }

  function finishHandleDrag() {
    const shape = getSelectedShape();
    const shouldPersist = handleState.dirty;
    const primitiveIndex = handleState.primitiveIndex;

    resetHandleDragState();

    if (!shouldPersist || !shape) {
      return;
    }

    setSingleSelectedPrimitive(shape, primitiveIndex);
    persistShapeLibrary();
    renderShapeLibraryList();
    renderSubmenu();
    renderPropertiesPanel(shape);
  }

  function resetHandleDragState() {
    handleState.isDragging = false;
    handleState.primitiveIndex = null;
    handleState.handleKey = null;
    handleState.moved = false;
    handleState.dirty = false;
  }

  function renderControlHandles(shape) {
    if (!Array.isArray(shape?.editableElements) || !shape.editableElements.length) {
      return;
    }

    const selectedIndex = getSingleSelectedPrimitiveIndex(shape);
    if (!Number.isInteger(selectedIndex)) {
      return;
    }

    const index = clampPrimitiveIndex(selectedIndex, shape.editableElements.length);
    const primitive = shape.editableElements[index];
    const effectivePrimitive = resolvePrimitiveWithParameters(primitive, shape.parameters);

    if (effectivePrimitive.type !== "line" && effectivePrimitive.type !== "bezier") {
      const bounds = getTransformBoundsForPrimitive(effectivePrimitive);
      if (!bounds) {
        return;
      }

      const box = document.createElementNS(svgNs, "g");
      box.setAttribute("class", "shape-transform-box");
      box.setAttribute("data-shape-transform-box", "1");

      const moveRect = document.createElementNS(svgNs, "rect");
      moveRect.setAttribute("x", String(bounds.minX));
      moveRect.setAttribute("y", String(bounds.minY));
      moveRect.setAttribute("width", String(Math.max(1, bounds.maxX - bounds.minX)));
      moveRect.setAttribute("height", String(Math.max(1, bounds.maxY - bounds.minY)));
      moveRect.setAttribute("class", "shape-transform-move");
      moveRect.setAttribute("data-shape-transform-move", "1");
      moveRect.setAttribute("data-primitive-index", String(index));
      box.appendChild(moveRect);

      const corners = [
        { key: "nw", x: bounds.minX, y: bounds.minY },
        { key: "ne", x: bounds.maxX, y: bounds.minY },
        { key: "se", x: bounds.maxX, y: bounds.maxY },
        { key: "sw", x: bounds.minX, y: bounds.maxY }
      ];

      corners.forEach((corner) => {
        const h = document.createElementNS(svgNs, "rect");
        h.setAttribute("x", String(corner.x - 4.5));
        h.setAttribute("y", String(corner.y - 4.5));
        h.setAttribute("width", "9");
        h.setAttribute("height", "9");
        h.setAttribute("rx", "2");
        h.setAttribute("class", "shape-transform-handle");
        h.setAttribute("data-shape-transform-handle", "1");
        h.setAttribute("data-primitive-index", String(index));
        h.setAttribute("data-handle-key", corner.key);
        box.appendChild(h);
      });

      shapeEditorCanvas.appendChild(box);
      return;
    }

    const handles = getPrimitiveHandles(effectivePrimitive);
    if (!handles.length) {
      return;
    }

    const group = document.createElementNS(svgNs, "g");
    group.setAttribute("class", "shape-control-handles");

    if (primitive.type === "bezier") {
      const g1 = document.createElementNS(svgNs, "line");
      g1.setAttribute("x1", String(primitive.x1));
      g1.setAttribute("y1", String(primitive.y1));
      g1.setAttribute("x2", String(primitive.cx1));
      g1.setAttribute("y2", String(primitive.cy1));
      g1.setAttribute("class", "shape-control-guide");
      group.appendChild(g1);

      const g2 = document.createElementNS(svgNs, "line");
      g2.setAttribute("x1", String(primitive.x2));
      g2.setAttribute("y1", String(primitive.y2));
      g2.setAttribute("x2", String(primitive.cx2));
      g2.setAttribute("y2", String(primitive.cy2));
      g2.setAttribute("class", "shape-control-guide");
      group.appendChild(g2);
    }

    handles.forEach((handle) => {
      const circle = document.createElementNS(svgNs, "circle");
      circle.setAttribute("cx", String(handle.x));
      circle.setAttribute("cy", String(handle.y));
      circle.setAttribute("r", handle.kind === "control" ? "4.8" : "5.4");
      circle.setAttribute("class", `shape-control-handle ${handle.kind === "control" ? "shape-control-handle-control" : "shape-control-handle-end"}`);
      circle.setAttribute("data-shape-handle", "1");
      circle.setAttribute("data-primitive-index", String(index));
      circle.setAttribute("data-handle-key", handle.key);
      group.appendChild(circle);
    });

    shapeEditorCanvas.appendChild(group);
  }

  function findHandleHit(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    const hit = target.closest("[data-shape-handle]");
    if (!hit) {
      return null;
    }

    const primitiveIndex = Number(hit.getAttribute("data-primitive-index"));
    const handleKey = String(hit.getAttribute("data-handle-key") || "");
    if (!Number.isInteger(primitiveIndex) || !handleKey) {
      return null;
    }

    return { primitiveIndex, handleKey };
  }

  function findTransformHandleHit(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    const hit = target.closest("[data-shape-transform-handle]");
    if (!hit) {
      return null;
    }

    const primitiveIndex = Number(hit.getAttribute("data-primitive-index"));
    const handleKey = String(hit.getAttribute("data-handle-key") || "");
    if (!Number.isInteger(primitiveIndex) || !handleKey) {
      return null;
    }

    return { primitiveIndex, handleKey };
  }

  function findTransformMoveHit(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    const hit = target.closest("[data-shape-transform-move]");
    if (!hit) {
      return null;
    }

    const primitiveIndex = Number(hit.getAttribute("data-primitive-index"));
    if (!Number.isInteger(primitiveIndex)) {
      return null;
    }

    return { primitiveIndex };
  }

  function getPrimitiveHandles(primitive) {
    if (!primitive || typeof primitive !== "object") {
      return [];
    }

    if (primitive.type === "line") {
      return [
        { key: "x1y1", x: primitive.x1, y: primitive.y1, kind: "end" },
        { key: "x2y2", x: primitive.x2, y: primitive.y2, kind: "end" }
      ];
    }

    if (primitive.type === "bezier") {
      return [
        { key: "x1y1", x: primitive.x1, y: primitive.y1, kind: "end" },
        { key: "cx1cy1", x: primitive.cx1, y: primitive.cy1, kind: "control" },
        { key: "cx2cy2", x: primitive.cx2, y: primitive.cy2, kind: "control" },
        { key: "x2y2", x: primitive.x2, y: primitive.y2, kind: "end" }
      ];
    }

    return [];
  }

  function setPrimitiveNumberField(shape, primitive, key, value) {
    if (!primitive || typeof primitive !== "object") {
      return;
    }

    primitive[key] = value;

    if (!shape || !Array.isArray(shape.parameters)) {
      return;
    }

    const binding = getPrimitiveParamBinding(primitive, key, "number");
    if (!binding) {
      return;
    }

    const param = shape.parameters.find((item) => item.id === binding.paramId && item.type === "number");
    if (!param) {
      return;
    }

    param.defaultValue = normalizeShapeParameterDefault("number", value);
  }

  function updatePrimitiveByHandle(shape, primitive, handleKey, point) {
    if (!primitive || !point) {
      return false;
    }

    if (primitive.type === "line") {
      if (handleKey === "x1y1") {
        setPrimitiveNumberField(shape, primitive, "x1", Number(point.x.toFixed(2)));
        setPrimitiveNumberField(shape, primitive, "y1", Number(point.y.toFixed(2)));
        return true;
      }
      if (handleKey === "x2y2") {
        setPrimitiveNumberField(shape, primitive, "x2", Number(point.x.toFixed(2)));
        setPrimitiveNumberField(shape, primitive, "y2", Number(point.y.toFixed(2)));
        return true;
      }
      return false;
    }

    if (primitive.type === "bezier") {
      if (handleKey === "x1y1") {
        setPrimitiveNumberField(shape, primitive, "x1", Number(point.x.toFixed(2)));
        setPrimitiveNumberField(shape, primitive, "y1", Number(point.y.toFixed(2)));
        return true;
      }
      if (handleKey === "x2y2") {
        setPrimitiveNumberField(shape, primitive, "x2", Number(point.x.toFixed(2)));
        setPrimitiveNumberField(shape, primitive, "y2", Number(point.y.toFixed(2)));
        return true;
      }
      if (handleKey === "cx1cy1") {
        setPrimitiveNumberField(shape, primitive, "cx1", Number(point.x.toFixed(2)));
        setPrimitiveNumberField(shape, primitive, "cy1", Number(point.y.toFixed(2)));
        return true;
      }
      if (handleKey === "cx2cy2") {
        setPrimitiveNumberField(shape, primitive, "cx2", Number(point.x.toFixed(2)));
        setPrimitiveNumberField(shape, primitive, "cy2", Number(point.y.toFixed(2)));
        return true;
      }
      return false;
    }

    return false;
  }

  function startTransformDrag(mode, primitiveIndex, handleKey, startPoint) {
    const shape = getSelectedShape();
    if (!shape || !Array.isArray(shape.editableElements)) {
      return;
    }

    const primitive = shape.editableElements[primitiveIndex];
    const effectivePrimitive = resolvePrimitiveWithParameters(primitive, shape.parameters);
    const bounds = getTransformBoundsForPrimitive(effectivePrimitive);
    if (!primitive || !bounds) {
      return;
    }

    setSingleSelectedPrimitive(shape, primitiveIndex);

    transformState.isDragging = true;
    transformState.mode = mode;
    transformState.primitiveIndex = primitiveIndex;
    transformState.handleKey = handleKey;
    transformState.startPoint = { ...startPoint };
    transformState.startBounds = { ...bounds };
    transformState.startPrimitive = structuredClone(effectivePrimitive);
    transformState.dirty = false;
    transformState.moved = false;
  }

  function finishTransformDrag() {
    const shape = getSelectedShape();
    const shouldPersist = transformState.dirty;
    const primitiveIndex = transformState.primitiveIndex;

    resetTransformDragState();

    if (!shape || !shouldPersist) {
      return;
    }

    setSingleSelectedPrimitive(shape, primitiveIndex);
    persistShapeLibrary();
    renderShapeLibraryList();
    renderSubmenu();
    renderPropertiesPanel(shape);
  }

  function resetTransformDragState() {
    transformState.isDragging = false;
    transformState.mode = null;
    transformState.primitiveIndex = null;
    transformState.handleKey = null;
    transformState.startPoint = null;
    transformState.startBounds = null;
    transformState.startPrimitive = null;
    transformState.dirty = false;
    transformState.moved = false;
  }

  function applyPrimitiveMove(shape, primitive, startPrimitive, startPoint, currentPoint) {
    const dx = currentPoint.x - startPoint.x;
    const dy = currentPoint.y - startPoint.y;

    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
      return false;
    }

    if (primitive.type === "circle" || primitive.type === "hexagon" || primitive.type === "octagon") {
      setPrimitiveNumberField(shape, primitive, "cx", Number((startPrimitive.cx + dx).toFixed(2)));
      setPrimitiveNumberField(shape, primitive, "cy", Number((startPrimitive.cy + dy).toFixed(2)));
      return true;
    }

    if (primitive.type === "rect") {
      setPrimitiveNumberField(shape, primitive, "x", Number((startPrimitive.x + dx).toFixed(2)));
      setPrimitiveNumberField(shape, primitive, "y", Number((startPrimitive.y + dy).toFixed(2)));
      return true;
    }

    if (primitive.type === "text") {
      setPrimitiveNumberField(shape, primitive, "x", Number((startPrimitive.x + dx).toFixed(2)));
      setPrimitiveNumberField(shape, primitive, "y", Number((startPrimitive.y + dy).toFixed(2)));
      return true;
    }

    return false;
  }

  function applyPrimitiveResize(shape, primitive, startPrimitive, startBounds, handleKey, currentPoint, lockAspectRatio) {
    if (!startBounds) {
      return false;
    }

    const anchor = getResizeAnchor(startBounds, handleKey);
    if (!anchor) {
      return false;
    }

    const corner = getResizeCorner(startBounds, handleKey, anchor, currentPoint, lockAspectRatio);
    const minX = Math.min(anchor.x, corner.x);
    const maxX = Math.max(anchor.x, corner.x);
    const minY = Math.min(anchor.y, corner.y);
    const maxY = Math.max(anchor.y, corner.y);

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    if (primitive.type === "rect") {
      setPrimitiveNumberField(shape, primitive, "x", Number(minX.toFixed(2)));
      setPrimitiveNumberField(shape, primitive, "y", Number(minY.toFixed(2)));
      setPrimitiveNumberField(shape, primitive, "width", Number(width.toFixed(2)));
      setPrimitiveNumberField(shape, primitive, "height", Number(height.toFixed(2)));
      if (primitive.rounded === false) {
        setPrimitiveNumberField(shape, primitive, "rx", 0);
      } else {
        setPrimitiveNumberField(shape, primitive, "rx", Number(Math.min(width, height, startPrimitive.rx || 0).toFixed(2)));
      }
      return true;
    }

    if (primitive.type === "circle" || primitive.type === "hexagon" || primitive.type === "octagon") {
      const rx = Math.max(1, width / 2);
      const ry = Math.max(1, height / 2);
      setPrimitiveNumberField(shape, primitive, "cx", Number(((minX + maxX) / 2).toFixed(2)));
      setPrimitiveNumberField(shape, primitive, "cy", Number(((minY + maxY) / 2).toFixed(2)));
      setPrimitiveNumberField(shape, primitive, "radiusX", Number(rx.toFixed(2)));
      setPrimitiveNumberField(shape, primitive, "radiusY", Number(ry.toFixed(2)));
      setPrimitiveNumberField(shape, primitive, "r", Number(((rx + ry) / 2).toFixed(2)));
      return true;
    }

    if (primitive.type === "text") {
      const startW = Math.max(1, startBounds.maxX - startBounds.minX);
      const startH = Math.max(1, startBounds.maxY - startBounds.minY);
      const scale = Math.max(width / startW, height / startH);
      setPrimitiveNumberField(shape, primitive, "x", Number(((minX + maxX) / 2).toFixed(2)));
      setPrimitiveNumberField(shape, primitive, "y", Number(((minY + maxY) / 2).toFixed(2)));
      setPrimitiveNumberField(
        shape,
        primitive,
        "fontSize",
        Number(clampNumber((startPrimitive.fontSize || 26) * scale, 1, 240).toFixed(2))
      );
      return true;
    }

    return false;
  }

  function getResizeAnchor(bounds, handleKey) {
    if (handleKey === "se") {
      return { x: bounds.minX, y: bounds.minY };
    }
    if (handleKey === "sw") {
      return { x: bounds.maxX, y: bounds.minY };
    }
    if (handleKey === "ne") {
      return { x: bounds.minX, y: bounds.maxY };
    }
    if (handleKey === "nw") {
      return { x: bounds.maxX, y: bounds.maxY };
    }
    return null;
  }

  function getResizeCorner(bounds, handleKey, anchor, point, lockAspectRatio) {
    const sign = {
      se: { x: 1, y: 1 },
      sw: { x: -1, y: 1 },
      ne: { x: 1, y: -1 },
      nw: { x: -1, y: -1 }
    }[handleKey] || { x: 1, y: 1 };

    let dx = Math.max(1, (point.x - anchor.x) * sign.x);
    let dy = Math.max(1, (point.y - anchor.y) * sign.y);

    if (lockAspectRatio) {
      const startW = Math.max(1, bounds.maxX - bounds.minX);
      const startH = Math.max(1, bounds.maxY - bounds.minY);
      const ratio = startW / startH;
      if (dx / dy > ratio) {
        dy = dx / ratio;
      } else {
        dx = dy * ratio;
      }
    }

    return {
      x: anchor.x + sign.x * dx,
      y: anchor.y + sign.y * dy
    };
  }

  function getTransformBoundsForPrimitive(primitive) {
    if (!primitive || typeof primitive !== "object") {
      return null;
    }

    if (primitive.type === "circle" || primitive.type === "hexagon" || primitive.type === "octagon") {
      const fallback = primitive.type === "circle" ? 42 : 52;
      const { radiusX, radiusY } = getPrimitiveRadii(primitive, fallback);
      return {
        minX: primitive.cx - radiusX,
        minY: primitive.cy - radiusY,
        maxX: primitive.cx + radiusX,
        maxY: primitive.cy + radiusY
      };
    }

    if (primitive.type === "rect") {
      return {
        minX: primitive.x,
        minY: primitive.y,
        maxX: primitive.x + primitive.width,
        maxY: primitive.y + primitive.height
      };
    }

    if (primitive.type === "text") {
      const width = Math.max(12, String(primitive.value || "").length * primitive.fontSize * 0.55);
      const height = Math.max(primitive.fontSize, 12);
      return {
        minX: primitive.x - width / 2,
        minY: primitive.y - height / 2,
        maxX: primitive.x + width / 2,
        maxY: primitive.y + height / 2
      };
    }

    return null;
  }

  function createLayerActionButton({ label, shape, action, icon, disabled, active }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "shape-layer-action";
    if (active) {
      button.classList.add("active");
    }
    button.title = label;
    button.setAttribute("aria-label", label);
    button.disabled = Boolean(disabled);
    if (icon) {
      const image = document.createElement("img");
      image.src = icon;
      image.alt = "";
      button.appendChild(image);
    } else {
      button.textContent = label;
    }

    button.addEventListener("click", () => {
      if (button.disabled) {
        return;
      }

      if (action === "move-under" || action === "move-over") {
        const selectedIndex = getSingleSelectedPrimitiveIndex(shape);
        if (!Number.isInteger(selectedIndex)) {
          return;
        }

        const mode = action === "move-under" ? "below" : "above";
        if (layerMoveMode && layerMoveMode.sourceIndex === selectedIndex && layerMoveMode.mode === mode) {
          layerMoveMode = null;
        } else {
          layerMoveMode = { sourceIndex: selectedIndex, mode };
        }
        renderPropertiesPanel(shape);
        return;
      }

      layerMoveMode = null;
      moveSelectedPrimitive(shape, action);
    });
    return button;
  }

  function moveSelectedPrimitive(shape, direction) {
    if (!shape || !Array.isArray(shape.editableElements) || !shape.editableElements.length) {
      return;
    }

    const length = shape.editableElements.length;
    const selectedIndex = getSingleSelectedPrimitiveIndex(shape);
    if (!Number.isInteger(selectedIndex)) {
      return;
    }
    const index = clampPrimitiveIndex(selectedIndex, length);

    let targetIndex = index;
    if (direction === "up") {
      targetIndex = Math.min(length - 1, index + 1);
    } else if (direction === "down") {
      targetIndex = Math.max(0, index - 1);
    } else if (direction === "top") {
      targetIndex = length - 1;
    } else if (direction === "bottom") {
      targetIndex = 0;
    }

    if (targetIndex === index) {
      return;
    }

    const moved = shape.editableElements.splice(index, 1)[0];
    shape.editableElements.splice(targetIndex, 0, moved);
    setSingleSelectedPrimitive(shape, targetIndex);

    syncShapeSvg(shape);
    persistShapeLibrary();
    renderEditorCanvas(shape);
    renderPropertiesPanel(shape);
    renderShapeLibraryList();
    renderSubmenu();
  }

  function movePrimitiveRelativeToTarget(shape, sourceIndex, targetIndex, mode) {
    if (!shape || !Array.isArray(shape.editableElements) || !shape.editableElements.length) {
      return;
    }

    const length = shape.editableElements.length;
    const source = clampPrimitiveIndex(sourceIndex, length);
    const target = clampPrimitiveIndex(targetIndex, length);
    if (source === target) {
      return;
    }

    const [moved] = shape.editableElements.splice(source, 1);
    let insertIndex = mode === "above" ? target + 1 : target;
    if (source < insertIndex) {
      insertIndex -= 1;
    }
    shape.editableElements.splice(insertIndex, 0, moved);
    setSingleSelectedPrimitive(shape, insertIndex);

    syncShapeSvg(shape);
    persistShapeLibrary();
    renderEditorCanvas(shape);
    renderPropertiesPanel(shape);
    renderShapeLibraryList();
    renderSubmenu();
  }

  function getSnapTargetsForShape(shape, excludeIndex) {
    const targetsX = [snapConfig.axisX];
    const targetsY = [snapConfig.axisY];

    if (!Array.isArray(shape?.editableElements)) {
      return { targetsX, targetsY };
    }

    shape.editableElements.forEach((primitive, index) => {
      if (index === excludeIndex) {
        return;
      }

      getPrimitiveSnapPoints(primitive).forEach((point) => {
        targetsX.push(point.x);
        targetsY.push(point.y);
      });
    });

    return { targetsX, targetsY };
  }

  function getPrimitiveSnapPoints(primitive) {
    if (!primitive || typeof primitive !== "object") {
      return [];
    }

    if (primitive.type === "line") {
      return [
        { x: primitive.x1, y: primitive.y1 },
        { x: primitive.x2, y: primitive.y2 },
        { x: (primitive.x1 + primitive.x2) / 2, y: (primitive.y1 + primitive.y2) / 2 }
      ];
    }

    if (primitive.type === "bezier") {
      return [
        { x: primitive.x1, y: primitive.y1 },
        { x: primitive.cx1, y: primitive.cy1 },
        { x: primitive.cx2, y: primitive.cy2 },
        { x: primitive.x2, y: primitive.y2 },
        { x: (primitive.x1 + primitive.x2) / 2, y: (primitive.y1 + primitive.y2) / 2 }
      ];
    }

    if (primitive.type === "circle" || primitive.type === "hexagon" || primitive.type === "octagon") {
      const fallback = primitive.type === "circle" ? 42 : 52;
      const { radiusX, radiusY } = getPrimitiveRadii(primitive, fallback);
      return [
        { x: primitive.cx, y: primitive.cy },
        { x: primitive.cx - radiusX, y: primitive.cy - radiusY },
        { x: primitive.cx + radiusX, y: primitive.cy + radiusY }
      ];
    }

    if (primitive.type === "rect") {
      return [
        { x: primitive.x, y: primitive.y },
        { x: primitive.x + primitive.width, y: primitive.y + primitive.height },
        { x: primitive.x + primitive.width / 2, y: primitive.y + primitive.height / 2 }
      ];
    }

    if (primitive.type === "text") {
      return [{ x: primitive.x, y: primitive.y }];
    }

    return [];
  }

  function applyAutoSnap(point, event, snapTargets) {
    if (!point) {
      return null;
    }

    if (event.altKey || state.appSettings?.snapOverlap === false) {
      return point;
    }

    const useAlign = state.appSettings?.snapAxisDiagonal !== false;
    const useGrid = state.appSettings?.snapGrid !== false;
    if (!useAlign && !useGrid) {
      return point;
    }

    const tolerance = getSnapToleranceInCanvas();
    return {
      x: snapValue(point.x, useAlign ? (snapTargets?.targetsX || []) : [], tolerance, useGrid),
      y: snapValue(point.y, useAlign ? (snapTargets?.targetsY || []) : [], tolerance, useGrid)
    };
  }

  function getSnapToleranceInCanvas() {
    const rect = shapeEditorCanvas?.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      return 2;
    }

    const viewBox = getCurrentViewBox();
    const unitX = viewBox.width / rect.width;
    const unitY = viewBox.height / rect.height;
    return Math.max(1, Math.max(unitX, unitY) * snapConfig.pixelTolerance);
  }

  function snapValue(value, targets, tolerance, useGrid) {
    const candidates = [...targets];
    if (useGrid) {
      candidates.push(Math.round(value / snapConfig.gridStep) * snapConfig.gridStep);
    }
    let bestValue = value;
    let bestDistance = tolerance;

    candidates.forEach((candidate) => {
      if (!Number.isFinite(candidate)) {
        return;
      }

      const distance = Math.abs(candidate - value);
      if (distance <= bestDistance) {
        bestDistance = distance;
        bestValue = candidate;
      }
    });

    return Number(bestValue.toFixed(2));
  }

  function deleteCurrentSelection() {
    const shape = getSelectedShape();
    if (!shape) {
      return false;
    }

    if (Array.isArray(shape.editableElements)) {
      const selectedIndices = getSelectedPrimitiveIndices(shape);
      if (selectedIndices.length) {
        const sorted = [...selectedIndices].sort((a, b) => b - a);
        sorted.forEach((index) => {
          if (index >= 0 && index < shape.editableElements.length) {
            shape.editableElements.splice(index, 1);
          }
        });

        if (shape.editableElements.length) {
          const nextIndex = Math.min(Math.min(...selectedIndices), shape.editableElements.length - 1);
          setSingleSelectedPrimitive(shape, nextIndex);
        } else {
          setSelectedPrimitiveIndices(shape, []);
        }

        syncShapeSvg(shape);
        persistShapeLibrary();
        renderShapeManager();
        renderSubmenu();
        return true;
      }
    }

    const shapeIndex = state.shapeLibrary.findIndex((item) => item.id === shape.id);
    if (shapeIndex < 0) {
      return false;
    }

    state.shapeLibrary.splice(shapeIndex, 1);
    const nextShape = state.shapeLibrary[Math.min(shapeIndex, state.shapeLibrary.length - 1)] || null;
    state.shapeManager.selectedId = nextShape?.id || null;
    if (nextShape) {
      setSingleSelectedPrimitive(nextShape, getFirstPrimitiveIndex(nextShape));
    } else {
      state.shapeManager.selectedPrimitiveIndices = [];
      state.shapeManager.selectedPrimitiveIndex = null;
    }
    resetViewToSelectedShape();

    persistShapeLibrary();
    renderShapeManager();
    renderSubmenu();
    return true;
  }

  function isTypingElement(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      return true;
    }

    return target.isContentEditable;
  }

  function onCanvasWheel(event) {
    if (!state.shapeManager.isOpen) {
      return;
    }

    event.preventDefault();

    const current = getCurrentViewBox();
    const scaleFactor = event.deltaY < 0 ? 0.9 : 1.1;
    const nextWidth = clampNumber(current.width * scaleFactor, 20, 2400);
    const nextHeight = clampNumber(current.height * scaleFactor, 20, 2400);

    const focus = clientToCanvasPoint(event.clientX, event.clientY) || {
      x: current.x + current.width / 2,
      y: current.y + current.height / 2
    };
    const rx = (focus.x - current.x) / current.width;
    const ry = (focus.y - current.y) / current.height;

    state.shapeManager.viewBox = {
      x: focus.x - rx * nextWidth,
      y: focus.y - ry * nextHeight,
      width: nextWidth,
      height: nextHeight
    };

    renderEditorCanvas(getSelectedShape());
  }

  function clientToCanvasPoint(clientX, clientY) {
    if (!shapeEditorCanvas) {
      return null;
    }

    const ctm = shapeEditorCanvas.getScreenCTM();
    if (!ctm) {
      return null;
    }

    const point = shapeEditorCanvas.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(ctm.inverse());

    return {
      x: transformed.x,
      y: transformed.y
    };
  }

  function getSelectedShape() {
    return state.shapeLibrary.find((shape) => shape.id === state.shapeManager.selectedId) || null;
  }

  function ensureSelectedShape() {
    if (getSelectedShape()) {
      return;
    }

    state.shapeManager.selectedId = state.shapeLibrary[0]?.id || null;
    const shape = getSelectedShape();
    if (shape) {
      setSingleSelectedPrimitive(shape, getFirstPrimitiveIndex(shape));
    } else {
      state.shapeManager.selectedPrimitiveIndices = [];
      state.shapeManager.selectedPrimitiveIndex = null;
    }
  }

  function ensureShapeManagerState() {
    if (!state.shapeManager || typeof state.shapeManager !== "object") {
      state.shapeManager = {};
    }

    state.shapeManager.primitiveType = state.shapeManager.primitiveType || "line";
    state.shapeManager.activeTab = state.shapeManager.activeTab || "props";
    state.shapeManager.parameterType = shapeParameterTypeDefinitions[state.shapeManager.parameterType]
      ? state.shapeManager.parameterType
      : "color";
    state.shapeManager.checkedIds = Array.isArray(state.shapeManager.checkedIds)
      ? state.shapeManager.checkedIds.map((id) => String(id))
      : [];
    const selection = Array.isArray(state.shapeManager.selectedPrimitiveIndices)
      ? state.shapeManager.selectedPrimitiveIndices.filter((index) => Number.isInteger(index))
      : [];
    state.shapeManager.selectedPrimitiveIndices = selection;
    if (Number.isInteger(state.shapeManager.selectedPrimitiveIndex)) {
      if (!selection.includes(state.shapeManager.selectedPrimitiveIndex)) {
        selection.push(state.shapeManager.selectedPrimitiveIndex);
      }
    } else {
      state.shapeManager.selectedPrimitiveIndex = selection.length ? selection[selection.length - 1] : null;
    }

    const vb = state.shapeManager.viewBox;
    if (!vb || !Number.isFinite(vb.x) || !Number.isFinite(vb.y) || !Number.isFinite(vb.width) || !Number.isFinite(vb.height)) {
      state.shapeManager.viewBox = { ...defaultViewBox };
    }
  }

  function getCurrentViewBox() {
    const vb = state.shapeManager.viewBox || defaultViewBox;
    return {
      x: Number(vb.x) || 0,
      y: Number(vb.y) || 0,
      width: clampNumber(Number(vb.width) || 240, 20, 2400),
      height: clampNumber(Number(vb.height) || 240, 20, 2400)
    };
  }

  function resetViewToSelectedShape() {
    const shape = getSelectedShape();
    if (!shape) {
      state.shapeManager.viewBox = { ...defaultViewBox };
      return;
    }

    let sourceView = null;

    if (Array.isArray(shape.editableElements) && shape.editableElements.length) {
      const bounds = computeEditableBounds(shape.editableElements);
      if (bounds) {
        sourceView = boundsToViewBox(bounds, 24);
      }
    } else {
      const parsed = parseSvg(shape.svg);
      if (parsed?.viewBox) {
        sourceView = boundsToViewBox({
          minX: parsed.viewBox.x,
          minY: parsed.viewBox.y,
          maxX: parsed.viewBox.x + parsed.viewBox.width,
          maxY: parsed.viewBox.y + parsed.viewBox.height
        }, 24);
      }
    }

    state.shapeManager.viewBox = sourceView || { ...defaultViewBox };
  }

  function loadShapeLibraryFromStorage() {
    state.shapeLibrary = readShapeLibrary();
    ensureSelectedShape();
    initShapeHistoryBaseline();
    renderSubmenu();
  }

  function buildShapeLibraryPayload() {
    return state.shapeLibrary.map((shape) => {
      const editableElements = Array.isArray(shape.editableElements)
        ? normalizeEditableElements(shape.editableElements)
        : null;
      const parameters = normalizeShapeParameters(shape.parameters);

      const safeShape = {
        id: String(shape.id || createShapeId()),
        name: String(shape.name || "图形").trim() || "图形",
        editableElements,
        parameters,
        imported: Boolean(shape.imported)
      };

      safeShape.svg = editableElements
        ? buildSvgFromEditableElements(resolveEditableElementsWithParameters(editableElements, parameters))
        : String(shape.svg || "");

      return safeShape;
    });
  }

  function buildShapeHistorySnapshot(payload) {
    const library = payload || buildShapeLibraryPayload();
    return JSON.stringify({
      library,
      selectedId: state.shapeManager.selectedId || null,
      selectedPrimitiveIndices: Array.isArray(state.shapeManager.selectedPrimitiveIndices)
        ? state.shapeManager.selectedPrimitiveIndices
        : [],
      selectedPrimitiveIndex: Number.isInteger(state.shapeManager.selectedPrimitiveIndex)
        ? state.shapeManager.selectedPrimitiveIndex
        : null,
      viewBox: getCurrentViewBox()
    });
  }

  function commitShapeHistory(payload) {
    if (historyManager.isApplying()) {
      return;
    }

    const snapshot = buildShapeHistorySnapshot(payload);
    historyManager.commit(snapshot, { coalesceKey: "shape-edit" });
    updateShapeHistoryUI();
  }

  function initShapeHistoryBaseline() {
    historyManager.initBaseline(buildShapeHistorySnapshot());
    updateShapeHistoryUI();
  }

  function applyShapeHistorySnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(snapshot);
    } catch {
      return;
    }

    const library = Array.isArray(parsed?.library)
      ? parsed.library.map((shape) => sanitizeShape(shape)).filter(Boolean)
      : [];

    state.shapeLibrary = library;

    if (!library.length) {
      state.shapeManager.selectedId = null;
      state.shapeManager.selectedPrimitiveIndices = [];
      state.shapeManager.selectedPrimitiveIndex = null;
    } else {
      const selectedId = parsed?.selectedId;
      const selectedShape = library.find((shape) => shape.id === selectedId) || library[0];
      state.shapeManager.selectedId = selectedShape?.id || null;

      const indices = Array.isArray(parsed?.selectedPrimitiveIndices)
        ? parsed.selectedPrimitiveIndices
        : [];
      const primaryIndex = Number.isInteger(parsed?.selectedPrimitiveIndex)
        ? parsed.selectedPrimitiveIndex
        : null;
      setSelectedPrimitiveIndices(selectedShape, indices, { primaryIndex });

      if (!getSelectedPrimitiveIndices(selectedShape).length) {
        setSingleSelectedPrimitive(selectedShape, getFirstPrimitiveIndex(selectedShape));
      }
    }

    const vb = parsed?.viewBox;
    if (vb && Number.isFinite(vb.x) && Number.isFinite(vb.y) && Number.isFinite(vb.width) && Number.isFinite(vb.height)) {
      state.shapeManager.viewBox = {
        x: vb.x,
        y: vb.y,
        width: vb.width,
        height: vb.height
      };
    } else {
      resetViewToSelectedShape();
    }

    persistShapeLibrary({ skipHistory: true });
    renderShapeManager();
    renderSubmenu();
  }

  function persistShapeLibrary(options = {}) {
    try {
      const payload = buildShapeLibraryPayload();
      localStorage.setItem(shapeStorageKey, JSON.stringify(payload));

      if (!options.skipHistory) {
        commitShapeHistory(payload);
      }
    } catch {
      // Ignore localStorage quota/availability errors.
    }
  }

  function updateShapeHistoryUI() {
    if (shapeUndoBtn) {
      shapeUndoBtn.disabled = !historyManager.canUndo();
      shapeUndoBtn.setAttribute("aria-disabled", String(shapeUndoBtn.disabled));
    }

    if (shapeRedoBtn) {
      shapeRedoBtn.disabled = !historyManager.canRedo();
      shapeRedoBtn.setAttribute("aria-disabled", String(shapeRedoBtn.disabled));
    }
  }

  function readShapeLibrary() {
    try {
      const raw = localStorage.getItem(shapeStorageKey);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((shape) => sanitizeShape(shape))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function sanitizeShape(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const editableElements = Array.isArray(raw.editableElements)
      ? normalizeEditableElements(raw.editableElements)
      : null;

    let svg = "";
    if (editableElements) {
      svg = buildSvgFromEditableElements(editableElements);
    } else {
      svg = normalizeImportedSvg(raw.svg || "");
      if (!svg) {
        return null;
      }
    }

    return {
      id: String(raw.id || createShapeId()),
      name: String(raw.name || "图形").trim() || "图形",
      svg,
      editableElements,
      parameters: normalizeShapeParameters(raw.parameters),
      imported: Boolean(raw.imported)
    };
  }

  function syncShapeSvg(shape, options = {}) {
    if (!shape || !Array.isArray(shape.editableElements)) {
      return;
    }

    // Keep object references stable for active property panel listeners (e.g. color picker drag).
    if (!options.preserveParameters) {
      shape.parameters = normalizeShapeParameters(shape.parameters);
    }
    shape.svg = buildSvgFromEditableElements(resolveEditableElementsWithParameters(shape.editableElements, shape.parameters));
    shape.imported = false;
  }

  return {
    bind,
    open,
    close,
    undo,
    redo,
    copySelection: clipboard.copySelection,
    cutSelection: clipboard.cutSelection,
    pasteSelection: clipboard.paste,
    clearClipboard: clipboard.clear,
    hasClipboard: clipboard.hasData
  };
}
