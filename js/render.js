import { svgNs } from "./dom.js";
import { geometryLabelMap, lineStyleMap } from "./constants.js";
import {
  applyEndpointOffsets,
  buildPathD,
  getLinePoints,
  getOffsetPolyline,
  getParallelOffsets
} from "./line/geometry.js";
import { resolveSegmentColor } from "./line/type-store.js";
import {
  clamp,
  getSvgTextDecoration,
  formatColorWithAlpha,
  normalizeColor,
  normalizeTextStyleFlags
} from "./utils.js";
import { createSettingsRenderer } from "./settings-renderer.js";
import { getTemplate } from "./template-store.js";
import { buildRenderableShapeSvg } from "./shape/utils.js";
import {
  appendStationTexts,
  buildShapeParamValuesFromRuntime,
  buildStationRuntimeParamMap
} from "./station/text-utils.js";
import { loadVersion } from "./version.js";

export function createRenderer({
  state,
  elements,
  findLineType,
  getColorListDefault,
  colorPicker,
  openLineManager,
  openShapeManager,
  openStationManager,
  onAppSettingsChanged,
  moveLineInStack,
  applyStationType,
  getStationTypeIndexByStation,
  onStateChanged
}) {
  const {
    svg,
    viewport,
    stationLayer,
    lineLayer,
    shapeLayer,
    textLayer,
    linePreview,
    toolStrip,
    submenuTitle,
    submenuItems,
    settingsPanel,
    settingsBody,
    zoomIndicator,
    shortcutsModal
  } = elements;

  let shapeGhostEl = null;
  let stationGhostEl = null;
  let shortcutsModalBound = false;
  let shortcutsKeyHandler = null;

  const ensureShortcutsModalContent = () => {
    if (!shortcutsModal) {
      return null;
    }
    if (!shortcutsModal.dataset.ready) {
      shortcutsModal.innerHTML = getTemplate("shortcuts-modal");
      shortcutsModal.dataset.ready = "true";
    }
    return shortcutsModal.querySelector("#closeShortcutsBtn");
  };

  const openShortcutsModal = () => {
    ensureShortcutsModalContent();
    bindShortcutsModal();
    if (shortcutsModal) {
      shortcutsModal.hidden = false;
    }
    if (!shortcutsKeyHandler) {
      shortcutsKeyHandler = (event) => {
        if (event.key === "Escape") {
          closeShortcutsModal();
        }
      };
      window.addEventListener("keydown", shortcutsKeyHandler);
    }
  };

  const closeShortcutsModal = () => {
    if (shortcutsModal) {
      shortcutsModal.hidden = true;
    }
    if (shortcutsKeyHandler) {
      window.removeEventListener("keydown", shortcutsKeyHandler);
      shortcutsKeyHandler = null;
    }
  };

  const bindShortcutsModal = () => {
    if (shortcutsModalBound) {
      return;
    }
    shortcutsModalBound = true;
    if (shortcutsModal) {
      shortcutsModal.addEventListener("click", (event) => {
        const closeBtn = event.target.closest("#closeShortcutsBtn");
        if (closeBtn) {
          closeShortcutsModal();
          return;
        }
        if (event.target === shortcutsModal) {
          closeShortcutsModal();
        }
      });
    }
  };

  function setActiveToolButton() {
    toolStrip.querySelectorAll(".tool-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === state.activeTool);
    });

    svg.classList.toggle("select-tool-active", state.activeTool === "select");
    svg.classList.toggle("line-tool-active", state.activeTool === "line");
    svg.classList.toggle("text-tool-active", state.activeTool === "text");
  }

  function renderSubmenu() {
    submenuItems.innerHTML = "";

    if (state.activeTool === "station") {
      submenuTitle.textContent = "车站样式";
      submenuItems.innerHTML = getTemplate("submenu-station");

      const managerBtn = submenuItems.querySelector("[data-action=\"open-station-manager\"]");
      managerBtn?.addEventListener("click", () => openStationManager?.());

      const stationList = submenuItems.querySelector("[data-list=\"station-types\"]") || submenuItems;

      state.stationTypes.forEach((item, index) => {
        const button = document.createElement("button");
        button.className = "menu-item";
        button.textContent = item.name;
        button.classList.toggle("active", state.menuSelection.station === index);
        button.addEventListener("click", () => {
          state.menuSelection.station = state.menuSelection.station === index ? null : index;
          hideStationGhost();
          renderSubmenu();
        });
        stationList.appendChild(button);
      });
      return;
    }

    if (state.activeTool === "line") {
      submenuTitle.textContent = "连线工具";
      submenuItems.innerHTML = getTemplate("submenu-line");

      const managerBtn = submenuItems.querySelector("[data-action=\"open-line-manager\"]");
      managerBtn?.addEventListener("click", () => openLineManager());

      const geometryList = submenuItems.querySelector("[data-list=\"line-geometries\"]") || submenuItems;

      Object.entries(geometryLabelMap).forEach(([geometryKey, geometryLabel]) => {
        const button = document.createElement("button");
        button.className = "menu-item";
        button.textContent = geometryLabel;
        button.classList.toggle("active", state.menuSelection.lineGeometry === geometryKey);
        button.addEventListener("click", () => {
          state.menuSelection.lineGeometry = state.menuSelection.lineGeometry === geometryKey ? null : geometryKey;
          renderSubmenu();
        });
        geometryList.appendChild(button);
      });

      const lineTypeList = submenuItems.querySelector("[data-list=\"line-types\"]") || submenuItems;

      const usageCountByTypeId = new Map();
      state.edges.forEach((edge) => {
        const key = String(edge.lineTypeId || "");
        usageCountByTypeId.set(key, (usageCountByTypeId.get(key) || 0) + 1);
      });

      state.lineTypes.forEach((item) => {
        const button = document.createElement("button");
        button.className = "menu-item menu-item-line-type";

        const row = document.createElement("div");
        row.className = "menu-item-line-row";

        const title = document.createElement("span");
        title.className = "menu-item-line-title";
        title.textContent = item.name;
        title.classList.toggle("temporary-imported", Boolean(item.isTemporaryImported));

        const preview = document.createElementNS(svgNs, "svg");
        preview.setAttribute("viewBox", "0 0 86 22");
        preview.setAttribute("class", "menu-item-line-preview");
        renderLineTypePreviewSvg(preview, item);

        row.appendChild(title);
        row.appendChild(preview);
        button.appendChild(row);

        button.classList.toggle("active", state.menuSelection.lineType === item.id);
        button.addEventListener("click", () => {
          state.menuSelection.lineType = state.menuSelection.lineType === item.id ? null : item.id;
          renderSubmenu();
        });
        lineTypeList.appendChild(button);
      });
      return;
    }

    if (state.activeTool === "text") {
      submenuTitle.textContent = "文本工具已启用";
      submenuItems.innerHTML = getTemplate("submenu-text");
      return;
    }

    if (state.activeTool === "shape") {
      submenuTitle.textContent = "图形工具";
      submenuItems.innerHTML = getTemplate("submenu-shape");

      const managerBtn = submenuItems.querySelector("[data-action=\"open-shape-manager\"]");
      managerBtn?.addEventListener("click", () => openShapeManager?.());

      const shapeList = submenuItems.querySelector("[data-list=\"shape-library\"]") || submenuItems;

      if (state.menuSelection.shape && !state.shapeLibrary.some((item) => item.id === state.menuSelection.shape)) {
        state.menuSelection.shape = null;
      }

      if (!state.shapeLibrary.length) {
        shapeList.innerHTML = getTemplate("submenu-shape-empty");
        return;
      }

      state.shapeLibrary.forEach((shape) => {
        const button = document.createElement("button");
        button.className = "menu-item menu-item-shape";
        button.classList.toggle("active", state.menuSelection.shape === shape.id);

        const row = document.createElement("div");
        row.className = "menu-item-shape-row";

        const title = document.createElement("span");
        title.className = "menu-item-shape-title";
        title.textContent = shape.name;

        const preview = document.createElement("img");
        preview.className = "menu-item-shape-preview";
        preview.alt = `${shape.name}预览`;
        preview.src = toSvgDataUrl(shape.svg);

        row.appendChild(title);
        row.appendChild(preview);
        button.appendChild(row);

        button.addEventListener("click", () => {
          state.menuSelection.shape = state.menuSelection.shape === shape.id ? null : shape.id;
          renderSubmenu();
        });

        shapeList.appendChild(button);
      });

      return;
    }

    if (state.activeTool === "settings") {
      submenuTitle.textContent = "设置";
      submenuItems.innerHTML = getTemplate("submenu-settings");

      const shortcutBtn = submenuItems.querySelector("#openShortcutModalBtn");
      if (shortcutBtn) {
        bindShortcutsModal();
        shortcutBtn.addEventListener("click", () => {
          openShortcutsModal();
        });
      }

      const continuousSelectInput = submenuItems.querySelector("#continuousSelectModeToggle");
      if (continuousSelectInput) {
        continuousSelectInput.checked = state.appSettings?.continuousSelectMode !== false;
        continuousSelectInput.addEventListener("change", () => {
          onAppSettingsChanged?.({ continuousSelectMode: continuousSelectInput.checked });
        });
      }

      const continuousStationInput = submenuItems.querySelector("#continuousStationModeToggle");
      if (continuousStationInput) {
        continuousStationInput.checked = state.appSettings?.continuousStationMode !== false;
        continuousStationInput.addEventListener("change", () => {
          onAppSettingsChanged?.({ continuousStationMode: continuousStationInput.checked });
        });
      }

      const continuousInput = submenuItems.querySelector("#continuousLineModeToggle");
      if (continuousInput) {
        continuousInput.checked = state.appSettings?.continuousLineMode !== false;
        continuousInput.addEventListener("change", () => {
          onAppSettingsChanged?.({ continuousLineMode: continuousInput.checked });
        });
      }

      const continuousTextInput = submenuItems.querySelector("#continuousTextModeToggle");
      if (continuousTextInput) {
        continuousTextInput.checked = state.appSettings?.continuousTextMode !== false;
        continuousTextInput.addEventListener("change", () => {
          onAppSettingsChanged?.({ continuousTextMode: continuousTextInput.checked });
        });
      }

      const shapeContinuousInput = submenuItems.querySelector("#continuousShapeModeToggle");
      if (shapeContinuousInput) {
        shapeContinuousInput.checked = state.appSettings?.continuousShapeMode !== false;
        shapeContinuousInput.addEventListener("change", () => {
          onAppSettingsChanged?.({ continuousShapeMode: shapeContinuousInput.checked });
        });
      }

      const gridInput = submenuItems.querySelector("#showGridToggle");
      if (gridInput) {
        gridInput.checked = state.appSettings?.showGrid !== false;
        gridInput.addEventListener("change", () => {
          onAppSettingsChanged?.({ showGrid: gridInput.checked });
        });
      }

      const arrowPanInput = submenuItems.querySelector("#arrowKeyPanToggle");
      if (arrowPanInput) {
        arrowPanInput.checked = state.appSettings?.arrowKeyPan !== false;
        arrowPanInput.addEventListener("change", () => {
          onAppSettingsChanged?.({ arrowKeyPan: arrowPanInput.checked });
        });
      }

      const applyColorButton = (button, color) => {
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
      };

      const glowButton = submenuItems.querySelector("#selectionGlowColor");
      if (glowButton) {
        applyColorButton(glowButton, state.appSettings?.selectionGlowColor || "#2f6de5");
        glowButton.addEventListener("click", () => {
          if (!colorPicker) {
            return;
          }
          colorPicker.open({
            color: glowButton.dataset.colorValue,
            title: "选择框颜色",
            onConfirm: (nextColor) => {
              applyColorButton(glowButton, nextColor);
              onAppSettingsChanged?.({ selectionGlowColor: nextColor });
            }
          });
        });
      }

      const themeAccentButton = submenuItems.querySelector("#themeAccentColor");
      if (themeAccentButton) {
        applyColorButton(themeAccentButton, state.appSettings?.themeAccentColor || "#2f6de5");
        themeAccentButton.addEventListener("click", () => {
          if (!colorPicker) {
            return;
          }
          colorPicker.open({
            color: themeAccentButton.dataset.colorValue,
            title: "主题色",
            onConfirm: (nextColor) => {
              applyColorButton(themeAccentButton, nextColor);
              onAppSettingsChanged?.({ themeAccentColor: nextColor });
            }
          });
        });
      }

      const glowSizeInput = submenuItems.querySelector("#selectionGlowSize");
      if (glowSizeInput) {
        glowSizeInput.value = String(Number(state.appSettings?.selectionGlowSize || 4));
        glowSizeInput.addEventListener("change", () => {
          const raw = Number(glowSizeInput.value);
          if (!Number.isFinite(raw)) {
            glowSizeInput.value = String(Number(state.appSettings?.selectionGlowSize || 4));
            return;
          }
          const clamped = Math.min(30, Math.max(1, raw));
          onAppSettingsChanged?.({ selectionGlowSize: clamped });
        });
      }

      const equalSpacingOffsetInput = submenuItems.querySelector("#snapEqualSpacingOffset");
      if (equalSpacingOffsetInput) {
        equalSpacingOffsetInput.value = String(Number(state.appSettings?.snapEqualSpacingOffset || 12));
        equalSpacingOffsetInput.addEventListener("change", () => {
          const raw = Number(equalSpacingOffsetInput.value);
          if (!Number.isFinite(raw)) {
            equalSpacingOffsetInput.value = String(Number(state.appSettings?.snapEqualSpacingOffset || 12));
            return;
          }
          const clamped = Math.min(80, Math.max(4, raw));
          onAppSettingsChanged?.({ snapEqualSpacingOffset: clamped });
        });
      }

      const snapOverlapInput = submenuItems.querySelector("#snapOverlapToggle");
      if (snapOverlapInput) {
        snapOverlapInput.checked = state.appSettings?.snapOverlap !== false;
        snapOverlapInput.addEventListener("change", () => {
          onAppSettingsChanged?.({ snapOverlap: snapOverlapInput.checked });
        });
      }

      const snapAxisDiagonalInput = submenuItems.querySelector("#snapAxisDiagonalToggle");
      if (snapAxisDiagonalInput) {
        snapAxisDiagonalInput.checked = state.appSettings?.snapAxisDiagonal !== false;
        snapAxisDiagonalInput.addEventListener("change", () => {
          onAppSettingsChanged?.({ snapAxisDiagonal: snapAxisDiagonalInput.checked });
        });
      }

      const snapEqualSpacingInput = submenuItems.querySelector("#snapEqualSpacingToggle");
      if (snapEqualSpacingInput) {
        snapEqualSpacingInput.checked = state.appSettings?.snapEqualSpacing !== false;
        snapEqualSpacingInput.addEventListener("change", () => {
          onAppSettingsChanged?.({ snapEqualSpacing: snapEqualSpacingInput.checked });
        });
      }

      const snapGridInput = submenuItems.querySelector("#snapGridToggle");
      if (snapGridInput) {
        snapGridInput.checked = state.appSettings?.snapGrid !== false;
        snapGridInput.addEventListener("change", () => {
          onAppSettingsChanged?.({ snapGrid: snapGridInput.checked });
        });
      }

      const geometrySelect = submenuItems.querySelector("#defaultLineGeometrySelect");
      if (geometrySelect) {
        geometrySelect.innerHTML = "";
        Object.entries(geometryLabelMap).forEach(([key, label]) => {
          const option = document.createElement("option");
          option.value = key;
          option.textContent = label;
          geometrySelect.appendChild(option);
        });
        geometrySelect.value = state.appSettings?.defaultLineGeometry || "bend135";
        geometrySelect.addEventListener("change", () => {
          onAppSettingsChanged?.({ defaultLineGeometry: geometrySelect.value });
        });
      }

      return;
    }

    if (state.activeTool === "about") {
      submenuTitle.textContent = "关于";
      submenuItems.innerHTML = getTemplate("submenu-about");
      loadVersion();
      return;
    }

    if (state.activeTool === "select") {
      submenuTitle.textContent = "选择工具已启用";
      submenuItems.innerHTML = getTemplate("submenu-select-tip");
      return;
    }

    submenuTitle.textContent = "请选择工具";
    submenuItems.innerHTML = getTemplate("submenu-idle");
  }

  function renderStations() {
    stationLayer.innerHTML = "";

    state.nodes.forEach((station) => {
      const preset = getStationPresetByStation(station);
      const group = document.createElementNS(svgNs, "g");
      group.setAttribute("data-station-id", station.id);

      if (preset?.virtualNode) {
        group.setAttribute("data-virtual-node", "true");
      }

      const renderedByShape = renderStationShape(group, station, preset);
      if (renderedByShape) {
        stationLayer.appendChild(group);
        return;
      }

      const base = document.createElementNS(svgNs, "circle");
      base.setAttribute("cx", String(station.x));
      base.setAttribute("cy", String(station.y));
      base.setAttribute("r", String(station.radius));
      base.setAttribute("class", station.oval ? "station interchange" : "station");

      if (isSelected("station", station.id)) {
        base.classList.add("selected-shape");
      }

      group.appendChild(base);

      if (station.oval) {
        const inner = document.createElementNS(svgNs, "circle");
        inner.setAttribute("cx", String(station.x));
        inner.setAttribute("cy", String(station.y));
        inner.setAttribute("r", String(Math.max(2, station.radius - 4)));
        inner.setAttribute("fill", "none");
        inner.setAttribute("stroke", "#203554");
        inner.setAttribute("stroke-width", "1.5");
        inner.setAttribute("pointer-events", "none");
        group.appendChild(inner);
      }

      renderStationTextsFallback(group, station, preset);

      stationLayer.appendChild(group);
    });
  }

  function renderStationShape(group, station, preset) {
    if (!preset?.shapeId) {
      return false;
    }

    const shape = state.shapeLibrary.find((item) => item.id === preset.shapeId);
    if (!shape) {
      return false;
    }

    const runtimeParams = buildStationRuntimeParamMap({
      preset,
      shape,
      stationParamValues: station.paramValues
    });
    const resolvedSvg = buildRenderableShapeSvg(shape, buildShapeParamValuesFromRuntime(shape, runtimeParams));
    const parsed = parseShapeSvgContent(resolvedSvg);
    if (!parsed || !parsed.nodes.length) {
      return false;
    }

    const shapeRenderScale = 0.25;
    const cx = parsed.minX + parsed.width / 2;
    const cy = parsed.minY + parsed.height / 2;

    group.setAttribute("transform", `translate(${Number(station.x) || 0} ${Number(station.y) || 0})`);

    if (isSelected("station", station.id)) {
      group.classList.add("selected-shape");
    }

    const shapeGroup = document.createElementNS(svgNs, "g");
    shapeGroup.setAttribute(
      "transform",
      `scale(${shapeRenderScale}) translate(${-cx} ${-cy})`
    );
    parsed.nodes.forEach((node) => shapeGroup.appendChild(node));
    group.appendChild(shapeGroup);

    appendStationTexts({
      container: group,
      preset,
      runtimeParamMap: runtimeParams,
      centerX: 0,
      centerY: 0,
      pointerEvents: "none",
      textValueMap: station.textValues,
      placementOverride: station.textPlacement
    });
    return true;
  }

  function getStationPresetByStation(station) {
    const sourceType = Number.isInteger(station?.stationTypeIndex)
      ? state.stationTypes[station.stationTypeIndex]
      : null;
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

    if (station.stationTypeIndex >= 0 && station.stationTypeIndex < state.stationLibrary.length) {
      return state.stationLibrary[station.stationTypeIndex] || null;
    }

    return null;
  }

  function renderStationTextsFallback(group, station, preset) {
    if (!preset) {
      return;
    }

    const runtimeParams = buildStationRuntimeParamMap({
      preset,
      shape: null,
      stationParamValues: station.paramValues
    });

    appendStationTexts({
      container: group,
      preset,
      runtimeParamMap: runtimeParams,
      centerX: Number(station.x) || 0,
      centerY: Number(station.y) || 0,
      pointerEvents: "none",
      textValueMap: station.textValues,
      placementOverride: station.textPlacement
    });
  }

  function ensureEdgeColorList(edge, lineType) {
    const defaults = getColorListDefault(lineType).map((color) => normalizeColor(color));
    const current = Array.isArray(edge.colorList) ? edge.colorList.map((color) => normalizeColor(color)) : [];

    const next = defaults.map((defaultColor, index) => current[index] || defaultColor);
    edge.colorList = next;
    return next;
  }

  function renderLines() {
    lineLayer.innerHTML = "";

    state.edges.forEach((edge) => {
      const from = state.nodes.find((node) => node.id === edge.fromStationId);
      const to = state.nodes.find((node) => node.id === edge.toStationId);
      const type = findLineType(edge.lineTypeId);
      if (!from || !to || !type) {
        return;
      }

      const edgeColorList = ensureEdgeColorList(edge, type);

      const points = getLinePoints(edge.geometry || "straight", from, to, { flip: edge.flip });
      const baseLine = applyEndpointOffsets(points, Number(edge.startOffset) || 0, Number(edge.endOffset) || 0);
      const segmentsForRender = edge.flipColor ? [...type.segments].reverse() : type.segments;
      const overlapGap = getSegmentOverlapGap(edge, baseLine);
      const offsets = getParallelOffsets(segmentsForRender.map((segment) => segment.width), overlapGap);
      const geometry = edge.geometry || "straight";
      const useSegmentCornerRadius = geometry === "bend90" || geometry === "bend90rot45";
      const radiusOffsets = getParallelOffsets(segmentsForRender.map((segment) => segment.width), 0);
      const cornerRadiusBase = Math.max(0, Number(edge.cornerRadius) || 0);
      const turnSign = getTurnSign(baseLine);

      segmentsForRender.forEach((segStyle, index) => {
        const color = resolveSegmentColor(segStyle, edgeColorList);
        const offsetPoints = getOffsetPolyline(baseLine, offsets[index] || 0);
        const radiusOffset = radiusOffsets[index] || 0;
        const cornerRadius = useSegmentCornerRadius
          ? Math.max(0, cornerRadiusBase - turnSign * radiusOffset)
          : cornerRadiusBase;

        const path = document.createElementNS(svgNs, "path");
        path.setAttribute("d", buildPathD(offsetPoints, cornerRadius));
        path.setAttribute("stroke", color);
        path.setAttribute("stroke-width", String(segStyle.width));
        path.setAttribute("stroke-linecap", segStyle.roundCap ? "round" : "butt");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("fill", "none");
        path.setAttribute("class", "link-line");
        path.setAttribute("data-line-id", edge.id);
        path.setAttribute("stroke-dasharray", getSegmentDasharray(segStyle));

        if (isSelected("line", edge.id)) {
          path.classList.add("selected-shape");
        }

        lineLayer.appendChild(path);
      });
    });
  }

  function renderShapes() {
    if (!shapeLayer) {
      return;
    }

    shapeLayer.innerHTML = "";
    (Array.isArray(state.shapes) ? state.shapes : []).forEach((shapeInstance) => {
      const definition = state.shapeLibrary.find((item) => item.id === shapeInstance.shapeId);
      if (!definition) {
        return;
      }

      const resolvedSvg = buildRenderableShapeSvg(definition, shapeInstance.paramValues);
      const parsed = parseShapeSvgContent(resolvedSvg);
      if (!parsed || !parsed.nodes.length) {
        return;
      }

      const scale = clamp(Number(shapeInstance.scale) || 1, 0.1, 10);
      const cx = parsed.minX + parsed.width / 2;
      const cy = parsed.minY + parsed.height / 2;

      const group = document.createElementNS(svgNs, "g");
      group.setAttribute("data-shape-id", String(shapeInstance.id));
      group.setAttribute("class", "placed-shape-instance");
      group.setAttribute(
        "transform",
        `translate(${Number(shapeInstance.x) || 0} ${Number(shapeInstance.y) || 0}) scale(${scale}) translate(${-cx} ${-cy})`
      );

      if (isSelected("shape", shapeInstance.id)) {
        group.classList.add("selected-shape");
      }

      parsed.nodes.forEach((node) => group.appendChild(node));
      shapeLayer.appendChild(group);
    });
  }

  function renderTexts() {
    textLayer.innerHTML = "";

    state.labels.forEach((label) => {
      const textStyle = normalizeTextStyleFlags(label);
      const text = document.createElementNS(svgNs, "text");
      text.setAttribute("x", String(label.x));
      text.setAttribute("y", String(label.y));
      text.setAttribute("fill", label.color);
      text.setAttribute("font-size", String(label.fontSize));
      text.setAttribute("font-family", label.fontFamily);
      text.setAttribute("font-weight", textStyle.bold ? "700" : "400");
      text.setAttribute("font-style", textStyle.italic ? "italic" : "normal");
      text.setAttribute("text-decoration", getSvgTextDecoration(textStyle));
      text.setAttribute("class", "node-text");
      text.setAttribute("data-text-id", label.id);
      text.setAttribute("dominant-baseline", "hanging");

      const lines = String(label.value).split("\n");
      lines.forEach((lineValue, index) => {
        const tspan = document.createElementNS(svgNs, "tspan");
        tspan.setAttribute("x", String(label.x));
        tspan.setAttribute("dy", index === 0 ? "0" : "1.2em");
        tspan.textContent = lineValue.length ? lineValue : " ";
        text.appendChild(tspan);
      });

      if (isSelected("text", label.id)) {
        text.classList.add("selected-shape");
      }

      textLayer.appendChild(text);
    });
  }

  const renderSettings = createSettingsRenderer({
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
    colorPicker,
    onStateChanged
  });

  function drawLinePreview(start, end, lineType, geometry) {
    const points = getLinePoints(geometry, start, end, { flip: false });
    const first = lineType.segments[0] || {
      width: 5,
      strokeStyle: "solid",
      colorMode: "fixed",
      paletteIndex: 0,
      fixedColor: "#2f5d9dff"
    };
    linePreview.setAttribute("d", buildPathD(points));
    linePreview.setAttribute("stroke", resolveSegmentColor(first, lineType.colorList || []));
    linePreview.setAttribute("stroke-width", String(first.width));
    linePreview.setAttribute("stroke-linecap", first.roundCap ? "round" : "butt");
    linePreview.setAttribute("stroke-dasharray", getSegmentDasharray(first));
    linePreview.setAttribute("fill", "none");
    linePreview.setAttribute("visibility", "visible");
  }

  function drawShapeGhost(point, shapeId) {
    if (!shapeLayer) {
      return;
    }

    const definition = state.shapeLibrary.find((item) => item.id === shapeId);
    if (!definition) {
      hideShapeGhost();
      return;
    }

    const resolvedSvg = buildRenderableShapeSvg(definition, null);
    const parsed = parseShapeSvgContent(resolvedSvg);
    if (!parsed || !parsed.nodes.length) {
      hideShapeGhost();
      return;
    }

    if (shapeGhostEl?.parentNode) {
      shapeGhostEl.parentNode.removeChild(shapeGhostEl);
    }

    const cx = parsed.minX + parsed.width / 2;
    const cy = parsed.minY + parsed.height / 2;
    const group = document.createElementNS(svgNs, "g");
    group.setAttribute("class", "placed-shape-ghost");
    group.setAttribute(
      "transform",
      `translate(${Number(point?.x) || 0} ${Number(point?.y) || 0}) scale(0.25) translate(${-cx} ${-cy})`
    );

    parsed.nodes.forEach((node) => group.appendChild(node));
    shapeLayer.appendChild(group);
    shapeGhostEl = group;
  }

  function drawStationGhost(point, stationTypeIndex) {
    if (!stationLayer) {
      return;
    }

    const sourceType = Number.isInteger(stationTypeIndex)
      ? state.stationTypes[stationTypeIndex]
      : null;
    if (!sourceType) {
      hideStationGhost();
      return;
    }

    if (stationGhostEl?.parentNode) {
      stationGhostEl.parentNode.removeChild(stationGhostEl);
    }

    const x = Number(point?.x) || 0;
    const y = Number(point?.y) || 0;
    const group = document.createElementNS(svgNs, "g");
    group.setAttribute("class", "placed-station-ghost");
    group.setAttribute("transform", `translate(${x} ${y})`);

    const preset = getStationPresetByTypeIndex(stationTypeIndex);
    const renderedByShape = renderStationGhostByShape(group, preset);
    if (!renderedByShape) {
      const radius = Math.max(2, Number(sourceType.radius) || 10);
      const outer = document.createElementNS(svgNs, "circle");
      outer.setAttribute("cx", "0");
      outer.setAttribute("cy", "0");
      outer.setAttribute("r", String(radius));
      outer.setAttribute("class", sourceType.oval ? "station interchange" : "station");
      outer.setAttribute("pointer-events", "none");
      group.appendChild(outer);

      if (sourceType.oval) {
        const inner = document.createElementNS(svgNs, "circle");
        inner.setAttribute("cx", "0");
        inner.setAttribute("cy", "0");
        inner.setAttribute("r", String(Math.max(2, radius - 4)));
        inner.setAttribute("fill", "none");
        inner.setAttribute("stroke", "#203554");
        inner.setAttribute("stroke-width", "1.5");
        inner.setAttribute("pointer-events", "none");
        group.appendChild(inner);
      }
    }

    if (preset) {
      const runtimeParams = buildStationRuntimeParamMap({
        preset,
        shape: null,
        stationParamValues: null
      });
      appendStationTexts({
        container: group,
        preset,
        runtimeParamMap: runtimeParams,
        centerX: 0,
        centerY: 0,
        pointerEvents: "none"
      });
    }

    stationLayer.appendChild(group);
    stationGhostEl = group;
  }

  function renderStationGhostByShape(group, preset) {
    if (!group || !preset?.shapeId) {
      return false;
    }

    const shape = state.shapeLibrary.find((item) => item.id === preset.shapeId);
    if (!shape) {
      return false;
    }

    const runtimeParams = buildStationRuntimeParamMap({
      preset,
      shape,
      stationParamValues: null
    });
    const resolvedSvg = buildRenderableShapeSvg(shape, buildShapeParamValuesFromRuntime(shape, runtimeParams));
    const parsed = parseShapeSvgContent(resolvedSvg);
    if (!parsed || !parsed.nodes.length) {
      return false;
    }

    const shapeRenderScale = 0.25;
    const cx = parsed.minX + parsed.width / 2;
    const cy = parsed.minY + parsed.height / 2;
    const shapeGroup = document.createElementNS(svgNs, "g");
    shapeGroup.setAttribute(
      "transform",
      `scale(${shapeRenderScale}) translate(${-cx} ${-cy})`
    );
    parsed.nodes.forEach((node) => shapeGroup.appendChild(node));
    group.appendChild(shapeGroup);
    return true;
  }

  function hideShapeGhost() {
    if (shapeGhostEl?.parentNode) {
      shapeGhostEl.parentNode.removeChild(shapeGhostEl);
    }
    shapeGhostEl = null;
  }

  function hideStationGhost() {
    if (stationGhostEl?.parentNode) {
      stationGhostEl.parentNode.removeChild(stationGhostEl);
    }
    stationGhostEl = null;
  }

  function getStationPresetByTypeIndex(typeIndex) {
    const sourceType = Number.isInteger(typeIndex)
      ? state.stationTypes[typeIndex]
      : null;
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

  function renderLineTypePreviewSvg(svgEl, lineType) {
    svgEl.innerHTML = "";

    const vb = svgEl.viewBox?.baseVal;
    const width = vb?.width || 86;
    const height = vb?.height || 22;
    const padX = Math.max(4, width * 0.08);
    const centerLine = [
      { x: padX, y: height / 2 },
      { x: width - padX, y: height / 2 }
    ];
    const segments = Array.isArray(lineType?.segments) ? lineType.segments : [];
    const offsets = getParallelOffsets(segments.map((seg) => seg.width), -0.8);

    segments.forEach((seg, index) => {
      const path = document.createElementNS(svgNs, "path");
      const offsetLine = getOffsetPolyline(centerLine, offsets[index] || 0);
      path.setAttribute("d", buildPathD(offsetLine));
      path.setAttribute("stroke", resolveSegmentColor(seg, lineType.colorList || []));
      path.setAttribute("stroke-width", String(seg.width));
      path.setAttribute("stroke-linecap", seg.roundCap ? "round" : "butt");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-dasharray", getSegmentDasharray(seg));
      svgEl.appendChild(path);
    });
  }

  function getSegmentDasharray(seg) {
    if (seg.strokeStyle !== "dashed") {
      return lineStyleMap.solid;
    }

    const solid = normalizePositiveDashLength(seg.dashSolidLength, 10);
    const gap = normalizePositiveDashLength(seg.dashGapLength, 6);
    return `${solid} ${gap}`;
  }

  function normalizePositiveDashLength(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      return fallback;
    }

    return Math.min(200, Math.max(0.1, n));
  }

  function getSegmentOverlapGap(edge, baseLine) {
    const geometry = edge?.geometry || "straight";

    if (geometry === "bend90") {
      return -0.35;
    }

    if (geometry === "bend135") {
      return -0.3;
    }

    if (geometry === "bend90rot45") {
      const start = baseLine?.[0];
      const next = baseLine?.[1];
      if (!start || !next) {
        return -0.55;
      }

      const dx = next.x - start.x;
      const dy = next.y - start.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = Math.abs(dx / len);
      const ny = Math.abs(dy / len);
      const factor = Math.max(nx, ny);

      return -0.55 * factor;
    }

    return -0.8;
  }

  function getTurnSign(polyline) {
    if (!Array.isArray(polyline) || polyline.length < 3) {
      return 0;
    }

    const a = polyline[0];
    const b = polyline[1];
    const c = polyline[2];
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const cross = v1x * v2y - v1y * v2x;

    if (Math.abs(cross) < 1e-6) {
      return 0;
    }

    return cross > 0 ? 1 : -1;
  }

  function updateViewportTransform() {
    viewport.setAttribute("transform", `translate(${state.pan.x}, ${state.pan.y}) scale(${state.zoom})`);
  }

  function updateDragCursor() {
    svg.classList.toggle("select-tool-active", state.activeTool === "select");
    svg.classList.toggle("line-tool-active", state.activeTool === "line");
    svg.classList.toggle("text-tool-active", state.activeTool === "text");
    svg.classList.toggle("dragging-pan", state.drag.mode === "pan");
    svg.classList.toggle("dragging-station", state.drag.mode === "station" || state.drag.mode === "selection-move");
  }

  function updateZoomIndicator() {
    if (!zoomIndicator) {
      return;
    }

    zoomIndicator.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function isSelected(type, id) {
    return Array.isArray(state.selectedEntities)
      && state.selectedEntities.some((entity) => entity.type === type && entity.id === id);
  }

  function toSvgDataUrl(svgText) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svgText || ""))}`;
  }

  function parseShapeSvgContent(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(svgText || ""), "image/svg+xml");
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== "svg") {
      return null;
    }

    const viewBox = parseViewBox(root.getAttribute("viewBox"));
    const width = viewBox?.width || toPositiveNumber(root.getAttribute("width"), 240);
    const height = viewBox?.height || toPositiveNumber(root.getAttribute("height"), 240);
    const minX = viewBox?.x || 0;
    const minY = viewBox?.y || 0;
    const nodes = Array.from(root.childNodes)
      .filter((node) => node.nodeType === Node.ELEMENT_NODE)
      .map((node) => document.importNode(node, true));

    return {
      minX,
      minY,
      width,
      height,
      nodes
    };
  }

  function parseViewBox(rawViewBox) {
    const values = String(rawViewBox || "")
      .trim()
      .split(/[\s,]+/)
      .map((value) => Number(value));
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
      return null;
    }

    const [x, y, width, height] = values;
    if (width <= 0 || height <= 0) {
      return null;
    }

    return { x, y, width, height };
  }

  function toPositiveNumber(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      return fallback;
    }
    return n;
  }

  return {
    setActiveToolButton,
    renderSubmenu,
    renderStations,
    renderLines,
    renderShapes,
    renderTexts,
    renderSettings,
    drawLinePreview,
    drawShapeGhost,
    hideShapeGhost,
    drawStationGhost,
    hideStationGhost,
    updateViewportTransform,
    updateDragCursor,
    updateZoomIndicator
  };
}
