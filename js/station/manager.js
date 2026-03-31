import { stationStorageKey } from "../constants.js";
import { svgNs } from "../dom.js";
import {
  buildRenderableShapeSvg,
  normalizeNumber,
  normalizeShapeParameterDefault,
  normalizeShapeParameters,
  safeColor,
  shapeParameterTypeDefinitions,
  toNumber
} from "../shape/utils.js";
import {
  appendStationTexts,
  buildShapeParamValuesFromRuntime,
  buildStationRuntimeParamMap,
  buildStationTextParamOptions,
  createDefaultStationTextCard,
  createDefaultStationTextPlacement,
  getStationTextFontOptions,
  normalizeStationTextCards,
  normalizeStationTextPlacement,
  normalizeTextBinding,
  normalizeTextSlot
} from "./textUtils.js";

const previewDefaultViewBox = Object.freeze({ x: -120, y: -120, width: 480, height: 480 });
const previewInitialScale = 0.25;

export function createStationManager({
  state,
  elements,
  createStationPresetId,
  renderSubmenu
}) {
  const {
    stationManagerModal,
    closeStationManagerBtn,
    newStationPresetBtn,
    stationLibraryList,
    stationPresetNameInput,
    stationShapeSearchInput,
    stationShapeSelect,
    stationTextPlacementPanel,
    stationPlacementTitle,
    stationPositionGrid,
    stationTextDistanceMode,
    stationTextDistanceValue,
    stationTextDistanceParamSelect,
    stationTextLineGap,
    stationPreviewResetBtn,
    stationPreviewCanvasWrap,
    stationPreviewCanvas,
    stationTabTextBtn,
    stationTabParamsBtn,
    stationTextPanel,
    stationParamsPanel,
    stationAddTextCardBtn,
    stationParamTypeSelect,
    stationAddParamBtn,
    stationCustomParamList,
    stationExistingParamList,
    stationTextCardList
  } = elements;

  const previewState = {
    viewBox: { ...previewDefaultViewBox },
    isPanning: false,
    startClientX: 0,
    startClientY: 0,
    startViewBox: { ...previewDefaultViewBox }
  };

  function bind() {
    if (
      !stationManagerModal
      || !closeStationManagerBtn
      || !newStationPresetBtn
      || !stationLibraryList
      || !stationPresetNameInput
      || !stationShapeSearchInput
      || !stationShapeSelect
      || !stationTextPlacementPanel
      || !stationPlacementTitle
      || !stationPositionGrid
      || !stationTextDistanceMode
      || !stationTextDistanceValue
      || !stationTextDistanceParamSelect
      || !stationTextLineGap
      || !stationPreviewResetBtn
      || !stationPreviewCanvasWrap
      || !stationPreviewCanvas
      || !stationTabTextBtn
      || !stationTabParamsBtn
      || !stationTextPanel
      || !stationParamsPanel
      || !stationAddTextCardBtn
      || !stationParamTypeSelect
      || !stationAddParamBtn
      || !stationCustomParamList
      || !stationExistingParamList
      || !stationTextCardList
    ) {
      return;
    }

    ensureStationManagerState();
    loadStationLibrary();

    closeStationManagerBtn.addEventListener("click", close);
    newStationPresetBtn.addEventListener("click", createEmptyPreset);
    stationPreviewResetBtn.addEventListener("click", () => {
      const preset = getSelectedPreset();
      resetPreviewView(preset);
      renderPreview(preset);
    });

    stationPreviewCanvas.addEventListener("mousedown", onPreviewMouseDown);
    stationPreviewCanvas.addEventListener("wheel", onPreviewWheel, { passive: false });
    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);

    stationTabTextBtn.addEventListener("click", () => {
      state.stationManager.activeTab = "text";
      syncTabVisibility();
    });

    stationTabParamsBtn.addEventListener("click", () => {
      state.stationManager.activeTab = "params";
      syncTabVisibility();
      renderParamsPanel(getSelectedPreset());
    });

    stationParamTypeSelect.addEventListener("change", () => {
      state.stationManager.paramType = stationParamTypeSelect.value;
    });

    stationAddParamBtn.addEventListener("click", () => {
      addCustomParameter(stationParamTypeSelect.value);
    });

    stationAddTextCardBtn.addEventListener("click", addTextCard);

    stationPresetNameInput.addEventListener("input", () => {
      const preset = getSelectedPreset();
      if (!preset) {
        return;
      }

      preset.name = String(stationPresetNameInput.value || "").trim() || "车站预设";
      persistStationLibrary();
      renderStationManager();
      renderSubmenu?.();
    });

    stationShapeSearchInput.addEventListener("input", () => {
      state.stationManager.shapeQuery = String(stationShapeSearchInput.value || "");
      renderShapeSelect();
    });

    stationShapeSelect.addEventListener("change", () => {
      const preset = getSelectedPreset();
      if (!preset) {
        return;
      }

      preset.shapeId = stationShapeSelect.value || null;
      preset.shapeParamSettings = {};
      persistStationLibrary();
      resetPreviewView(preset);
      renderParamsPanel(preset);
      renderPreview(preset);
      renderSubmenu?.();
    });

    stationPositionGrid.addEventListener("click", onPositionGridClicked);
    stationTextDistanceMode.addEventListener("change", onTextDistanceChanged);
    stationTextDistanceValue.addEventListener("change", onTextDistanceChanged);
    stationTextDistanceParamSelect.addEventListener("change", onTextDistanceChanged);
    stationTextLineGap.addEventListener("change", onTextLineGapChanged);

    stationManagerModal.hidden = true;
  }

  function open() {
    if (!stationManagerModal) {
      return;
    }

    state.stationManager.isOpen = true;
    stationManagerModal.hidden = false;
    ensureSelectedPreset();
    resetPreviewView(getSelectedPreset());
    renderStationManager();
  }

  function close() {
    if (!stationManagerModal) {
      return;
    }

    state.stationManager.isOpen = false;
    stationManagerModal.hidden = true;
    stopPreviewPanning();
  }

  function renderStationManager() {
    renderStationLibraryList();
    syncTabVisibility();

    const preset = getSelectedPreset();
    stationShapeSearchInput.value = state.stationManager.shapeQuery || "";
    stationParamTypeSelect.value = shapeParameterTypeDefinitions[state.stationManager.paramType]
      ? state.stationManager.paramType
      : "color";

    if (!preset) {
      stationPresetNameInput.value = "";
      stationShapeSelect.innerHTML = "";
      stationTextCardList.innerHTML = "<div class=\"kv\">暂无文本卡片。</div>";
      renderTextPlacementPanel(null);
      renderParamsPanel(null);
      renderPreview(null);
      return;
    }

    stationPresetNameInput.value = preset.name || "";
    renderShapeSelect();
    renderTextCards(preset);
    renderTextPlacementPanel(preset);
    renderParamsPanel(preset);
    renderPreview(preset);
  }

  function renderStationLibraryList() {
    stationLibraryList.innerHTML = "";

    if (!Array.isArray(state.stationLibrary) || !state.stationLibrary.length) {
      const empty = document.createElement("div");
      empty.className = "kv";
      empty.textContent = "车站库为空，请先新建。";
      stationLibraryList.appendChild(empty);
      return;
    }

    state.stationLibrary.forEach((preset) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "line-library-item";
      item.classList.toggle("active", preset.id === state.stationManager.selectedId);

      const row = document.createElement("div");
      row.className = "line-library-item-row";

      const title = document.createElement("span");
      title.className = "line-library-item-title";
      title.textContent = preset.name || "未命名车站";
      row.appendChild(title);

      const previewSrc = buildLibraryPreviewDataUrl(preset);
      if (previewSrc) {
        const preview = document.createElement("img");
        preview.className = "shape-library-preview-inline station-library-preview-inline";
        preview.alt = `${preset.name || "车站"} 预览`;
        preview.src = previewSrc;
        row.appendChild(preview);
      } else {
        const previewPlaceholder = document.createElement("span");
        previewPlaceholder.className = "station-library-preview-placeholder";
        previewPlaceholder.textContent = "-";
        row.appendChild(previewPlaceholder);
      }

      item.appendChild(row);

      item.addEventListener("click", () => {
        state.stationManager.selectedId = preset.id;
        renderStationManager();
      });

      stationLibraryList.appendChild(item);
    });
  }

  function buildLibraryPreviewDataUrl(preset) {
    const shape = getShapeById(preset?.shapeId);
    if (!shape) {
      return "";
    }

    const runtimeParams = buildStationRuntimeParamMap({
      preset,
      shape,
      stationParamValues: null
    });
    const svgText = buildRenderableShapeSvg(shape, buildShapeParamValuesFromRuntime(shape, runtimeParams));
    if (!svgText) {
      return "";
    }

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svgText))}`;
  }

  function renderShapeSelect() {
    const preset = getSelectedPreset();
    stationShapeSelect.innerHTML = "";

    if (!preset) {
      return;
    }

    const query = String(state.stationManager.shapeQuery || "").trim().toLowerCase();
    const shapes = (Array.isArray(state.shapeLibrary) ? state.shapeLibrary : []).filter((shape) => {
      if (!shape || typeof shape !== "object") {
        return false;
      }
      if (!query) {
        return true;
      }
      return String(shape.name || "").toLowerCase().includes(query);
    });

    if (!shapes.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "无可用图形";
      stationShapeSelect.appendChild(option);
      stationShapeSelect.disabled = true;
      return;
    }

    stationShapeSelect.disabled = false;

    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "请选择图形";
    stationShapeSelect.appendChild(emptyOption);

    shapes.forEach((shape) => {
      const option = document.createElement("option");
      option.value = shape.id;
      option.textContent = shape.name;
      stationShapeSelect.appendChild(option);
    });

    if (preset.shapeId && shapes.some((shape) => shape.id === preset.shapeId)) {
      stationShapeSelect.value = preset.shapeId;
    } else {
      stationShapeSelect.value = "";
    }
  }

  function renderTextCards(preset) {
    stationTextCardList.innerHTML = "";

    const cards = normalizeStationTextCards(preset?.textCards, createStationPresetId);
    if (preset) {
      preset.textCards = cards;
      ensureSelectedTextCard(preset);
    }

    const shape = getShapeById(preset?.shapeId);
    const paramOptions = buildStationTextParamOptions({ preset, shape });
    const colorParamOptions = paramOptions.filter((item) => item.type === "color");
    const numberParamOptions = paramOptions.filter((item) => item.type === "number");

    if (!cards.length) {
      const empty = document.createElement("div");
      empty.className = "kv";
      empty.textContent = "暂无文本卡片。";
      stationTextCardList.appendChild(empty);
      return;
    }

    cards.forEach((card, index) => {
      const item = document.createElement("div");
      item.className = "station-text-card shape-param-item";
      item.setAttribute("data-text-card-id", card.id);
      item.classList.toggle("active", card.id === state.stationManager.selectedTextCardId);

      const head = document.createElement("div");
      head.className = "station-text-card-head";

      const indexBadge = document.createElement("span");
      indexBadge.className = "station-text-card-index";
      indexBadge.textContent = `#${index + 1}`;
      head.appendChild(indexBadge);

      const tools = document.createElement("div");
      tools.className = "station-text-card-tools";

      const drag = document.createElement("button");
      drag.type = "button";
      drag.className = "btn-ghost station-text-drag";
      drag.innerHTML = '<img src="/img/icon-drag-vertical.svg" alt="拖动" />';
      drag.setAttribute("aria-label", "拖动");
      drag.title = "拖拽调整顺序";
      drag.setAttribute("draggable", "true");
      tools.appendChild(drag);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn-ghost param-remove-btn";
      removeBtn.textContent = "删除";
      removeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        removeTextCard(card.id);
      });
      tools.appendChild(removeBtn);
      head.appendChild(tools);
      item.appendChild(head);

      const descField = document.createElement("label");
      descField.className = "station-text-card-field";
      const descLabel = document.createElement("span");
      descLabel.textContent = "文本描述";
      const descInput = document.createElement("input");
      descInput.type = "text";
      descInput.value = card.label;
      descInput.addEventListener("change", () => {
        mutateSelectedTextCard(card.id, (liveCard) => {
          liveCard.label = String(descInput.value || `文本 ${index + 1}`).trim() || `文本 ${index + 1}`;
        });
        descInput.value = getSelectedTextCard(preset)?.label || descInput.value;
        persistStationLibrary();
        renderSubmenu?.();
      });
      descField.appendChild(descLabel);
      descField.appendChild(descInput);
      item.appendChild(descField);

      const valueField = document.createElement("label");
      valueField.className = "station-text-card-field";
      const valueLabel = document.createElement("span");
      valueLabel.textContent = "默认值";
      const valueInput = document.createElement("textarea");
      valueInput.value = String(card.defaultValue || "");
      valueInput.addEventListener("input", () => {
        mutateSelectedTextCard(card.id, (liveCard) => {
          liveCard.defaultValue = String(valueInput.value || "");
        });
        persistStationLibrary();
        renderPreview(preset);
        renderSubmenu?.();
      });
      valueField.appendChild(valueLabel);
      valueField.appendChild(valueInput);
      item.appendChild(valueField);

      const colorBindingField = document.createElement("div");
      colorBindingField.className = "station-text-card-field";
      const colorBindingLabel = document.createElement("span");
      colorBindingLabel.textContent = "颜色";
      colorBindingField.appendChild(colorBindingLabel);

      const colorModeRow = document.createElement("div");
      colorModeRow.className = "station-binding-row";
      const colorMode = document.createElement("select");
      colorMode.innerHTML = "<option value=\"value\">固定值</option><option value=\"param\">参数引用</option>";
      colorMode.value = card.colorBinding?.mode === "param" ? "param" : "value";
      const colorValue = document.createElement("input");
      colorValue.type = "color";
      colorValue.value = safeColor(card.colorBinding?.value || "#000000");
      const colorParam = document.createElement("select");
      colorParam.innerHTML = colorParamOptions.length
        ? colorParamOptions.map((option) => `<option value=\"${option.id}\">${option.label}</option>`).join("")
        : "<option value=\"\">无可用颜色参数</option>";
      colorParam.value = colorParamOptions.some((option) => option.id === card.colorBinding?.paramId)
        ? card.colorBinding.paramId
        : (colorParamOptions[0]?.id || "");
      colorModeRow.appendChild(colorMode);
      colorModeRow.appendChild(colorValue);
      colorModeRow.appendChild(colorParam);
      colorBindingField.appendChild(colorModeRow);

      const syncColorBindingView = () => {
        const useParam = colorMode.value === "param";
        colorValue.hidden = useParam;
        colorValue.disabled = useParam;
        colorParam.hidden = !useParam;
        colorParam.disabled = !useParam;
      };

      const applyColorBinding = () => {
        mutateSelectedTextCard(card.id, (liveCard) => {
          liveCard.colorBinding = normalizeTextBinding({
            mode: colorMode.value,
            value: colorValue.value,
            paramId: colorParam.value
          }, "color", "#000000");
        });
        syncColorBindingView();
        persistStationLibrary();
        renderPreview(preset);
      };

      colorMode.addEventListener("change", applyColorBinding);
      colorValue.addEventListener("input", applyColorBinding);
      colorParam.addEventListener("change", applyColorBinding);
      syncColorBindingView();
      item.appendChild(colorBindingField);

      const fontField = document.createElement("label");
      fontField.className = "station-text-card-field";
      const fontLabel = document.createElement("span");
      fontLabel.textContent = "字体";
      const fontSelect = document.createElement("select");
      fontSelect.innerHTML = getStationTextFontOptions()
        .map((name) => `<option value=\"${name}\">${name}</option>`)
        .join("");
      fontSelect.value = card.fontFamily || "Segoe UI";
      fontSelect.addEventListener("change", () => {
        mutateSelectedTextCard(card.id, (liveCard) => {
          liveCard.fontFamily = fontSelect.value;
        });
        persistStationLibrary();
        renderPreview(preset);
      });
      fontField.appendChild(fontLabel);
      fontField.appendChild(fontSelect);
      item.appendChild(fontField);

      const fontSizeField = document.createElement("div");
      fontSizeField.className = "station-text-card-field";
      const fontSizeLabel = document.createElement("span");
      fontSizeLabel.textContent = "文字大小";
      fontSizeField.appendChild(fontSizeLabel);

      const sizeModeRow = document.createElement("div");
      sizeModeRow.className = "station-binding-row";
      const sizeMode = document.createElement("select");
      sizeMode.innerHTML = "<option value=\"value\">固定值</option><option value=\"param\">参数引用</option>";
      sizeMode.value = card.fontSizeBinding?.mode === "param" ? "param" : "value";
      const sizeValue = document.createElement("input");
      sizeValue.type = "number";
      sizeValue.step = "0.1";
      sizeValue.min = "1";
      sizeValue.value = String(Number(card.fontSizeBinding?.value) || 18);
      const sizeParam = document.createElement("select");
      sizeParam.innerHTML = numberParamOptions.length
        ? numberParamOptions.map((option) => `<option value=\"${option.id}\">${option.label}</option>`).join("")
        : "<option value=\"\">无可用数字参数</option>";
      sizeParam.value = numberParamOptions.some((option) => option.id === card.fontSizeBinding?.paramId)
        ? card.fontSizeBinding.paramId
        : (numberParamOptions[0]?.id || "");
      sizeModeRow.appendChild(sizeMode);
      sizeModeRow.appendChild(sizeValue);
      sizeModeRow.appendChild(sizeParam);
      fontSizeField.appendChild(sizeModeRow);

      const syncFontSizeBindingView = () => {
        const useParam = sizeMode.value === "param";
        sizeValue.hidden = useParam;
        sizeValue.disabled = useParam;
        sizeParam.hidden = !useParam;
        sizeParam.disabled = !useParam;
      };

      const applyFontSizeBinding = () => {
        mutateSelectedTextCard(card.id, (liveCard) => {
          liveCard.fontSizeBinding = normalizeTextBinding({
            mode: sizeMode.value,
            value: Number(sizeValue.value) || 18,
            paramId: sizeParam.value
          }, "number", 18);
        });
        syncFontSizeBindingView();
        persistStationLibrary();
        renderPreview(preset);
      };

      sizeMode.addEventListener("change", applyFontSizeBinding);
      sizeValue.addEventListener("input", applyFontSizeBinding);
      sizeParam.addEventListener("change", applyFontSizeBinding);
      syncFontSizeBindingView();
      item.appendChild(fontSizeField);

      head.addEventListener("click", () => {
        selectTextCard(preset, card.id);
      });

      item.addEventListener("focusin", () => {
        selectTextCard(preset, card.id, { rerenderCards: false });
      });

      drag.addEventListener("dragstart", (event) => {
        state.stationManager.dragTextCardId = card.id;
        item.classList.add("dragging");
        event.dataTransfer?.setData("text/plain", card.id);
        event.dataTransfer.effectAllowed = "move";
      });

      drag.addEventListener("dragend", () => {
        state.stationManager.dragTextCardId = null;
        stationTextCardList.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
        item.classList.remove("dragging");
      });

      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (state.stationManager.dragTextCardId && state.stationManager.dragTextCardId !== card.id) {
          item.classList.add("drop-target");
        }
      });

      item.addEventListener("dragleave", () => {
        item.classList.remove("drop-target");
      });

      item.addEventListener("drop", (event) => {
        event.preventDefault();
        item.classList.remove("drop-target");
        reorderTextCards(preset, state.stationManager.dragTextCardId, card.id);
      });

      stationTextCardList.appendChild(item);
    });

    updateActiveTextCardStyles();
  }

  function selectTextCard(preset, cardId, options = {}) {
    const { rerenderCards = true } = options;
    if (!preset || !cardId) {
      return;
    }

    state.stationManager.selectedTextCardId = cardId;
    if (rerenderCards) {
      renderTextCards(preset);
    } else {
      updateActiveTextCardStyles();
    }
    renderTextPlacementPanel(preset);
  }

  function updateActiveTextCardStyles() {
    const selectedId = state.stationManager.selectedTextCardId;
    stationTextCardList.querySelectorAll("[data-text-card-id]").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-text-card-id") === selectedId);
    });
  }

  function mutateSelectedTextCard(cardId, mutator) {
    const preset = getSelectedPreset();
    if (!preset || !cardId || typeof mutator !== "function") {
      return;
    }

    preset.textCards = normalizeStationTextCards(preset.textCards, createStationPresetId);
    const card = preset.textCards.find((item) => item.id === cardId);
    if (!card) {
      return;
    }

    mutator(card, preset);
  }

  function ensureSelectedTextCard(preset) {
    const cards = normalizeStationTextCards(preset?.textCards, createStationPresetId);
    preset.textCards = cards;

    const current = cards.find((card) => card.id === state.stationManager.selectedTextCardId);
    if (current) {
      return current;
    }

    state.stationManager.selectedTextCardId = cards[0]?.id || null;
    return cards[0] || null;
  }

  function getSelectedTextCard(preset) {
    const cards = normalizeStationTextCards(preset?.textCards, createStationPresetId);
    preset.textCards = cards;
    return cards.find((card) => card.id === state.stationManager.selectedTextCardId) || null;
  }

  function addTextCard() {
    const preset = getSelectedPreset();
    if (!preset) {
      return;
    }

    const cards = normalizeStationTextCards(preset.textCards, createStationPresetId);
    const card = createDefaultStationTextCard(cards.length, createStationPresetId);
    cards.push(card);
    preset.textCards = cards;
    state.stationManager.selectedTextCardId = card.id;

    persistStationLibrary();
    renderTextCards(preset);
    renderTextPlacementPanel(preset);
    renderPreview(preset);
    renderSubmenu?.();
  }

  function removeTextCard(cardId) {
    const preset = getSelectedPreset();
    if (!preset) {
      return;
    }

    const cards = normalizeStationTextCards(preset.textCards, createStationPresetId)
      .filter((card) => card.id !== cardId);
    preset.textCards = cards.length ? cards : [createDefaultStationTextCard(0, createStationPresetId)];

    if (!preset.textCards.some((card) => card.id === state.stationManager.selectedTextCardId)) {
      state.stationManager.selectedTextCardId = preset.textCards[0]?.id || null;
    }

    persistStationLibrary();
    renderTextCards(preset);
    renderTextPlacementPanel(preset);
    renderPreview(preset);
    renderSubmenu?.();
  }

  function reorderTextCards(preset, fromId, toId) {
    if (!preset || !fromId || !toId || fromId === toId) {
      return;
    }

    const cards = normalizeStationTextCards(preset.textCards, createStationPresetId);
    const fromIndex = cards.findIndex((card) => card.id === fromId);
    const toIndex = cards.findIndex((card) => card.id === toId);
    if (fromIndex < 0 || toIndex < 0) {
      return;
    }

    const [moved] = cards.splice(fromIndex, 1);
    cards.splice(toIndex, 0, moved);
    preset.textCards = cards;
    state.stationManager.selectedTextCardId = moved.id;

    persistStationLibrary();
    renderTextCards(preset);
    renderTextPlacementPanel(preset);
    renderPreview(preset);
  }

  function renderTextPlacementPanel(preset) {
    if (!preset) {
      stationPlacementTitle.textContent = "文字位置";
      stationPositionGrid.querySelectorAll("button[data-slot]").forEach((button) => {
        button.classList.remove("active");
        button.disabled = true;
      });
      stationTextDistanceMode.disabled = true;
      stationTextDistanceValue.disabled = true;
      stationTextDistanceParamSelect.disabled = true;
      stationTextLineGap.disabled = true;
      stationTextDistanceParamSelect.innerHTML = "<option value=\"\">暂无数字参数</option>";
      return;
    }

    ensureSelectedTextCard(preset);

    stationPlacementTitle.textContent = "文字位置";
    preset.textPlacement = normalizeStationTextPlacement(preset.textPlacement || {
      slot: preset.textCards?.[0]?.placement?.slot,
      distanceBinding: preset.textCards?.[0]?.placement?.distanceBinding,
      lineGap: 4
    });
    const slot = normalizeTextSlot(preset.textPlacement.slot);
    stationPositionGrid.querySelectorAll("button[data-slot]").forEach((button) => {
      const isActive = button.getAttribute("data-slot") === slot;
      button.classList.toggle("active", isActive);
      button.disabled = false;
    });

    const shape = getShapeById(preset.shapeId);
    const options = buildStationTextParamOptions({ preset, shape }).filter((item) => item.type === "number");
    stationTextDistanceParamSelect.innerHTML = options.length
      ? options.map((option) => `<option value=\"${option.id}\">${option.label}</option>`).join("")
      : "<option value=\"\">暂无数字参数</option>";

    const distanceBinding = normalizeTextBinding(preset.textPlacement?.distanceBinding, "number", 18);
    preset.textPlacement = {
      slot,
      distanceBinding,
      lineGap: Number.isFinite(Number(preset.textPlacement?.lineGap))
        ? Number(preset.textPlacement.lineGap)
        : 4
    };

    stationTextDistanceMode.disabled = false;
    stationTextDistanceMode.value = distanceBinding.mode;
    stationTextDistanceValue.value = Number.isFinite(Number(distanceBinding.value))
      ? String(Number(distanceBinding.value))
      : "18";
    stationTextLineGap.disabled = false;
    stationTextLineGap.value = Number.isFinite(Number(preset.textPlacement.lineGap))
      ? String(Number(preset.textPlacement.lineGap))
      : "4";
    stationTextDistanceParamSelect.value = options.some((item) => item.id === distanceBinding.paramId)
      ? distanceBinding.paramId
      : (options[0]?.id || "");

    const useParam = stationTextDistanceMode.value === "param";
    stationTextDistanceValue.disabled = useParam;
    stationTextDistanceParamSelect.disabled = !useParam || !options.length;
  }

  function onPositionGridClicked(event) {
    const button = event.target.closest("button[data-slot]");
    if (!button) {
      return;
    }

    const preset = getSelectedPreset();
    if (!preset) {
      return;
    }

    preset.textPlacement = normalizeStationTextPlacement(preset.textPlacement);
    preset.textPlacement.slot = normalizeTextSlot(button.getAttribute("data-slot"));
    persistStationLibrary();
    renderTextPlacementPanel(preset);
    renderPreview(preset);
  }

  function onTextDistanceChanged() {
    const preset = getSelectedPreset();
    if (!preset) {
      return;
    }

    preset.textPlacement = normalizeStationTextPlacement(preset.textPlacement);
    preset.textPlacement.distanceBinding = normalizeTextBinding({
      mode: stationTextDistanceMode.value,
      value: Number(stationTextDistanceValue.value) || 18,
      paramId: stationTextDistanceParamSelect.value
    }, "number", 18);

    persistStationLibrary();
    renderTextPlacementPanel(preset);
    renderPreview(preset);
  }

  function onTextLineGapChanged() {
    const preset = getSelectedPreset();
    if (!preset) {
      return;
    }

    preset.textPlacement = normalizeStationTextPlacement(preset.textPlacement);
    preset.textPlacement.lineGap = Number.isFinite(Number(stationTextLineGap.value))
      ? Number(stationTextLineGap.value)
      : 0;

    persistStationLibrary();
    renderTextPlacementPanel(preset);
    renderPreview(preset);
  }

  function renderPreview(preset) {
    if (!stationPreviewCanvas) {
      return;
    }

    stationPreviewCanvas.innerHTML = "";
    const vb = getPreviewViewBox();
    stationPreviewCanvas.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);

    const background = document.createElementNS(svgNs, "rect");
    background.setAttribute("x", String(vb.x - vb.width));
    background.setAttribute("y", String(vb.y - vb.height));
    background.setAttribute("width", String(vb.width * 3));
    background.setAttribute("height", String(vb.height * 3));
    background.setAttribute("fill", "#ffffff");
    stationPreviewCanvas.appendChild(background);

    if (!preset) {
      appendPreviewPlaceholder("暂无预设，请先新建。");
      return;
    }

    const shape = getShapeById(preset.shapeId);
    if (!shape || !shape.svg) {
      appendPreviewPlaceholder("未选择图形");
      return;
    }

    const runtimeParams = buildStationRuntimeParamMap({
      preset,
      shape,
      stationParamValues: null
    });
    const shapeSvg = buildRenderableShapeSvg(shape, buildShapeParamValuesFromRuntime(shape, runtimeParams));
    const parsed = parseSvgDocument(shapeSvg);
    if (!parsed) {
      appendPreviewPlaceholder("图形数据无效");
      return;
    }

    const centerX = parsed.viewBox ? parsed.viewBox.x + parsed.viewBox.width / 2 : 120;
    const centerY = parsed.viewBox ? parsed.viewBox.y + parsed.viewBox.height / 2 : 120;

    const layer = document.createElementNS(svgNs, "g");
    layer.setAttribute(
      "transform",
      `translate(${centerX} ${centerY}) scale(${previewInitialScale}) translate(${-centerX} ${-centerY})`
    );
    Array.from(parsed.root.children).forEach((child) => {
      const tag = child.tagName.toLowerCase();
      if (tag === "script" || tag === "foreignobject") {
        return;
      }

      const clone = child.cloneNode(true);
      layer.appendChild(stationPreviewCanvas.ownerDocument.importNode(clone, true));
    });
    stationPreviewCanvas.appendChild(layer);

    appendStationTexts({
      container: stationPreviewCanvas,
      preset,
      runtimeParamMap: runtimeParams,
      centerX,
      centerY,
      pointerEvents: "none"
    });
  }

  function createEmptyPreset() {
    const primaryCard = {
      ...createDefaultStationTextCard(0, createStationPresetId),
      defaultValue: "站名"
    };

    const preset = {
      id: createStationPresetId(),
      name: `车站预设 ${state.stationLibrary.length + 1}`,
      shapeId: null,
      textCards: [primaryCard],
      textPlacement: createDefaultStationTextPlacement(),
      radius: 12,
      oval: false,
      shapeParamSettings: {},
      params: []
    };

    state.stationLibrary.push(preset);
    state.stationManager.selectedId = preset.id;
    persistStationLibrary();
    resetPreviewView(preset);
    renderStationManager();
    renderSubmenu?.();
  }

  function ensureStationManagerState() {
    if (!state.stationManager || typeof state.stationManager !== "object") {
      state.stationManager = {};
    }

    state.stationManager.selectedId = state.stationManager.selectedId || null;
    state.stationManager.isOpen = Boolean(state.stationManager.isOpen);
    state.stationManager.shapeQuery = String(state.stationManager.shapeQuery || "");
    state.stationManager.paramType = shapeParameterTypeDefinitions[state.stationManager.paramType]
      ? state.stationManager.paramType
      : "color";
    state.stationManager.selectedTextCardId = state.stationManager.selectedTextCardId || null;
    state.stationManager.dragTextCardId = null;
    state.stationManager.activeTab = state.stationManager.activeTab === "params"
      ? "params"
      : "text";

    const vb = state.stationManager.previewViewBox;
    if (!vb || !Number.isFinite(vb.x) || !Number.isFinite(vb.y) || !Number.isFinite(vb.width) || !Number.isFinite(vb.height)) {
      state.stationManager.previewViewBox = { ...previewDefaultViewBox };
    }
    previewState.viewBox = { ...state.stationManager.previewViewBox };
  }

  function syncTabVisibility() {
    const textActive = state.stationManager.activeTab !== "params";
    stationTabTextBtn.classList.toggle("active", textActive);
    stationTabParamsBtn.classList.toggle("active", !textActive);
    stationTextPanel.hidden = !textActive;
    stationParamsPanel.hidden = textActive;
  }

  function renderParamsPanel(preset) {
    renderCustomParamList(preset);
    renderExistingParamList(preset);
  }

  function renderCustomParamList(preset) {
    stationCustomParamList.innerHTML = "";
    if (!preset) {
      stationCustomParamList.innerHTML = "<div class=\"shape-param-item\">请先创建或选择车站预设。</div>";
      return;
    }

    const params = normalizeShapeParameters(preset.params);
    preset.params = params;
    if (!params.length) {
      stationCustomParamList.innerHTML = "<div class=\"shape-param-item\">暂无自定义参数。</div>";
      return;
    }

    params.forEach((param, index) => {
      const row = document.createElement("div");
      row.className = "shape-param-item";

      const head = document.createElement("div");
      head.className = "shape-param-head";

      const typeBadge = document.createElement("span");
      typeBadge.className = "shape-param-type";
      typeBadge.textContent = shapeParameterTypeDefinitions[param.type]?.label || "参数";
      head.appendChild(typeBadge);

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-ghost param-remove-btn";
      removeBtn.type = "button";
      removeBtn.textContent = "删除";
      removeBtn.addEventListener("click", () => {
        preset.params = normalizeShapeParameters(preset.params);
        preset.params.splice(index, 1);
        persistStationLibrary();
        renderParamsPanel(preset);
      });
      head.appendChild(removeBtn);

      row.appendChild(head);

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.value = param.label;
      labelInput.placeholder = "参数名称";
      labelInput.addEventListener("change", () => {
        param.label = String(labelInput.value || "参数").trim() || "参数";
        labelInput.value = param.label;
        persistStationLibrary();
        renderParamsPanel(preset);
      });
      row.appendChild(labelInput);

      const defaultBlock = document.createElement("div");
      defaultBlock.className = "shape-param-default";
      const defaultLabel = document.createElement("span");
      defaultLabel.className = "shape-param-default-label";
      defaultLabel.textContent = "默认值";
      defaultBlock.appendChild(defaultLabel);

      const input = createParameterInput(param.type, param.defaultValue, (value) => {
        param.defaultValue = value;
        persistStationLibrary();
      });
      defaultBlock.appendChild(input);
      row.appendChild(defaultBlock);

      stationCustomParamList.appendChild(row);
    });
  }

  function renderExistingParamList(preset) {
    stationExistingParamList.innerHTML = "";
    if (!preset) {
      stationExistingParamList.innerHTML = "<div class=\"shape-prop-empty\">请先创建或选择车站预设。</div>";
      return;
    }

    const shape = getShapeById(preset.shapeId);
    if (!shape) {
      stationExistingParamList.innerHTML = "<div class=\"shape-prop-empty\">请选择图形后查看已有参数。</div>";
      return;
    }

    const shapeParams = normalizeShapeParameters(shape.parameters);
    if (!shapeParams.length) {
      stationExistingParamList.innerHTML = "<div class=\"shape-prop-empty\">所选图形没有参数可复用。</div>";
      return;
    }

    if (!preset.shapeParamSettings || typeof preset.shapeParamSettings !== "object") {
      preset.shapeParamSettings = {};
    }

    shapeParams.forEach((param) => {
      const row = document.createElement("div");
      row.className = "station-existing-param-item shape-prop-item";

      const head = document.createElement("div");
      head.className = "shape-param-head";

      const title = document.createElement("span");
      title.className = "shape-prop-label";
      title.textContent = param.label;
      head.appendChild(title);

      const typeBadge = document.createElement("span");
      typeBadge.className = "shape-param-type";
      typeBadge.textContent = shapeParameterTypeDefinitions[param.type]?.label || "参数";
      head.appendChild(typeBadge);

      row.appendChild(head);

      const modeWrap = document.createElement("label");
      modeWrap.className = "station-param-mode-row";
      const modeText = document.createElement("span");
      modeText.textContent = "模式";
      const modeSelect = document.createElement("select");
      modeSelect.innerHTML = `
        <option value="inherit">跟随图形默认</option>
        <option value="default">重设默认值</option>
        <option value="locked">锁定参数值</option>
      `;

      const setting = preset.shapeParamSettings[param.id];
      const mode = setting?.mode === "default" || setting?.mode === "locked"
        ? setting.mode
        : "inherit";
      modeSelect.value = mode;
      modeWrap.appendChild(modeText);
      modeWrap.appendChild(modeSelect);
      row.appendChild(modeWrap);

      const valueWrap = document.createElement("div");
      valueWrap.className = "shape-param-default";
      const valueLabel = document.createElement("span");
      valueLabel.className = "shape-param-default-label";
      valueLabel.textContent = mode === "locked" ? "锁定值" : "参数值";
      valueWrap.appendChild(valueLabel);

      const resolvedValue = mode === "inherit"
        ? param.defaultValue
        : normalizeShapeParameterDefault(param.type, setting?.value);
      const valueInput = createParameterInput(param.type, resolvedValue, (value) => {
        if (modeSelect.value === "inherit") {
          return;
        }

        preset.shapeParamSettings[param.id] = {
          mode: modeSelect.value,
          value: normalizeShapeParameterDefault(param.type, value)
        };
        persistStationLibrary();
        renderPreview(preset);
      });
      setParameterInputEnabled(valueInput, mode !== "inherit");
      valueWrap.appendChild(valueInput);
      row.appendChild(valueWrap);

      modeSelect.addEventListener("change", () => {
        const nextMode = modeSelect.value;
        valueLabel.textContent = nextMode === "locked" ? "锁定值" : "参数值";

        if (nextMode === "inherit") {
          delete preset.shapeParamSettings[param.id];
          setParameterInputValue(valueInput, param.type, param.defaultValue);
          setParameterInputEnabled(valueInput, false);
        } else {
          const current = readParameterInputValue(valueInput, param.type, param.defaultValue);
          preset.shapeParamSettings[param.id] = {
            mode: nextMode,
            value: normalizeShapeParameterDefault(param.type, current)
          };
          setParameterInputEnabled(valueInput, true);
        }

        persistStationLibrary();
        renderPreview(preset);
      });

      stationExistingParamList.appendChild(row);
    });
  }

  function addCustomParameter(type) {
    const preset = getSelectedPreset();
    if (!preset) {
      return;
    }

    const normalizedType = shapeParameterTypeDefinitions[type] ? type : "text";
    const definition = shapeParameterTypeDefinitions[normalizedType] || shapeParameterTypeDefinitions.text;
    const nextNo = Array.isArray(preset.params) ? preset.params.length + 1 : 1;

    if (!Array.isArray(preset.params)) {
      preset.params = [];
    }

    preset.params.push({
      id: createStationPresetId(),
      type: normalizedType,
      label: `${definition.label} ${nextNo}`,
      defaultValue: normalizeShapeParameterDefault(normalizedType, definition.defaultValue),
      conditions: [],
      extensions: {}
    });

    persistStationLibrary();
    renderParamsPanel(preset);
  }

  function createParameterInput(type, value, onValueChanged) {
    if (type === "color") {
      const input = document.createElement("input");
      input.type = "color";
      input.value = safeColor(value || "#2f5d9d");
      input.addEventListener("input", () => {
        onValueChanged(safeColor(input.value));
      });
      input.addEventListener("change", () => {
        onValueChanged(safeColor(input.value));
      });
      return input;
    }

    if (type === "number") {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.1";
      input.value = String(toNumber(value, 0));
      input.addEventListener("input", () => {
        const normalized = normalizeNumber(input.value, 0, -100000, 100000);
        input.value = String(normalized);
        onValueChanged(normalized);
      });
      input.addEventListener("change", () => {
        const normalized = normalizeNumber(input.value, 0, -100000, 100000);
        input.value = String(normalized);
        onValueChanged(normalized);
      });
      return input;
    }

    if (type === "checkbox") {
      const wrapper = document.createElement("label");
      wrapper.className = "toggle-switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "toggle-checkbox";
      input.checked = Boolean(value);
      const slider = document.createElement("span");
      slider.className = "toggle-slider";
      slider.setAttribute("aria-hidden", "true");
      input.addEventListener("change", () => {
        onValueChanged(Boolean(input.checked));
      });
      wrapper.appendChild(input);
      wrapper.appendChild(slider);
      return wrapper;
    }

    const input = document.createElement("input");
    input.type = "text";
    input.value = String(value || "");
    input.addEventListener("input", () => {
      onValueChanged(String(input.value || ""));
    });
    input.addEventListener("change", () => {
      onValueChanged(String(input.value || ""));
    });
    return input;
  }

  function setParameterInputEnabled(input, enabled) {
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement) {
      input.disabled = !enabled;
      return;
    }

    if (input instanceof Element) {
      input.querySelectorAll("input,select,textarea").forEach((el) => {
        el.disabled = !enabled;
      });
    }
  }

  function setParameterInputValue(input, type, value) {
    if (type === "checkbox") {
      const checkbox = input instanceof HTMLInputElement
        ? input
        : input.querySelector("input[type='checkbox']");
      if (checkbox) {
        checkbox.checked = Boolean(value);
      }
      return;
    }

    const field = input instanceof HTMLInputElement
      ? input
      : input.querySelector("input");
    if (!field) {
      return;
    }

    if (type === "color") {
      field.value = safeColor(value || "#2f5d9d");
      return;
    }

    if (type === "number") {
      field.value = String(toNumber(value, 0));
      return;
    }

    field.value = String(value || "");
  }

  function readParameterInputValue(input, type, fallback) {
    if (type === "checkbox") {
      const checkbox = input instanceof HTMLInputElement
        ? input
        : input.querySelector("input[type='checkbox']");
      return checkbox ? Boolean(checkbox.checked) : Boolean(fallback);
    }

    const field = input instanceof HTMLInputElement
      ? input
      : input.querySelector("input");
    if (!field) {
      return fallback;
    }

    if (type === "color") {
      return safeColor(field.value || fallback || "#2f5d9d");
    }

    if (type === "number") {
      return normalizeNumber(field.value, toNumber(fallback, 0), -100000, 100000);
    }

    return String(field.value || fallback || "");
  }

  function ensureSelectedPreset() {
    if (!Array.isArray(state.stationLibrary) || !state.stationLibrary.length) {
      state.stationManager.selectedId = null;
      return;
    }

    const selected = getSelectedPreset();
    if (selected) {
      return;
    }

    state.stationManager.selectedId = state.stationLibrary[0].id;
  }

  function getSelectedPreset() {
    return (Array.isArray(state.stationLibrary) ? state.stationLibrary : [])
      .find((preset) => preset.id === state.stationManager.selectedId) || null;
  }

  function loadStationLibrary() {
    const stored = readStationLibrary();
    if (stored.length) {
      state.stationLibrary = stored;
    } else {
      state.stationLibrary = (Array.isArray(state.stationTypes) ? state.stationTypes : [])
        .map((type, index) => convertTypeToPreset(type, index));
      persistStationLibrary();
    }

    syncStationTypesFromLibrary();
    ensureSelectedPreset();
  }

  function persistStationLibrary() {
    try {
      const payload = (Array.isArray(state.stationLibrary) ? state.stationLibrary : [])
        .map((preset) => sanitizePreset(preset))
        .filter(Boolean);
      localStorage.setItem(stationStorageKey, JSON.stringify(payload));
      syncStationTypesFromLibrary();
    } catch {
      // Ignore localStorage quota/availability errors.
    }
  }

  function readStationLibrary() {
    try {
      const raw = localStorage.getItem(stationStorageKey);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map((preset) => sanitizePreset(preset)).filter(Boolean);
    } catch {
      return [];
    }
  }

  function sanitizePreset(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const cards = normalizeStationTextCards(raw.textCards, createStationPresetId);
    if (String(raw.label || "").trim() && !String(cards[0]?.defaultValue || "").trim()) {
      cards[0].defaultValue = String(raw.label || "").trim();
    }
    if (cards.length === 1 && cards[0].label === "主文本") {
      cards[0].label = "文本 1";
    }

    return {
      id: String(raw.id || createStationPresetId()),
      name: String(raw.name || "车站预设").trim() || "车站预设",
      shapeId: raw.shapeId ? String(raw.shapeId) : null,
      textCards: cards,
      textPlacement: normalizeStationTextPlacement(raw.textPlacement || {
        slot: raw.position,
        distanceBinding: Object.prototype.hasOwnProperty.call(raw, "distance")
          ? { mode: "value", value: raw.distance }
          : undefined
      }),
      radius: Number.isFinite(Number(raw.radius)) ? Number(raw.radius) : 12,
      oval: Boolean(raw.oval),
      shapeParamSettings: normalizeShapeParamSettings(raw.shapeParamSettings),
      params: Array.isArray(raw.params) ? structuredClone(raw.params) : []
    };
  }

  function convertTypeToPreset(type, index) {
    const primaryCard = {
      ...createDefaultStationTextCard(0, createStationPresetId),
      defaultValue: "站名"
    };

    return sanitizePreset({
      id: createStationPresetId(),
      name: String(type?.name || `车站类型 ${index + 1}`),
      shapeId: type?.shapeId ? String(type.shapeId) : null,
      textCards: [primaryCard],
      textPlacement: createDefaultStationTextPlacement(),
      radius: Number(type?.radius) || 12,
      oval: Boolean(type?.oval),
      shapeParamSettings: {},
      params: []
    });
  }

  function normalizeShapeParamSettings(raw) {
    if (!raw || typeof raw !== "object") {
      return {};
    }

    const normalized = {};
    Object.entries(raw).forEach(([paramId, setting]) => {
      if (!setting || typeof setting !== "object") {
        return;
      }

      const mode = setting.mode === "default" || setting.mode === "locked"
        ? setting.mode
        : null;
      if (!mode) {
        return;
      }

      normalized[String(paramId)] = {
        mode,
        value: setting.value
      };
    });

    return normalized;
  }

  function syncStationTypesFromLibrary() {
    state.stationTypes = (Array.isArray(state.stationLibrary) ? state.stationLibrary : []).map((preset, index) => ({
      name: preset.name,
      radius: Number.isFinite(Number(preset.radius)) ? Number(preset.radius) : 12,
      oval: Boolean(preset.oval),
      stationPresetId: preset.id,
      stationTypeIndex: index
    }));

    const length = state.stationTypes.length;
    if (!Number.isInteger(state.menuSelection?.station)) {
      return;
    }

    if (length <= 0) {
      state.menuSelection.station = null;
      return;
    }

    state.menuSelection.station = Math.max(0, Math.min(length - 1, state.menuSelection.station));
  }

  function getShapeById(id) {
    if (!id) {
      return null;
    }

    return (Array.isArray(state.shapeLibrary) ? state.shapeLibrary : []).find((shape) => shape.id === id) || null;
  }

  function appendPreviewPlaceholder(message) {
    const text = document.createElementNS(svgNs, "text");
    text.setAttribute("x", "120");
    text.setAttribute("y", "120");
    text.setAttribute("fill", "#7b8da8");
    text.setAttribute("font-size", "13");
    text.setAttribute("font-family", "Segoe UI");
    text.setAttribute("text-anchor", "middle");
    text.textContent = message;
    stationPreviewCanvas.appendChild(text);
  }

  function parseSvgDocument(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(svgText || ""), "image/svg+xml");
    if (doc.querySelector("parsererror")) {
      return null;
    }

    const root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== "svg") {
      return null;
    }

    return {
      root,
      viewBox: parseViewBox(root.getAttribute("viewBox"))
    };
  }

  function parseViewBox(value) {
    const values = String(value || "")
      .trim()
      .split(/[\s,]+/)
      .map((item) => Number(item));

    if (values.length !== 4 || values.some((item) => !Number.isFinite(item))) {
      return null;
    }

    const [x, y, width, height] = values;
    if (width <= 0 || height <= 0) {
      return null;
    }

    return { x, y, width, height };
  }

  function onPreviewMouseDown(event) {
    if (!state.stationManager.isOpen || event.button !== 0) {
      return;
    }

    previewState.isPanning = true;
    previewState.startClientX = event.clientX;
    previewState.startClientY = event.clientY;
    previewState.startViewBox = { ...getPreviewViewBox() };
    stationPreviewCanvasWrap.classList.add("panning");
    event.preventDefault();
  }

  function onWindowMouseMove(event) {
    if (!previewState.isPanning || !state.stationManager.isOpen) {
      return;
    }

    const rect = stationPreviewCanvas.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const start = previewState.startViewBox;
    const dx = ((event.clientX - previewState.startClientX) / rect.width) * start.width;
    const dy = ((event.clientY - previewState.startClientY) / rect.height) * start.height;

    previewState.viewBox = {
      x: start.x - dx,
      y: start.y - dy,
      width: start.width,
      height: start.height
    };
    state.stationManager.previewViewBox = { ...previewState.viewBox };
    renderPreview(getSelectedPreset());
  }

  function onWindowMouseUp() {
    stopPreviewPanning();
  }

  function stopPreviewPanning() {
    previewState.isPanning = false;
    stationPreviewCanvasWrap?.classList.remove("panning");
  }

  function onPreviewWheel(event) {
    if (!state.stationManager.isOpen) {
      return;
    }

    event.preventDefault();

    const current = getPreviewViewBox();
    const scaleFactor = event.deltaY < 0 ? 0.9 : 1.1;
    const nextWidth = Math.max(20, Math.min(2400, current.width * scaleFactor));
    const nextHeight = Math.max(20, Math.min(2400, current.height * scaleFactor));

    const focus = clientToPreviewPoint(event.clientX, event.clientY) || {
      x: current.x + current.width / 2,
      y: current.y + current.height / 2
    };

    const rx = (focus.x - current.x) / current.width;
    const ry = (focus.y - current.y) / current.height;

    previewState.viewBox = {
      x: focus.x - rx * nextWidth,
      y: focus.y - ry * nextHeight,
      width: nextWidth,
      height: nextHeight
    };
    state.stationManager.previewViewBox = { ...previewState.viewBox };
    renderPreview(getSelectedPreset());
  }

  function clientToPreviewPoint(clientX, clientY) {
    const ctm = stationPreviewCanvas.getScreenCTM();
    if (!ctm) {
      return null;
    }

    const point = stationPreviewCanvas.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  function getPreviewViewBox() {
    const vb = previewState.viewBox || previewDefaultViewBox;
    return {
      x: Number(vb.x) || 0,
      y: Number(vb.y) || 0,
      width: Math.max(20, Math.min(2400, Number(vb.width) || 240)),
      height: Math.max(20, Math.min(2400, Number(vb.height) || 240))
    };
  }

  function resetPreviewView(preset) {
    const shape = getShapeById(preset?.shapeId);
    if (!shape?.svg) {
      previewState.viewBox = { ...previewDefaultViewBox };
      state.stationManager.previewViewBox = { ...previewState.viewBox };
      return;
    }

    const parsed = parseSvgDocument(shape.svg);
    const vb = parsed?.viewBox;
    if (!vb) {
      previewState.viewBox = { ...previewDefaultViewBox };
      state.stationManager.previewViewBox = { ...previewState.viewBox };
      return;
    }

    const pad = 20;
    const baseViewBox = {
      x: vb.x - pad,
      y: vb.y - pad,
      width: Math.max(80, vb.width + pad * 2),
      height: Math.max(80, vb.height + pad * 2)
    };
    previewState.viewBox = { ...baseViewBox };
    state.stationManager.previewViewBox = { ...previewState.viewBox };
  }

  return {
    bind,
    open,
    close
  };
}
