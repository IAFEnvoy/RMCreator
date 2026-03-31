import { shapeStorageKey } from "./constants.js";
import { svgNs } from "./dom.js";

const defaultViewBox = Object.freeze({ x: 0, y: 0, width: 240, height: 240 });
const snapConfig = Object.freeze({
  gridStep: 10,
  axisX: 120,
  axisY: 120,
  pixelTolerance: 8
});

export const shapeParameterTypeDefinitions = Object.freeze({
  color: { label: "颜色参数", defaultValue: "#2f5d9d" },
  text: { label: "文本参数", defaultValue: "" },
  number: { label: "数字参数", defaultValue: 0 },
  checkbox: { label: "勾选参数", defaultValue: false }
});

export function createShapeManager({
  state,
  elements,
  createShapeId,
  renderSubmenu
}) {
  const {
    shapeManagerModal,
    closeShapeManagerBtn,
    newShapeBtn,
    shapeLibraryList,
    shapeNameInput,
    shapePrimitiveSelect,
    shapeAddPrimitiveBtn,
    shapeResetViewBtn,
    shapeImportSvgBtn,
    shapeImportSvgInput,
    shapeEditorCanvasWrap,
    shapeEditorCanvas,
    shapeTabPropsBtn,
    shapeTabParamsBtn,
    shapePropsPanel,
    shapeParamsPanel,
    shapePropsList,
    shapeParamTypeSelect,
    shapeAddParamBtn,
    shapeParamList
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

  function bind() {
    if (
      !shapeManagerModal
      || !closeShapeManagerBtn
      || !newShapeBtn
      || !shapeLibraryList
      || !shapeNameInput
      || !shapePrimitiveSelect
      || !shapeAddPrimitiveBtn
      || !shapeResetViewBtn
      || !shapeImportSvgBtn
      || !shapeImportSvgInput
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
    ) {
      return;
    }

    ensureShapeManagerState();
    loadShapeLibraryFromStorage();

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
  }

  function renderShapeManager() {
    const selectedShape = getSelectedShape();

    renderShapeLibraryList();
    shapePrimitiveSelect.value = state.shapeManager.primitiveType || "line";
    shapeParamTypeSelect.value = shapeParameterTypeDefinitions[state.shapeManager.parameterType || "color"]
      ? state.shapeManager.parameterType || "color"
      : "color";
    shapeNameInput.value = selectedShape?.name || "";

    syncTabVisibility();
    renderEditorCanvas(selectedShape);
    renderPropertiesPanel(selectedShape);
    renderParameterList(selectedShape);
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

    if (!state.shapeLibrary.length) {
      const empty = document.createElement("div");
      empty.className = "kv";
      empty.textContent = "图形库为空，请创建或导入 SVG 图形。";
      shapeLibraryList.appendChild(empty);
      return;
    }

    state.shapeLibrary.forEach((shape) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "line-library-item";
      item.classList.toggle("active", shape.id === state.shapeManager.selectedId);

      const row = document.createElement("div");
      row.className = "line-library-item-row";

      const title = document.createElement("span");
      title.className = "line-library-item-title";
      title.textContent = shape.name;

      const preview = document.createElement("img");
      preview.className = "shape-library-preview-inline";
      preview.alt = `${shape.name}预览`;
      preview.src = toSvgDataUrl(shape.svg);

      row.appendChild(title);
      row.appendChild(preview);
      item.appendChild(row);

      const tag = document.createElement("span");
      tag.className = "line-library-item-tag";
      tag.textContent = shape.imported ? "外部SVG" : "编辑图形";
      item.appendChild(tag);

      item.addEventListener("click", () => {
        state.shapeManager.selectedId = shape.id;
        state.shapeManager.selectedPrimitiveIndex = getFirstPrimitiveIndex(shape);
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
      shape.editableElements.forEach((primitive, index) => {
        const effectivePrimitive = resolvePrimitiveWithParameters(primitive, shape.parameters);
        const node = createPrimitiveNode(effectivePrimitive);
        if (!node) {
          return;
        }

        node.setAttribute("data-primitive-index", String(index));
        node.classList.add("shape-primitive");
        if (index === state.shapeManager.selectedPrimitiveIndex) {
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

    if (!Number.isInteger(state.shapeManager.selectedPrimitiveIndex)) {
      appendInfo(shapePropsList, "已取消图元选择，可点击画布中的图元继续编辑。", "shape-prop-empty");
      return;
    }

    const index = clampPrimitiveIndex(state.shapeManager.selectedPrimitiveIndex, shape.editableElements.length);
    state.shapeManager.selectedPrimitiveIndex = index;
    const primitive = shape.editableElements[index];

    const title = document.createElement("div");
    title.className = "shape-prop-title";
    title.textContent = `当前图元: ${primitiveTypeLabel(primitive.type)} #${index + 1}`;
    shapePropsList.appendChild(title);

    const layerActions = document.createElement("div");
    layerActions.className = "shape-layer-actions";
    layerActions.appendChild(createLayerActionButton("置底", shape, "bottom", index <= 0));
    layerActions.appendChild(createLayerActionButton("下移", shape, "down", index <= 0));
    layerActions.appendChild(createLayerActionButton("上移", shape, "up", index >= shape.editableElements.length - 1));
    layerActions.appendChild(createLayerActionButton("置顶", shape, "top", index >= shape.editableElements.length - 1));
    shapePropsList.appendChild(layerActions);

    if (primitive.type === "line" || primitive.type === "bezier") {
      appendInfo(shapePropsList, "可直接在中间画布拖拽控制点调整端点/控制点位置。", "shape-prop-tip");
    }

    appendInfo(shapePropsList, "拖拽支持自动吸附（网格/轴线/其他图元关键点），按住 Alt 可临时关闭吸附。", "shape-prop-tip");

    const row = document.createElement("div");
    row.className = "shape-prop-grid";
    shapePropsList.appendChild(row);

    renderPrimitiveFields(row, shape, index, primitive);
  }

  function renderPrimitiveFields(container, shape, index, primitive) {
    const shapeParameters = normalizeShapeParameters(shape.parameters);
    shape.parameters = shapeParameters;

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
      return resolvePrimitiveFieldValue(primitive, shapeParameters, key, paramType, fallback);
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

      const toggleWrap = document.createElement("label");
      toggleWrap.className = "shape-prop-param-toggle";
      const toggleText = document.createElement("span");
      toggleText.textContent = "参数";
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.className = "toggle-checkbox";
      const slider = document.createElement("span");
      slider.className = "toggle-slider";
      slider.setAttribute("aria-hidden", "true");
      const switchRoot = document.createElement("span");
      switchRoot.className = "toggle-switch";
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

      const binding = getPrimitiveParamBinding(primitive, key, paramType);
      let selectedParamId = binding?.paramId && params.some((param) => param.id === binding.paramId)
        ? binding.paramId
        : (params[0]?.id || "");

      if (selectedParamId) {
        paramSelect.value = selectedParamId;
      }

      toggle.disabled = !params.length;
      toggle.checked = Boolean(params.length && selectedParamId && binding);

      const applyMode = () => {
        const useParam = Boolean(toggle.checked && params.length);
        paramSelect.hidden = !useParam;
        paramSelect.disabled = !useParam;

        if (useParam) {
          selectedParamId = paramSelect.value || params[0].id;
          paramSelect.value = selectedParamId;
          setPrimitiveParamBinding(primitive, key, { type: paramType, paramId: selectedParamId });
        } else {
          setPrimitiveParamBinding(primitive, key, null);
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
        primitive[key] = normalized;
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
      const input = document.createElement("input");
      input.type = "color";
      input.value = safeColor(resolveFieldValue(key, "color", fallback) || fallback);
      const applyColor = ({ refreshLibrary }) => {
        primitive[key] = safeColor(input.value);
        commit({ refreshLibrary });
      };
      input.addEventListener("input", () => applyColor({ refreshLibrary: false }));
      input.addEventListener("change", () => applyColor({ refreshLibrary: true }));
      attachParameterBinding(field, key, "color", (useParam) => {
        input.disabled = useParam;
        if (useParam) {
          input.value = safeColor(resolveFieldValue(key, "color", fallback) || fallback);
        }
      });
      field.appendChild(input);
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

      const color = document.createElement("input");
      color.type = "color";
      color.value = safeColor(primitive[key] || "#2f5d9d");

      const syncFillFixedState = (useParam) => {
        if (useParam) {
          select.value = "custom";
          select.disabled = true;
          color.disabled = true;
          color.value = safeColor(resolveFieldValue(key, "color", "#2f5d9d") || "#2f5d9d");
          return;
        }

        const isNone = String(primitive[key] || "none") === "none";
        select.disabled = false;
        select.value = isNone ? "none" : "custom";
        color.disabled = isNone;
        color.value = safeColor(primitive[key] || "#2f5d9d");
      };

      syncFillFixedState(false);

      select.addEventListener("change", () => {
        if (select.value === "none") {
          primitive[key] = "none";
          color.disabled = true;
        } else {
          primitive[key] = safeColor(color.value);
          color.disabled = false;
        }
        commit();
      });

      const applyColor = ({ refreshLibrary }) => {
        if (select.value !== "none") {
          primitive[key] = safeColor(color.value);
          commit({ refreshLibrary });
        }
      };

      color.addEventListener("input", () => applyColor({ refreshLibrary: false }));
      color.addEventListener("change", () => applyColor({ refreshLibrary: true }));

      attachParameterBinding(field, key, "color", (useParam) => {
        syncFillFixedState(useParam);
      });

      field.appendChild(select);
      field.appendChild(color);
      container.appendChild(field);
    };

    const addText = (labelText, key, fallback = "") => {
      const field = createPropField(labelText);
      const input = document.createElement("input");
      input.type = "text";
      input.value = String(resolveFieldValue(key, "text", fallback) ?? fallback);
      input.addEventListener("input", () => {
        primitive[key] = String(input.value || fallback);
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
    };

    const addToggle = (labelText, key, { rerenderProps = false, onChange, parameterizable = true } = {}) => {
      const field = createPropField(labelText);
      field.classList.add("shape-prop-toggle");
      const toggle = document.createElement("label");
      toggle.className = "toggle-switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "toggle-checkbox";
      input.checked = Boolean(resolveFieldValue(key, "checkbox", primitive[key]));
      const slider = document.createElement("span");
      slider.className = "toggle-slider";
      slider.setAttribute("aria-hidden", "true");
      input.addEventListener("change", () => {
        if (input.disabled) {
          return;
        }
        const checked = Boolean(input.checked);
        primitive[key] = checked;
        if (typeof onChange === "function") {
          onChange(checked);
        }
        commit({ rerenderProps });
      });

      if (parameterizable) {
        attachParameterBinding(field, key, "checkbox", (useParam) => {
          input.disabled = useParam;
          if (useParam) {
            input.checked = Boolean(resolveFieldValue(key, "checkbox", primitive[key]));
          }
        });
      }

      toggle.appendChild(input);
      toggle.appendChild(slider);
      field.appendChild(toggle);
      container.appendChild(field);
      return input;
    };

    if (primitive.type === "line") {
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

    if (primitive.type === "circle") {
      addNumber("中心 X", "cx", { defaultValue: 120 });
      addNumber("中心 Y", "cy", { defaultValue: 120 });
      addNumber("半径", "r", { defaultValue: 40, min: 1, max: 300 });
      addNumber("旋转", "rotation", { defaultValue: 0, min: -360, max: 360, step: 1 });
      addNumber("线宽", "strokeWidth", { defaultValue: 8, min: 0.1, max: 100, step: 0.1 });
      addColor("描边颜色", "stroke", "#2f5d9d");
      addFill("填充", "fill");
      return;
    }

    if (primitive.type === "rect") {
      addNumber("左上 X", "x", { defaultValue: 56 });
      addNumber("左上 Y", "y", { defaultValue: 56 });
      addNumber("宽度", "width", { defaultValue: 128, min: 1, max: 500 });
      addNumber("高度", "height", { defaultValue: 128, min: 1, max: 500 });
      addToggle("圆角", "rounded", {
        rerenderProps: true,
        onChange: (checked) => {
          if (checked && toNumber(primitive.rx, 0) <= 0) {
            primitive.rx = 10;
          }
        }
      });

      const rxField = createPropField("圆角半径");
      const rxInput = document.createElement("input");
      rxInput.type = "number";
      rxInput.min = "0";
      rxInput.max = "200";
      rxInput.step = "1";
      rxInput.value = String(toNumber(primitive.rx, 10));
      rxInput.disabled = primitive.rounded === false;
      rxInput.addEventListener("change", () => {
        const normalized = normalizeNumber(rxInput.value, 10, 0, 200);
        primitive.rx = normalized;
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

    if (primitive.type === "hexagon" || primitive.type === "octagon") {
      addNumber("中心 X", "cx", { defaultValue: 120 });
      addNumber("中心 Y", "cy", { defaultValue: 120 });
      addNumber("半径", "r", { defaultValue: 52, min: 1, max: 400 });
      addNumber("旋转", "rotation", { defaultValue: 0, min: -360, max: 360, step: 1 });
      addNumber("线宽", "strokeWidth", { defaultValue: 8, min: 0.1, max: 100, step: 0.1 });
      addColor("描边颜色", "stroke", "#2f5d9d");
      addFill("填充", "fill");
      return;
    }

    if (primitive.type === "bezier") {
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

    if (primitive.type === "text") {
      addText("文本内容", "value", "文本");
      addText("字体", "fontFamily", "Segoe UI");
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
        syncShapeSvg(shape);
        persistShapeLibrary();
        renderEditorCanvas(shape);
        renderPropertiesPanel(shape);
        if (refreshLibrary) {
          renderShapeLibraryList();
          renderSubmenu();
        }
      };

      const defaultInput = createParameterDefaultInput(param, commitDefault);
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
    state.shapeManager.selectedPrimitiveIndex = null;
    resetViewToSelectedShape();
    persistShapeLibrary();
    renderShapeManager();
    renderSubmenu();
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
    state.shapeManager.selectedPrimitiveIndex = nextIndex;
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

  function createParameterDefaultInput(param, commitDefault) {
    if (param.type === "color") {
      const input = document.createElement("input");
      input.type = "color";
      input.value = safeColor(param.defaultValue || "#2f5d9d");
      input.addEventListener("input", () => {
        param.defaultValue = safeColor(input.value);
        commitDefault({ refreshLibrary: false });
      });
      input.addEventListener("change", () => {
        param.defaultValue = safeColor(input.value);
        commitDefault({ refreshLibrary: true });
      });
      return input;
    }

    if (param.type === "number") {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.1";
      input.value = String(toNumber(param.defaultValue, 0));
      input.addEventListener("change", () => {
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
      param.defaultValue = String(input.value || "");
      commitDefault({ refreshLibrary: false });
    });
    input.addEventListener("change", () => {
      param.defaultValue = String(input.value || "");
      commitDefault({ refreshLibrary: true });
    });
    return input;
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
    state.shapeManager.selectedPrimitiveIndex = primitiveIndex;
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
      if (updatePrimitiveByHandle(primitive, handleState.handleKey, point)) {
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
      const point = applyAutoSnap(rawPoint, event, getSnapTargetsForShape(shape, transformState.primitiveIndex));
      if (!point) {
        return;
      }

      let updated = false;
      if (transformState.mode === "move") {
        updated = applyPrimitiveMove(primitive, transformState.startPrimitive, transformState.startPoint, point);
      } else if (transformState.mode === "resize") {
        updated = applyPrimitiveResize(
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

    state.shapeManager.selectedPrimitiveIndex = primitiveIndex;
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

    if (!Number.isInteger(state.shapeManager.selectedPrimitiveIndex)) {
      return;
    }

    const index = clampPrimitiveIndex(state.shapeManager.selectedPrimitiveIndex, shape.editableElements.length);
    const primitive = shape.editableElements[index];

    if (primitive.type !== "line" && primitive.type !== "bezier") {
      const bounds = getTransformBoundsForPrimitive(primitive);
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

    const handles = getPrimitiveHandles(primitive);
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

  function updatePrimitiveByHandle(primitive, handleKey, point) {
    if (!primitive || !point) {
      return false;
    }

    if (primitive.type === "line") {
      if (handleKey === "x1y1") {
        primitive.x1 = Number(point.x.toFixed(2));
        primitive.y1 = Number(point.y.toFixed(2));
        return true;
      }
      if (handleKey === "x2y2") {
        primitive.x2 = Number(point.x.toFixed(2));
        primitive.y2 = Number(point.y.toFixed(2));
        return true;
      }
      return false;
    }

    if (primitive.type === "bezier") {
      if (handleKey === "x1y1") {
        primitive.x1 = Number(point.x.toFixed(2));
        primitive.y1 = Number(point.y.toFixed(2));
        return true;
      }
      if (handleKey === "x2y2") {
        primitive.x2 = Number(point.x.toFixed(2));
        primitive.y2 = Number(point.y.toFixed(2));
        return true;
      }
      if (handleKey === "cx1cy1") {
        primitive.cx1 = Number(point.x.toFixed(2));
        primitive.cy1 = Number(point.y.toFixed(2));
        return true;
      }
      if (handleKey === "cx2cy2") {
        primitive.cx2 = Number(point.x.toFixed(2));
        primitive.cy2 = Number(point.y.toFixed(2));
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
    const bounds = getTransformBoundsForPrimitive(primitive);
    if (!primitive || !bounds) {
      return;
    }

    state.shapeManager.selectedPrimitiveIndex = primitiveIndex;

    transformState.isDragging = true;
    transformState.mode = mode;
    transformState.primitiveIndex = primitiveIndex;
    transformState.handleKey = handleKey;
    transformState.startPoint = { ...startPoint };
    transformState.startBounds = { ...bounds };
    transformState.startPrimitive = structuredClone(primitive);
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

    state.shapeManager.selectedPrimitiveIndex = primitiveIndex;
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

  function applyPrimitiveMove(primitive, startPrimitive, startPoint, currentPoint) {
    const dx = currentPoint.x - startPoint.x;
    const dy = currentPoint.y - startPoint.y;

    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
      return false;
    }

    if (primitive.type === "circle" || primitive.type === "hexagon" || primitive.type === "octagon") {
      primitive.cx = Number((startPrimitive.cx + dx).toFixed(2));
      primitive.cy = Number((startPrimitive.cy + dy).toFixed(2));
      return true;
    }

    if (primitive.type === "rect") {
      primitive.x = Number((startPrimitive.x + dx).toFixed(2));
      primitive.y = Number((startPrimitive.y + dy).toFixed(2));
      return true;
    }

    if (primitive.type === "text") {
      primitive.x = Number((startPrimitive.x + dx).toFixed(2));
      primitive.y = Number((startPrimitive.y + dy).toFixed(2));
      return true;
    }

    return false;
  }

  function applyPrimitiveResize(primitive, startPrimitive, startBounds, handleKey, currentPoint, lockAspectRatio) {
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
      primitive.x = Number(minX.toFixed(2));
      primitive.y = Number(minY.toFixed(2));
      primitive.width = Number(width.toFixed(2));
      primitive.height = Number(height.toFixed(2));
      if (primitive.rounded === false) {
        primitive.rx = 0;
      } else {
        primitive.rx = Number(Math.min(width, height, startPrimitive.rx || 0).toFixed(2));
      }
      return true;
    }

    if (primitive.type === "circle" || primitive.type === "hexagon" || primitive.type === "octagon") {
      const r = Math.max(1, Math.min(width, height) / 2);
      primitive.cx = Number(((minX + maxX) / 2).toFixed(2));
      primitive.cy = Number(((minY + maxY) / 2).toFixed(2));
      primitive.r = Number(r.toFixed(2));
      return true;
    }

    if (primitive.type === "text") {
      const startW = Math.max(1, startBounds.maxX - startBounds.minX);
      const startH = Math.max(1, startBounds.maxY - startBounds.minY);
      const scale = Math.max(width / startW, height / startH);
      primitive.x = Number(((minX + maxX) / 2).toFixed(2));
      primitive.y = Number(((minY + maxY) / 2).toFixed(2));
      primitive.fontSize = Number(clampNumber((startPrimitive.fontSize || 26) * scale, 1, 240).toFixed(2));
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
      return {
        minX: primitive.cx - primitive.r,
        minY: primitive.cy - primitive.r,
        maxX: primitive.cx + primitive.r,
        maxY: primitive.cy + primitive.r
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

  function createLayerActionButton(label, shape, direction, disabled) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-ghost shape-layer-btn";
    button.textContent = label;
    button.disabled = Boolean(disabled);
    button.addEventListener("click", () => {
      moveSelectedPrimitive(shape, direction);
    });
    return button;
  }

  function moveSelectedPrimitive(shape, direction) {
    if (!shape || !Array.isArray(shape.editableElements) || !shape.editableElements.length) {
      return;
    }

    const length = shape.editableElements.length;
    const index = clampPrimitiveIndex(state.shapeManager.selectedPrimitiveIndex, length);

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
    state.shapeManager.selectedPrimitiveIndex = targetIndex;

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
      return [
        { x: primitive.cx, y: primitive.cy },
        { x: primitive.cx - primitive.r, y: primitive.cy - primitive.r },
        { x: primitive.cx + primitive.r, y: primitive.cy + primitive.r }
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

    if (event.altKey) {
      return point;
    }

    const tolerance = getSnapToleranceInCanvas();
    return {
      x: snapValue(point.x, snapTargets?.targetsX || [], tolerance),
      y: snapValue(point.y, snapTargets?.targetsY || [], tolerance)
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

  function snapValue(value, targets, tolerance) {
    const candidates = [...targets, Math.round(value / snapConfig.gridStep) * snapConfig.gridStep];
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

    if (Array.isArray(shape.editableElements) && Number.isInteger(state.shapeManager.selectedPrimitiveIndex)) {
      const index = clampPrimitiveIndex(state.shapeManager.selectedPrimitiveIndex, shape.editableElements.length);
      shape.editableElements.splice(index, 1);

      if (shape.editableElements.length) {
        state.shapeManager.selectedPrimitiveIndex = Math.min(index, shape.editableElements.length - 1);
      } else {
        state.shapeManager.selectedPrimitiveIndex = null;
      }

      syncShapeSvg(shape);
      persistShapeLibrary();
      renderShapeManager();
      renderSubmenu();
      return true;
    }

    const shapeIndex = state.shapeLibrary.findIndex((item) => item.id === shape.id);
    if (shapeIndex < 0) {
      return false;
    }

    state.shapeLibrary.splice(shapeIndex, 1);
    const nextShape = state.shapeLibrary[Math.min(shapeIndex, state.shapeLibrary.length - 1)] || null;
    state.shapeManager.selectedId = nextShape?.id || null;
    state.shapeManager.selectedPrimitiveIndex = getFirstPrimitiveIndex(nextShape);
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
    state.shapeManager.selectedPrimitiveIndex = getFirstPrimitiveIndex(getSelectedShape());
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
    state.shapeManager.selectedPrimitiveIndex = Number.isInteger(state.shapeManager.selectedPrimitiveIndex)
      ? state.shapeManager.selectedPrimitiveIndex
      : null;

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
    renderSubmenu();
  }

  function persistShapeLibrary() {
    try {
      const payload = state.shapeLibrary.map((shape) => {
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

      localStorage.setItem(shapeStorageKey, JSON.stringify(payload));
    } catch {
      // Ignore localStorage quota/availability errors.
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

  function syncShapeSvg(shape) {
    if (!shape || !Array.isArray(shape.editableElements)) {
      return;
    }

    // Keep object references stable for active property panel listeners (e.g. color picker drag).
    shape.parameters = normalizeShapeParameters(shape.parameters);
    shape.svg = buildSvgFromEditableElements(resolveEditableElementsWithParameters(shape.editableElements, shape.parameters));
    shape.imported = false;
  }

  return {
    bind,
    open,
    close
  };
}

export function getShapeParameterDefaults(shape) {
  const defaults = {};
  normalizeShapeParameters(shape?.parameters).forEach((param) => {
    defaults[param.id] = normalizeShapeParameterDefault(param.type, param.defaultValue);
  });
  return defaults;
}

export function resolveShapeParametersWithValues(shape, paramValues) {
  const values = paramValues && typeof paramValues === "object" ? paramValues : {};
  return normalizeShapeParameters(shape?.parameters).map((param) => {
    if (!Object.prototype.hasOwnProperty.call(values, param.id)) {
      return param;
    }

    return {
      ...param,
      defaultValue: normalizeShapeParameterDefault(param.type, values[param.id])
    };
  });
}

export function buildRenderableShapeSvg(shape, paramValues) {
  if (!shape || typeof shape !== "object") {
    return "";
  }

  const resolvedParams = resolveShapeParametersWithValues(shape, paramValues);
  if (Array.isArray(shape.editableElements)) {
    return buildSvgFromEditableElements(resolveEditableElementsWithParameters(shape.editableElements, resolvedParams));
  }

  return normalizeImportedSvg(shape.svg || "");
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

function getFirstPrimitiveIndex(shape) {
  return Array.isArray(shape?.editableElements) && shape.editableElements.length ? 0 : null;
}

function clampPrimitiveIndex(index, length) {
  if (!Number.isInteger(index)) {
    return 0;
  }

  return Math.max(0, Math.min(length - 1, index));
}

function createPrimitiveElement(type, index) {
  const shift = (index % 6) * 8;

  if (type === "circle") {
    return {
      type: "circle",
      cx: 120 + shift * 0.4,
      cy: 120 - shift * 0.35,
      r: 42,
      fill: "none",
      stroke: "#2f5d9d",
      strokeWidth: 6,
      rotation: 0
    };
  }

  if (type === "rect") {
    return {
      type: "rect",
      x: 56 + shift * 0.3,
      y: 56 + shift * 0.2,
      width: 128,
      height: 128,
      rounded: true,
      rx: 10,
      fill: "none",
      stroke: "#2f5d9d",
      strokeWidth: 6,
      rotation: 0
    };
  }

  if (type === "hexagon") {
    return {
      type: "hexagon",
      cx: 120,
      cy: 120,
      r: 54,
      fill: "none",
      stroke: "#2f5d9d",
      strokeWidth: 6,
      rotation: 0
    };
  }

  if (type === "octagon") {
    return {
      type: "octagon",
      cx: 120,
      cy: 120,
      r: 54,
      fill: "none",
      stroke: "#2f5d9d",
      strokeWidth: 6,
      rotation: 0
    };
  }

  if (type === "bezier") {
    return {
      type: "bezier",
      x1: 40,
      y1: 170,
      cx1: 90,
      cy1: 60,
      cx2: 150,
      cy2: 180,
      x2: 200,
      y2: 70,
      stroke: "#2f5d9d",
      strokeWidth: 6,
      roundCap: true,
      rotation: 0
    };
  }

  if (type === "text") {
    return {
      type: "text",
      x: 120,
      y: 120,
      value: "文本",
      fontSize: 26,
      fontFamily: "Segoe UI",
      fill: "#2f5d9d",
      rotation: 0
    };
  }

  return {
    type: "line",
    x1: 40,
    y1: 60 + shift,
    x2: 200,
    y2: 180 - shift,
    stroke: "#2f5d9d",
    strokeWidth: 6,
    roundCap: true,
    rotation: 0
  };
}

function normalizeEditableElements(elements) {
  return (Array.isArray(elements) ? elements : [])
    .map((item) => normalizePrimitive(item))
    .filter(Boolean);
}

function normalizeShapeParameters(parameters) {
  return (Array.isArray(parameters) ? parameters : [])
    .map((param, index) => normalizeShapeParameter(param, index))
    .filter(Boolean);
}

function normalizeShapeParameter(param, index) {
  if (!param || typeof param !== "object") {
    return null;
  }

  const type = shapeParameterTypeDefinitions[param.type] ? param.type : "text";
  const definition = shapeParameterTypeDefinitions[type] || shapeParameterTypeDefinitions.text;

  return {
    id: String(param.id || `shape-param-${index + 1}`),
    type,
    label: String(param.label || `${definition.label} ${index + 1}`).trim() || `${definition.label} ${index + 1}`,
    defaultValue: normalizeShapeParameterDefault(type, param.defaultValue),
    conditions: Array.isArray(param.conditions) ? structuredClone(param.conditions) : [],
    extensions: param.extensions && typeof param.extensions === "object" ? structuredClone(param.extensions) : {}
  };
}

function normalizeShapeParameterDefault(type, value) {
  if (type === "color") {
    return safeColor(value || "#2f5d9d");
  }

  if (type === "number") {
    return normalizeNumber(value, 0, -100000, 100000);
  }

  if (type === "checkbox") {
    return Boolean(value);
  }

  return String(value || "");
}

function normalizePrimitiveParamBindings(rawBindings) {
  if (!rawBindings || typeof rawBindings !== "object") {
    return {};
  }

  const normalized = {};
  Object.entries(rawBindings).forEach(([key, binding]) => {
    if (!binding || typeof binding !== "object") {
      return;
    }

    const type = shapeParameterTypeDefinitions[binding.type] ? binding.type : null;
    const paramId = String(binding.paramId || "").trim();
    if (!type || !paramId) {
      return;
    }

    normalized[key] = { type, paramId };
  });

  return normalized;
}

function getPrimitiveParamBindings(primitive) {
  if (!primitive || typeof primitive !== "object") {
    return {};
  }

  if (!primitive.paramBindings || typeof primitive.paramBindings !== "object") {
    primitive.paramBindings = {};
  }

  return primitive.paramBindings;
}

function getPrimitiveParamBinding(primitive, key, expectedType) {
  const bindings = getPrimitiveParamBindings(primitive);
  const binding = bindings[key];
  if (!binding || typeof binding !== "object") {
    return null;
  }

  if (expectedType && binding.type !== expectedType) {
    return null;
  }

  return binding;
}

function setPrimitiveParamBinding(primitive, key, binding) {
  const bindings = getPrimitiveParamBindings(primitive);

  if (!binding) {
    delete bindings[key];
    return;
  }

  bindings[key] = {
    type: binding.type,
    paramId: String(binding.paramId || "")
  };
}

function resolvePrimitiveFieldValue(primitive, parameters, key, paramType, fallback) {
  const binding = getPrimitiveParamBinding(primitive, key, paramType);
  if (!binding) {
    return primitive?.[key] ?? fallback;
  }

  const param = (Array.isArray(parameters) ? parameters : []).find((item) => item.id === binding.paramId && item.type === paramType);
  if (!param) {
    return primitive?.[key] ?? fallback;
  }

  return normalizeShapeParameterDefault(paramType, param.defaultValue);
}

function resolvePrimitiveWithParameters(primitive, parameters) {
  if (!primitive || typeof primitive !== "object") {
    return primitive;
  }

  const result = { ...primitive };
  const bindings = getPrimitiveParamBindings(primitive);
  Object.entries(bindings).forEach(([key, binding]) => {
    if (!binding?.type || !shapeParameterTypeDefinitions[binding.type]) {
      return;
    }

    result[key] = resolvePrimitiveFieldValue(primitive, parameters, key, binding.type, primitive[key]);
  });

  return result;
}

function resolveEditableElementsWithParameters(elements, parameters) {
  return (Array.isArray(elements) ? elements : []).map((primitive) => resolvePrimitiveWithParameters(primitive, parameters));
}

function normalizePrimitive(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const type = String(raw.type || "line").toLowerCase();
  const paramBindings = normalizePrimitiveParamBindings(raw.paramBindings);

  if (type === "line") {
    return {
      type,
      x1: toNumber(raw.x1, 40),
      y1: toNumber(raw.y1, 60),
      x2: toNumber(raw.x2, 200),
      y2: toNumber(raw.y2, 180),
      stroke: safeColor(raw.stroke),
      strokeWidth: normalizeNumber(raw.strokeWidth, 6, 0.1, 100),
      roundCap: Boolean(raw.roundCap),
      rotation: toNumber(raw.rotation, 0),
      paramBindings
    };
  }

  if (type === "circle") {
    return {
      type,
      cx: toNumber(raw.cx, 120),
      cy: toNumber(raw.cy, 120),
      r: normalizeNumber(raw.r, 42, 1, 400),
      fill: safeFill(raw.fill),
      stroke: safeColor(raw.stroke),
      strokeWidth: normalizeNumber(raw.strokeWidth, 6, 0.1, 100),
      rotation: toNumber(raw.rotation, 0),
      paramBindings
    };
  }

  if (type === "rect") {
    const rx = normalizeNumber(raw.rx, 10, 0, 400);
    const rounded = raw.rounded === undefined ? rx > 0 : Boolean(raw.rounded);

    return {
      type,
      x: toNumber(raw.x, 56),
      y: toNumber(raw.y, 56),
      width: normalizeNumber(raw.width, 128, 1, 800),
      height: normalizeNumber(raw.height, 128, 1, 800),
      rounded,
      rx,
      fill: safeFill(raw.fill),
      stroke: safeColor(raw.stroke),
      strokeWidth: normalizeNumber(raw.strokeWidth, 6, 0.1, 100),
      rotation: toNumber(raw.rotation, 0),
      paramBindings
    };
  }

  if (type === "hexagon" || type === "octagon") {
    return {
      type,
      cx: toNumber(raw.cx, 120),
      cy: toNumber(raw.cy, 120),
      r: normalizeNumber(raw.r, 52, 1, 600),
      fill: safeFill(raw.fill),
      stroke: safeColor(raw.stroke),
      strokeWidth: normalizeNumber(raw.strokeWidth, 6, 0.1, 100),
      rotation: toNumber(raw.rotation, 0),
      paramBindings
    };
  }

  if (type === "bezier") {
    return {
      type,
      x1: toNumber(raw.x1, 40),
      y1: toNumber(raw.y1, 170),
      cx1: toNumber(raw.cx1, 90),
      cy1: toNumber(raw.cy1, 60),
      cx2: toNumber(raw.cx2, 150),
      cy2: toNumber(raw.cy2, 180),
      x2: toNumber(raw.x2, 200),
      y2: toNumber(raw.y2, 70),
      stroke: safeColor(raw.stroke),
      strokeWidth: normalizeNumber(raw.strokeWidth, 6, 0.1, 100),
      roundCap: Boolean(raw.roundCap),
      rotation: toNumber(raw.rotation, 0),
      paramBindings
    };
  }

  if (type === "text") {
    return {
      type,
      x: toNumber(raw.x, 120),
      y: toNumber(raw.y, 120),
      value: String(raw.value || "文本"),
      fontSize: normalizeNumber(raw.fontSize, 26, 1, 240),
      fontFamily: String(raw.fontFamily || "Segoe UI"),
      fill: safeColor(raw.fill),
      rotation: toNumber(raw.rotation, 0),
      paramBindings
    };
  }

  return null;
}

function createPrimitiveNode(primitive) {
  if (!primitive || typeof primitive !== "object") {
    return null;
  }

  const type = primitive.type;
  if (type === "line") {
    const line = document.createElementNS(svgNs, "line");
    line.setAttribute("x1", String(primitive.x1));
    line.setAttribute("y1", String(primitive.y1));
    line.setAttribute("x2", String(primitive.x2));
    line.setAttribute("y2", String(primitive.y2));
    line.setAttribute("stroke", safeColor(primitive.stroke));
    line.setAttribute("stroke-width", String(primitive.strokeWidth));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke-linecap", primitive.roundCap ? "round" : "butt");
    setRotationTransform(line, primitive.rotation, (primitive.x1 + primitive.x2) / 2, (primitive.y1 + primitive.y2) / 2);
    return line;
  }

  if (type === "circle") {
    const circle = document.createElementNS(svgNs, "circle");
    circle.setAttribute("cx", String(primitive.cx));
    circle.setAttribute("cy", String(primitive.cy));
    circle.setAttribute("r", String(primitive.r));
    circle.setAttribute("fill", safeFill(primitive.fill));
    circle.setAttribute("stroke", safeColor(primitive.stroke));
    circle.setAttribute("stroke-width", String(primitive.strokeWidth));
    setRotationTransform(circle, primitive.rotation, primitive.cx, primitive.cy);
    return circle;
  }

  if (type === "rect") {
    const rect = document.createElementNS(svgNs, "rect");
    const rx = primitive.rounded === false ? 0 : normalizeNumber(primitive.rx, 10, 0, 400);
    rect.setAttribute("x", String(primitive.x));
    rect.setAttribute("y", String(primitive.y));
    rect.setAttribute("width", String(primitive.width));
    rect.setAttribute("height", String(primitive.height));
    rect.setAttribute("rx", String(rx));
    rect.setAttribute("fill", safeFill(primitive.fill));
    rect.setAttribute("stroke", safeColor(primitive.stroke));
    rect.setAttribute("stroke-width", String(primitive.strokeWidth));
    setRotationTransform(rect, primitive.rotation, primitive.x + primitive.width / 2, primitive.y + primitive.height / 2);
    return rect;
  }

  if (type === "hexagon" || type === "octagon") {
    const polygon = document.createElementNS(svgNs, "polygon");
    const sides = type === "hexagon" ? 6 : 8;
    polygon.setAttribute("points", buildRegularPolygonPoints(primitive.cx, primitive.cy, primitive.r, sides));
    polygon.setAttribute("fill", safeFill(primitive.fill));
    polygon.setAttribute("stroke", safeColor(primitive.stroke));
    polygon.setAttribute("stroke-width", String(primitive.strokeWidth));
    setRotationTransform(polygon, primitive.rotation, primitive.cx, primitive.cy);
    return polygon;
  }

  if (type === "bezier") {
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", `M ${primitive.x1} ${primitive.y1} C ${primitive.cx1} ${primitive.cy1} ${primitive.cx2} ${primitive.cy2} ${primitive.x2} ${primitive.y2}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", safeColor(primitive.stroke));
    path.setAttribute("stroke-width", String(primitive.strokeWidth));
    path.setAttribute("stroke-linecap", primitive.roundCap ? "round" : "butt");
    setRotationTransform(path, primitive.rotation, (primitive.x1 + primitive.x2) / 2, (primitive.y1 + primitive.y2) / 2);
    return path;
  }

  if (type === "text") {
    const text = document.createElementNS(svgNs, "text");
    text.setAttribute("x", String(primitive.x));
    text.setAttribute("y", String(primitive.y));
    text.setAttribute("fill", safeColor(primitive.fill));
    text.setAttribute("font-size", String(primitive.fontSize));
    text.setAttribute("font-family", String(primitive.fontFamily || "Segoe UI"));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.textContent = String(primitive.value || "文本");
    setRotationTransform(text, primitive.rotation, primitive.x, primitive.y);
    return text;
  }

  return null;
}

function buildSvgFromEditableElements(elements) {
  const rows = ["<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 240 240\">"];

  normalizeEditableElements(elements).forEach((primitive) => {
    rows.push(`  ${primitiveToMarkup(primitive)}`);
  });

  rows.push("</svg>");
  return rows.join("\n");
}

function primitiveToMarkup(primitive) {
  const rotationAttr = buildRotationAttr(primitive);

  if (primitive.type === "line") {
    return `<line x1=\"${num(primitive.x1)}\" y1=\"${num(primitive.y1)}\" x2=\"${num(primitive.x2)}\" y2=\"${num(primitive.y2)}\" stroke=\"${safeColor(primitive.stroke)}\" stroke-width=\"${num(primitive.strokeWidth)}\" stroke-linecap=\"${primitive.roundCap ? "round" : "butt"}\" fill=\"none\"${rotationAttr} />`;
  }

  if (primitive.type === "circle") {
    return `<circle cx=\"${num(primitive.cx)}\" cy=\"${num(primitive.cy)}\" r=\"${num(primitive.r)}\" fill=\"${safeFill(primitive.fill)}\" stroke=\"${safeColor(primitive.stroke)}\" stroke-width=\"${num(primitive.strokeWidth)}\"${rotationAttr} />`;
  }

  if (primitive.type === "rect") {
    const rx = primitive.rounded === false ? 0 : normalizeNumber(primitive.rx, 10, 0, 400);
    return `<rect x=\"${num(primitive.x)}\" y=\"${num(primitive.y)}\" width=\"${num(primitive.width)}\" height=\"${num(primitive.height)}\" rx=\"${num(rx)}\" fill=\"${safeFill(primitive.fill)}\" stroke=\"${safeColor(primitive.stroke)}\" stroke-width=\"${num(primitive.strokeWidth)}\"${rotationAttr} />`;
  }

  if (primitive.type === "hexagon" || primitive.type === "octagon") {
    const sides = primitive.type === "hexagon" ? 6 : 8;
    return `<polygon points=\"${buildRegularPolygonPoints(primitive.cx, primitive.cy, primitive.r, sides)}\" fill=\"${safeFill(primitive.fill)}\" stroke=\"${safeColor(primitive.stroke)}\" stroke-width=\"${num(primitive.strokeWidth)}\"${rotationAttr} />`;
  }

  if (primitive.type === "bezier") {
    return `<path d=\"M ${num(primitive.x1)} ${num(primitive.y1)} C ${num(primitive.cx1)} ${num(primitive.cy1)} ${num(primitive.cx2)} ${num(primitive.cy2)} ${num(primitive.x2)} ${num(primitive.y2)}\" fill=\"none\" stroke=\"${safeColor(primitive.stroke)}\" stroke-width=\"${num(primitive.strokeWidth)}\" stroke-linecap=\"${primitive.roundCap ? "round" : "butt"}\"${rotationAttr} />`;
  }

  if (primitive.type === "text") {
    return `<text x=\"${num(primitive.x)}\" y=\"${num(primitive.y)}\" fill=\"${safeColor(primitive.fill)}\" font-size=\"${num(primitive.fontSize)}\" font-family=\"${escapeXml(String(primitive.fontFamily || "Segoe UI"))}\" text-anchor=\"middle\" dominant-baseline=\"middle\"${rotationAttr}>${escapeXml(String(primitive.value || "文本"))}</text>`;
  }

  return "";
}

function buildRotationAttr(primitive) {
  const angle = toNumber(primitive.rotation, 0);
  if (Math.abs(angle) < 1e-6) {
    return "";
  }

  const center = getPrimitiveCenter(primitive);
  return ` transform=\"rotate(${num(angle)} ${num(center.x)} ${num(center.y)})\"`;
}

function setRotationTransform(node, angle, cx, cy) {
  const n = toNumber(angle, 0);
  if (Math.abs(n) < 1e-6) {
    return;
  }

  node.setAttribute("transform", `rotate(${n} ${cx} ${cy})`);
}

function getPrimitiveCenter(primitive) {
  if (primitive.type === "line") {
    return { x: (primitive.x1 + primitive.x2) / 2, y: (primitive.y1 + primitive.y2) / 2 };
  }

  if (primitive.type === "circle") {
    return { x: primitive.cx, y: primitive.cy };
  }

  if (primitive.type === "rect") {
    return { x: primitive.x + primitive.width / 2, y: primitive.y + primitive.height / 2 };
  }

  if (primitive.type === "hexagon" || primitive.type === "octagon") {
    return { x: primitive.cx, y: primitive.cy };
  }

  if (primitive.type === "bezier") {
    return { x: (primitive.x1 + primitive.x2) / 2, y: (primitive.y1 + primitive.y2) / 2 };
  }

  if (primitive.type === "text") {
    return { x: primitive.x, y: primitive.y };
  }

  return { x: 120, y: 120 };
}

function buildRegularPolygonPoints(cx, cy, r, sides) {
  const points = [];
  const radius = Math.max(1, toNumber(r, 50));
  const centerX = toNumber(cx, 120);
  const centerY = toNumber(cy, 120);
  const count = Math.max(3, Number(sides) || 6);

  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
    points.push(`${num(centerX + radius * Math.cos(angle))},${num(centerY + radius * Math.sin(angle))}`);
  }

  return points.join(" ");
}

function computeEditableBounds(elements) {
  if (!Array.isArray(elements) || !elements.length) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const pushPoint = (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  elements.forEach((primitive) => {
    if (primitive.type === "line") {
      pushPoint(primitive.x1, primitive.y1);
      pushPoint(primitive.x2, primitive.y2);
      return;
    }

    if (primitive.type === "circle") {
      pushPoint(primitive.cx - primitive.r, primitive.cy - primitive.r);
      pushPoint(primitive.cx + primitive.r, primitive.cy + primitive.r);
      return;
    }

    if (primitive.type === "rect") {
      pushPoint(primitive.x, primitive.y);
      pushPoint(primitive.x + primitive.width, primitive.y + primitive.height);
      return;
    }

    if (primitive.type === "hexagon" || primitive.type === "octagon") {
      pushPoint(primitive.cx - primitive.r, primitive.cy - primitive.r);
      pushPoint(primitive.cx + primitive.r, primitive.cy + primitive.r);
      return;
    }

    if (primitive.type === "bezier") {
      [
        [primitive.x1, primitive.y1],
        [primitive.cx1, primitive.cy1],
        [primitive.cx2, primitive.cy2],
        [primitive.x2, primitive.y2]
      ].forEach(([x, y]) => pushPoint(x, y));
      return;
    }

    if (primitive.type === "text") {
      const width = Math.max(12, String(primitive.value || "").length * primitive.fontSize * 0.55);
      const height = Math.max(primitive.fontSize, 12);
      pushPoint(primitive.x - width / 2, primitive.y - height / 2);
      pushPoint(primitive.x + width / 2, primitive.y + height / 2);
    }
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function boundsToViewBox(bounds, padding) {
  const pad = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const width = Math.max(80, bounds.maxX - bounds.minX + pad * 2);
  const height = Math.max(80, bounds.maxY - bounds.minY + pad * 2);
  return {
    x: bounds.minX - pad,
    y: bounds.minY - pad,
    width,
    height
  };
}

function parseSvg(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(svgText || ""), "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    return null;
  }

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") {
    return null;
  }

  const viewBoxText = root.getAttribute("viewBox") || "0 0 240 240";
  const parts = viewBoxText.split(/[\s,]+/).map((v) => Number(v)).filter((v) => Number.isFinite(v));
  const viewBox = parts.length >= 4
    ? {
      x: parts[0],
      y: parts[1],
      width: parts[2] || 240,
      height: parts[3] || 240
    }
    : { x: 0, y: 0, width: 240, height: 240 };

  return {
    root,
    viewBox
  };
}

function stripUnsafeAttributes(node) {
  if (!(node instanceof Element)) {
    return;
  }

  Array.from(node.attributes).forEach((attr) => {
    const name = attr.name.toLowerCase();
    const value = String(attr.value || "").toLowerCase();
    if (name.startsWith("on") || value.includes("javascript:")) {
      node.removeAttribute(attr.name);
    }
  });

  Array.from(node.children).forEach((child) => stripUnsafeAttributes(child));
}

function normalizeImportedSvg(rawSvg) {
  const text = String(rawSvg || "").trim();
  if (!text) {
    return "";
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    return "";
  }

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") {
    return "";
  }

  if (!root.getAttribute("xmlns")) {
    root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(root);
}

function toSvgDataUrl(svgText) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svgText || ""))}`;
}

function primitiveTypeLabel(type) {
  const map = {
    line: "线段",
    circle: "圆形",
    rect: "方形",
    hexagon: "六边形",
    octagon: "八边形",
    bezier: "贝塞尔曲线",
    text: "文本"
  };
  return map[type] || "图元";
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

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeNumber(value, fallback, min, max) {
  let next = toNumber(value, fallback);
  if (Number.isFinite(min)) {
    next = Math.max(min, next);
  }
  if (Number.isFinite(max)) {
    next = Math.min(max, next);
  }
  return Number(next.toFixed(2));
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function num(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Number(n.toFixed(2));
}

function safeColor(value) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(value || "").trim()) ? String(value).trim() : "#2f5d9d";
}

function safeFill(value) {
  const raw = String(value || "none").trim();
  if (raw === "none") {
    return "none";
  }
  return safeColor(raw);
}

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
