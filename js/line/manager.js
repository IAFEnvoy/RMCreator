import { svgNs } from "../dom.js";
import { lineStyleMap } from "../constants.js";
import { buildPathD, getOffsetPolyline, getParallelOffsets } from "./geometry.js";
import {
  getLineTypeById,
  normalizeLineType,
  persistCustomLineTypes,
  resolveSegmentColor
} from "./type-store.js";
import {
  clamp,
  escapeHtml,
  formatColorWithAlpha,
  normalizeColor,
  splitColorAndAlpha
} from "../utils.js";
import { renderTemplate } from "../template-store.js";

export function createLineManager({
  state,
  elements,
  createLineTypeId,
  colorPicker,
  renderSubmenu,
  renderLines,
  onLineTypeUpdated,
  onStateChanged
}) {
  const exportType = "lineType";
  const {
    lineManagerModal,
    closeLineManagerBtn,
    newLineTypeBtn,
    lineLibraryList,
    lineSelectAllInput,
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
    lineTypeImportInput,
    lineDetailCopyBtn,
    lineDetailDeleteBtn
  } = elements;

  const findLineType = (id) => getLineTypeById(state.lineTypes, id);

  function getCheckedLineTypeIds() {
    return Array.isArray(state.lineManager.checkedIds)
      ? state.lineManager.checkedIds.map((id) => String(id))
      : [];
  }

  function setCheckedLineTypeIds(ids) {
    const validIds = new Set(state.lineTypes.map((type) => String(type.id)));
    const next = [];
    const seen = new Set();
    (Array.isArray(ids) ? ids : []).forEach((id) => {
      const key = String(id || "");
      if (!key || !validIds.has(key) || seen.has(key)) {
        return;
      }
      seen.add(key);
      next.push(key);
    });
    state.lineManager.checkedIds = next;
  }

  function resolveLineTypeTargets() {
    const checkedIds = getCheckedLineTypeIds();
    if (checkedIds.length) {
      return checkedIds
        .map((id) => findLineType(id))
        .filter(Boolean);
    }

    const selected = findLineType(state.lineManager.selectedId);
    return selected ? [selected] : [];
  }

  function syncLineBulkActionState() {
    const totalCount = state.lineTypes.length;
    const checkedIds = getCheckedLineTypeIds();
    const checkedCount = checkedIds.length;

    lineSelectAllInput.checked = totalCount > 0 && checkedCount === totalCount;
    lineSelectAllInput.indeterminate = checkedCount > 0 && checkedCount < totalCount;

    const selectedType = findLineType(state.lineManager.selectedId);
    const hasChecked = checkedCount > 0;
    const checkedTypes = checkedIds.map((id) => findLineType(id)).filter(Boolean);
    const deletableCheckedCount = checkedTypes.filter((type) => type.source === "custom").length;

    const canDelete = hasChecked
      ? deletableCheckedCount > 0
      : Boolean(selectedType && selectedType.source === "custom");
    const canDownload = hasChecked
      ? checkedTypes.length > 0
      : Boolean(selectedType);

    deleteLineTypeBtn.disabled = !canDelete;
    downloadLineTypeBtn.disabled = !canDownload;
  }

  function syncLineDetailActionState() {
    const selectedType = findLineType(state.lineManager.selectedId);
    lineDetailCopyBtn.disabled = !selectedType;
    lineDetailDeleteBtn.disabled = !selectedType || selectedType.source !== "custom";
  }

  function bind() {
    if (!Array.isArray(state.lineManager.checkedIds)) {
      state.lineManager.checkedIds = [];
    }

    if (!lineDetailCopyBtn || !lineDetailDeleteBtn) {
      return;
    }

    closeLineManagerBtn.addEventListener("click", close);
    newLineTypeBtn.addEventListener("click", startNewLineTypeDraft);
    addColorRefBtn.addEventListener("click", addDraftColor);
    addSegmentBtn.addEventListener("click", addDraftSegment);
    deleteLineTypeBtn.addEventListener("click", deleteSelectedLineType);
    downloadLineTypeBtn.addEventListener("click", downloadSelectedLineType);
    importLineTypeBtn.addEventListener("click", () => lineTypeImportInput.click());
    lineTypeImportInput.addEventListener("change", importLineTypesFromFile);
    makeLineTypePermanentBtn.addEventListener("click", makeSelectedLineTypePermanent);
    lineDetailCopyBtn.addEventListener("click", createLineTypeCopy);
    lineDetailDeleteBtn.addEventListener("click", deleteCurrentLineType);
    lineSelectAllInput.addEventListener("change", () => {
      if (lineSelectAllInput.checked) {
        setCheckedLineTypeIds(state.lineTypes.map((type) => type.id));
      } else {
        setCheckedLineTypeIds([]);
      }
      renderLineManager();
    });

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
    syncLineBulkActionState();
    syncLineDetailActionState();
  }

  function renderLineLibraryList() {
    lineLibraryList.innerHTML = "";
    setCheckedLineTypeIds(getCheckedLineTypeIds());
    const checkedSet = new Set(getCheckedLineTypeIds());

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

      const lead = document.createElement("div");
      lead.className = "line-library-item-lead";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "library-item-checkbox";
      checkbox.checked = checkedSet.has(type.id);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", (event) => {
        event.stopPropagation();
        const next = new Set(getCheckedLineTypeIds());
        if (checkbox.checked) {
          next.add(type.id);
        } else {
          next.delete(type.id);
        }
        setCheckedLineTypeIds([...next]);
        syncLineBulkActionState();
      });

      const title = document.createElement("span");
      title.className = "line-library-item-title";
      const usageCount = usageCountByTypeId.get(type.id) || 0;
      title.textContent = `${type.name} (${usageCount})`;
      title.classList.toggle("temporary-imported", Boolean(type.isTemporaryImported));

      const tag = document.createElement("span");
      tag.className = "line-library-item-tag";
      if (type.isTemporaryImported) {
        tag.textContent = "外部导入(临时)";
      } else if (type.source !== "custom") {
        tag.textContent = "预设";
      } else {
        tag.textContent = "自定义";
      }
      tag.classList.toggle("temporary-imported", Boolean(type.isTemporaryImported));
      title.title = `${type.name} (${usageCount}条, ${tag.textContent})`;

      const preview = document.createElementNS(svgNs, "svg");
      preview.setAttribute("viewBox", "0 0 92 24");
      preview.setAttribute("class", "line-library-preview-inline");
      renderLineTypePreviewSvg(preview, type);

      lead.appendChild(checkbox);
      lead.appendChild(title);
      row.appendChild(lead);
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

  function formatColorLabel(value) {
    return formatColorWithAlpha(value);
  }

  function buildColorTrigger({ color, label, attrs = {} }) {
    const normalized = normalizeColor(color);
    const attrText = Object.entries(attrs)
      .map(([key, val]) => ` ${key}="${escapeHtml(val)}"`)
      .join("");
    const text = label || formatColorLabel(normalized);
    return `
        <button class="color-modal-trigger" type="button"${attrText}>
          <span class="color-modal-swatch" style="--swatch-color:${escapeHtml(normalized)}"></span>
          <span class="color-modal-text">${escapeHtml(text)}</span>
        </button>
      `;
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

      const card = document.createElement("div");
      card.className = "segment-item";
      card.dataset.segmentIndex = String(index);

      const dashedFieldsHtml = segment.strokeStyle === "dashed"
        ? `
            <div class="field-compact">
              <label>虚线实段长度</label>
              <input data-field="dashSolidLength" data-index="${index}" type="number" min="0.1" max="200" step="0.1" value="${formatPositiveNumber(segment.dashSolidLength, 10)}" />
            </div>
            <div class="field-compact">
              <label>虚线虚段长度</label>
              <input data-field="dashGapLength" data-index="${index}" type="number" min="0.1" max="200" step="0.1" value="${formatPositiveNumber(segment.dashGapLength, 6)}" />
            </div>
          `
        : "";

      const colorModeHtml = segment.colorMode === "palette"
        ? `
            <div class="field-compact">
              <label>引用颜色</label>
              <select data-field="paletteIndex" data-index="${index}">${paletteOptions}</select>
            </div>
          `
        : `
            <div class="field-compact">
              <label>固定颜色</label>
              ${buildColorTrigger({
          color: segment.fixedColor,
          attrs: {
            "data-color-role": "segment-fixed",
            "data-index": String(index)
          }
        })}
            </div>
          `;

      card.innerHTML = renderTemplate("line-manager-segment-item", {
        segmentIndex: String(index),
        segmentTitle: `小线条 ${index + 1}`,
        segmentWidth: String(segment.width),
        dashedFieldsHtml,
        colorModeHtml,
        roundCapChecked: segment.roundCap ? "checked" : ""
      });

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

      const fixedColorButton = card.querySelector("[data-color-role='segment-fixed']");
      fixedColorButton?.addEventListener("click", () => {
        if (!colorPicker) {
          return;
        }
        const liveDraft = state.lineManager.draft;
        if (!liveDraft) {
          return;
        }
        const liveSegment = liveDraft.segments[index];
        if (!liveSegment) {
          return;
        }
        colorPicker.open({
          color: liveSegment.fixedColor,
          title: `小线条${index + 1} 固定颜色`,
          onConfirm: (nextColor) => {
            liveSegment.fixedColor = nextColor;
            renderLineTypePreviewEditor();
            autoSaveDraft({ history: { coalesceKey: "line-type-color" }, syncUsage: false });
            renderLineEditor();
          }
        });
      });

      const removeBtn = card.querySelector("[data-remove-index]");
      removeBtn.disabled = draft.segments.length <= 1;
      if (removeBtn.disabled) {
        // wrap in span so tooltip still shows when button is disabled
        const wrapper = document.createElement("span");
        wrapper.className = "disabled-wrapper";
        wrapper.title = "至少需要保留一个小线条，无法删除";
        removeBtn.parentNode.replaceChild(wrapper, removeBtn);
        wrapper.appendChild(removeBtn);
      }
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

  }

  function renderColorListEditor() {
    const draft = state.lineManager.draft;
    colorListEditor.innerHTML = "";
    if (!draft) {
      return;
    }

    draft.colorList.forEach((color, index) => {
      const row = document.createElement("div");
      row.className = "color-list-item";
      row.innerHTML = renderTemplate("line-manager-color-item", {
        colorLabel: `颜色${index + 1}`,
        colorTriggerHtml: buildColorTrigger({
          color,
          attrs: {
            "data-color-role": "line-palette",
            "data-index": String(index)
          }
        }),
        colorIndex: String(index)
      });

      const colorButton = row.querySelector("[data-color-role='line-palette']");
      colorButton?.addEventListener("click", () => {
        if (!colorPicker) {
          return;
        }
        const liveDraft = state.lineManager.draft;
        if (!liveDraft) {
          return;
        }
        colorPicker.open({
          color: liveDraft.colorList[index],
          title: `颜色${index + 1}`,
          onConfirm: (nextColor) => {
            liveDraft.colorList[index] = nextColor;
            renderLineTypePreviewEditor();
            autoSaveDraft({ history: { coalesceKey: "line-type-color" }, syncUsage: false });
            renderLineEditor();
          }
        });
      });

      const removeBtn = row.querySelector("[data-remove-color-index]");
      // disable if only one color or if any segment references this palette index
      const isReferenced = (state.lineManager.draft?.segments || []).some((seg) => seg.colorMode === "palette" && Number(seg.paletteIndex || 0) === index);
      removeBtn.disabled = draft.colorList.length <= 1 || isReferenced;
      if (removeBtn.disabled) {
        const wrapper = document.createElement("span");
        wrapper.className = "disabled-wrapper";
        wrapper.title = draft.colorList.length <= 1 ? "至少需要保留一种颜色" : "该颜色已被小线条引用，无法删除";
        removeBtn.parentNode.replaceChild(wrapper, removeBtn);
        wrapper.appendChild(removeBtn);
      }
      removeBtn.addEventListener("click", () => {
        const liveDraft = state.lineManager.draft;
        if (!liveDraft || liveDraft.colorList.length <= 1) {
          return;
        }
        // prevent deleting a color that is referenced
        const stillReferenced = liveDraft.segments.some((seg) => seg.colorMode === "palette" && Number(seg.paletteIndex || 0) === index);
        if (stillReferenced) {
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
    autoSaveDraft();
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
    deleteLineTypes(resolveLineTypeTargets());
  }

  function deleteCurrentLineType() {
    const selected = findLineType(state.lineManager.selectedId);
    if (!selected) {
      return;
    }
    deleteLineTypes([selected]);
  }

  function deleteLineTypes(targets) {
    if (!targets.length) {
      return;
    }

    const deletableTargets = targets.filter((type) => type.source === "custom");
    if (!deletableTargets.length) {
      window.alert("所选线条类型均为预设，无法删除。");
      return;
    }

    const skippedCount = targets.length - deletableTargets.length;
    const removedTypeIds = new Set(deletableTargets.map((type) => String(type.id)));
    const usageCount = state.edges.filter((edge) => removedTypeIds.has(String(edge.lineTypeId))).length;

    const warningLines = [`将删除 ${deletableTargets.length} 个线条类型。`];
    if (usageCount > 0) {
      warningLines.push(`当前绘图中有 ${usageCount} 条线在使用这些类型，删除后这些线也会被删除。`);
    }
    if (skippedCount > 0) {
      warningLines.push(`有 ${skippedCount} 个预设类型已自动跳过。`);
    }
    warningLines.push("此操作不可撤销，是否继续？");

    if (!window.confirm(warningLines.join("\n"))) {
      return;
    }
    if (!window.confirm("请再次确认删除：该操作执行后无法恢复。")) {
      return;
    }

    state.lineTypes = state.lineTypes.filter((item) => !removedTypeIds.has(String(item.id)));
    state.edges = state.edges.filter((edge) => !removedTypeIds.has(String(edge.lineTypeId)));

    if (removedTypeIds.has(String(state.menuSelection.lineType || ""))) {
      state.menuSelection.lineType = null;
    }

    setCheckedLineTypeIds([]);

    if (state.lineTypes.length) {
      if (!findLineType(state.lineManager.selectedId) || removedTypeIds.has(String(state.lineManager.selectedId || ""))) {
        state.lineManager.selectedId = state.lineTypes[0].id;
      }
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

  function createLineTypeCopy() {
    const selectedType = findLineType(state.lineManager.selectedId);
    const draft = state.lineManager.draft;
    if (!selectedType || !draft) {
      return;
    }

    const nextId = createLineTypeId();
    const existingNames = state.lineTypes.map((type) => String(type.name || ""));
    const nextName = buildCopyName(String(selectedType.name || draft.name || "线条"), existingNames);

    const normalized = normalizeLineType({
      ...draft,
      id: nextId,
      name: nextName,
      source: "custom"
    });
    if (!normalized) {
      return;
    }

    const copy = {
      ...normalized,
      id: nextId,
      source: "custom",
      isTemporaryImported: false
    };

    state.lineTypes.push(copy);
    state.lineManager.selectedId = nextId;
    loadLineTypeDraft(nextId);
    persistCustomLineTypes(state.lineTypes);
    renderSubmenu();
    renderLineManager();
    renderLines();
    onStateChanged?.();
  }

  function buildCopyName(baseName, existingNames) {
    const cleaned = String(baseName || "线条").trim() || "线条";
    const baseCopy = `${cleaned} 副本`;
    if (!existingNames.includes(baseCopy)) {
      return baseCopy;
    }

    let index = 2;
    let next = `${baseCopy} ${index}`;
    while (existingNames.includes(next)) {
      index += 1;
      next = `${baseCopy} ${index}`;
    }
    return next;
  }

  function downloadSelectedLineType() {
    const targets = resolveLineTypeTargets();
    if (!targets.length) {
      return;
    }

    const payloadList = targets.map((type) => ({
      name: type.name,
      colorList: type.colorList,
      segments: type.segments
    }));
    const payload = {
      type: exportType,
      data: payloadList
    };
    const downloadName = `RMC_LineType_${buildExportTimestamp()}.json`;

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
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
      const payload = JSON.parse(text.replace(/^\uFEFF/, ""));
      if (!payload || typeof payload !== "object") {
        window.alert("导入失败：文件格式无效。");
        return;
      }
      if (payload.type !== exportType) {
        window.alert("导入失败：文件类型不匹配。");
        return;
      }
      const entries = Array.isArray(payload.data) ? payload.data : [];
      if (!entries.length) {
        window.alert("导入失败：文件中没有可导入的线条类型。");
        return;
      }
      showLineImportSelectionModal(entries, file.name);
    } catch {
      window.alert("导入失败：JSON 文件格式无效。\n需要 {type:\"lineType\", data:[...]} 格式。");
    } finally {
      lineTypeImportInput.value = "";
    }
  }

  function openImportSelection(items, fileName) {
    if (!Array.isArray(items) || !items.length) {
      window.alert("导入失败：文件中没有可导入的线条类型。");
      return;
    }
    showLineImportSelectionModal(items, fileName || "导入");
  }

  function showLineImportSelectionModal(items, fileName) {
    const modalId = 'lineImportSelectModal';
    let modal = typeof lineManagerModal !== 'undefined' && lineManagerModal ? lineManagerModal.querySelector('#' + modalId) : null;
    if (!modal) {
        modal = document.getElementById(modalId);
    }
    if (modal && !modal.innerHTML.trim()) {
      modal.innerHTML = renderTemplate('import-select-modal', {
        title: '线条类型',
        type: 'line',
        Type: 'Line'
      });
    }
    
    const listEl = modal ? modal.querySelector('#lineImportSelectList') : null;
    const confirmBtn = modal ? modal.querySelector('#confirmLineImportSelectBtn') : null;
    const cancelBtn = modal ? modal.querySelector('#cancelLineImportSelectBtn') : null;
    const selectAllCheckbox = modal ? modal.querySelector('#lineImportSelectAll') : null;
    const closeBtn2 = modal ? modal.querySelector('#closeLineImportSelectBtn') : null;

    if (!modal || !listEl || !confirmBtn || !cancelBtn) {
      // fallback: import all
      try {
        const imported = items
          .map((item) => normalizeLineType(item))
          .filter(Boolean)
          .map((item) => ({
            ...item,
            id: createLineTypeId(),
            source: 'custom',
            isTemporaryImported: false
          }));
        if (!imported.length) return;
        state.lineTypes.push(...imported);
        state.lineManager.selectedId = imported[0].id;
        loadLineTypeDraft(imported[0].id);
        persistCustomLineTypes(state.lineTypes);
        renderSubmenu();
        renderLineManager();
        onStateChanged?.();
      } catch (err) {
        // ignore
      }
      return;
    }

    listEl.innerHTML = '';
    const normalized = items.map((it) => normalizeLineType(it)).map((it, idx) => ({ item: it, idx }));
    normalized.forEach(({ item, idx }) => {
      const row = document.createElement('div');
      row.className = 'drawing-import-item';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'drawing-import-item-checkbox';
      checkbox.dataset.index = String(idx);
      checkbox.checked = true;

      const name = item && item.name ? item.name : `${fileName.replace(/\.[^/.]+$/, '')} ${idx + 1}`;
      const segCount = item && Array.isArray(item.segments) ? item.segments.length : 0;
      const label = document.createElement('label');
      label.appendChild(checkbox);
      const span = document.createElement('span');
      span.textContent = `${name} — ${segCount} 段`;
      label.appendChild(span);
      row.appendChild(label);
      listEl.appendChild(row);
    });

    function getSelectedIndexes() {
      const boxes = listEl.querySelectorAll('.drawing-import-item-checkbox');
      const res = [];
      boxes.forEach((b) => { if (b.checked) res.push(Number(b.dataset.index)); });
      return res;
    }

    function cleanupHandlers() {
      confirmBtn.removeEventListener('click', confirmHandler);
      cancelBtn.removeEventListener('click', cancelHandler);
      if (selectAllCheckbox) selectAllCheckbox.removeEventListener('change', selectAllHandler);
      if (closeBtn2) closeBtn2.removeEventListener('click', cancelHandler);
    }

    function confirmHandler() {
      const idxs = getSelectedIndexes();
      if (!idxs.length) {
        window.alert('请先选择要导入的线条类型。');
        return;
      }
      try {
        const imported = idxs.map((i) => normalizeLineType(items[i])).filter(Boolean).map((item) => ({
          ...item,
          id: createLineTypeId(),
          source: 'custom',
          isTemporaryImported: false
        }));
        if (!imported.length) return;
        state.lineTypes.push(...imported);
        state.lineManager.selectedId = imported[0].id;
        loadLineTypeDraft(imported[0].id);
        persistCustomLineTypes(state.lineTypes);
        renderSubmenu();
        renderLineManager();
        onStateChanged?.();
      } catch (err) {
        // ignore
      } finally {
        cleanupHandlers();
        modal.hidden = true;
      }
    }

    function cancelHandler() {
      cleanupHandlers();
      modal.hidden = true;
    }

    function selectAllHandler() {
      const boxes = listEl.querySelectorAll('.drawing-import-item-checkbox');
      boxes.forEach((b) => { b.checked = selectAllCheckbox.checked; });
    }

    if (selectAllCheckbox) {
      selectAllCheckbox.checked = true;
      selectAllCheckbox.addEventListener('change', selectAllHandler);
    }
    confirmBtn.addEventListener('click', confirmHandler);
    cancelBtn.addEventListener('click', cancelHandler);
    if (closeBtn2) closeBtn2.addEventListener('click', cancelHandler);
    modal.hidden = false;
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
    if (selectedType && selectedType.source !== "custom") {
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
    close,
    openImportSelection
  };
}

function buildExportTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
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
