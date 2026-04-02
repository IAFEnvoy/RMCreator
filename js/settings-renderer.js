import { geometryLabelMap } from "./constants.js";
import {
  applyTextInputStyle,
  clamp,
  escapeHtml,
  mergeColorAndAlpha,
  normalizeTextStyleFlags,
  splitColorAndAlpha
} from "./utils.js";
import {
  buildRenderableShapeSvg,
  normalizeShapeParameterDefault,
  normalizeShapeParameters,
  resolveShapeParametersWithValues,
  shapeParameterTypeDefinitions
} from "./shape/utils.js";
import {
  normalizeStationTextContent,
  normalizeStationTextCards,
  normalizeTextSlot
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
  renderTexts,
  moveLineInStack,
  applyStationType,
  getStationTypeIndexByStation,
  onStateChanged
}) {
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

    if (selectedLines.length !== 1) {
      state.lineMoveMode = null;
    }

    const typeCount = [selectedStations.length, selectedLines.length, selectedTexts.length, selectedShapes.length]
      .filter((count) => count > 0)
      .length;

    const summaryHtml = selectedEntities.length > 1
      ? `<div class="kv">已选择：车站 ${selectedStations.length} 个，线条 ${selectedLines.length} 条，文本 ${selectedTexts.length} 个，图形 ${selectedShapes.length} 个</div>`
      : "";

    if (typeCount > 1) {
      settingsBody.innerHTML = renderTemplate("settings-message", {
        summaryHtml,
        messageHtml: "<div class=\"kv\">当前包含多种类型，暂不提供批量属性设置。</div>"
      });
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
      }
      return;
    }

    if (selectedShapes.length > 0) {
      if (selectedShapes.length === 1) {
        renderSingleShape(selectedShapes[0], summaryHtml);
      } else {
        settingsBody.innerHTML = renderTemplate("settings-message", {
          summaryHtml,
          messageHtml: "<div class=\"kv\">图形多选暂不支持批量设置。</div>"
        });
      }
    }
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

    const textFieldsHtml = stationTextCards.length
      ? `
        <div class="station-instance-text-panel">
          <div class="station-instance-text-title">站点文本</div>
          ${stationTextCards.map((card, index) => {
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

    const paramFieldsHtml = stationParams
      .filter((param) => !param.locked)
      .map((param) => {
        const controlId = `stationParamValue-${escapeHtml(station.id)}-${escapeHtml(param.id)}`;
        const label = escapeHtml(param.label || shapeParameterTypeDefinitions[param.type]?.label || "参数");
        const typeLabel = escapeHtml(shapeParameterTypeDefinitions[param.type]?.label || "参数");
        const value = normalizeShapeParameterDefault(param.type, station.paramValues?.[param.id]);

        if (param.type === "color") {
          return `
            <div class="field">
              <label for="${controlId}">${label}（${typeLabel}）</label>
              <input id="${controlId}" data-station-param-id="${escapeHtml(param.id)}" data-station-param-type="${escapeHtml(param.type)}" type="color" value="${escapeHtml(String(value || "#2f5d9d"))}" />
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
      paramFieldsHtml: paramFieldsHtml || "<div class=\"kv\">当前车站类型没有可调整参数（已锁定参数不会显示）。</div>"
    });

    const stationTypeSelect = document.getElementById("stationTypeSelect");
    stationTypeSelect.addEventListener("change", () => {
      const nextIndex = Number(stationTypeSelect.value);
      applyStationType(station, nextIndex);
      renderStations();
      renderSettings();
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
      stationTypeOptions
    });

    const batchStationTypeSelect = document.getElementById("batchStationTypeSelect");
    batchStationTypeSelect.addEventListener("change", () => {
      if (batchStationTypeSelect.value === "") {
        return;
      }

      const nextIndex = Number(batchStationTypeSelect.value);
      stations.forEach((station) => applyStationType(station, nextIndex));
      renderStations();
      renderSettings();
      onStateChanged?.();
    });
  }

  function renderSingleLine(edge, summaryHtml) {
    const lineType = findLineType(edge.lineTypeId);
    if (!lineType) {
      settingsBody.innerHTML = renderTemplate("settings-message", {
        summaryHtml,
        messageHtml: "<div class=\"kv\">组件类型: 线</div>"
      });
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
    const colorListEditorHtml = colorList
      .map((color, idx) => {
        const parsed = splitColorAndAlpha(color);
        const alphaPercent = Math.round(parsed.alpha * 100);
        return `
        <div class="line-settings-color-item">
          <label for="lineColorRef${idx}">颜色${idx + 1}</label>
          <input id="lineColorRef${idx}" data-line-color-hex-index="${idx}" type="color" value="${escapeHtml(parsed.hex)}" />
          <div class="alpha-control">
            <span class="alpha-control-label" title="Alpha">A</span>
            <input data-line-color-alpha-index="${idx}" type="range" min="0" max="100" value="${alphaPercent}" />
            <input class="alpha-control-number" data-line-color-alpha-number-index="${idx}" type="number" min="0" max="100" step="1" value="${alphaPercent}" />
          </div>
        </div>
      `;
      })
      .join("");

    settingsBody.innerHTML = renderTemplate("settings-line-single", {
      summaryHtml,
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

    settingsBody.querySelectorAll("[data-line-color-hex-index]").forEach((hexInput) => {
      const index = Number(hexInput.dataset.lineColorHexIndex);
      const alphaInput = settingsBody.querySelector(`[data-line-color-alpha-index="${index}"]`);
      const alphaNumberInput = settingsBody.querySelector(`[data-line-color-alpha-number-index="${index}"]`);
      if (!alphaInput) {
        return;
      }

      const apply = () => {
        const alphaPercent = Math.round(clamp(Number(alphaInput.value) || 0, 0, 100));
        alphaInput.value = String(alphaPercent);
        if (alphaNumberInput) {
          alphaNumberInput.value = String(alphaPercent);
        }
        edge.colorList[index] = mergeColorAndAlpha(hexInput.value, alphaPercent / 100);
        renderLines();
        onStateChanged?.({ coalesceKey: "line-color" });
      };

      const applyFromNumber = () => {
        if (!alphaNumberInput) {
          apply();
          return;
        }

        const alphaPercent = Math.round(clamp(Number(alphaNumberInput.value) || 0, 0, 100));
        alphaInput.value = String(alphaPercent);
        alphaNumberInput.value = String(alphaPercent);
        edge.colorList[index] = mergeColorAndAlpha(hexInput.value, alphaPercent / 100);
        renderLines();
        onStateChanged?.({ coalesceKey: "line-color" });
      };

      hexInput.addEventListener("input", apply);
      alphaInput.addEventListener("input", apply);
      if (alphaNumberInput) {
        alphaNumberInput.addEventListener("input", applyFromNumber);
        alphaNumberInput.addEventListener("change", applyFromNumber);
      }
    });
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
    const colorInput = document.getElementById("textColor");
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

    colorInput.addEventListener("input", () => {
      label.color = colorInput.value;
      renderTexts();
      onStateChanged?.();
    });

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
  }

  function renderSingleShape(shapeInstance, summaryHtml) {
    const preset = state.shapeLibrary.find((item) => item.id === shapeInstance.shapeId);
    if (!preset) {
      settingsBody.innerHTML = renderTemplate("settings-message", {
        summaryHtml,
        messageHtml: "<div class=\"kv\">组件类型: 图形</div><div class=\"kv\">该图形引用的预制图形已不存在。</div>"
      });
      return;
    }

    const safeScale = clamp(Number(shapeInstance.scale) || 1, 0.1, 10);
    const resolvedParams = resolveShapeParametersWithValues(preset, shapeInstance.paramValues || {});

    const paramFieldsHtml = resolvedParams
      .map((param) => {
        const controlId = `shapeParamValue-${escapeHtml(shapeInstance.id)}-${escapeHtml(param.id)}`;
        const label = escapeHtml(param.label || shapeParameterTypeDefinitions[param.type]?.label || "参数");
        const typeLabel = escapeHtml(shapeParameterTypeDefinitions[param.type]?.label || "参数");

        if (param.type === "color") {
          return `
            <div class="field">
              <label for="${controlId}">${label}（${typeLabel}）</label>
              <input id="${controlId}" data-shape-param-id="${escapeHtml(param.id)}" type="color" value="${escapeHtml(String(param.defaultValue || "#2f5d9d"))}" />
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
      shapePreviewSrc: escapeHtml(toSvgDataUrl(buildRenderableShapeSvg(preset, shapeInstance.paramValues || {}))),
      paramFieldsHtml: paramFieldsHtml || "<div class=\"kv\">该图形没有可配置参数。</div>"
    });

    const scaleInput = document.getElementById("shapeScaleInput");
    scaleInput?.addEventListener("change", () => {
      shapeInstance.scale = clamp(Number(scaleInput.value) || 1, 0.1, 10);
      scaleInput.value = String(shapeInstance.scale);
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

  function ensureStationTextValues(station, cards) {
    if (!station || typeof station !== "object") {
      return;
    }

    const source = station.textValues && typeof station.textValues === "object"
      ? station.textValues
      : {};
    const normalized = {};

    (Array.isArray(cards) ? cards : []).forEach((card) => {
      const id = String(card?.id || "").trim();
      if (!id) {
        return;
      }

      if (Object.prototype.hasOwnProperty.call(source, id)) {
        normalized[id] = normalizeStationTextContent(source[id], Boolean(card?.allowMultiline));
      } else {
        normalized[id] = normalizeStationTextContent(card?.defaultValue ?? "", Boolean(card?.allowMultiline));
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
