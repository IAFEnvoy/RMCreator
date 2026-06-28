import {
  getColorListDefault,
  getEffectiveColorList,
  resolveSegmentColor
} from "./line/type-store.js";
import { svgNs } from "./dom.js";
import { geometryLabelMap, lineStyleMap } from "./constants.js";
import {
  applyEndpointOffsets,
  buildPathD,
  getLinePoints,
  getOffsetPolyline,
  getParallelOffsets
} from "./line/geometry.js";
import {
  clamp,
  getSvgTextDecoration,
  formatColorWithAlpha,
  normalizeColor,
  normalizeTextStyleFlags
} from "./utils.js";
import { createSettingsRenderer } from "./settings-renderer.js";
import { getTemplate } from "./template-store.js";
import { autoCropSvg, buildRenderableShapeSvg } from "./shape/utils.js";
import {
  appendStationTexts,
  buildShapeParamValuesFromRuntime,
  buildStationRuntimeParamMap,
  resolveTextBindingValue
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
  copySelection,
  duplicateSelection,
  deleteSelectedEntity,
  getSavedDrawings,
  findDrawingById,
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
        renderLineTypePreviewSvg(preview, item, getEffectiveColorList(state, item));

        row.appendChild(title);
        row.appendChild(preview);
        button.appendChild(row);

        button.classList.toggle("active", state.menuSelection.lineType === item.id);
        button.addEventListener("click", () => {
          state.menuSelection.lineType = state.menuSelection.lineType === item.id ? null : item.id;
          renderSubmenu();
        });

        // 双击打开临时颜色编辑器
        button.addEventListener("dblclick", () => {
          openLineTempColorEditor(item);
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
        preview.src = toSvgDataUrl(autoCropSvg(shape.svg));

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

    if (state.activeTool === "subDrawing") {
      submenuTitle.textContent = "子绘图工具";
      submenuItems.innerHTML = getTemplate("submenu-subdrawing");

      const listEl = submenuItems.querySelector("[data-list=\"sub-drawings\"]") || submenuItems;

      if (!Array.isArray(state.subDrawingLibraryCache)) {
        state.subDrawingLibraryCache = [];
      }

      const savedList = typeof getSavedDrawings === "function" ? getSavedDrawings() : [];
      state.subDrawingLibraryCache = savedList;

      if (!savedList.length) {
        const empty = document.createElement("div");
        empty.className = "kv";
        empty.textContent = "没有已保存的绘图。请先在 文件→绘图存档 中创建绘图。";
        listEl.appendChild(empty);
        return;
      }

      // 只有当前正在编辑的绘图才不能引用自身
      const activeId = state.drawingManager?.activeId
        || (typeof localStorage !== "undefined" ? localStorage.getItem("rmcreator.activeDrawingId.v1") : null);

      // 检查某个绘图是否会导致循环引用（递归检查目标绘图的子绘图）
      const wouldCauseCycle = (targetDrawingId) => {
        if (activeId && String(targetDrawingId) === String(activeId)) return true;
        // 递归检查：目标绘图中引用的子绘图不能包含当前绘图
        const visited = new Set();
        const checkRecursive = (drawId) => {
          if (visited.has(drawId)) return false;
          visited.add(drawId);
          if (activeId && String(drawId) === String(activeId)) return true;
          const entry = savedList.find((d) => String(d.id) === String(drawId));
          if (!entry) return false;
          try {
            const data = JSON.parse(entry.snapshot);
            if (data && Array.isArray(data.subDrawings)) {
              return data.subDrawings.some((sd) => checkRecursive(sd.drawingId));
            }
          } catch { /* ignore */ }
          return false;
        };
        return checkRecursive(targetDrawingId);
      };

      savedList.forEach((drawing) => {
        const button = document.createElement("button");
        button.className = "menu-item menu-item-subdrawing";
        button.classList.toggle("active", state.menuSelection.subDrawing === drawing.id);

        const isBanned = wouldCauseCycle(String(drawing.id));
        if (isBanned) {
          button.classList.add("disabled");
          button.disabled = true;
          button.title = "不能引用此绘图（会形成循环引用）";
        }

        const row = document.createElement("div");
        row.className = "menu-item-shape-row";

        const title = document.createElement("span");
        title.className = "menu-item-shape-title";
        title.textContent = drawing.name || "无名绘图";
        if (isBanned) {
          title.textContent += " ⛔";
        }

        const meta = document.createElement("span");
        meta.className = "menu-item-subdrawing-meta";
        meta.textContent = `${drawing.counts?.nodes || 0} 站 · ${drawing.counts?.edges || 0} 线`;

        row.appendChild(title);
        row.appendChild(meta);
        button.appendChild(row);

        if (!isBanned) {
          button.addEventListener("click", () => {
            state.menuSelection.subDrawing = state.menuSelection.subDrawing === drawing.id ? null : drawing.id;
            renderSubmenu();
          });
        }

        listEl.appendChild(button);
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

      const contextMenuInput = submenuItems.querySelector("#enableContextMenuToggle");
      if (contextMenuInput) {
        contextMenuInput.checked = state.appSettings?.enableContextMenu !== false;
        contextMenuInput.addEventListener("change", () => {
          onAppSettingsChanged?.({ enableContextMenu: contextMenuInput.checked });
        });
      }

      const confirmBeforeDeleteInput = submenuItems.querySelector("#confirmBeforeDeleteToggle");
      if (confirmBeforeDeleteInput) {
        confirmBeforeDeleteInput.checked = state.appSettings?.confirmBeforeDelete !== false;
        confirmBeforeDeleteInput.addEventListener("change", () => {
          onAppSettingsChanged?.({ confirmBeforeDelete: confirmBeforeDeleteInput.checked });
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

      const feedbackDurationInput = submenuItems.querySelector("#feedbackDurationInput");
      if (feedbackDurationInput) {
        const current = Number(state.appSettings?.feedbackDuration);
        feedbackDurationInput.value = Number.isFinite(current) ? String(current) : "0.63";
        feedbackDurationInput.addEventListener("change", () => {
          const raw = Number(feedbackDurationInput.value);
          if (!Number.isFinite(raw)) {
            feedbackDurationInput.value = String(state.appSettings?.feedbackDuration ?? 0.63);
            return;
          }
          const clamped = Math.min(5, Math.max(0, raw));
          feedbackDurationInput.value = String(clamped);
          onAppSettingsChanged?.({ feedbackDuration: clamped });
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

      // 绑定框选过滤勾选框
      if (!state.selectionFilter || typeof state.selectionFilter !== "object") {
        state.selectionFilter = { station: true, line: true, text: true, shape: true };
      }
      submenuItems.querySelectorAll(".select-filter-toggle").forEach((cb) => {
        const filterType = cb.getAttribute("data-filter-type");
        if (filterType) {
          cb.checked = Boolean(state.selectionFilter[filterType]);
          if (!cb._filterBound) {
            cb._filterBound = true;
            cb.addEventListener("change", () => {
              state.selectionFilter[filterType] = cb.checked;
            });
          }
        }
      });
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
    const rotation = Number.isFinite(Number(station.rotation)) ? Number(station.rotation) : 0;

    group.setAttribute("transform", `translate(${Number(station.x) || 0} ${Number(station.y) || 0}) rotate(${rotation})`);

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

      const resolvedSvg = buildRenderableShapeSvg(definition, shapeInstance.paramValues, shapeInstance.paramExpressions);
      const parsed = parseShapeSvgContent(resolvedSvg);
      if (!parsed || !parsed.nodes.length) {
        return;
      }

      const scale = clamp(Number(shapeInstance.scale) || 1, 0.001, 10);
      const rotation = Number.isFinite(Number(shapeInstance.rotation)) ? Number(shapeInstance.rotation) : 0;
      const cx = parsed.minX + parsed.width / 2;
      const cy = parsed.minY + parsed.height / 2;

      const group = document.createElementNS(svgNs, "g");
      group.setAttribute("data-shape-id", String(shapeInstance.id));
      group.setAttribute("class", "placed-shape-instance");
      group.setAttribute(
        "transform",
        `translate(${Number(shapeInstance.x) || 0} ${Number(shapeInstance.y) || 0}) rotate(${rotation}) scale(${scale}) translate(${-cx} ${-cy})`
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

  function buildDrawingSnapshotSvg(snapshotJson) {
    // 将保存的绘图数据渲染为完整 SVG（保留所有样式/线段/颜色/图形）
    let drawing;
    try {
      drawing = typeof snapshotJson === "string" ? JSON.parse(snapshotJson) : snapshotJson;
    } catch {
      return "";
    }
    if (!drawing || typeof drawing !== "object") return "";

    const nodes = Array.isArray(drawing.nodes) ? drawing.nodes : [];
    const edges = Array.isArray(drawing.edges) ? drawing.edges : [];
    const labels = Array.isArray(drawing.labels) ? drawing.labels : [];
    const shapes = Array.isArray(drawing.shapes) ? drawing.shapes : [];
    const lineTypes = Array.isArray(drawing.customLineTypes) ? drawing.customLineTypes : [];
    const stationPresets = Array.isArray(drawing.stationPresets) ? drawing.stationPresets : [];
    const shapeTypes = Array.isArray(drawing.shapeTypes) ? drawing.shapeTypes : [];

    // 重建 stationTypes（与 applyDrawingData 中的逻辑一致）
    const stationTypes = stationPresets.map((preset, index) => ({
      name: preset.name,
      radius: Number.isFinite(Number(preset.radius)) ? Number(preset.radius) : 12,
      oval: Boolean(preset.oval),
      stationPresetId: preset.id,
      stationTypeIndex: index
    }));

    // 计算边界
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      const x = Number(n.x) || 0, y = Number(n.y) || 0;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    });
    edges.forEach((e) => {
      const from = nodes.find((n) => n.id === e.fromStationId);
      const to = nodes.find((n) => n.id === e.toStationId);
      if (from && to) {
        minX = Math.min(minX, Number(from.x) || 0, Number(to.x) || 0);
        minY = Math.min(minY, Number(from.y) || 0, Number(to.y) || 0);
        maxX = Math.max(maxX, Number(from.x) || 0, Number(to.x) || 0);
        maxY = Math.max(maxY, Number(from.y) || 0, Number(to.y) || 0);
      }
    });
    labels.forEach((l) => {
      const x = Number(l.x) || 0, y = Number(l.y) || 0;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    });
    shapes.forEach((s) => {
      const x = Number(s.x) || 0, y = Number(s.y) || 0;
      const scale = clamp(Number(s.scale) || 0.25, 0.001, 10);
      minX = Math.min(minX, x - 30 * scale); minY = Math.min(minY, y - 30 * scale);
      maxX = Math.max(maxX, x + 30 * scale); maxY = Math.max(maxY, y + 30 * scale);
    });
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 240; maxY = 240; }
    const pad = 40;
    const vbX = minX - pad, vbY = minY - pad;
    const vbW = Math.max(1, maxX - minX + pad * 2), vbH = Math.max(1, maxY - minY + pad * 2);

    const svgDoc = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgDoc.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svgDoc.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);

    // 内联样式
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = ".station{fill:#ffffff;stroke:#203554;stroke-width:2}.station.interchange{stroke-width:3}.link-line{stroke-linecap:butt}";
    svgDoc.appendChild(style);

    // === 1. 先渲染线条（在车站下面）===
    const lineTypeMap = new Map();
    lineTypes.forEach((lt) => lineTypeMap.set(String(lt.id), lt));
    edges.forEach((edge) => {
      const fromNode = nodes.find((n) => n.id === edge.fromStationId);
      const toNode = nodes.find((n) => n.id === edge.toStationId);
      if (!fromNode || !toNode) return;

      const lineType = lineTypeMap.get(String(edge.lineTypeId));
      const geometry = edge.geometry || "straight";
      const fr = Number.isFinite(Number(fromNode.radius)) ? Number(fromNode.radius) : 6;
      const tr = Number.isFinite(Number(toNode.radius)) ? Number(toNode.radius) : 6;
      const points = getLinePoints(geometry,
        { x: Number(fromNode.x) || 0, y: Number(fromNode.y) || 0, radius: fr },
        { x: Number(toNode.x) || 0, y: Number(toNode.y) || 0, radius: tr },
        { flip: Boolean(edge.flip) }
      );

      if (lineType && Array.isArray(lineType.segments) && lineType.segments.length) {
        const baseLine = applyEndpointOffsets(points, Number(edge.startOffset) || 0, Number(edge.endOffset) || 0);
        const edgeColors = Array.isArray(edge.colorList) ? edge.colorList : (lineType.colorList || ["#7b8da8"]);
        const segs = edge.flipColor ? [...lineType.segments].reverse() : lineType.segments;
        const offsets = getParallelOffsets(segs.map((s) => s.width || 2), -0.8);
        const cornerRadiusBase = Math.max(0, Number(edge.cornerRadius) || 0);
        const useCornerRadius = cornerRadiusBase > 0 && points.length > 2;
        const radiusOffsets = getParallelOffsets(segs.map((s) => s.width || 2), 0);
        const bx = Number(fromNode.x) || 0, by = Number(fromNode.y) || 0;
        const ex = Number(toNode.x) || 0, ey = Number(toNode.y) || 0;
        const turnSign = (bx * ey - by * ex) >= 0 ? 1 : -1;
        segs.forEach((seg, idx) => {
          const offsetPoints = getOffsetPolyline(baseLine, offsets[idx] || 0);
          const radiusOffset = radiusOffsets[idx] || 0;
          const cornerRadius = useCornerRadius ? Math.max(0, cornerRadiusBase - turnSign * radiusOffset) : 0;
          const color = seg.colorMode === "fixed" ? (seg.fixedColor || "#7b8da8") : (edgeColors[seg.paletteIndex || 0] || "#7b8da8");
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", buildPathD(offsetPoints, cornerRadius));
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", color);
          path.setAttribute("stroke-width", String(seg.width || 2));
          path.setAttribute("stroke-linecap", seg.roundCap ? "round" : "butt");
          path.setAttribute("stroke-linejoin", "round");
          if (seg.strokeStyle === "dashed") {
            path.setAttribute("stroke-dasharray", `${seg.dashSolidLength || 10} ${seg.dashGapLength || 6}`);
          }
          svgDoc.appendChild(path);
        });
      } else {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", buildPathD(points));
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#7b8da8");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        svgDoc.appendChild(path);
      }
    });

    // === 2. 渲染图形（在线上）===
    shapes.forEach((shapeInst) => {
      const def = shapeTypes.find((st) => st && st.id === shapeInst.shapeId);
      if (!def) return;
      try {
        const shapeSvg = buildRenderableShapeSvg(def, shapeInst.paramValues || {}, shapeInst.paramExpressions);
        const parsed = parseShapeSvgContent(shapeSvg);
        if (!parsed || !parsed.nodes.length) return;
        const scale = clamp(Number(shapeInst.scale) || 0.25, 0.001, 10);
        const rotation = Number.isFinite(Number(shapeInst.rotation)) ? Number(shapeInst.rotation) : 0;
        const cx = parsed.minX + parsed.width / 2;
        const cy = parsed.minY + parsed.height / 2;
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("transform",
          `translate(${Number(shapeInst.x) || 0} ${Number(shapeInst.y) || 0}) rotate(${rotation}) scale(${scale}) translate(${-cx} ${-cy})`
        );
        parsed.nodes.forEach((c) => g.appendChild(svgDoc.ownerDocument.importNode(c, true)));
        svgDoc.appendChild(g);
      } catch { /* skip */ }
    });

    // === 3. 渲染独立文本 ===
    labels.forEach((label) => {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(label.x ?? 0));
      text.setAttribute("y", String(label.y ?? 0));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "hanging");
      text.setAttribute("font-size", String(label.fontSize || 14));
      text.setAttribute("fill", label.color || "#203554");
      text.setAttribute("font-family", label.fontFamily || "Segoe UI, sans-serif");
      const weight = label.bold ? "700" : "400";
      const style2 = label.italic ? "italic" : "normal";
      text.setAttribute("font-weight", weight);
      text.setAttribute("font-style", style2);
      const lines = String(label.value || "").split("\n");
      lines.forEach((lineVal, idx) => {
        const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
        tspan.setAttribute("x", String(label.x ?? 0));
        tspan.setAttribute("dy", idx === 0 ? "0" : "1.2em");
        tspan.textContent = lineVal || " ";
        text.appendChild(tspan);
      });
      svgDoc.appendChild(text);
    });

    // === 4. 最后渲染车站（在最上层）===
    nodes.forEach((node) => {
      const x = Number(node.x) || 0, y = Number(node.y) || 0;
      const typeIndex = Number.isInteger(node.stationTypeIndex) && node.stationTypeIndex >= 0 ? node.stationTypeIndex : -1;
      const preset = typeIndex >= 0 && typeIndex < stationPresets.length ? stationPresets[typeIndex] : null;
      const r = Number.isFinite(Number(node.radius)) ? Number(node.radius) : (preset?.radius ?? 6);
      const isOval = Boolean(node.oval !== undefined ? node.oval : preset?.oval);

      if (preset?.shapeId) {
        const shapeDef = shapeTypes.find((st) => st && st.id === preset.shapeId);
        if (shapeDef) {
          const runtimeParams = buildStationRuntimeParamMap({
            preset,
            shape: shapeDef,
            stationParamValues: node.paramValues
          });
          const paramValues = buildShapeParamValuesFromRuntime(shapeDef, runtimeParams);
          const shapeSvg = buildRenderableShapeSvg(shapeDef, paramValues);
          const parsed = parseShapeSvgContent(shapeSvg);
          if (parsed && parsed.nodes.length) {
            const rotation = Number.isFinite(Number(node.rotation)) ? Number(node.rotation) : 0;
            const shapeRenderScale = 0.25;
            const cx = parsed.minX + parsed.width / 2;
            const cy = parsed.minY + parsed.height / 2;
            const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            g.setAttribute("transform", `translate(${x} ${y}) rotate(${rotation})`);
            const sg = document.createElementNS("http://www.w3.org/2000/svg", "g");
            sg.setAttribute("transform", `scale(${shapeRenderScale}) translate(${-cx} ${-cy})`);
            parsed.nodes.forEach((nd) => sg.appendChild(svgDoc.ownerDocument.importNode(nd, true)));
            g.appendChild(sg);
            svgDoc.appendChild(g);
            renderSnapshotStationTexts(svgDoc, preset, node, x, y, runtimeParams);
            return;
          }
        }
      }

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(x));
      circle.setAttribute("cy", String(y));
      circle.setAttribute("r", String(r));
      circle.setAttribute("class", isOval ? "station interchange" : "station");
      svgDoc.appendChild(circle);

      if (isOval) {
        const inner = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        inner.setAttribute("cx", String(x));
        inner.setAttribute("cy", String(y));
        inner.setAttribute("r", String(Math.max(2, r - 4)));
        inner.setAttribute("fill", "none");
        inner.setAttribute("stroke", "#203554");
        inner.setAttribute("stroke-width", "1.5");
        svgDoc.appendChild(inner);
      }

      renderSnapshotStationTexts(svgDoc, preset, node, x, y, null);
    });

    return new XMLSerializer().serializeToString(svgDoc);
  }

  /** 渲染快照中车站的文本 — 与 appendStationTexts 保持一致的布局逻辑 */
  function renderSnapshotStationTexts(svgDoc, preset, node, x, y, runtimeParams) {
    if (!preset) {
      const rr = Number.isFinite(Number(node.radius)) ? Number(node.radius) : 6;
      if (node.textValues && typeof node.textValues === "object") {
        Object.values(node.textValues).forEach((txt, tIdx) => {
          if (!txt) return;
          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", String(x));
          text.setAttribute("y", String(y + rr + 4 + tIdx * 11));
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("font-size", "9");
          text.setAttribute("fill", "#203554");
          text.setAttribute("font-family", "Segoe UI, sans-serif");
          text.textContent = String(txt);
          svgDoc.appendChild(text);
        });
      }
      return;
    }

    const cards = Array.isArray(preset.textCards) ? preset.textCards : [];
    if (!cards.length) return;

    const runtimeMap = runtimeParams || buildStationRuntimeParamMap({
      preset,
      shape: null,
      stationParamValues: node.paramValues || {}
    });

    const blocks = [];
    cards.forEach((card) => {
      if (!card || typeof card !== "object") return;
      const visible = Boolean(resolveTextBindingValue(
        card.visibilityBinding || {}, "checkbox", runtimeMap, true
      ));
      if (!visible || card.locked) return;
      const rawTxt = (node.textValues && typeof node.textValues === "object"
        ? node.textValues[card.id] : null) ?? card.defaultValue ?? "";
      const rawStr = String(rawTxt).trim();
      if (!rawStr) return;
      const allowMultiline = Boolean(card.allowMultiline);
      const lines = allowMultiline ? String(rawTxt).split("\n") : [String(rawTxt)];
      const fontSize = Math.max(1, Number(
        resolveTextBindingValue(card.fontSizeBinding, "number", runtimeMap, 9)
      ) || 9);
      const color = resolveTextBindingValue(
        card.colorBinding, "color", runtimeMap, card.color ?? "#203554"
      ) || "#203554";
      const ff = card.fontFamily || "Segoe UI, sans-serif";
      const textStyle = normalizeTextStyleFlags(card, card);
      const lineGap = Number.isFinite(Number(card.lineGap)) ? Math.abs(Number(card.lineGap)) : 4;
      const lineHeight = fontSize * 1.2;
      const height = lines.length * lineHeight;
      blocks.push({ lines, fontSize, color, ff, textStyle, lineGap, height, lineHeight });
    });

    if (!blocks.length) return;

    let totalH = 0;
    blocks.forEach((b, i) => {
      totalH += b.height + (i < blocks.length - 1 ? b.lineGap : 0);
    });

    const slot = (node.textPlacement?.slot && typeof node.textPlacement.slot === "string"
      ? node.textPlacement.slot.toLowerCase()
      : (cards[0]?.slot?.toLowerCase?.() || "s"));

    const r = Number.isFinite(Number(node.radius)) ? Number(node.radius) : (Number(preset.radius) || 6);
    const distance = r * 0.4 + 2;

    let anchorX = x, anchorY = y, textAnchor = "middle";
    if (slot === "n") {
      anchorY = y - r - distance - totalH;
    } else if (slot === "s") {
      anchorY = y + r + distance;
    } else if (slot === "e") {
      anchorX = x + r + distance; textAnchor = "start"; anchorY = y - totalH / 2;
    } else if (slot === "w") {
      anchorX = x - r - distance; textAnchor = "end"; anchorY = y - totalH / 2;
    } else if (slot === "nw") {
      anchorX = x - r - distance; anchorY = y - r - distance - totalH; textAnchor = "end";
    } else if (slot === "ne") {
      anchorX = x + r + distance; anchorY = y - r - distance - totalH; textAnchor = "start";
    } else if (slot === "sw") {
      anchorX = x - r - distance; anchorY = y + r + distance; textAnchor = "end";
    } else if (slot === "se") {
      anchorX = x + r + distance; anchorY = y + r + distance; textAnchor = "start";
    }

    let curY = anchorY;
    blocks.forEach((b) => {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(anchorX));
      text.setAttribute("y", String(curY));
      text.setAttribute("text-anchor", textAnchor);
      text.setAttribute("dominant-baseline", "hanging");
      text.setAttribute("fill", b.color);
      text.setAttribute("font-size", String(b.fontSize));
      text.setAttribute("font-family", b.ff);
      text.setAttribute("font-weight", b.textStyle.bold ? "700" : "400");
      text.setAttribute("font-style", b.textStyle.italic ? "italic" : "normal");
      if (b.textStyle.underline || b.textStyle.strikethrough) {
        text.setAttribute("text-decoration", getSvgTextDecoration(b.textStyle));
      }
      b.lines.forEach((line, li) => {
        const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
        tspan.setAttribute("x", String(anchorX));
        tspan.setAttribute("dy", li === 0 ? "0" : String(b.lineHeight));
        tspan.textContent = line || " ";
        text.appendChild(tspan);
      });
      svgDoc.appendChild(text);
      curY += b.height + b.lineGap;
    });
  }

  function renderSubDrawings() {
    if (!shapeLayer) return;

    shapeLayer.querySelectorAll("[data-subdrawing-id]").forEach((el) => el.remove());

    // 缓存已生成的 SVG 数据 URL，避免重复转换同一绘图
    if (!state.subDrawingSvgCache) state.subDrawingSvgCache = {};

    (Array.isArray(state.subDrawings) ? state.subDrawings : []).forEach((sd) => {
      const cached = state.subDrawingSvgCache[sd.drawingId];
      const hasCached = cached && cached.snapshot === sd._lastSnapshot;
      let svgDataUrl, imgW, imgH;
      if (hasCached) {
        svgDataUrl = cached.url;
        imgW = cached.w;
        imgH = cached.h;
      } else {
        const saved = (typeof getSavedDrawings === "function" ? getSavedDrawings() : []).find((s) => String(s.id) === String(sd.drawingId));
        if (!saved) return;
        const svgText = buildDrawingSnapshotSvg(saved.snapshot);
        if (!svgText) return;
        // 解析 viewBox 获取实际尺寸
        const vbMatch = svgText.match(/viewBox="([^"]+)"/);
        if (vbMatch) {
          const parts = vbMatch[1].split(/[\s,]+/).map(Number).filter((v) => isFinite(v));
          imgW = parts.length >= 4 ? parts[2] : 240;
          imgH = parts.length >= 4 ? parts[3] : 240;
        } else {
          imgW = 240; imgH = 240;
        }
        svgDataUrl = toSvgDataUrl(svgText);
        state.subDrawingSvgCache[sd.drawingId] = { url: svgDataUrl, w: imgW, h: imgH, snapshot: saved.snapshot };
      }

      if (!svgDataUrl) return;

      const scale = clamp(Number(sd.scale) || 0.25, 0.001, 10);
      const rotation = Number.isFinite(Number(sd.rotation)) ? Number(sd.rotation) : 0;

      const group = document.createElementNS(svgNs, "g");
      group.setAttribute("data-subdrawing-id", String(sd.id));
      group.setAttribute("class", "placed-subdrawing-instance");

      if (isSelected("subDrawing", sd.id)) {
        group.classList.add("selected-shape");
      }

      group.setAttribute(
        "transform",
        `translate(${Number(sd.x) || 0} ${Number(sd.y) || 0}) rotate(${rotation}) scale(${scale})`
      );

      // 透明点击区接收所有事件，data-* 确保 closest() 匹配
      const hitRect = document.createElementNS(svgNs, "rect");
      hitRect.setAttribute("x", "0");
      hitRect.setAttribute("y", "0");
      hitRect.setAttribute("width", String(imgW));
      hitRect.setAttribute("height", String(imgH));
      hitRect.setAttribute("fill", "transparent");
      hitRect.setAttribute("stroke", "none");
      hitRect.setAttribute("pointer-events", "all");
      hitRect.setAttribute("data-subdrawing-id", String(sd.id));
      group.appendChild(hitRect);

      const img = document.createElementNS(svgNs, "image");
      img.setAttribute("href", svgDataUrl);
      img.setAttribute("x", "0");
      img.setAttribute("y", "0");
      img.setAttribute("width", String(imgW));
      img.setAttribute("height", String(imgH));
      img.setAttribute("preserveAspectRatio", "none");
      img.setAttribute("pointer-events", "none");

      group.appendChild(img);
      shapeLayer.appendChild(group);
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

  function renderLineTypePreviewSvg(svgEl, lineType, effectiveColors) {
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
    const colors = effectiveColors || lineType.colorList || [];

    segments.forEach((seg, index) => {
      const path = document.createElementNS(svgNs, "path");
      const offsetLine = getOffsetPolyline(centerLine, offsets[index] || 0);
      path.setAttribute("d", buildPathD(offsetLine));
      path.setAttribute("stroke", resolveSegmentColor(seg, colors));
      path.setAttribute("stroke-width", String(seg.width));
      path.setAttribute("stroke-linecap", seg.roundCap ? "round" : "butt");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-dasharray", getSegmentDasharray(seg));
      svgEl.appendChild(path);
    });
  }

  function openLineTempColorEditor(lineType) {
    if (!colorPicker || !lineType) return;

    const effective = getEffectiveColorList(state, lineType);
    if (!effective.length) return;

    // 只编辑第一个颜色（palette核心色）
    const title = `${lineType.name} — 临时颜色`;
    colorPicker.open({
      color: effective[0],
      title,
      onConfirm: (nextColor) => {
        if (!state.tempLineColorOverrides || typeof state.tempLineColorOverrides !== "object") {
          state.tempLineColorOverrides = {};
        }
        state.tempLineColorOverrides[lineType.id] = [nextColor];
        renderSubmenu();
      }
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
    renderSubDrawings,
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
