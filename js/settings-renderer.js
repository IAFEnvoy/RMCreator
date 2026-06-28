import { geometryLabelMap } from "./constants.js";
import {
  applyTextInputStyle,
  clamp,
  escapeHtml,
  formatColorWithAlpha,
  normalizeColor,
  normalizeTextStyleFlags
} from "./utils.js";
import {
  autoCropSvg,
  buildRenderableShapeSvg,
  normalizeShapeParameterDefault,
  normalizeShapeParameters,
  resolveShapeParametersWithValues,
  shapeParameterTypeDefinitions
} from "./shape/utils.js";
import {
  buildStationRuntimeParamMap,
  normalizeStationTextContent,
  normalizeStationTextCards,
  normalizeTextSlot,
  resolveTextBindingValue
} from "./station/text-utils.js";
import { renderTemplate } from "./template-store.js";

export function createSettingsRenderer({
  state,
  settingsPanel,
  settingsBody,
  findLineType,
  getColorListDefault,
  ensureEdgeColorList,
  renderStations,
  renderLines,
  renderShapes,
  renderSubDrawings,
  renderTexts,
  moveLineInStack,
  applyStationType,
  getStationTypeIndexByStation,
  colorPicker,
  copySelection,
  duplicateSelection,
  deleteSelectedEntity,
  onStateChanged
}) {
  if (typeof state.paramClipboard === "undefined") {
    state.paramClipboard = null;
  }
  const feedbackTimers = new WeakMap();

  const flashButtonText = (button, message) => {
    if (!button) {
      return;
    }
    const durationSec = clamp(Number(state.appSettings?.feedbackDuration) || 0.63, 0, 5);
    if (durationSec <= 0) {
      return;
    }
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent || "";
    }
    button.textContent = message;

    const existing = feedbackTimers.get(button);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
      button.textContent = button.dataset.originalText || "";
      feedbackTimers.delete(button);
    }, durationSec * 1000);
    feedbackTimers.set(button, timer);
  };
  const getSelectionType = (entities) => {
    if (!Array.isArray(entities) || !entities.length) {
      return null;
    }
    const firstType = entities[0]?.type;
    if (!firstType) {
      return null;
    }
    return entities.every((item) => item.type === firstType) ? firstType : null;
  };

  const buildParamKey = (name, type) => `${String(type)}::${String(name)}`;

  const buildParamMap = (params) => {
    const map = new Map();
    (Array.isArray(params) ? params : []).forEach((param) => {
      const key = param.id || buildParamKey(param.name, param.type);
      if (!key) return;
      map.set(key, { value: param.value, expression: param.expression || "" });
    });
    return map;
  };

  const collectStationParams = (station) => {
    const params = [];
    const exprSource = station?.paramExpressions && typeof station.paramExpressions === "object"
      ? station.paramExpressions
      : {};
    const descriptors = buildStationParameterDescriptors(station);
    descriptors.forEach((descriptor) => {
      if (descriptor.locked) {
        return;
      }
      const value = normalizeShapeParameterDefault(
        descriptor.type,
        station.paramValues?.[descriptor.id]
      );
      params.push({
        name: descriptor.label || "参数",
        id: descriptor.id,
        type: descriptor.type,
        value,
        expression: exprSource[descriptor.id] || ""
      });
    });

    return params;
  };

  const collectLineParams = (edge) => {
    const exprSource = edge?.paramExpressions && typeof edge.paramExpressions === "object"
      ? edge.paramExpressions
      : {};

    const lineTypeOptions = state.lineTypes.map((type) => ({
      label: type.name,
      value: type.id
    }));
    const geometryOptions = Object.entries(geometryLabelMap).map(([value, label]) => ({
      label,
      value
    }));

    const params = [
      { name: "线条类型", id: "lineTypeId", type: "select", value: edge.lineTypeId, options: lineTypeOptions, expression: exprSource["lineTypeId"] || "" },
      { name: "几何类型", id: "geometry", type: "select", value: edge.geometry, options: geometryOptions, expression: exprSource["geometry"] || "" },
      { name: "翻转形状", id: "flip", type: "checkbox", value: Boolean(edge.flip), expression: exprSource["flip"] || "" },
      { name: "翻转颜色", id: "flipColor", type: "checkbox", value: Boolean(edge.flipColor), expression: exprSource["flipColor"] || "" },
      { name: "转弯圆弧半径", id: "cornerRadius", type: "number", value: Number(edge.cornerRadius) || 0, expression: exprSource["cornerRadius"] || "" },
      { name: "起点偏移量", id: "startOffset", type: "number", value: Number(edge.startOffset) || 0, expression: exprSource["startOffset"] || "" },
      { name: "终点偏移量", id: "endOffset", type: "number", value: Number(edge.endOffset) || 0, expression: exprSource["endOffset"] || "" }
    ];

    (Array.isArray(edge.colorList) ? edge.colorList : []).forEach((color, index) => {
      const colorKey = `color${index}`;
      params.push({ name: `颜色${index + 1}`, id: colorKey, type: "color", value: color, expression: exprSource[colorKey] || "" });
    });

    return params;
  };

  const collectTextParams = (label) => {
    const textStyle = normalizeTextStyleFlags(label);
    const exprSource = label?.paramExpressions && typeof label.paramExpressions === "object"
      ? label.paramExpressions
      : {};

    const fontOptions = [
      { label: "Segoe UI", value: "Segoe UI" },
      { label: "Microsoft YaHei", value: "Microsoft YaHei" },
      { label: "SimHei", value: "SimHei" },
      { label: "Arial", value: "Arial" },
      { label: "Times New Roman", value: "Times New Roman" },
      { label: "Courier New", value: "Courier New" }
    ];

    const params = [
      { name: "内容", id: "value", type: "text", value: label.value || "", expression: exprSource["value"] || "" },
      { name: "字体", id: "fontFamily", type: "select", value: label.fontFamily, options: fontOptions, expression: exprSource["fontFamily"] || "" },
      { name: "颜色", id: "color", type: "color", value: normalizeColor(label.color), expression: exprSource["color"] || "" },
      { name: "字号", id: "fontSize", type: "number", value: Number(label.fontSize) || 20, expression: exprSource["fontSize"] || "" }
    ];

    getTextStyleToolbarItems().forEach((item) => {
      params.push({ name: item.label, id: item.flag, type: "checkbox", value: Boolean(textStyle[item.flag]), expression: exprSource[item.flag] || "" });
    });

    return params;
  };

  const collectShapeParams = (shapeInstance) => {
    const exprSource = shapeInstance?.paramExpressions && typeof shapeInstance.paramExpressions === "object"
      ? shapeInstance.paramExpressions
      : {};

    const params = [
      { name: "缩放比例", id: "scale", type: "number", value: clamp(Number(shapeInstance.scale) || 1, 0.001, 10), expression: exprSource["scale"] || "" }
    ];
    const preset = state.shapeLibrary.find((item) => item.id === shapeInstance.shapeId);
    if (!preset) {
      return params;
    }
    const resolvedParams = resolveShapeParametersWithValues(preset, shapeInstance.paramValues || {});
    resolvedParams.forEach((param) => {
      const value = normalizeShapeParameterDefault(param.type, param.defaultValue);
      params.push({
        name: param.label || "参数",
        id: param.id,
        type: param.type,
        value,
        expression: exprSource[param.id] || ""
      });
    });
    return params;
  };

  const copyParamsFromSelection = () => {
    const selected = Array.isArray(state.selectedEntities) ? state.selectedEntities : [];
    if (selected.length !== 1) {
      window.alert("多选时无法复制参数。");
      return false;
    }
    const entity = selected[0];
    const type = entity.type;
    if (type === "station") {
      const station = state.nodes.find((item) => item.id === entity.id);
      if (!station) return false;
      state.paramClipboard = { type, params: collectStationParams(station) };
      return true;
    }
    if (type === "line") {
      const line = state.edges.find((item) => item.id === entity.id);
      if (!line) return false;
      state.paramClipboard = { type, params: collectLineParams(line) };
      return true;
    }
    if (type === "text") {
      const text = state.labels.find((item) => item.id === entity.id);
      if (!text) return false;
      state.paramClipboard = { type, params: collectTextParams(text) };
      return true;
    }
    if (type === "shape") {
      const shape = state.shapes.find((item) => item.id === entity.id);
      if (!shape) return false;
      state.paramClipboard = { type, params: collectShapeParams(shape) };
      return true;
    }
    return false;
  };

  const pasteParamsToSelection = () => {
    const parameterClipboard = state.paramClipboard;
    if (!parameterClipboard) {
      window.alert("暂无可黏贴的参数。");
      return false;
    }
    const selected = Array.isArray(state.selectedEntities) ? state.selectedEntities : [];
    if (!selected.length) {
      return false;
    }
    const selectionType = getSelectionType(selected);
    if (!selectionType || selectionType !== parameterClipboard.type) {
      window.alert("参数类型不匹配，无法黏贴。");
      return false;
    }

    const map = buildParamMap(parameterClipboard.params);

    if (selectionType === "station") {
      selected.forEach((entity) => {
        const station = state.nodes.find((item) => item.id === entity.id);
        if (!station) return;
        const descriptors = buildStationParameterDescriptors(station);
        descriptors.forEach((descriptor) => {
          if (descriptor.locked) return;
          const entry = map.get(descriptor.id);
          if (!entry) return;
          if (!station.paramValues || typeof station.paramValues !== "object") {
            station.paramValues = {};
          }
          station.paramValues[descriptor.id] = normalizeShapeParameterDefault(descriptor.type, entry.value);
          if (entry.expression) {
            if (!station.paramExpressions || typeof station.paramExpressions !== "object") {
              station.paramExpressions = {};
            }
            station.paramExpressions[descriptor.id] = entry.expression;
          }
        });
      });
      renderStations();
      renderLines();
      onStateChanged?.({ coalesceKey: "station-params-paste" });
      renderSettings();
      return true;
    }

    if (selectionType === "line") {
      selected.forEach((entity) => {
        const line = state.edges.find((item) => item.id === entity.id);
        if (!line) return;

        const lineTypeEntry = map.get("lineTypeId");
        if (lineTypeEntry) {
          const nextType = String(lineTypeEntry.value || "");
          const nextLineType = findLineType(nextType);
          if (nextLineType) {
            line.lineTypeId = nextLineType.id;
            line.colorList = getColorListDefault(nextLineType);
          }
        }

        const geomEntry = map.get("geometry");
        if (geomEntry && geometryLabelMap[geomEntry.value]) {
          line.geometry = geomEntry.value;
        }

        const flipEntry = map.get("flip");
        if (flipEntry) line.flip = Boolean(flipEntry.value);
        const flipColorEntry = map.get("flipColor");
        if (flipColorEntry) line.flipColor = Boolean(flipColorEntry.value);
        const cornerEntry = map.get("cornerRadius");
        if (cornerEntry) line.cornerRadius = clamp(Number(cornerEntry.value) || 0, 0, 120);
        const startEntry = map.get("startOffset");
        if (startEntry) line.startOffset = clamp(Number(startEntry.value) || 0, -120, 120);
        const endEntry = map.get("endOffset");
        if (endEntry) line.endOffset = clamp(Number(endEntry.value) || 0, -120, 120);

        const lineType = findLineType(line.lineTypeId);
        if (lineType) ensureEdgeColorList(line, lineType);

        (Array.isArray(line.colorList) ? line.colorList : []).forEach((color, index) => {
          const entry = map.get(`color${index}`);
          if (!entry) return;
          line.colorList[index] = String(entry.value);
        });

        // 处理表达式
        ["lineTypeId", "geometry", "flip", "flipColor", "cornerRadius", "startOffset", "endOffset"].forEach((key) => {
          const entry = map.get(key);
          if (entry && entry.expression) {
            if (!line.paramExpressions || typeof line.paramExpressions !== "object") {
              line.paramExpressions = {};
            }
            line.paramExpressions[key] = entry.expression;
          }
        });
        (Array.isArray(line.colorList) ? line.colorList : []).forEach((_, index) => {
          const entry = map.get(`color${index}`);
          if (entry && entry.expression) {
            if (!line.paramExpressions || typeof line.paramExpressions !== "object") {
              line.paramExpressions = {};
            }
            line.paramExpressions[`color${index}`] = entry.expression;
          }
        });
      });

      renderLines();
      onStateChanged?.({ coalesceKey: "line-params-paste" });
      renderSettings();
      return true;
    }

    if (selectionType === "text") {
      selected.forEach((entity) => {
        const text = state.labels.find((item) => item.id === entity.id);
        if (!text) return;

        const valueEntry = map.get("value");
        if (valueEntry) text.value = String(valueEntry.value || "");
        const fontEntry = map.get("fontFamily");
        if (fontEntry) text.fontFamily = String(fontEntry.value || text.fontFamily);
        const colorEntry = map.get("color");
        if (colorEntry) text.color = normalizeColor(colorEntry.value);
        const sizeEntry = map.get("fontSize");
        if (sizeEntry) text.fontSize = clamp(Number(sizeEntry.value) || 20, 1, 300);

        getTextStyleToolbarItems().forEach((item) => {
          const entry = map.get(item.flag);
          if (!entry) return;
          text[item.flag] = Boolean(entry.value);
        });

        // 处理表达式
        ["value", "fontFamily", "color", "fontSize", ...getTextStyleToolbarItems().map((i) => i.flag)].forEach((key) => {
          const entry = map.get(key);
          if (entry && entry.expression) {
            if (!text.paramExpressions || typeof text.paramExpressions !== "object") {
              text.paramExpressions = {};
            }
            text.paramExpressions[key] = entry.expression;
          }
        });
      });

      renderTexts();
      onStateChanged?.({ coalesceKey: "text-params-paste" });
      renderSettings();
      return true;
    }

    if (selectionType === "shape") {
      selected.forEach((entity) => {
        const shape = state.shapes.find((item) => item.id === entity.id);
        if (!shape) return;

        const scaleEntry = map.get("scale");
        if (scaleEntry) {
          shape.scale = clamp(Number(scaleEntry.value) || 1, 0.001, 10);
        }

        const preset = state.shapeLibrary.find((item) => item.id === shape.shapeId);
        if (!preset) return;
        const resolvedParams = resolveShapeParametersWithValues(preset, shape.paramValues || {});
        resolvedParams.forEach((param) => {
          const entry = map.get(param.id);
          if (!entry) return;
          if (!shape.paramValues || typeof shape.paramValues !== "object") {
            shape.paramValues = {};
          }
          shape.paramValues[param.id] = normalizeShapeParameterDefault(param.type, entry.value);
          if (entry.expression) {
            if (!shape.paramExpressions || typeof shape.paramExpressions !== "object") {
              shape.paramExpressions = {};
            }
            shape.paramExpressions[param.id] = entry.expression;
          }
        });

        const scaleExprEntry = map.get("scale");
        if (scaleExprEntry && scaleExprEntry.expression) {
          if (!shape.paramExpressions || typeof shape.paramExpressions !== "object") {
            shape.paramExpressions = {};
          }
          shape.paramExpressions["scale"] = scaleExprEntry.expression;
        }
      });

      renderShapes();
      onStateChanged?.({ coalesceKey: "shape-params-paste" });
      renderSettings();
      return true;
    }

    return false;
  };

  const appendSelectionActions = () => {
    if (!settingsBody) {
      return;
    }
    const selectedEntities = Array.isArray(state.selectedEntities) ? state.selectedEntities : [];
    const selectionType = getSelectionType(selectedEntities);
    const showCopyDuplicate = selectionType !== "line";
    const actionButtons = [];
    if (showCopyDuplicate) {
      actionButtons.push(`<button class="btn-ghost" id="settingsCopyBtn" type="button">复制</button>`);
      actionButtons.push(`<button class="btn-ghost" id="settingsDuplicateBtn" type="button">重复</button>`);
    }
    actionButtons.push(`<button class="btn-ghost btn-danger" id="settingsDeleteBtn" type="button">删除</button>`);

    settingsBody.insertAdjacentHTML("beforeend", `
      <div class="settings-param-actions">
        <button class="btn-ghost" id="settingsCopyParamsBtn" type="button">复制参数</button>
        <button class="btn-ghost" id="settingsPasteParamsBtn" type="button">黏贴参数</button>
      </div>
      <div class="settings-actions">
        ${actionButtons.join("")}
      </div>
    `);

    const copyParamsBtn = settingsBody.querySelector("#settingsCopyParamsBtn");
    const pasteParamsBtn = settingsBody.querySelector("#settingsPasteParamsBtn");

    const copyBtn = settingsBody.querySelector("#settingsCopyBtn");
    const duplicateBtn = settingsBody.querySelector("#settingsDuplicateBtn");
    const deleteBtn = settingsBody.querySelector("#settingsDeleteBtn");

    const canCopyParams = selectedEntities.length === 1 && Boolean(selectionType);
    const canPasteParams = Boolean(state.paramClipboard)
      && Boolean(selectionType)
      && state.paramClipboard.type === selectionType;

    if (copyParamsBtn) {
      copyParamsBtn.disabled = !canCopyParams;
      copyParamsBtn.title = !canCopyParams
        ? "多选或类型不一致时无法复制参数"
        : "";
      copyParamsBtn.addEventListener("click", () => {
        if (copyParamsFromSelection()) {
          flashButtonText(copyParamsBtn, "复制成功");
        }
      });
    }
    if (pasteParamsBtn) {
      pasteParamsBtn.disabled = !canPasteParams;
      if (!state.paramClipboard) {
        pasteParamsBtn.title = "暂无可黏贴的参数";
      } else if (!selectionType || state.paramClipboard.type !== selectionType) {
        pasteParamsBtn.title = "参数类型不匹配";
      } else {
        pasteParamsBtn.title = "";
      }
      pasteParamsBtn.addEventListener("click", () => {
        if (pasteParamsToSelection()) {
          flashButtonText(pasteParamsBtn, "粘贴成功");
        }
      });
    }

    if (copyBtn) {
      copyBtn.disabled = typeof copySelection !== "function";
      copyBtn.addEventListener("click", () => {
        if (copySelection?.()) {
          flashButtonText(copyBtn, "复制成功");
        }
      });
    }
    if (duplicateBtn) {
      duplicateBtn.disabled = typeof duplicateSelection !== "function";
      duplicateBtn.addEventListener("click", () => {
        if (duplicateSelection?.()) {
          flashButtonText(duplicateBtn, "重复成功");
        }
      });
    }
    if (deleteBtn) {
      deleteBtn.disabled = typeof deleteSelectedEntity !== "function";
      deleteBtn.addEventListener("click", () => {
        const count = Array.isArray(state.selectedEntities) ? state.selectedEntities.length : 0;
        if (!count) {
          return;
        }
        const message = count > 1
          ? `确认删除所选 ${count} 个元素？`
          : "确认删除所选元素？";
        if (state.appSettings?.confirmBeforeDelete !== false && !window.confirm(message)) {
          return;
        }
        deleteSelectedEntity?.();
      });
    }
  };

  const renderSettings = () => {
    const selectedEntities = Array.isArray(state.selectedEntities) ? state.selectedEntities : [];
    if (!selectedEntities.length) {
      settingsPanel.hidden = true;
      settingsBody.innerHTML = "";
      return;
    }

    settingsPanel.hidden = false;

    const selectedStations = selectedEntities
      .filter((entity) => entity.type === "station")
      .map((entity) => state.nodes.find((item) => item.id === entity.id))
      .filter(Boolean);

    const selectedLines = selectedEntities
      .filter((entity) => entity.type === "line")
      .map((entity) => state.edges.find((item) => item.id === entity.id))
      .filter(Boolean);

    const selectedTexts = selectedEntities
      .filter((entity) => entity.type === "text")
      .map((entity) => state.labels.find((item) => item.id === entity.id))
      .filter(Boolean);

    const selectedShapes = selectedEntities
      .filter((entity) => entity.type === "shape")
      .map((entity) => state.shapes.find((item) => item.id === entity.id))
      .filter(Boolean);

    const selectedSubDrawings = selectedEntities
      .filter((entity) => entity.type === "subDrawing")
      .map((entity) => state.subDrawings.find((item) => item.id === entity.id))
      .filter(Boolean);

    if (selectedLines.length !== 1) {
      state.lineMoveMode = null;
    }

    const typeCount = [selectedStations.length, selectedLines.length, selectedTexts.length, selectedShapes.length, selectedSubDrawings.length]
      .filter((count) => count > 0)
      .length;

    const summaryHtml = selectedEntities.length > 1
      ? `<div class="kv">已选择：车站 ${selectedStations.length} 个，线条 ${selectedLines.length} 条，文本 ${selectedTexts.length} 个，图形 ${selectedShapes.length} 个，子绘图 ${selectedSubDrawings.length} 个</div>`
      : "";

    const alignTargets = [
      ...selectedStations.map((item) => ({ item, type: "station" })),
      ...selectedShapes.map((item) => ({ item, type: "shape" }))
    ];
    const canAlign = alignTargets.length >= 2;

    if (typeCount > 1) {
      if (canAlign && selectedTexts.length === 0) {
        const note = selectedLines.length
          ? "<div class=\"kv\">已忽略线条，仅对车站和图形进行对齐与分布。</div>"
          : "";
        settingsBody.innerHTML = renderTemplate("settings-message", {
          summaryHtml,
          messageHtml: `${renderTemplate("settings-align-card")}${note}`
        });
        bindAlignControls(alignTargets);
        appendSelectionActions();
        return;
      }

      settingsBody.innerHTML = renderTemplate("settings-message", {
        summaryHtml,
        messageHtml: "<div class=\"kv\">当前包含多种类型，暂不提供批量属性设置。</div>"
      });
      appendSelectionActions();
      return;
    }

    if (selectedStations.length > 0) {
      if (selectedStations.length === 1) {
        renderSingleStation(selectedStations[0], summaryHtml);
      } else {
        renderBatchStations(selectedStations, summaryHtml);
      }
      return;
    }

    if (selectedLines.length > 0) {
      if (selectedLines.length === 1) {
        renderSingleLine(selectedLines[0], summaryHtml);
      } else {
        renderBatchLines(selectedLines, summaryHtml);
      }
      return;
    }

    if (selectedTexts.length > 0) {
      if (selectedTexts.length === 1) {
        renderSingleText(selectedTexts[0], summaryHtml);
      } else {
        settingsBody.innerHTML = renderTemplate("settings-message", {
          summaryHtml,
          messageHtml: "<div class=\"kv\">文本多选暂不支持批量设置。</div>"
        });
        appendSelectionActions();
      }
      return;
    }

    if (selectedShapes.length > 0) {
      if (selectedShapes.length === 1) {
        renderSingleShape(selectedShapes[0], summaryHtml);
      } else {
        renderBatchShapes(selectedShapes, summaryHtml);
      }
      return;
    }

    if (selectedSubDrawings.length > 0) {
      if (selectedSubDrawings.length === 1) {
        renderSingleSubDrawing(selectedSubDrawings[0], summaryHtml);
      } else {
        settingsBody.innerHTML = renderTemplate("settings-message", {
          summaryHtml,
          messageHtml: "<div class=\"kv\">子绘图多选暂不支持批量设置。</div>"
        });
        appendSelectionActions();
      }
    }
  };

  state.paramClipboardActions = {
    copy: copyParamsFromSelection,
    paste: pasteParamsToSelection
  };

  return renderSettings;

  function renderSingleStation(station, summaryHtml) {
    const currentTypeIndex = getStationTypeIndexByStation(station);
    const stationTypeOptions = state.stationTypes
      .map((type, index) => `<option value="${index}" ${index === currentTypeIndex ? "selected" : ""}>${escapeHtml(type.name)}</option>`)
      .join("");

    const stationPreset = getStationPresetByTypeIndex(currentTypeIndex);
    const stationTextCards = normalizeStationTextCards(stationPreset?.textCards);
    ensureStationTextValues(station, stationTextCards);
    ensureStationTextPlacement(station, stationPreset);
    const activeTextSlot = normalizeTextSlot(station.textPlacement?.slot);

    const stationParams = buildStationParameterDescriptors(station);
    ensureStationParameterValues(station, stationParams);

    const shape = state.shapeLibrary.find((item) => item.id === stationPreset?.shapeId) || null;
    const stationRuntimeParamMap = buildStationRuntimeParamMap({
      preset: stationPreset,
      shape,
      stationParamValues: station.paramValues
    });
    const visibleStationTextCards = stationTextCards.filter((card) => {
      const isVisible = Boolean(
        resolveTextBindingValue(card.visibilityBinding, "checkbox", stationRuntimeParamMap, true)
      );
      return isVisible && !Boolean(card.locked);
    });

    const textFieldsHtml = visibleStationTextCards.length
      ? `
        <div class="station-instance-text-panel">
          <div class="station-instance-text-title">站点文本</div>
          ${visibleStationTextCards.map((card, index) => {
        const cardId = escapeHtml(String(card.id || ""));
        const controlId = `stationTextValue-${escapeHtml(station.id)}-${cardId}`;
        const label = escapeHtml(String(card.label || `文本 ${index + 1}`));
        const allowMultiline = Boolean(card.allowMultiline);
        const textStyle = normalizeTextStyleFlags(card, card);
        const value = escapeHtml(normalizeStationTextContent(
          station.textValues?.[card.id] ?? card.defaultValue ?? "",
          allowMultiline
        ));
        const controlHtml = allowMultiline
          ? `<textarea id="${controlId}" data-station-text-card-id="${cardId}" data-station-text-multiline="1">${value}</textarea>`
          : `<input id="${controlId}" data-station-text-card-id="${cardId}" data-station-text-multiline="0" type="text" value="${value}" />`;
        return `
              <div class="station-instance-text-item">
                <label class="station-instance-text-label" for="${controlId}">${label}</label>
                ${controlHtml}
              </div>
            `;
      }).join("")}
        </div>
      `
      : "<div class=\"kv\">当前车站类型没有可编辑文本。</div>";

    const anchorGridHtml = `
      <div class="field">
        <label>文本锚点</label>
        <div class="station-position-grid station-instance-anchor-grid" role="group" aria-label="文本锚点">
          <button type="button" data-station-text-slot="nw" class="${activeTextSlot === "nw" ? "active" : ""}">
            <img src="/img/arrow/icon-arrow-up-left.svg" alt="左上" />
          </button>
          <button type="button" data-station-text-slot="n" class="${activeTextSlot === "n" ? "active" : ""}">
            <img src="/img/arrow/icon-arrow-up.svg" alt="上" />
          </button>
          <button type="button" data-station-text-slot="ne" class="${activeTextSlot === "ne" ? "active" : ""}">
            <img src="/img/arrow/icon-arrow-up-right.svg" alt="右上" />
          </button>
          <button type="button" data-station-text-slot="w" class="${activeTextSlot === "w" ? "active" : ""}">
            <img src="/img/arrow/icon-arrow-left.svg" alt="左" />
          </button>
          <button type="button" class="disabled" disabled></button>
          <button type="button" data-station-text-slot="e" class="${activeTextSlot === "e" ? "active" : ""}">
            <img src="/img/arrow/icon-arrow-right.svg" alt="右" />
          </button>
          <button type="button" data-station-text-slot="sw" class="${activeTextSlot === "sw" ? "active" : ""}">
            <img src="/img/arrow/icon-arrow-down-left.svg" alt="左下" />
          </button>
          <button type="button" data-station-text-slot="s" class="${activeTextSlot === "s" ? "active" : ""}">
            <img src="/img/arrow/icon-arrow-down.svg" alt="下" />
          </button>
          <button type="button" data-station-text-slot="se" class="${activeTextSlot === "se" ? "active" : ""}">
            <img src="/img/arrow/icon-arrow-down-right.svg" alt="右下" />
          </button>
        </div>
      </div>
    `;

    const safeRotation = Number.isFinite(Number(station.rotation)) ? Number(station.rotation) : 0;
    const rotationHtml = `
      <div class="field">
        <label for="stationRotationInput">旋转角度</label>
        <input id="stationRotationInput" type="number" min="-360" max="360" step="1" value="${safeRotation}" />
      </div>
    `;

    const paramFieldsHtml = stationParams
      .filter((param) => !param.locked)
      .map((param) => {
        const controlId = `stationParamValue-${escapeHtml(station.id)}-${escapeHtml(param.id)}`;
        const label = escapeHtml(param.label || shapeParameterTypeDefinitions[param.type]?.label || "参数");
        const typeLabel = escapeHtml(shapeParameterTypeDefinitions[param.type]?.label || "参数");
        const value = normalizeShapeParameterDefault(param.type, station.paramValues?.[param.id]);

        if (param.type === "color") {
          const normalized = normalizeColor(value || "#2f5d9d");
          return `
            <div class="field">
              <label for="${controlId}">${label}（${typeLabel}）</label>
              <button id="${controlId}" class="color-modal-trigger" type="button" data-color-trigger="station-param" data-color-value="${escapeHtml(normalized)}" data-station-param-id="${escapeHtml(param.id)}" data-station-param-type="${escapeHtml(param.type)}">
                <span class="color-modal-swatch" style="--swatch-color:${escapeHtml(normalized)}"></span>
                <span class="color-modal-text">${escapeHtml(formatColorWithAlpha(normalized))}</span>
              </button>
            </div>
          `;
        }

        if (param.type === "number") {
          return `
            <div class="field">
              <label for="${controlId}">${label}（${typeLabel}）</label>
              <input id="${controlId}" data-station-param-id="${escapeHtml(param.id)}" data-station-param-type="${escapeHtml(param.type)}" type="number" step="0.1" value="${Number(value) || 0}" />
            </div>
          `;
        }

        if (param.type === "checkbox") {
          return `
            <div class="field field-toggle">
              <label for="${controlId}">${label}（${typeLabel}）</label>
              <label class="toggle-switch" for="${controlId}">
                <input id="${controlId}" data-station-param-id="${escapeHtml(param.id)}" data-station-param-type="${escapeHtml(param.type)}" class="toggle-checkbox" type="checkbox" ${value ? "checked" : ""} />
                <span class="toggle-slider" aria-hidden="true"></span>
              </label>
            </div>
          `;
        }

        return `
          <div class="field">
            <label for="${controlId}">${label}（${typeLabel}）</label>
            <input id="${controlId}" data-station-param-id="${escapeHtml(param.id)}" data-station-param-type="${escapeHtml(param.type)}" type="text" value="${escapeHtml(String(value || ""))}" />
          </div>
        `;
      })
      .join("");

    settingsBody.innerHTML = renderTemplate("settings-station-single", {
      summaryHtml,
      stationTypeOptions,
      textFieldsHtml,
      anchorGridHtml,
      rotationHtml,
      paramFieldsHtml: paramFieldsHtml || "<div class=\"kv\">当前车站类型没有可调整参数（已锁定参数不会显示）。</div>"
    });

    const stationTypeSelect = document.getElementById("stationTypeSelect");
    stationTypeSelect.addEventListener("change", () => {
      const nextIndex = Number(stationTypeSelect.value);
      applyStationType(station, nextIndex);
      renderSettings();
      renderStations();
      onStateChanged?.();
    });

    const stationRotationInput = document.getElementById("stationRotationInput");
    stationRotationInput?.addEventListener("change", () => {
      station.rotation = Number(stationRotationInput.value) || 0;
      stationRotationInput.value = String(station.rotation);
      renderStations();
      onStateChanged?.();
    });

    settingsBody.querySelectorAll("[data-station-text-card-id]").forEach((inputEl) => {
      const cardId = inputEl.getAttribute("data-station-text-card-id");
      if (!cardId) {
        return;
      }

      const sourceCard = stationTextCards.find((item) => String(item?.id || "") === cardId);
      const textStyle = normalizeTextStyleFlags(sourceCard, sourceCard);
      applyTextInputStyle(inputEl, textStyle);

      const apply = () => {
        if (!station.textValues || typeof station.textValues !== "object") {
          station.textValues = {};
        }

        const allowMultiline = inputEl.getAttribute("data-station-text-multiline") === "1";
        const nextValue = normalizeStationTextContent(inputEl.value || "", allowMultiline);
        station.textValues[cardId] = nextValue;
        if (inputEl.value !== nextValue) {
          inputEl.value = nextValue;
        }
        renderStations();
        onStateChanged?.({ coalesceKey: "station-text-values" });
      };

      inputEl.addEventListener("input", apply);
      inputEl.addEventListener("change", apply);
    });

    settingsBody.querySelectorAll("[data-station-text-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        const slot = normalizeTextSlot(button.getAttribute("data-station-text-slot"));
        if (!station.textPlacement || typeof station.textPlacement !== "object") {
          station.textPlacement = { slot };
        } else {
          station.textPlacement.slot = slot;
        }

        renderStations();
        renderSettings();
        onStateChanged?.({ coalesceKey: "station-text-slot" });
      });
    });

    settingsBody.querySelectorAll("[data-station-param-id]").forEach((inputEl) => {
      const paramId = inputEl.getAttribute("data-station-param-id");
      const paramType = inputEl.getAttribute("data-station-param-type") || "text";
      if (!paramId) {
        return;
      }

      if (paramType === "color" && inputEl instanceof HTMLButtonElement) {
        const button = inputEl;
        const applyButtonColor = (color) => {
          const normalized = normalizeColor(color);
          button.dataset.colorValue = normalized;
          const swatch = button.querySelector(".color-modal-swatch");
          if (swatch) {
            swatch.style.setProperty("--swatch-color", normalized);
          }
          const text = button.querySelector(".color-modal-text");
          if (text) {
            text.textContent = formatColorWithAlpha(normalized);
          }
          if (!station.paramValues || typeof station.paramValues !== "object") {
            station.paramValues = {};
          }
          station.paramValues[paramId] = normalizeShapeParameterDefault("color", normalized);
        };

        applyButtonColor(button.dataset.colorValue || "#2f5d9dff");
        button.addEventListener("click", () => {
          if (!colorPicker) {
            return;
          }
          colorPicker.open({
            color: button.dataset.colorValue,
            title: "参数颜色",
            onConfirm: (nextColor) => {
              applyButtonColor(nextColor);
              renderStations();
              onStateChanged?.({ coalesceKey: "station-params" });
            }
          });
        });
        return;
      }

      const apply = () => {
        if (!station.paramValues || typeof station.paramValues !== "object") {
          station.paramValues = {};
        }

        let nextValue;
        if (paramType === "checkbox") {
          nextValue = Boolean(inputEl.checked);
        } else if (paramType === "number") {
          nextValue = Number(inputEl.value) || 0;
        } else {
          nextValue = inputEl.value;
        }

        station.paramValues[paramId] = normalizeShapeParameterDefault(paramType, nextValue);
        renderStations();
        onStateChanged?.({ coalesceKey: "station-params" });
      };

      inputEl.addEventListener("input", apply);
      inputEl.addEventListener("change", apply);
    });

    appendSelectionActions();
  }

  function renderBatchStations(stations, summaryHtml) {
    const typeIndices = stations.map((station) => getStationTypeIndexByStation(station));
    const first = typeIndices[0];
    const isSameType = typeIndices.every((idx) => idx === first);

    const stationTypeOptions = [
      `<option value="" ${isSameType ? "" : "selected"}>保持当前（混合）</option>`,
      ...state.stationTypes.map((type, index) => `<option value="${index}" ${isSameType && index === first ? "selected" : ""}>${escapeHtml(type.name)}</option>`)
    ].join("");

    settingsBody.innerHTML = renderTemplate("settings-station-batch", {
      summaryHtml,
      stationTypeOptions,
      alignCardHtml: renderTemplate("settings-align-card")
    });

    bindAlignControls(stations.map((item) => ({ item, type: "station" })));

    const batchStationTypeSelect = document.getElementById("batchStationTypeSelect");
    batchStationTypeSelect.addEventListener("change", () => {
      if (batchStationTypeSelect.value === "") {
        return;
      }

      const nextIndex = Number(batchStationTypeSelect.value);
      stations.forEach((station) => applyStationType(station, nextIndex));
      renderSettings();
      renderStations();
      onStateChanged?.();
    });

    appendSelectionActions();
  }

  function renderBatchShapes(shapes, summaryHtml) {
    settingsBody.innerHTML = renderTemplate("settings-shape-batch", {
      summaryHtml,
      alignCardHtml: renderTemplate("settings-align-card")
    });

    bindAlignControls(shapes.map((item) => ({ item, type: "shape" })));

    appendSelectionActions();
  }

  function renderSingleLine(edge, summaryHtml) {
    const lineType = findLineType(edge.lineTypeId);
    if (!lineType) {
      settingsBody.innerHTML = renderTemplate("settings-message", {
        summaryHtml,
        messageHtml: "<div class=\"kv\">组件类型: 线</div>"
      });
      appendSelectionActions();
      return;
    }

    if (state.lineMoveMode && state.lineMoveMode.sourceId !== edge.id) {
      state.lineMoveMode = null;
    }

    const lineTypeOptions = state.lineTypes
      .map((type) => `<option value="${escapeHtml(type.id)}" ${type.id === edge.lineTypeId ? "selected" : ""}>${escapeHtml(type.name)}</option>`)
      .join("");
    const geometryOptions = Object.entries(geometryLabelMap)
      .map(([value, label]) => `<option value="${value}" ${value === edge.geometry ? "selected" : ""}>${escapeHtml(label)}</option>`)
      .join("");

    const colorList = ensureEdgeColorList(edge, lineType);
    const formatColorLabel = (value) => formatColorWithAlpha(value);

    const colorListEditorHtml = colorList
      .map((color, idx) => `
        <div class="line-settings-color-item">
          <label for="lineColorRef${idx}">颜色${idx + 1}</label>
          <button id="lineColorRef${idx}" class="color-modal-trigger" type="button" data-line-color-index="${idx}" data-color-value="${escapeHtml(color)}">
            <span class="color-modal-swatch" style="--swatch-color:${escapeHtml(color)}"></span>
            <span class="color-modal-text">${escapeHtml(formatColorLabel(color))}</span>
          </button>
        </div>
      `)
      .join("");

    settingsBody.innerHTML = renderTemplate("settings-line-single", {
      summaryHtml,
      arrangeCardHtml: renderTemplate("settings-arrange-card"),
      lineTypeOptions,
      geometryOptions,
      lineFlipChecked: edge.flip ? "checked" : "",
      lineFlipColorChecked: edge.flipColor ? "checked" : "",
      lineCornerRadius: String(Number(edge.cornerRadius) || 0),
      lineStartOffset: String(Number(edge.startOffset) || 0),
      lineEndOffset: String(Number(edge.endOffset) || 0),
      colorListEditorHtml
    });

    const layerButtons = settingsBody.querySelectorAll("[data-line-layer-action]");
    layerButtons.forEach((button) => {
      const action = button.getAttribute("data-line-layer-action") || "";
      const mode = button.getAttribute("data-line-layer-mode") || "";
      const isActive = Boolean(
        mode
        && state.lineMoveMode
        && state.lineMoveMode.sourceId === edge.id
        && state.lineMoveMode.mode === mode
      );

      if (mode) {
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      }

      button.addEventListener("click", () => {
        if (action === "move-under" || action === "move-over") {
          const nextMode = action === "move-under" ? "below" : "above";
          if (state.lineMoveMode && state.lineMoveMode.sourceId === edge.id && state.lineMoveMode.mode === nextMode) {
            state.lineMoveMode = null;
          } else {
            state.lineMoveMode = { sourceId: edge.id, mode: nextMode };
          }
          renderSettings();
          return;
        }

        const moved = moveLineInStack?.({ sourceId: edge.id, mode: action });
        if (moved) {
          renderLines();
          renderSettings();
          onStateChanged?.({ coalesceKey: "line-order" });
        }
      });
    });

    const lineTypeSelect = document.getElementById("lineTypeSelect");
    const lineGeometrySelect = document.getElementById("lineGeometrySelect");

    lineTypeSelect.addEventListener("change", () => {
      const newType = findLineType(lineTypeSelect.value);
      if (!newType) {
        return;
      }
      edge.lineTypeId = newType.id;
      edge.colorList = getColorListDefault(newType);
      renderLines();
      renderSettings();
      onStateChanged?.();
    });

    lineGeometrySelect.addEventListener("change", () => {
      edge.geometry = lineGeometrySelect.value;
      renderLines();
      renderSettings();
      onStateChanged?.();
    });

    const lineFlip = document.getElementById("lineFlip");
    const lineFlipColor = document.getElementById("lineFlipColor");
    const lineCornerRadius = document.getElementById("lineCornerRadius");
    const lineStartOffset = document.getElementById("lineStartOffset");
    const lineEndOffset = document.getElementById("lineEndOffset");

    lineFlip.addEventListener("change", () => {
      edge.flip = Boolean(lineFlip.checked);
      renderLines();
      onStateChanged?.();
    });

    lineFlipColor.addEventListener("change", () => {
      edge.flipColor = Boolean(lineFlipColor.checked);
      renderLines();
      onStateChanged?.();
    });

    lineCornerRadius.addEventListener("input", () => {
      edge.cornerRadius = clamp(Number(lineCornerRadius.value) || 0, 0, 120);
      renderLines();
      onStateChanged?.();
    });

    lineStartOffset.addEventListener("input", () => {
      edge.startOffset = clamp(Number(lineStartOffset.value) || 0, -120, 120);
      renderLines();
      onStateChanged?.();
    });

    lineEndOffset.addEventListener("input", () => {
      edge.endOffset = clamp(Number(lineEndOffset.value) || 0, -120, 120);
      renderLines();
      onStateChanged?.();
    });

    settingsBody.querySelectorAll("[data-line-color-index]").forEach((button) => {
      const index = Number(button.getAttribute("data-line-color-index"));
      if (!Number.isInteger(index)) {
        return;
      }
      button.addEventListener("click", () => {
        if (!colorPicker) {
          return;
        }
        colorPicker.open({
          color: edge.colorList[index],
          title: `颜色${index + 1}`,
          onConfirm: (nextColor) => {
            edge.colorList[index] = nextColor;
            renderLines();
            onStateChanged?.({ coalesceKey: "line-color" });
            renderSettings();
          }
        });
      });
    });

    appendSelectionActions();
  }

  function renderBatchLines(lines, summaryHtml) {
    const commonLineTypeId = getCommonValue(lines, (line) => line.lineTypeId);
    const commonGeometry = getCommonValue(lines, (line) => line.geometry);
    const commonFlip = getCommonValue(lines, (line) => String(Boolean(line.flip)));
    const commonFlipColor = getCommonValue(lines, (line) => String(Boolean(line.flipColor)));
    const commonCorner = getCommonValue(lines, (line) => String(Number(line.cornerRadius) || 0));
    const commonStartOffset = getCommonValue(lines, (line) => String(Number(line.startOffset) || 0));
    const commonEndOffset = getCommonValue(lines, (line) => String(Number(line.endOffset) || 0));

    const lineTypeOptions = [
      `<option value="" ${commonLineTypeId ? "" : "selected"}>保持当前（混合）</option>`,
      ...state.lineTypes.map((type) => `<option value="${escapeHtml(type.id)}" ${type.id === commonLineTypeId ? "selected" : ""}>${escapeHtml(type.name)}</option>`)
    ].join("");

    const geometryOptions = [
      `<option value="" ${commonGeometry ? "" : "selected"}>保持当前（混合）</option>`,
      ...Object.entries(geometryLabelMap)
        .map(([value, label]) => `<option value="${value}" ${value === commonGeometry ? "selected" : ""}>${escapeHtml(label)}</option>`)
    ].join("");

    const flipOptions = `
      <option value="" ${commonFlip ? "" : "selected"}>保持当前（混合）</option>
      <option value="true" ${commonFlip === "true" ? "selected" : ""}>是</option>
      <option value="false" ${commonFlip === "false" ? "selected" : ""}>否</option>
    `;

    const flipColorOptions = `
      <option value="" ${commonFlipColor ? "" : "selected"}>保持当前（混合）</option>
      <option value="true" ${commonFlipColor === "true" ? "selected" : ""}>是</option>
      <option value="false" ${commonFlipColor === "false" ? "selected" : ""}>否</option>
    `;

    settingsBody.innerHTML = renderTemplate("settings-line-batch", {
      summaryHtml,
      lineTypeOptions,
      geometryOptions,
      flipOptions,
      flipColorOptions,
      commonCorner: commonCorner || "",
      commonStartOffset: commonStartOffset || "",
      commonEndOffset: commonEndOffset || ""
    });

    const batchLineTypeSelect = document.getElementById("batchLineTypeSelect");
    const batchLineGeometrySelect = document.getElementById("batchLineGeometrySelect");
    const batchLineFlipSelect = document.getElementById("batchLineFlipSelect");
    const batchLineFlipColorSelect = document.getElementById("batchLineFlipColorSelect");
    const batchLineCornerRadius = document.getElementById("batchLineCornerRadius");
    const batchLineStartOffset = document.getElementById("batchLineStartOffset");
    const batchLineEndOffset = document.getElementById("batchLineEndOffset");

    batchLineTypeSelect.addEventListener("change", () => {
      if (!batchLineTypeSelect.value) {
        return;
      }
      const newType = findLineType(batchLineTypeSelect.value);
      if (!newType) {
        return;
      }

      lines.forEach((line) => {
        line.lineTypeId = newType.id;
        line.colorList = getColorListDefault(newType);
      });
      renderLines();
      renderSettings();
      onStateChanged?.();
    });

    batchLineGeometrySelect.addEventListener("change", () => {
      if (!batchLineGeometrySelect.value) {
        return;
      }
      lines.forEach((line) => {
        line.geometry = batchLineGeometrySelect.value;
      });
      renderLines();
      renderSettings();
      onStateChanged?.();
    });

    batchLineFlipSelect.addEventListener("change", () => {
      if (batchLineFlipSelect.value === "") {
        return;
      }
      const nextFlip = batchLineFlipSelect.value === "true";
      lines.forEach((line) => {
        line.flip = nextFlip;
      });
      renderLines();
      onStateChanged?.();
    });

    batchLineFlipColorSelect.addEventListener("change", () => {
      if (batchLineFlipColorSelect.value === "") {
        return;
      }
      const nextFlipColor = batchLineFlipColorSelect.value === "true";
      lines.forEach((line) => {
        line.flipColor = nextFlipColor;
      });
      renderLines();
      onStateChanged?.();
    });

    batchLineCornerRadius.addEventListener("change", () => {
      if (batchLineCornerRadius.value === "") {
        return;
      }
      const value = clamp(Number(batchLineCornerRadius.value) || 0, 0, 120);
      lines.forEach((line) => {
        line.cornerRadius = value;
      });
      batchLineCornerRadius.value = String(value);
      renderLines();
      onStateChanged?.();
    });

    batchLineStartOffset.addEventListener("change", () => {
      if (batchLineStartOffset.value === "") {
        return;
      }
      const value = clamp(Number(batchLineStartOffset.value) || 0, -120, 120);
      lines.forEach((line) => {
        line.startOffset = value;
      });
      batchLineStartOffset.value = String(value);
      renderLines();
      onStateChanged?.();
    });

    batchLineEndOffset.addEventListener("change", () => {
      if (batchLineEndOffset.value === "") {
        return;
      }
      const value = clamp(Number(batchLineEndOffset.value) || 0, -120, 120);
      lines.forEach((line) => {
        line.endOffset = value;
      });
      batchLineEndOffset.value = String(value);
      renderLines();
      onStateChanged?.();
    });

    // 批量颜色编辑：只显示所有线条共有的颜色索引
    lines.forEach((line) => {
      const lt = findLineType(line.lineTypeId);
      if (lt) ensureEdgeColorList(line, lt);
    });
    const maxCommonColorIndex = lines.reduce((min, line) => {
      const len = Array.isArray(line.colorList) ? line.colorList.length : 0;
      return Math.min(min, len);
    }, Infinity) - 1;

    const batchColorSection = document.getElementById("batchLineColorSection");
    const batchColorHint = document.getElementById("batchLineColorHint");
    if (batchColorSection && batchColorHint) {
      batchColorSection.innerHTML = "";
      if (maxCommonColorIndex >= 0) {
        batchColorHint.textContent = "以上颜色项在所有选中线条中均存在，修改将应用到全部选中线条。";
        for (let i = 0; i <= maxCommonColorIndex; i++) {
          // 取第一条线的颜色作为预览
          const sampleColor = String(
            (Array.isArray(lines[0]?.colorList) && lines[0].colorList[i])
            || "#2f5d9dff"
          );
          const normalized = normalizeColor(sampleColor);
          const item = document.createElement("div");
          item.className = "line-settings-color-item";
          item.innerHTML = `
            <label for="batchLineColor${i}">颜色${i + 1}</label>
            <button id="batchLineColor${i}" class="color-modal-trigger" type="button" data-batch-color-index="${i}" data-color-value="${escapeHtml(normalized)}">
              <span class="color-modal-swatch" style="--swatch-color:${escapeHtml(normalized)}"></span>
              <span class="color-modal-text">${escapeHtml(formatColorWithAlpha(normalized))}</span>
            </button>
          `;
          batchColorSection.appendChild(item);
        }
      } else {
        batchColorHint.textContent = "没有所有线条共有的颜色项。";
      }
    }

    // 绑定批量颜色按钮事件
    const btns = settingsBody.querySelectorAll("[data-batch-color-index]");
    btns.forEach((button) => {
      if (button._batchBound) return;
      button._batchBound = true;
      button.addEventListener("click", () => {
        if (!colorPicker) return;
        const index = Number(button.getAttribute("data-batch-color-index"));
        if (!Number.isInteger(index)) return;
        colorPicker.open({
          color: lines[0]?.colorList?.[index] || "#2f5d9dff",
          title: `颜色${index + 1}`,
          onConfirm: (nextColor) => {
            lines.forEach((line) => {
              if (Array.isArray(line.colorList) && line.colorList.length > index) {
                line.colorList[index] = nextColor;
              }
            });
            renderLines();
            onStateChanged?.({ coalesceKey: "line-color-batch" });
            renderSettings();
          }
        });
      });
    });

    appendSelectionActions();
  }

  function renderSingleText(label, summaryHtml) {
    const labelStyle = normalizeTextStyleFlags(label);
    settingsBody.innerHTML = renderTemplate("settings-text-single", {
      summaryHtml,
      textStyleToolbarHtml: buildTextStyleToolbarHtml({
        scope: "label",
        targetId: String(label.id || ""),
        textStyle: labelStyle
      }),
      textValue: escapeHtml(label.value),
      textColor: label.color,
      textFontSize: String(Number(label.fontSize) || 20)
    });

    const valueInput = document.getElementById("textValue");
    const fontSelect = document.getElementById("textFont");
    const colorButton = document.getElementById("textColor");
    const fontSizeInput = document.getElementById("textFontSize");
    const styleButtons = settingsBody.querySelectorAll("[data-label-text-style-id][data-text-style-flag]");

    fontSelect.value = label.fontFamily;
    applyTextInputStyle(valueInput, labelStyle);

    valueInput.addEventListener("input", () => {
      label.value = valueInput.value || "Text";
      renderTexts();
      onStateChanged?.();
    });

    fontSelect.addEventListener("change", () => {
      label.fontFamily = fontSelect.value;
      renderTexts();
      onStateChanged?.();
    });

    const applyTextColor = (color) => {
      const normalized = normalizeColor(color);
      label.color = normalized;
      if (colorButton instanceof HTMLButtonElement) {
        colorButton.dataset.colorValue = normalized;
        const swatch = colorButton.querySelector(".color-modal-swatch");
        if (swatch) {
          swatch.style.setProperty("--swatch-color", normalized);
        }
        const text = colorButton.querySelector(".color-modal-text");
        if (text) {
          text.textContent = formatColorWithAlpha(normalized);
        }
      }
    };

    if (colorButton instanceof HTMLButtonElement) {
      applyTextColor(label.color || "#2f5d9dff");
      colorButton.addEventListener("click", () => {
        if (!colorPicker) {
          return;
        }
        colorPicker.open({
          color: colorButton.dataset.colorValue || label.color,
          title: "文字颜色",
          onConfirm: (nextColor) => {
            applyTextColor(nextColor);
            renderTexts();
            onStateChanged?.();
          }
        });
      });
    }

    const applyFontSize = () => {
      const nextSize = clamp(Number(fontSizeInput.value) || 20, 1, 300);
      fontSizeInput.value = String(nextSize);
      label.fontSize = nextSize;
      renderTexts();
      onStateChanged?.();
    };

    fontSizeInput.addEventListener("input", applyFontSize);
    fontSizeInput.addEventListener("change", applyFontSize);

    styleButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const styleFlag = String(button.getAttribute("data-text-style-flag") || "").trim();
        if (!isSupportedTextStyleFlag(styleFlag)) {
          return;
        }

        const current = normalizeTextStyleFlags(label);
        const next = {
          ...current,
          [styleFlag]: !current[styleFlag]
        };
        Object.assign(label, next);
        applyTextInputStyle(valueInput, next);

        styleButtons.forEach((item) => {
          const flag = item.getAttribute("data-text-style-flag");
          const isActive = Boolean(flag && next[flag]);
          item.classList.toggle("active", isActive);
          item.setAttribute("aria-pressed", isActive ? "true" : "false");
        });

        renderTexts();
        onStateChanged?.();
      });
    });

    appendSelectionActions();
  }

  function renderSingleShape(shapeInstance, summaryHtml) {
    const preset = state.shapeLibrary.find((item) => item.id === shapeInstance.shapeId);
    if (!preset) {
      settingsBody.innerHTML = renderTemplate("settings-message", {
        summaryHtml,
        messageHtml: "<div class=\"kv\">组件类型: 图形</div><div class=\"kv\">该图形引用的预制图形已不存在。</div>"
      });
      appendSelectionActions();
      return;
    }

    const safeScale = clamp(Number(shapeInstance.scale) || 1, 0.001, 10);
    const safeRotation = Number.isFinite(Number(shapeInstance.rotation)) ? Number(shapeInstance.rotation) : 0;
    const resolvedParams = resolveShapeParametersWithValues(preset, shapeInstance.paramValues || {});

    const paramFieldsHtml = resolvedParams
      .map((param) => {
        const controlId = `shapeParamValue-${escapeHtml(shapeInstance.id)}-${escapeHtml(param.id)}`;
        const label = escapeHtml(param.label || shapeParameterTypeDefinitions[param.type]?.label || "参数");
        const typeLabel = escapeHtml(shapeParameterTypeDefinitions[param.type]?.label || "参数");

        if (param.type === "color") {
          const normalized = normalizeColor(param.defaultValue || "#2f5d9d");
          return `
            <div class="field">
              <label for="${controlId}">${label}（${typeLabel}）</label>
              <button id="${controlId}" class="color-modal-trigger" type="button" data-color-trigger="shape-param" data-color-value="${escapeHtml(normalized)}" data-shape-param-id="${escapeHtml(param.id)}">
                <span class="color-modal-swatch" style="--swatch-color:${escapeHtml(normalized)}"></span>
                <span class="color-modal-text">${escapeHtml(formatColorWithAlpha(normalized))}</span>
              </button>
            </div>
          `;
        }

        if (param.type === "number") {
          return `
            <div class="field">
              <label for="${controlId}">${label}（${typeLabel}）</label>
              <input id="${controlId}" data-shape-param-id="${escapeHtml(param.id)}" type="number" step="0.1" value="${Number(param.defaultValue) || 0}" />
            </div>
          `;
        }

        if (param.type === "checkbox") {
          return `
            <div class="field field-toggle">
              <label for="${controlId}">${label}（${typeLabel}）</label>
              <label class="toggle-switch" for="${controlId}">
                <input id="${controlId}" data-shape-param-id="${escapeHtml(param.id)}" class="toggle-checkbox" type="checkbox" ${param.defaultValue ? "checked" : ""} />
                <span class="toggle-slider" aria-hidden="true"></span>
              </label>
            </div>
          `;
        }

        return `
          <div class="field">
            <label for="${controlId}">${label}（${typeLabel}）</label>
            <input id="${controlId}" data-shape-param-id="${escapeHtml(param.id)}" type="text" value="${escapeHtml(String(param.defaultValue || ""))}" />
          </div>
        `;
      })
      .join("");

    settingsBody.innerHTML = renderTemplate("settings-shape-single", {
      summaryHtml,
      presetName: escapeHtml(preset.name || "图形"),
      safeScale: String(safeScale),
      safeRotation: String(safeRotation),
      shapePreviewSrc: escapeHtml(toSvgDataUrl(autoCropSvg(buildRenderableShapeSvg(preset, shapeInstance.paramValues || {}, shapeInstance.paramExpressions)))),
      paramFieldsHtml: paramFieldsHtml || "<div class=\"kv\">该图形没有可配置参数。</div>"
    });

    const scaleInput = document.getElementById("shapeScaleInput");
    scaleInput?.addEventListener("change", () => {
      shapeInstance.scale = clamp(Number(scaleInput.value) || 1, 0.001, 10);
      scaleInput.value = String(shapeInstance.scale);
      renderShapes();
      onStateChanged?.();
      renderSettings();
    });

    const rotationInput = document.getElementById("shapeRotationInput");
    rotationInput?.addEventListener("change", () => {
      shapeInstance.rotation = Number(rotationInput.value) || 0;
      rotationInput.value = String(shapeInstance.rotation);
      renderShapes();
      onStateChanged?.();
      renderSettings();
    });

    settingsBody.querySelectorAll("[data-shape-param-id]").forEach((inputEl) => {
      const paramId = inputEl.getAttribute("data-shape-param-id");
      const param = resolvedParams.find((item) => item.id === paramId);
      if (!param) {
        return;
      }

      if (param.type === "color" && inputEl instanceof HTMLButtonElement) {
        const button = inputEl;
        const applyButtonColor = (color) => {
          const normalized = normalizeColor(color);
          button.dataset.colorValue = normalized;
          const swatch = button.querySelector(".color-modal-swatch");
          if (swatch) {
            swatch.style.setProperty("--swatch-color", normalized);
          }
          const text = button.querySelector(".color-modal-text");
          if (text) {
            text.textContent = formatColorWithAlpha(normalized);
          }
          if (!shapeInstance.paramValues || typeof shapeInstance.paramValues !== "object") {
            shapeInstance.paramValues = {};
          }
          shapeInstance.paramValues[param.id] = normalizeShapeParameterDefault("color", normalized);
        };

        applyButtonColor(button.dataset.colorValue || "#2f5d9dff");
        button.addEventListener("click", () => {
          if (!colorPicker) {
            return;
          }
          colorPicker.open({
            color: button.dataset.colorValue,
            title: "参数颜色",
            onConfirm: (nextColor) => {
              applyButtonColor(nextColor);
              renderShapes();
              onStateChanged?.({ coalesceKey: "shape-params" });
            }
          });
        });
        return;
      }

      const apply = () => {
        if (!shapeInstance.paramValues || typeof shapeInstance.paramValues !== "object") {
          shapeInstance.paramValues = {};
        }

        if (param.type === "checkbox") {
          shapeInstance.paramValues[param.id] = Boolean(inputEl.checked);
        } else if (param.type === "number") {
          shapeInstance.paramValues[param.id] = Number(inputEl.value) || 0;
        } else {
          shapeInstance.paramValues[param.id] = inputEl.value;
        }

        renderShapes();
        onStateChanged?.({ coalesceKey: "shape-params" });
      };

      inputEl.addEventListener("input", apply);
      inputEl.addEventListener("change", apply);
    });

    appendSelectionActions();
  }

  function renderSingleSubDrawing(sd, summaryHtml) {
    const safeX = Number(sd.x) || 0;
    const safeY = Number(sd.y) || 0;
    const safeScale = clamp(Number(sd.scale) || 0.5, 0.001, 10);
    const safeRotation = Number.isFinite(Number(sd.rotation)) ? Number(sd.rotation) : 0;

    settingsBody.innerHTML = `
      ${summaryHtml}
      <div class="kv">组件类型: 子绘图</div>
      <div class="field">
        <label for="subDrawingXInput">位置 X</label>
        <input id="subDrawingXInput" type="number" step="1" value="${safeX}" />
      </div>
      <div class="field">
        <label for="subDrawingYInput">位置 Y</label>
        <input id="subDrawingYInput" type="number" step="1" value="${safeY}" />
      </div>
      <div class="field">
        <label for="subDrawingScaleInput">缩放比例</label>
        <input id="subDrawingScaleInput" type="number" min="0.001" max="10" step="0.001" value="${safeScale}" />
      </div>
      <div class="field">
        <label for="subDrawingRotationInput">旋转角度</label>
        <input id="subDrawingRotationInput" type="number" min="-360" max="360" step="1" value="${safeRotation}" />
      </div>
    `;

    const xInput = document.getElementById("subDrawingXInput");
    xInput?.addEventListener("change", () => {
      sd.x = Number(xInput.value) || 0;
      xInput.value = String(sd.x);
      renderSubDrawings?.();
      renderStations?.();
      renderLines?.();
      onStateChanged?.();
      renderSettings();
    });

    const yInput = document.getElementById("subDrawingYInput");
    yInput?.addEventListener("change", () => {
      sd.y = Number(yInput.value) || 0;
      yInput.value = String(sd.y);
      renderSubDrawings?.();
      renderStations?.();
      renderLines?.();
      onStateChanged?.();
      renderSettings();
    });

    const scaleInput = document.getElementById("subDrawingScaleInput");
    scaleInput?.addEventListener("change", () => {
      sd.scale = clamp(Number(scaleInput.value) || 0.25, 0.001, 10);
      scaleInput.value = String(sd.scale);
      renderSubDrawings?.();
      onStateChanged?.();
      renderSettings();
    });

    const rotationInput = document.getElementById("subDrawingRotationInput");
    rotationInput?.addEventListener("change", () => {
      sd.rotation = Number(rotationInput.value) || 0;
      rotationInput.value = String(sd.rotation);
      renderSubDrawings?.();
      onStateChanged?.();
      renderSettings();
    });

    appendSelectionActions();
  }

  function bindAlignControls(items) {
    const buttons = settingsBody.querySelectorAll("[data-align-action]");
    if (!buttons.length) {
      return;
    }

    const applyAlignment = (action) => {
      if (!Array.isArray(items) || items.length < 2) {
        return;
      }

      const positions = items.map(({ item, type }) => ({
        item,
        type,
        x: Number(item.x) || 0,
        y: Number(item.y) || 0
      }));
      if (action === "align-left") {
        const minX = Math.min(...positions.map((entry) => entry.x));
        positions.forEach((entry) => { entry.item.x = minX; });
      } else if (action === "align-right") {
        const maxX = Math.max(...positions.map((entry) => entry.x));
        positions.forEach((entry) => { entry.item.x = maxX; });
      } else if (action === "align-top") {
        const minY = Math.min(...positions.map((entry) => entry.y));
        positions.forEach((entry) => { entry.item.y = minY; });
      } else if (action === "align-bottom") {
        const maxY = Math.max(...positions.map((entry) => entry.y));
        positions.forEach((entry) => { entry.item.y = maxY; });
      } else if (action === "distribute-x") {
        if (positions.length < 3) {
          return;
        }
        const sorted = [...positions].sort((a, b) => a.x - b.x);
        const minX = sorted[0].x;
        const maxX = sorted[sorted.length - 1].x;
        const step = (maxX - minX) / (sorted.length - 1 || 1);
        sorted.forEach((entry, index) => { entry.item.x = minX + step * index; });
      } else if (action === "distribute-y") {
        if (positions.length < 3) {
          return;
        }
        const sorted = [...positions].sort((a, b) => a.y - b.y);
        const minY = sorted[0].y;
        const maxY = sorted[sorted.length - 1].y;
        const step = (maxY - minY) / (sorted.length - 1 || 1);
        sorted.forEach((entry, index) => { entry.item.y = minY + step * index; });
      }

      const hasStation = positions.some((entry) => entry.type === "station");
      const hasShape = positions.some((entry) => entry.type === "shape");
      if (hasStation) {
        renderStations();
        renderLines();
      }
      if (hasShape) {
        renderShapes();
      }

      onStateChanged?.({ coalesceKey: "align-multi" });
      renderSettings();
    };

    buttons.forEach((button) => {
      const action = button.getAttribute("data-align-action");
      if (!action) {
        return;
      }
      button.addEventListener("click", () => applyAlignment(action));
    });
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

  function buildStationParameterDescriptors(station) {
    const typeIndex = getStationTypeIndexByStation(station);
    const preset = getStationPresetByTypeIndex(typeIndex);
    if (!preset) {
      return [];
    }

    const descriptors = [];
    const seen = new Set();

    normalizeShapeParameters(preset.params).forEach((param) => {
      if (seen.has(param.id)) {
        return;
      }

      seen.add(param.id);
      descriptors.push({
        id: param.id,
        type: param.type,
        label: param.label,
        defaultValue: normalizeShapeParameterDefault(param.type, param.defaultValue),
        locked: false
      });
    });

    const shape = state.shapeLibrary.find((item) => item.id === preset.shapeId);
    const shapeParams = normalizeShapeParameters(shape?.parameters);
    const shapeSettings = preset.shapeParamSettings && typeof preset.shapeParamSettings === "object"
      ? preset.shapeParamSettings
      : {};

    shapeParams.forEach((param) => {
      if (seen.has(param.id)) {
        return;
      }

      seen.add(param.id);
      const setting = shapeSettings[param.id];
      const mode = setting?.mode === "default" || setting?.mode === "locked"
        ? setting.mode
        : "inherit";
      const fallback = mode === "inherit" ? param.defaultValue : setting?.value;

      descriptors.push({
        id: param.id,
        type: param.type,
        label: param.label,
        defaultValue: normalizeShapeParameterDefault(param.type, fallback),
        locked: mode === "locked"
      });
    });

    return descriptors;
  }

  function ensureStationParameterValues(station, descriptors) {
    if (!station || typeof station !== "object") {
      return;
    }

    if (!station.paramValues || typeof station.paramValues !== "object") {
      station.paramValues = {};
    }

    descriptors.forEach((descriptor) => {
      if (descriptor.locked) {
        station.paramValues[descriptor.id] = descriptor.defaultValue;
        return;
      }

      if (Object.prototype.hasOwnProperty.call(station.paramValues, descriptor.id)) {
        station.paramValues[descriptor.id] = normalizeShapeParameterDefault(
          descriptor.type,
          station.paramValues[descriptor.id]
        );
        return;
      }

      station.paramValues[descriptor.id] = descriptor.defaultValue;
    });
  }

  /** 获取参数化旋转的当前值显示文本 */
  function renderCurrentParamValue(station, numberParams, paramId) {
    if (!paramId) return "0°";
    const param = numberParams.find((p) => p.id === paramId);
    const val = param
      ? normalizeShapeParameterDefault("number", station.paramValues?.[paramId] ?? param.defaultValue)
      : (station.paramValues?.[paramId] ?? 0);
    return `${Number(val) || 0}°`;
  }

  function ensureStationTextValues(station, cards) {
    if (!station || typeof station !== "object") {
      return;
    }

    const source = station.textValues && typeof station.textValues === "object"
      ? { ...station.textValues }
      : {};
    const cardList = Array.isArray(cards) ? cards : [];

    // 收集旧 source 中不属于新卡片集的 key（可能来自上一个类型的 textCards）
    const newIdSet = new Set(cardList.map((c) => String(c?.id || "").trim()).filter(Boolean));
    const orphanEntries = Object.entries(source).filter(([key]) => key && !newIdSet.has(key));

    const normalized = {};
    const usedOrphanKeys = new Set();

    cardList.forEach((card, index) => {
      const id = String(card?.id || "").trim();
      if (!id) return;

      if (Object.prototype.hasOwnProperty.call(source, id)) {
        // 当前卡片 ID 在 source 中存在：直接保留
        normalized[id] = normalizeStationTextContent(source[id], Boolean(card?.allowMultiline));
      } else {
        // 尝试从孤儿条目中匹配
        let migratedValue = null;
        let matchedOrphanKey = null;

        // 策略1：按标签匹配（source key 对应卡片在旧预设中有相同 label）
        // 这里只能按索引做近似匹配
        // 策略2：按孤儿条目在 source 中的顺序，匹配到新卡片同索引
        if (orphanEntries.length > 0 && index < orphanEntries.length) {
          const orphanKey = orphanEntries[index][0];
          if (!usedOrphanKeys.has(orphanKey)) {
            migratedValue = orphanEntries[index][1];
            matchedOrphanKey = orphanKey;
          }
        }

        // 策略3：如果按索引不匹配，尝试第一个未使用的孤儿条目
        if (!migratedValue) {
          for (const [oKey, oVal] of orphanEntries) {
            if (!usedOrphanKeys.has(oKey) && String(oVal || "").trim()) {
              migratedValue = oVal;
              matchedOrphanKey = oKey;
              break;
            }
          }
        }

        if (migratedValue != null && String(migratedValue || "").trim()) {
          normalized[id] = normalizeStationTextContent(migratedValue, Boolean(card?.allowMultiline));
          if (matchedOrphanKey) usedOrphanKeys.add(matchedOrphanKey);
        } else {
          normalized[id] = normalizeStationTextContent(card?.defaultValue ?? "", Boolean(card?.allowMultiline));
        }
      }
    });

    station.textValues = normalized;
  }

  function ensureStationTextStyleValues(station, cards) {
    if (!station || typeof station !== "object") {
      return;
    }

    const source = station.textStyleValues && typeof station.textStyleValues === "object"
      ? station.textStyleValues
      : {};
    const normalized = {};

    (Array.isArray(cards) ? cards : []).forEach((card) => {
      const id = String(card?.id || "").trim();
      if (!id) {
        return;
      }

      normalized[id] = normalizeTextStyleFlags(source[id], card);
    });

    station.textStyleValues = normalized;
  }

  function ensureStationTextPlacement(station, preset) {
    if (!station || typeof station !== "object") {
      return;
    }

    station.textPlacement = {
      slot: normalizeTextSlot(station?.textPlacement?.slot || preset?.textPlacement?.slot)
    };
  }
}

