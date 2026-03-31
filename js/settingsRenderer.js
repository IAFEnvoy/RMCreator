import { geometryLabelMap } from "./constants.js";
import {
  clamp,
  escapeHtml,
  mergeColorAndAlpha,
  splitColorAndAlpha
} from "./utils.js";
import {
  buildRenderableShapeSvg,
  resolveShapeParametersWithValues,
  shapeParameterTypeDefinitions
} from "./shape/utils.js";

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
  applyStationType,
  getStationTypeIndexByStation,
  onStateChanged
}) {
  return function renderSettings() {
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

    const typeCount = [selectedStations.length, selectedLines.length, selectedTexts.length, selectedShapes.length]
      .filter((count) => count > 0)
      .length;

    const summaryHtml = selectedEntities.length > 1
      ? `<div class="kv">已选择：车站 ${selectedStations.length} 个，线条 ${selectedLines.length} 条，文本 ${selectedTexts.length} 个，图形 ${selectedShapes.length} 个</div>`
      : "";

    if (typeCount > 1) {
      settingsBody.innerHTML = `${summaryHtml}<div class="kv">当前包含多种类型，暂不提供批量属性设置。</div>`;
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
        settingsBody.innerHTML = `${summaryHtml}<div class="kv">文本多选暂不支持批量设置。</div>`;
      }
      return;
    }

    if (selectedShapes.length > 0) {
      if (selectedShapes.length === 1) {
        renderSingleShape(selectedShapes[0], summaryHtml);
      } else {
        settingsBody.innerHTML = `${summaryHtml}<div class="kv">图形多选暂不支持批量设置。</div>`;
      }
    }
  };

  function renderSingleStation(station, summaryHtml) {
    const currentTypeIndex = getStationTypeIndexByStation(station);
    const stationTypeOptions = state.stationTypes
      .map((type, index) => `<option value="${index}" ${index === currentTypeIndex ? "selected" : ""}>${escapeHtml(type.name)}</option>`)
      .join("");

    settingsBody.innerHTML = `
      ${summaryHtml}
      <div class="kv">组件类型: 车站</div>
      <div class="field">
        <label for="stationTypeSelect">车站类型</label>
        <select id="stationTypeSelect">${stationTypeOptions}</select>
      </div>
      <div class="kv">再次按住并拖动该车站，可调整位置。</div>
    `;

    const stationTypeSelect = document.getElementById("stationTypeSelect");
    stationTypeSelect.addEventListener("change", () => {
      const nextIndex = Number(stationTypeSelect.value);
      applyStationType(station, nextIndex);
      renderStations();
      renderSettings();
      onStateChanged?.();
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

    settingsBody.innerHTML = `
      ${summaryHtml}
      <div class="kv">组件类型: 车站（批量设置）</div>
      <div class="field">
        <label for="batchStationTypeSelect">车站类型</label>
        <select id="batchStationTypeSelect">${stationTypeOptions}</select>
      </div>
    `;

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
      settingsBody.innerHTML = `${summaryHtml}<div class="kv">组件类型: 线</div>`;
      return;
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

    settingsBody.innerHTML = `
      ${summaryHtml}
      <div class="kv">组件类型: 线</div>
      <div class="field">
        <label for="lineTypeSelect">线条类型</label>
        <select id="lineTypeSelect">${lineTypeOptions}</select>
      </div>
      <div class="field">
        <label for="lineGeometrySelect">几何类型</label>
        <select id="lineGeometrySelect">${geometryOptions}</select>
      </div>
      <div class="field field-toggle">
        <label for="lineFlip">翻转形状</label>
        <label class="toggle-switch" for="lineFlip">
          <input id="lineFlip" class="toggle-checkbox" type="checkbox" ${edge.flip ? "checked" : ""} />
          <span class="toggle-slider" aria-hidden="true"></span>
        </label>
      </div>
      <div class="field field-toggle">
        <label for="lineFlipColor">翻转颜色</label>
        <label class="toggle-switch" for="lineFlipColor">
          <input id="lineFlipColor" class="toggle-checkbox" type="checkbox" ${edge.flipColor ? "checked" : ""} />
          <span class="toggle-slider" aria-hidden="true"></span>
        </label>
      </div>
      <div class="field">
        <label for="lineCornerRadius">转弯圆弧半径</label>
        <input id="lineCornerRadius" type="number" min="0" max="120" step="1" value="${Number(edge.cornerRadius) || 0}" />
      </div>
      <div class="field">
        <label for="lineStartOffset">起点偏移量</label>
        <input id="lineStartOffset" type="number" min="-120" max="120" step="1" value="${Number(edge.startOffset) || 0}" />
      </div>
      <div class="field">
        <label for="lineEndOffset">终点偏移量</label>
        <input id="lineEndOffset" type="number" min="-120" max="120" step="1" value="${Number(edge.endOffset) || 0}" />
      </div>
      <div class="field">
        <label>颜色列表</label>
        <div class="line-settings-color-list">${colorListEditorHtml}</div>
      </div>
    `;

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

    settingsBody.innerHTML = `
      ${summaryHtml}
      <div class="kv">组件类型: 线（批量设置）</div>
      <div class="field">
        <label for="batchLineTypeSelect">线条类型</label>
        <select id="batchLineTypeSelect">${lineTypeOptions}</select>
      </div>
      <div class="field">
        <label for="batchLineGeometrySelect">几何类型</label>
        <select id="batchLineGeometrySelect">${geometryOptions}</select>
      </div>
      <div class="field">
        <label for="batchLineFlipSelect">翻转形状</label>
        <select id="batchLineFlipSelect">
          <option value="" ${commonFlip ? "" : "selected"}>保持当前（混合）</option>
          <option value="true" ${commonFlip === "true" ? "selected" : ""}>是</option>
          <option value="false" ${commonFlip === "false" ? "selected" : ""}>否</option>
        </select>
      </div>
      <div class="field">
        <label for="batchLineFlipColorSelect">翻转颜色</label>
        <select id="batchLineFlipColorSelect">
          <option value="" ${commonFlipColor ? "" : "selected"}>保持当前（混合）</option>
          <option value="true" ${commonFlipColor === "true" ? "selected" : ""}>是</option>
          <option value="false" ${commonFlipColor === "false" ? "selected" : ""}>否</option>
        </select>
      </div>
      <div class="field">
        <label for="batchLineCornerRadius">转弯圆弧半径</label>
        <input id="batchLineCornerRadius" type="number" min="0" max="120" step="1" value="${commonCorner || ""}" placeholder="保持当前（混合）" />
      </div>
      <div class="field">
        <label for="batchLineStartOffset">起点偏移量</label>
        <input id="batchLineStartOffset" type="number" min="-120" max="120" step="1" value="${commonStartOffset || ""}" placeholder="保持当前（混合）" />
      </div>
      <div class="field">
        <label for="batchLineEndOffset">终点偏移量</label>
        <input id="batchLineEndOffset" type="number" min="-120" max="120" step="1" value="${commonEndOffset || ""}" placeholder="保持当前（混合）" />
      </div>
      <div class="kv">提示：批量模式下暂不支持颜色列表编辑。</div>
    `;

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
    settingsBody.innerHTML = `
      ${summaryHtml}
      <div class="kv">组件类型: 文本</div>
      <div class="field">
        <label for="textValue">内容</label>
        <textarea id="textValue">${escapeHtml(label.value)}</textarea>
      </div>
      <div class="field">
        <label for="textFont">字体</label>
        <select id="textFont">
          <option value="Segoe UI">Segoe UI</option>
          <option value="Microsoft YaHei">Microsoft YaHei</option>
          <option value="SimSun">SimSun</option>
          <option value="Arial">Arial</option>
        </select>
      </div>
      <div class="field">
        <label for="textColor">颜色</label>
        <input id="textColor" type="color" value="${label.color}" />
      </div>
    `;

    const valueInput = document.getElementById("textValue");
    const fontSelect = document.getElementById("textFont");
    const colorInput = document.getElementById("textColor");

    fontSelect.value = label.fontFamily;

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
  }

  function renderSingleShape(shapeInstance, summaryHtml) {
    const preset = state.shapeLibrary.find((item) => item.id === shapeInstance.shapeId);
    if (!preset) {
      settingsBody.innerHTML = `${summaryHtml}<div class="kv">组件类型: 图形</div><div class="kv">该图形引用的预制图形已不存在。</div>`;
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

    settingsBody.innerHTML = `
      ${summaryHtml}
      <div class="kv">组件类型: 图形</div>
      <div class="kv">预制图形: ${escapeHtml(preset.name || "图形")}</div>
      <div class="field">
        <label for="shapeScaleInput">缩放比例</label>
        <input id="shapeScaleInput" type="number" min="0.1" max="10" step="0.1" value="${safeScale}" />
      </div>
      <div class="field">
        <label>参数预览</label>
        <img class="menu-item-shape-preview" alt="图形预览" src="${escapeHtml(toSvgDataUrl(buildRenderableShapeSvg(preset, shapeInstance.paramValues || {})))}" />
      </div>
      ${paramFieldsHtml || '<div class="kv">该图形没有可配置参数。</div>'}
      <div class="kv">提示：可再次按住并拖动该图形调整位置。</div>
    `;

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
