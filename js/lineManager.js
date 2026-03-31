import { svgNs } from "./dom.js";
import { lineStyleMap } from "./constants.js";
import { buildPathD, getOffsetPolyline, getParallelOffsets } from "./lineGeometry.js";
import {
  getLineTypeById,
  normalizeLineType,
  persistCustomLineTypes,
  resolveSegmentColor
} from "./lineTypeStore.js";
import { clamp, mergeColorAndAlpha, splitColorAndAlpha } from "./utils.js";

export function createLineManager({
  state,
  elements,
  createLineTypeId,
  renderSubmenu,
  renderLines,
  onLineTypeUpdated,
  onStateChanged
}) {
  const {
    lineManagerModal,
    closeLineManagerBtn,
    newLineTypeBtn,
    lineLibraryList,
    lineTypeTempNotice,
    makeLineTypePermanentBtn,
    lineTypeNameInput,
    lineTypePreview,
    addColorRefBtn,
    colorListEditor,
    addSegmentBtn,
    segmentEditorList,
    deleteLineTypeBtn,
    downloadLineTypeBtn,
    importLineTypeBtn,
    lineTypeImportInput
  } = elements;

  const findLineType = (id) => getLineTypeById(state.lineTypes, id);

  function bind() {
    closeLineManagerBtn.addEventListener("click", close);
    newLineTypeBtn.addEventListener("click", startNewLineTypeDraft);
    addColorRefBtn.addEventListener("click", addDraftColor);
    addSegmentBtn.addEventListener("click", addDraftSegment);
    deleteLineTypeBtn.addEventListener("click", deleteSelectedLineType);
    downloadLineTypeBtn.addEventListener("click", downloadSelectedLineType);
    importLineTypeBtn.addEventListener("click", () => lineTypeImportInput.click());
    lineTypeImportInput.addEventListener("change", importLineTypesFromFile);
    makeLineTypePermanentBtn.addEventListener("click", makeSelectedLineTypePermanent);

    lineTypeNameInput.addEventListener("input", () => {
      if (!state.lineManager.draft) {
        return;
      }
      state.lineManager.draft.name = lineTypeNameInput.value;
      renderLineTypePreviewEditor();
      autoSaveDraft({ rerenderLines: false, history: { coalesceKey: "line-type-name" } });
    });

    lineManagerModal.hidden = true;
  }

  function open() {
    state.lineManager.isOpen = true;
    lineManagerModal.hidden = false;

    if (
      (!state.lineManager.selectedId || !findLineType(state.lineManager.selectedId))
      && state.lineTypes.length
    ) {
      state.lineManager.selectedId = state.lineTypes[0].id;
    }

    loadLineTypeDraft(state.lineManager.selectedId);
    renderLineManager();
  }

  function close() {
    state.lineManager.isOpen = false;
    lineManagerModal.hidden = true;
    lineTypeTempNotice.hidden = true;
  }

  function renderLineManager() {
    renderLineLibraryList();
    renderLineEditor();
  }

  function renderLineLibraryList() {
    lineLibraryList.innerHTML = "";

    const usageCountByTypeId = new Map();
    state.edges.forEach((edge) => {
      const key = String(edge.lineTypeId || "");
      usageCountByTypeId.set(key, (usageCountByTypeId.get(key) || 0) + 1);
    });

    state.lineTypes.forEach((type) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "line-library-item";
      item.classList.toggle("active", type.id === state.lineManager.selectedId);

      const row = document.createElement("div");
      row.className = "line-library-item-row";

      const title = document.createElement("span");
      title.className = "line-library-item-title";
      const usageCount = usageCountByTypeId.get(type.id) || 0;
      title.textContent = `${type.name} (${usageCount})`;
      title.classList.toggle("temporary-imported", Boolean(type.isTemporaryImported));

      const tag = document.createElement("span");
      tag.className = "line-library-item-tag";
      if (type.source === "default") {
        tag.textContent = "默认";
      } else if (type.isTemporaryImported) {
        tag.textContent = "外部导入(临时)";
      } else {
        tag.textContent = "自定义";
      }
      tag.classList.toggle("temporary-imported", Boolean(type.isTemporaryImported));
      title.title = `${type.name} (${usageCount}条, ${tag.textContent})`;

      const preview = document.createElementNS(svgNs, "svg");
      preview.setAttribute("viewBox", "0 0 92 24");
      preview.setAttribute("class", "line-library-preview-inline");
      renderLineTypePreviewSvg(preview, type);

      row.appendChild(title);
      row.appendChild(preview);
      item.appendChild(row);
      item.appendChild(tag);
      item.addEventListener("click", () => {
        state.lineManager.selectedId = type.id;
        loadLineTypeDraft(type.id);
        renderLineManager();
      });
      lineLibraryList.appendChild(item);
    });
  }

  function renderLineEditor() {
    const draft = state.lineManager.draft;
    const selectedType = findLineType(state.lineManager.selectedId);
    lineTypeTempNotice.hidden = true;
    if (!draft) {
      colorListEditor.innerHTML = "";
      segmentEditorList.innerHTML = "";
      lineTypeNameInput.value = "";
      return;
    }

    if (selectedType && selectedType.isTemporaryImported === true) {
      lineTypeTempNotice.hidden = false;
    }

    lineTypeNameInput.value = draft.name;
    renderLineTypePreviewEditor();
    renderColorListEditor();

    segmentEditorList.innerHTML = "";
    draft.segments.forEach((segment, index) => {
      const paletteOptions = draft.colorList
        .map((_, paletteIndex) => `<option value="${paletteIndex}">颜色${paletteIndex + 1}</option>`)
        .join("");
      const fixedColor = splitColorAndAlpha(segment.fixedColor);
      const fixedAlphaPercent = Math.round(fixedColor.alpha * 100);

      const card = document.createElement("div");
      card.className = "segment-item";
      card.dataset.segmentIndex = String(index);

      card.innerHTML = `
        <div class="segment-head">
          <div class="segment-title">小线条 ${index + 1}</div>
          <button
            class="segment-drag-handle"
            data-drag-handle-index="${index}"
            draggable="true"
            type="button"
            title="拖拽排序"
            aria-label="拖拽排序"
          >
            <img src="img/icon-drag-vertical.svg" alt="" />
          </button>
        </div>
        <div class="segment-grid">
          <div class="field-compact">
            <label>宽度</label>
            <input data-field="width" data-index="${index}" type="number" min="1" max="20" value="${segment.width}" />
          </div>
          <div class="field-compact">
            <label>线形</label>
            <select data-field="strokeStyle" data-index="${index}">
              <option value="solid">实线</option>
              <option value="dashed">虚线</option>
            </select>
          </div>
          <div class="field-compact">
            <label>颜色来源</label>
            <select data-field="colorMode" data-index="${index}">
              <option value="fixed">固定颜色</option>
              <option value="palette">引用颜色列表</option>
            </select>
          </div>
          <button class="btn-ghost" data-remove-index="${index}" type="button">删除</button>
        </div>
        <div class="segment-subgrid">
          ${segment.strokeStyle === "dashed" ? `
            <div class="field-compact">
              <label>虚线实段长度</label>
              <input data-field="dashSolidLength" data-index="${index}" type="number" min="0.1" max="200" step="0.1" value="${formatPositiveNumber(segment.dashSolidLength, 10)}" />
            </div>
            <div class="field-compact">
              <label>虚线虚段长度</label>
              <input data-field="dashGapLength" data-index="${index}" type="number" min="0.1" max="200" step="0.1" value="${formatPositiveNumber(segment.dashGapLength, 6)}" />
            </div>
          ` : ""}
          <div class="field-compact field-compact-toggle">
            <label for="segmentRoundCap${index}">端点圆头</label>
            <label class="toggle-switch" for="segmentRoundCap${index}">
              <input id="segmentRoundCap${index}" class="toggle-checkbox" data-field="roundCap" data-index="${index}" type="checkbox" ${segment.roundCap ? "checked" : ""} />
              <span class="toggle-slider" aria-hidden="true"></span>
            </label>
          </div>
          ${segment.colorMode === "palette" ? `
            <div class="field-compact">
              <label>引用颜色</label>
              <select data-field="paletteIndex" data-index="${index}">${paletteOptions}</select>
            </div>
          ` : `
            <div class="field-compact">
              <label>固定颜色</label>
              <input data-field="fixedColorHex" data-index="${index}" type="color" value="${fixedColor.hex}" />
              <div class="alpha-control">
                <span class="alpha-control-label" title="Alpha">A</span>
                <input data-field="fixedColorAlpha" data-index="${index}" type="range" min="0" max="100" value="${fixedAlphaPercent}" />
                <input class="alpha-control-number" data-field="fixedColorAlphaNumber" data-index="${index}" type="number" min="0" max="100" step="1" value="${fixedAlphaPercent}" />
              </div>
            </div>
          `}
        </div>
      `;

      const styleSelect = card.querySelector(`select[data-index="${index}"]`);
      styleSelect.value = segment.strokeStyle;

      const modeSelect = card.querySelector(`select[data-field="colorMode"][data-index="${index}"]`);
      modeSelect.value = segment.colorMode;

      const paletteSelect = card.querySelector(`select[data-field="paletteIndex"][data-index="${index}"]`);
      if (paletteSelect) {
        paletteSelect.value = String(segment.paletteIndex || 0);
      }

      card.querySelectorAll("[data-field]").forEach((input) => {
        input.addEventListener("input", onSegmentDraftInput);
        input.addEventListener("change", onSegmentDraftInput);
      });

      const removeBtn = card.querySelector("[data-remove-index]");
      removeBtn.addEventListener("click", () => {
        if (state.lineManager.draft.segments.length <= 1) {
          return;
        }
        state.lineManager.draft.segments.splice(index, 1);
        autoSaveDraft();
        renderLineEditor();
      });

      card.addEventListener("dragover", onSegmentDragOver);
      card.addEventListener("drop", onSegmentDrop);
      const dragHandle = card.querySelector("[data-drag-handle-index]");
      if (dragHandle) {
        dragHandle.addEventListener("dragstart", onSegmentDragStart);
        dragHandle.addEventListener("dragend", onSegmentDragEnd);
      }

      segmentEditorList.appendChild(card);
    });

    deleteLineTypeBtn.disabled = !(selectedType && selectedType.source === "custom");
  }

  function renderColorListEditor() {
    const draft = state.lineManager.draft;
    colorListEditor.innerHTML = "";
    if (!draft) {
      return;
    }

    draft.colorList.forEach((color, index) => {
      const parsedColor = splitColorAndAlpha(color);
      const alphaPercent = Math.round(parsedColor.alpha * 100);
      const row = document.createElement("div");
      row.className = "color-list-item";
      row.innerHTML = `
        <span class="color-list-item-label">颜色${index + 1}</span>
        <input type="color" data-color-hex-index="${index}" value="${parsedColor.hex}" />
        <div class="alpha-control">
          <span class="alpha-control-label" title="Alpha">A</span>
          <input type="range" min="0" max="100" data-color-alpha-index="${index}" value="${alphaPercent}" />
          <input class="alpha-control-number" data-color-alpha-number-index="${index}" type="number" min="0" max="100" step="1" value="${alphaPercent}" />
        </div>
        <button class="btn-ghost" data-remove-color-index="${index}" type="button">删除</button>
      `;

      const colorHexInput = row.querySelector("[data-color-hex-index]");
      const colorAlphaInput = row.querySelector("[data-color-alpha-index]");
      const colorAlphaNumberInput = row.querySelector("[data-color-alpha-number-index]");

      const applyColor = () => {
        const liveDraft = state.lineManager.draft;
        if (!liveDraft) {
          return;
        }

        const alpha = Math.round(clamp(Number(colorAlphaInput.value) || 0, 0, 100));
        colorAlphaInput.value = String(alpha);
        if (colorAlphaNumberInput) {
          colorAlphaNumberInput.value = String(alpha);
        }

        liveDraft.colorList[index] = mergeColorAndAlpha(colorHexInput.value, alpha / 100);
        renderLineTypePreviewEditor();
        autoSaveDraft({ history: { coalesceKey: "line-type-color" }, syncUsage: false });
      };

      const applyColorFromNumber = () => {
        if (!colorAlphaNumberInput) {
          applyColor();
          return;
        }

        const alpha = Math.round(clamp(Number(colorAlphaNumberInput.value) || 0, 0, 100));
        colorAlphaInput.value = String(alpha);
        colorAlphaNumberInput.value = String(alpha);

        const liveDraft = state.lineManager.draft;
        if (!liveDraft) {
          return;
        }

        liveDraft.colorList[index] = mergeColorAndAlpha(colorHexInput.value, alpha / 100);
        renderLineTypePreviewEditor();
        autoSaveDraft({ history: { coalesceKey: "line-type-color" }, syncUsage: false });
      };

      colorHexInput.addEventListener("input", applyColor);
      colorAlphaInput.addEventListener("input", applyColor);
      if (colorAlphaNumberInput) {
        colorAlphaNumberInput.addEventListener("input", applyColorFromNumber);
        colorAlphaNumberInput.addEventListener("change", applyColorFromNumber);
      }

      const removeBtn = row.querySelector("[data-remove-color-index]");
      removeBtn.disabled = draft.colorList.length <= 1;
      removeBtn.addEventListener("click", () => {
        const liveDraft = state.lineManager.draft;
        if (!liveDraft || liveDraft.colorList.length <= 1) {
          return;
        }

        liveDraft.colorList.splice(index, 1);
        liveDraft.segments.forEach((segment) => {
          if (segment.colorMode === "palette") {
            segment.paletteIndex = clamp(segment.paletteIndex || 0, 0, liveDraft.colorList.length - 1);
          }
        });
        autoSaveDraft({ syncUsage: false });
        renderLineEditor();
      });

      colorListEditor.appendChild(row);
    });
  }

  function onSegmentDraftInput(event) {
    const input = event.target;
    const index = Number(input.dataset.index);
    const field = input.dataset.field;
    const segment = state.lineManager.draft?.segments[index];
    if (!segment) {
      return;
    }

    if (field === "width") {
      segment.width = clamp(Number(input.value) || 1, 1, 20);
    }

    if (field === "strokeStyle") {
      segment.strokeStyle = input.value === "dashed" ? "dashed" : "solid";
      if (segment.strokeStyle === "dashed") {
        segment.dashSolidLength = normalizePositiveNumber(segment.dashSolidLength, 10);
        segment.dashGapLength = normalizePositiveNumber(segment.dashGapLength, 6);
      }
      autoSaveDraft();
      renderLineEditor();
      return;
    }

    if (field === "colorMode") {
      segment.colorMode = input.value === "palette" ? "palette" : "fixed";
      autoSaveDraft();
      renderLineEditor();
      return;
    }

    if (field === "fixedColorHex") {
      const alphaInput = input
        .closest(".field-compact")
        ?.querySelector(`[data-field="fixedColorAlpha"][data-index="${index}"]`);
      const alphaNumberInput = input
        .closest(".field-compact")
        ?.querySelector(`[data-field="fixedColorAlphaNumber"][data-index="${index}"]`);
      const alphaSource = alphaNumberInput ? Number(alphaNumberInput.value) : Number(alphaInput?.value);
      const alpha = clamp(alphaSource || 0, 0, 100) / 100;
      segment.fixedColor = mergeColorAndAlpha(input.value, alpha);
    }

    if (field === "fixedColorAlpha" || field === "fixedColorAlphaNumber") {
      const container = input.closest(".field-compact");
      const hexInput = container?.querySelector(`[data-field="fixedColorHex"][data-index="${index}"]`);
      const alphaRangeInput = container?.querySelector(`[data-field="fixedColorAlpha"][data-index="${index}"]`);
      const alphaNumberInput = container?.querySelector(`[data-field="fixedColorAlphaNumber"][data-index="${index}"]`);
      const hex = hexInput ? hexInput.value : "#2f5d9d";
      const alphaPercent = Math.round(clamp(Number(input.value) || 0, 0, 100));

      if (alphaRangeInput) {
        alphaRangeInput.value = String(alphaPercent);
      }
      if (alphaNumberInput) {
        alphaNumberInput.value = String(alphaPercent);
      }

      segment.fixedColor = mergeColorAndAlpha(hex, alphaPercent / 100);
    }

    if (field === "paletteIndex") {
      segment.paletteIndex = clamp(Number(input.value) || 0, 0, Math.max(0, state.lineManager.draft.colorList.length - 1));
    }

    if (field === "dashSolidLength") {
      segment.dashSolidLength = normalizePositiveNumber(input.value, 10);
      input.value = String(segment.dashSolidLength);
    }

    if (field === "dashGapLength") {
      segment.dashGapLength = normalizePositiveNumber(input.value, 6);
      input.value = String(segment.dashGapLength);
    }

    if (field === "roundCap") {
      segment.roundCap = Boolean(input.checked);
    }

    renderLineTypePreviewEditor();
    const history = (field === "fixedColorHex" || field === "fixedColorAlpha" || field === "fixedColorAlphaNumber")
      ? { coalesceKey: "line-type-color" }
      : undefined;
    autoSaveDraft({ history });
  }

  function onSegmentDragStart(event) {
    const dragHandle = event.currentTarget;
    const card = dragHandle.closest(".segment-item");
    if (!card) {
      return;
    }

    state.lineManager.dragSegmentIndex = Number(card.dataset.segmentIndex);
    card.classList.add("dragging");

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", card.dataset.segmentIndex || "");
    }
  }

  function onSegmentDragOver(event) {
    if (!Number.isInteger(state.lineManager.dragSegmentIndex)) {
      return;
    }
    event.preventDefault();
  }

  function onSegmentDrop(event) {
    event.preventDefault();
    const targetCard = event.currentTarget;
    const fromIndex = state.lineManager.dragSegmentIndex;
    const toIndex = Number(targetCard.dataset.segmentIndex);

    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) {
      return;
    }

    const moved = state.lineManager.draft.segments.splice(fromIndex, 1)[0];
    const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    state.lineManager.draft.segments.splice(insertIndex, 0, moved);
    state.lineManager.dragSegmentIndex = null;
    autoSaveDraft();
    renderLineEditor();
  }

  function onSegmentDragEnd() {
    segmentEditorList.querySelectorAll(".segment-item.dragging").forEach((item) => {
      item.classList.remove("dragging");
    });
    state.lineManager.dragSegmentIndex = null;
  }

  function addDraftColor() {
    if (!state.lineManager.draft) {
      return;
    }

    const latestColor = state.lineManager.draft.colorList[state.lineManager.draft.colorList.length - 1] || "#2f5d9dff";
    state.lineManager.draft.colorList.push(latestColor);
    autoSaveDraft({ syncUsage: false });
    renderLineEditor();
  }

  function addDraftSegment() {
    if (!state.lineManager.draft) {
      return;
    }

    const latest = state.lineManager.draft.segments[state.lineManager.draft.segments.length - 1];
    state.lineManager.draft.segments.push({
      width: latest?.width || 5,
      strokeStyle: latest?.strokeStyle === "dashed" ? "dashed" : "solid",
      dashSolidLength: normalizePositiveNumber(latest?.dashSolidLength, 10),
      dashGapLength: normalizePositiveNumber(latest?.dashGapLength, 6),
      roundCap: Boolean(latest?.roundCap),
      colorMode: latest?.colorMode || "palette",
      paletteIndex: clamp(Number(latest?.paletteIndex) || 0, 0, Math.max(0, state.lineManager.draft.colorList.length - 1)),
      fixedColor: latest?.fixedColor || "#2f5d9dff"
    });
    autoSaveDraft();
    renderLineEditor();
  }

  function startNewLineTypeDraft() {
    const newId = createLineTypeId();
    state.lineManager.selectedId = newId;
    state.lineManager.draft = {
      name: "新线条",
      colorList: ["#2f5d9dff"],
      segments: [{
        width: 5,
        strokeStyle: "solid",
        dashSolidLength: 10,
        dashGapLength: 6,
        roundCap: false,
        colorMode: "palette",
        paletteIndex: 0,
        fixedColor: "#2f5d9dff"
      }]
    };
    autoSaveDraft({ rerenderLines: false });
    renderLineManager();
  }

  function loadLineTypeDraft(typeId) {
    const source = findLineType(typeId);
    if (!source) {
      state.lineManager.draft = null;
      return;
    }

    state.lineManager.draft = structuredClone({
      name: source.name,
      colorList: source.colorList,
      segments: source.segments
    });
  }

  function deleteSelectedLineType() {
    const selected = findLineType(state.lineManager.selectedId);
    if (!selected || selected.source !== "custom") {
      return;
    }

    const usageCount = state.edges.filter((edge) => edge.lineTypeId === selected.id).length;
    if (usageCount > 0) {
      const confirmed = window.confirm(`当前绘图中有 ${usageCount} 条线在使用该线条类型，删除后这些线也会被删除。是否继续？`);
      if (!confirmed) {
        return;
      }
    }

    state.lineTypes = state.lineTypes.filter((item) => item.id !== selected.id);
    state.edges = state.edges.filter((edge) => edge.lineTypeId !== selected.id);

    if (state.menuSelection.lineType === selected.id) {
      state.menuSelection.lineType = null;
    }

    if (state.lineTypes.length) {
      state.lineManager.selectedId = state.lineTypes[0].id;
      loadLineTypeDraft(state.lineManager.selectedId);
    } else {
      state.lineManager.selectedId = null;
      state.lineManager.draft = null;
    }

    persistCustomLineTypes(state.lineTypes);
    renderSubmenu();
    renderLineManager();
    renderLines();
    onStateChanged?.();
  }

  function downloadSelectedLineType() {
    const selected = findLineType(state.lineManager.selectedId);
    if (!selected) {
      return;
    }

    const payload = {
      name: selected.name,
      colorList: selected.colorList,
      segments: selected.segments
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selected.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importLineTypesFromFile(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const entries = Array.isArray(raw) ? raw : [raw];
      const imported = entries
        .map((item) => normalizeLineType(item))
        .filter(Boolean)
        .map((item) => ({
          ...item,
          id: createLineTypeId(),
          source: "custom",
          isTemporaryImported: false
        }));

      if (!imported.length) {
        return;
      }

      state.lineTypes.push(...imported);
      state.lineManager.selectedId = imported[0].id;
      loadLineTypeDraft(imported[0].id);
      persistCustomLineTypes(state.lineTypes);
      renderSubmenu();
      renderLineManager();
      onStateChanged?.();
    } finally {
      lineTypeImportInput.value = "";
    }
  }

  function renderLineTypePreviewEditor() {
    if (!state.lineManager.draft) {
      return;
    }

    const temp = normalizeLineType({
      ...state.lineManager.draft,
      id: "preview",
      source: "custom"
    });
    renderLineTypePreviewSvg(lineTypePreview, temp);
  }

  function renderLineTypePreviewSvg(svgEl, lineType) {
    svgEl.innerHTML = "";
    const vb = svgEl.viewBox?.baseVal;
    const width = vb?.width || 220;
    const height = vb?.height || 90;
    const padX = Math.max(6, width * 0.08);
    const centerLine = [
      { x: padX, y: height / 2 },
      { x: width - padX, y: height / 2 }
    ];
    const offsets = getParallelOffsets(lineType.segments.map((seg) => seg.width), -0.8);

    lineType.segments.forEach((seg, index) => {
      const offsetLine = getOffsetPolyline(centerLine, offsets[index] || 0);
      const path = document.createElementNS(svgNs, "path");
      path.setAttribute("d", buildPathD(offsetLine));
      path.setAttribute("stroke", resolveSegmentColor(seg, lineType.colorList));
      path.setAttribute("stroke-width", String(seg.width));
      path.setAttribute("stroke-linecap", seg.roundCap ? "round" : "butt");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-dasharray", getSegmentDasharray(seg));
      svgEl.appendChild(path);
    });
  }

  function autoSaveDraft({ rerenderSubmenu = true, rerenderLines = true, history, syncUsage = true } = {}) {
    const draft = state.lineManager.draft;
    if (!draft) {
      return;
    }

    let targetId = state.lineManager.selectedId;
    if (!targetId) {
      targetId = createLineTypeId();
      state.lineManager.selectedId = targetId;
    }

    const selectedType = findLineType(targetId);
    if (selectedType && selectedType.source === "default") {
      targetId = createLineTypeId();
      state.lineManager.selectedId = targetId;
    }

    const previousLineType = findLineType(targetId) ? structuredClone(findLineType(targetId)) : null;

    const cleaned = normalizeLineType({
      id: targetId,
      source: "custom",
      name: draft.name,
      isTemporaryImported: selectedType?.isTemporaryImported || false,
      colorList: draft.colorList,
      segments: draft.segments
    });
    cleaned.id = targetId;
    cleaned.source = "custom";

    const existingIndex = state.lineTypes.findIndex((item) => item.id === targetId);
    if (existingIndex >= 0) {
      state.lineTypes[existingIndex] = cleaned;
    } else {
      state.lineTypes.push(cleaned);
    }

    onLineTypeUpdated?.({
      previousLineType,
      nextLineType: cleaned,
      syncUsage
    });

    persistCustomLineTypes(state.lineTypes);
    if (state.lineManager.isOpen) {
      renderLineLibraryList();
    }
    if (rerenderSubmenu) {
      renderSubmenu();
    }
    if (rerenderLines) {
      renderLines();
    }
    onStateChanged?.(history);
  }

  function makeSelectedLineTypePermanent() {
    const selected = findLineType(state.lineManager.selectedId);
    if (!selected || selected.source !== "custom" || !selected.isTemporaryImported) {
      return;
    }

    selected.isTemporaryImported = false;
    persistCustomLineTypes(state.lineTypes);
    renderSubmenu();
    renderLineManager();
    onStateChanged?.();
  }

  return {
    bind,
    open,
    close
  };
}

function normalizePositiveNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }

  return clamp(n, 0.1, 200);
}

function formatPositiveNumber(value, fallback) {
  return normalizePositiveNumber(value, fallback).toString();
}

function getSegmentDasharray(seg) {
  if (seg.strokeStyle !== "dashed") {
    return lineStyleMap.solid;
  }

  const solid = normalizePositiveNumber(seg.dashSolidLength, 10);
  const gap = normalizePositiveNumber(seg.dashGapLength, 6);
  return `${solid} ${gap}`;
}