function getCommonValue(items, getter) {
  if (!items.length) {
    return "";
  }

  const first = getter(items[0]);
  const allSame = items.every((item) => getter(item) === first);
  return allSame ? first : "";
}

function toSvgDataUrl(svgText) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svgText || ""))}`;
}

function getTextStyleToolbarItems() {
  return [
    { flag: "bold", icon: "/img/icon-bold.svg", label: "加粗" },
    { flag: "italic", icon: "/img/icon-italic.svg", label: "斜体" },
    { flag: "underline", icon: "/img/icon-underline.svg", label: "下划线" },
    { flag: "strikethrough", icon: "/img/icon-strikethrough.svg", label: "删除线" }
  ];
}

function isSupportedTextStyleFlag(flag) {
  return getTextStyleToolbarItems().some((item) => item.flag === flag);
}

function buildTextStyleToolbarHtml({ scope, targetId, textStyle }) {
  const normalized = normalizeTextStyleFlags(textStyle);
  const safeTargetId = escapeHtml(String(targetId || ""));
  const targetAttr = scope === "station"
    ? `data-station-text-style-card-id="${safeTargetId}"`
    : `data-label-text-style-id="${safeTargetId}"`;

  const buttons = getTextStyleToolbarItems().map((item) => {
    const active = Boolean(normalized[item.flag]);
    const activeClass = active ? " active" : "";
    return `
      <button type="button" class="text-style-btn${activeClass}" ${targetAttr} data-text-style-flag="${item.flag}" aria-label="${item.label}" aria-pressed="${active ? "true" : "false"}">
        <img src="${item.icon}" alt="${item.label}" />
      </button>
    `;
  }).join("");

  return `<div class="text-style-toolbar">${buttons}</div>`;
}

function cssEscapeAttr(value) {
  const raw = String(value ?? "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(raw);
  }

  return raw.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
