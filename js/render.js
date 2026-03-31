import { svgNs } from "./dom.js";
import { geometryLabelMap, lineStyleMap } from "./constants.js";
import {
  applyEndpointOffsets,
  buildPathD,
  getLinePoints,
  getOffsetPolyline,
  getParallelOffsets
} from "./lineGeometry.js";
import { resolveSegmentColor } from "./lineTypeStore.js";
import { clamp, normalizeColor } from "./utils.js";
import { createSettingsRenderer } from "./settingsRenderer.js";
import { buildRenderableShapeSvg } from "./shapeManager.js";

export function createRenderer({
  state,
  elements,
  findLineType,
  getColorListDefault,
  openLineManager,
  openShapeManager,
  onAppSettingsChanged,
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
    zoomIndicator
  } = elements;

  let shapeGhostEl = null;

  function setActiveToolButton() {
    toolStrip.querySelectorAll(".tool-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === state.activeTool);
    });

    svg.classList.toggle("select-tool-active", state.activeTool === "select");
  }

  function renderSubmenu() {
    submenuItems.innerHTML = "";

    if (state.activeTool === "station") {
      submenuTitle.textContent = "车站样式";
      state.stationTypes.forEach((item, index) => {
        const button = document.createElement("button");
        button.className = "menu-item";
        button.textContent = item.name;
        button.classList.toggle("active", state.menuSelection.station === index);
        button.addEventListener("click", () => {
          state.menuSelection.station = state.menuSelection.station === index ? null : index;
          renderSubmenu();
        });
        submenuItems.appendChild(button);
      });
      return;
    }

    if (state.activeTool === "line") {
      submenuTitle.textContent = "连线工具";

      const managerBtn = document.createElement("button");
      managerBtn.className = "menu-item menu-item-action";
      managerBtn.textContent = "线条管理器";
      managerBtn.addEventListener("click", () => openLineManager());
      submenuItems.appendChild(managerBtn);

      const geometryHint = document.createElement("div");
      geometryHint.className = "menu-group-title";
      geometryHint.textContent = "几何类型";
      submenuItems.appendChild(geometryHint);

      Object.entries(geometryLabelMap).forEach(([geometryKey, geometryLabel]) => {
        const button = document.createElement("button");
        button.className = "menu-item";
        button.textContent = geometryLabel;
        button.classList.toggle("active", state.menuSelection.lineGeometry === geometryKey);
        button.addEventListener("click", () => {
          state.menuSelection.lineGeometry = state.menuSelection.lineGeometry === geometryKey ? null : geometryKey;
          renderSubmenu();
        });
        submenuItems.appendChild(button);
      });

      const styleHint = document.createElement("div");
      styleHint.className = "menu-group-title";
      styleHint.textContent = "线条类型";
      submenuItems.appendChild(styleHint);

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
        const usageCount = usageCountByTypeId.get(item.id) || 0;
        title.textContent = `${item.name} (${usageCount})`;
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
        submenuItems.appendChild(button);
      });
      return;
    }

    if (state.activeTool === "text") {
      submenuTitle.textContent = "文本工具已启用";
      const tip = document.createElement("div");
      tip.className = "kv";
      tip.textContent = "点击画布任意位置可添加文本。";
      submenuItems.appendChild(tip);
      return;
    }

    if (state.activeTool === "shape") {
      submenuTitle.textContent = "图形工具";

      const managerBtn = document.createElement("button");
      managerBtn.className = "menu-item menu-item-action";
      managerBtn.textContent = "图形管理器";
      managerBtn.addEventListener("click", () => openShapeManager?.());
      submenuItems.appendChild(managerBtn);

      const libraryHint = document.createElement("div");
      libraryHint.className = "menu-group-title";
      libraryHint.textContent = "预制图形";
      submenuItems.appendChild(libraryHint);

      if (state.menuSelection.shape && !state.shapeLibrary.some((item) => item.id === state.menuSelection.shape)) {
        state.menuSelection.shape = null;
      }

      if (!state.shapeLibrary.length) {
        const empty = document.createElement("div");
        empty.className = "kv";
        empty.textContent = "当前没有预制图形，请先在图形管理器中创建或导入。";
        submenuItems.appendChild(empty);
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

        submenuItems.appendChild(button);
      });

      return;
    }

    if (state.activeTool === "settings") {
      submenuTitle.textContent = "设置";

      const settingsCard = document.createElement("div");
      settingsCard.className = "submenu-settings-card";

      const continuousRow = document.createElement("div");
      continuousRow.className = "submenu-settings-row";
      const continuousText = document.createElement("span");
      continuousText.textContent = "连续画线模式";
      const continuousSwitch = document.createElement("label");
      continuousSwitch.className = "toggle-switch";
      continuousSwitch.setAttribute("for", "continuousLineModeToggle");
      const continuousInput = document.createElement("input");
      continuousInput.id = "continuousLineModeToggle";
      continuousInput.className = "toggle-checkbox";
      continuousInput.type = "checkbox";
      continuousInput.checked = state.appSettings?.continuousLineMode !== false;
      const continuousSlider = document.createElement("span");
      continuousSlider.className = "toggle-slider";
      continuousSlider.setAttribute("aria-hidden", "true");
      continuousInput.addEventListener("change", () => {
        onAppSettingsChanged?.({ continuousLineMode: continuousInput.checked });
      });
      continuousSwitch.appendChild(continuousInput);
      continuousSwitch.appendChild(continuousSlider);
      continuousRow.appendChild(continuousText);
      continuousRow.appendChild(continuousSwitch);
      settingsCard.appendChild(continuousRow);

      const continuousTip = document.createElement("div");
      continuousTip.className = "submenu-settings-hint";
      continuousTip.textContent = "关闭后，每次绘制一条线会自动取消当前线形选择。";
      settingsCard.appendChild(continuousTip);

      const shapeContinuousRow = document.createElement("div");
      shapeContinuousRow.className = "submenu-settings-row";
      const shapeContinuousText = document.createElement("span");
      shapeContinuousText.textContent = "连续放置图形模式";
      const shapeContinuousSwitch = document.createElement("label");
      shapeContinuousSwitch.className = "toggle-switch";
      shapeContinuousSwitch.setAttribute("for", "continuousShapeModeToggle");
      const shapeContinuousInput = document.createElement("input");
      shapeContinuousInput.id = "continuousShapeModeToggle";
      shapeContinuousInput.className = "toggle-checkbox";
      shapeContinuousInput.type = "checkbox";
      shapeContinuousInput.checked = state.appSettings?.continuousShapeMode !== false;
      const shapeContinuousSlider = document.createElement("span");
      shapeContinuousSlider.className = "toggle-slider";
      shapeContinuousSlider.setAttribute("aria-hidden", "true");
      shapeContinuousInput.addEventListener("change", () => {
        onAppSettingsChanged?.({ continuousShapeMode: shapeContinuousInput.checked });
      });
      shapeContinuousSwitch.appendChild(shapeContinuousInput);
      shapeContinuousSwitch.appendChild(shapeContinuousSlider);
      shapeContinuousRow.appendChild(shapeContinuousText);
      shapeContinuousRow.appendChild(shapeContinuousSwitch);
      settingsCard.appendChild(shapeContinuousRow);

      const shapeContinuousTip = document.createElement("div");
      shapeContinuousTip.className = "submenu-settings-hint";
      shapeContinuousTip.textContent = "关闭后，每次放置一个图形会自动取消当前预制图形选择。";
      settingsCard.appendChild(shapeContinuousTip);

      const glowRow = document.createElement("label");
      glowRow.className = "submenu-settings-row";
      const glowText = document.createElement("span");
      glowText.textContent = "选择框颜色";
      const glowInput = document.createElement("input");
      glowInput.type = "color";
      glowInput.value = state.appSettings?.selectionGlowColor || "#2f6de5";
      glowInput.addEventListener("input", () => {
        onAppSettingsChanged?.({ selectionGlowColor: glowInput.value });
      });
      glowRow.appendChild(glowText);
      glowRow.appendChild(glowInput);
      settingsCard.appendChild(glowRow);

      const geometryRow = document.createElement("label");
      geometryRow.className = "submenu-settings-row submenu-settings-row-column";
      const geometryText = document.createElement("span");
      geometryText.textContent = "默认线条几何类型";
      const geometrySelect = document.createElement("select");
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
      geometryRow.appendChild(geometryText);
      geometryRow.appendChild(geometrySelect);
      settingsCard.appendChild(geometryRow);

      const spacingRow = document.createElement("label");
      spacingRow.className = "submenu-settings-row submenu-settings-row-column";
      const spacingText = document.createElement("span");
      spacingText.textContent = "线条间距系数（1.00 为当前基准）";
      const spacingInput = document.createElement("input");
      spacingInput.type = "number";
      spacingInput.min = "0.5";
      spacingInput.max = "1.8";
      spacingInput.step = "0.05";
      spacingInput.value = String(Number(state.appSettings?.lineSpacingScale || 1).toFixed(2));
      spacingInput.addEventListener("change", () => {
        const raw = Number(spacingInput.value);
        if (!Number.isFinite(raw)) {
          spacingInput.value = String(Number(state.appSettings?.lineSpacingScale || 1).toFixed(2));
          return;
        }

        const clamped = Math.min(1.8, Math.max(0.5, raw));
        onAppSettingsChanged?.({ lineSpacingScale: clamped });
      });
      spacingRow.appendChild(spacingText);
      spacingRow.appendChild(spacingInput);
      settingsCard.appendChild(spacingRow);

      const spacingWarning = document.createElement("div");
      spacingWarning.className = "submenu-settings-warning";
      spacingWarning.textContent = "警告：该设置会大幅度影响线条绘制效果与既有图形观感，请谨慎调整。";
      settingsCard.appendChild(spacingWarning);

      submenuItems.appendChild(settingsCard);
      return;
    }

    if (state.activeTool === "select") {
      submenuTitle.textContent = "选择工具已启用";
      const tip = document.createElement("div");
      tip.className = "kv";
      tip.textContent = "拖动可框选元素；按住 Ctrl 点击可多选或取消选中。";
      submenuItems.appendChild(tip);
      return;
    }

    submenuTitle.textContent = "请选择工具";
    const idleTip = document.createElement("div");
    idleTip.className = "kv";
    idleTip.textContent = "左侧选择工具后，这里会显示可选菜单项。";
    submenuItems.appendChild(idleTip);
  }

  function renderStations() {
    stationLayer.innerHTML = "";

    state.nodes.forEach((station) => {
      const group = document.createElementNS(svgNs, "g");
      group.setAttribute("data-station-id", station.id);

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

      stationLayer.appendChild(group);
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
      const text = document.createElementNS(svgNs, "text");
      text.setAttribute("x", String(label.x));
      text.setAttribute("y", String(label.y));
      text.setAttribute("fill", label.color);
      text.setAttribute("font-size", String(label.fontSize));
      text.setAttribute("font-family", label.fontFamily);
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
    applyStationType,
    getStationTypeIndexByStation,
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

  function hideShapeGhost() {
    if (shapeGhostEl?.parentNode) {
      shapeGhostEl.parentNode.removeChild(shapeGhostEl);
    }
    shapeGhostEl = null;
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
    const scale = Math.max(0.5, Number(state.appSettings?.lineSpacingScale) || 1);

    if (geometry === "bend90") {
      return -0.35 * scale;
    }

    if (geometry === "bend135") {
      return -0.3 * scale;
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

      return -0.55 * factor * scale;
    }

    return -0.8 * scale;
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
    updateViewportTransform,
    updateDragCursor,
    updateZoomIndicator
  };
}
