import { svgNs } from "./dom.js";
import { clamp, clientToSvgPoint, toCanvasPoint } from "./utils.js";

export function createEventBinder({
  state,
  elements,
  renderer,
  findLineType,
  moveLineInStack,
  addStation,
  addLine,
  addText,
  addShape,
  selectEntity,
  selectEntities,
  toggleEntitySelection,
  clearSelection,
  deleteSelectedEntity,
  createNewDrawing,
  saveDrawing,
  exportDrawingAsSvg,
  openPngExportModal,
  loadDrawingFromFile,
  undo,
  redo,
  shapeUndo,
  shapeRedo,
  copySelection,
  cutSelection,
  pasteSelection,
  onStateChanged
}) {
  const {
    svg,
    viewport,
    lineLayer,
    shapeLayer,
    textLayer,
    snapGuideLayer,
    linePreview,
    selectionMarquee,
    toolStrip,
    fileMenu,
    fileMenuBtn,
    fileMenuPanel,
    editMenu,
    editMenuBtn,
    editMenuPanel,
    fileNewBtn,
    fileSaveBtn,
    fileLoadBtn,
    fileExportSvgBtn,
    fileExportPngBtn,
    fileUndoBtn,
    fileRedoBtn,
    fileCutBtn,
    fileCopyBtn,
    filePasteBtn,
    fileLoadInput,
    zoomIndicator,
    zoomMenu
  } = elements;

  const snapConfig = Object.freeze({
    pixelTolerance: 8
  });

  function bindToolbar() {
    toolStrip.addEventListener("click", (event) => {
      const btn = event.target.closest(".tool-btn");
      if (!btn) {
        return;
      }

      const tool = btn.dataset.tool;
      state.activeTool = state.activeTool === tool ? null : tool;

      if (state.activeTool !== "station") {
        state.menuSelection.station = null;
      }

      if (state.activeTool !== "line") {
        state.menuSelection.lineType = null;
        state.menuSelection.lineGeometry = null;
      }

      if (state.activeTool === "line" && !state.menuSelection.lineGeometry) {
        state.menuSelection.lineGeometry = state.appSettings?.defaultLineGeometry || "bend135";
      }

      if (state.activeTool !== "shape") {
        state.menuSelection.shape = null;
      }

      renderer.setActiveToolButton();
      renderer.renderSubmenu();
      if (state.activeTool !== "shape" || !state.menuSelection.shape) {
        renderer.hideShapeGhost?.();
      }
      if (state.activeTool !== "station" || state.menuSelection.station === null) {
        renderer.hideStationGhost?.();
      }
      renderer.updateDragCursor();
    });

    bindZoomIndicator();
  }

  function bindZoomIndicator() {
    if (!zoomIndicator || !zoomMenu) {
      return;
    }

    const closeMenu = () => {
      zoomMenu.hidden = true;
      zoomIndicator.setAttribute("aria-expanded", "false");
    };

    const openMenu = () => {
      zoomMenu.hidden = false;
      zoomIndicator.setAttribute("aria-expanded", "true");
    };

    const setZoom = (nextZoom) => {
      const scale = clamp(Number(nextZoom), 0.3, 4);
      const rect = svg?.getBoundingClientRect();
      if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
        return;
      }

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const before = toCanvasPoint({ clientX: cx, clientY: cy }, svg, viewport);
      const cursor = clientToSvgPoint(cx, cy, svg);

      state.zoom = scale;
      state.pan.x = cursor.x - before.x * scale;
      state.pan.y = cursor.y - before.y * scale;

      renderer.updateViewportTransform();
      renderer.updateZoomIndicator();
      onStateChanged?.({ coalesceKey: "viewport" });
    };

    zoomIndicator.addEventListener("click", (event) => {
      event.stopPropagation();
      if (zoomMenu.hidden) {
        openMenu();
      } else {
        closeMenu();
      }
    });

    zoomMenu.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-zoom]");
      if (!btn) {
        return;
      }
      const zoomValue = Number(btn.getAttribute("data-zoom"));
      if (!Number.isFinite(zoomValue)) {
        return;
      }
      setZoom(zoomValue);
      closeMenu();
    });

    document.addEventListener("click", (event) => {
      if (zoomIndicator.contains(event.target) || zoomMenu.contains(event.target)) {
        return;
      }
      closeMenu();
    });
  }

  function bindCanvas() {
    svg.addEventListener("mousedown", onCanvasMouseDown);
    svg.addEventListener("mousemove", onCanvasMouseMove);
    window.addEventListener("mouseup", onCanvasMouseUp);
    svg.addEventListener("click", onCanvasClick);
    svg.addEventListener("wheel", onCanvasWheel, { passive: false });
  }

  function bindKeyboard() {
    window.addEventListener("keydown", (event) => {
      const isUndoRedoCombo = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "z";
      if (isUndoRedoCombo) {
        if (isEditableTarget(event.target)) {
          return;
        }

        event.preventDefault();
        if (state.shapeManager?.isOpen) {
          if (event.shiftKey) {
            shapeRedo?.();
          } else {
            shapeUndo?.();
          }
        } else if (event.shiftKey) {
          redo?.();
        } else {
          undo?.();
        }
        return;
      }

      const hasModifier = event.ctrlKey || event.metaKey;
      if (hasModifier && !event.altKey) {
        if (
          isEditableTarget(event.target)
          || state.lineManager.isOpen
          || state.shapeManager?.isOpen
          || state.stationManager?.isOpen
        ) {
          return;
        }

        const key = event.key.toLowerCase();
        if (key === "c") {
          if (copySelection?.()) {
            event.preventDefault();
          }
          return;
        }

        if (key === "x") {
          if (cutSelection?.()) {
            event.preventDefault();
          }
          return;
        }

        if (key === "v") {
          if (pasteSelection?.()) {
            event.preventDefault();
          }
          return;
        }
      }

      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      if (
        isEditableTarget(event.target)
        || state.lineManager.isOpen
        || state.shapeManager?.isOpen
        || state.stationManager?.isOpen
      ) {
        return;
      }

      if (!Array.isArray(state.selectedEntities) || !state.selectedEntities.length) {
        return;
      }

      event.preventDefault();
      deleteSelectedEntity();
    });
  }

  function bindFileMenu() {
    if (
      !fileNewBtn
      || !fileSaveBtn
      || !fileLoadBtn
      || !fileUndoBtn
      || !fileRedoBtn
      || !fileCutBtn
      || !fileCopyBtn
      || !filePasteBtn
      || !fileLoadInput
    ) {
      return;
    }

    const menus = [
      {
        root: fileMenu,
        button: fileMenuBtn,
        panel: fileMenuPanel
      },
      {
        root: editMenu,
        button: editMenuBtn,
        panel: editMenuPanel
      }
    ].filter((menu) => menu.root && menu.button && menu.panel);

    const closeAllMenus = () => {
      menus.forEach((menu) => {
        menu.panel.hidden = true;
        menu.button.setAttribute("aria-expanded", "false");
      });
    };

    menus.forEach((menu) => {
      menu.button.addEventListener("click", (event) => {
        event.stopPropagation();
        const willOpen = menu.panel.hidden;
        closeAllMenus();
        if (willOpen) {
          menu.panel.hidden = false;
          menu.button.setAttribute("aria-expanded", "true");
        }
      });

      menu.panel.addEventListener("click", (event) => {
        event.stopPropagation();
      });
    });

    document.addEventListener("click", (event) => {
      if (menus.some((menu) => menu.root.contains(event.target))) {
        return;
      }
      closeAllMenus();
    });

    fileNewBtn.addEventListener("click", () => {
      closeAllMenus();
      createNewDrawing();
    });

    fileSaveBtn.addEventListener("click", () => {
      closeAllMenus();
      saveDrawing();
    });

    if (fileExportSvgBtn) {
      fileExportSvgBtn.addEventListener("click", () => {
        closeAllMenus();
        exportDrawingAsSvg?.();
      });
    }

    if (fileExportPngBtn) {
      fileExportPngBtn.addEventListener("click", () => {
        closeAllMenus();
        openPngExportModal?.();
      });
    }

    fileLoadBtn.addEventListener("click", () => {
      closeAllMenus();
      fileLoadInput.click();
    });

    fileUndoBtn.addEventListener("click", () => {
      closeAllMenus();
      undo?.();
    });

    fileRedoBtn.addEventListener("click", () => {
      closeAllMenus();
      redo?.();
    });

    fileCutBtn.addEventListener("click", () => {
      closeAllMenus();
      cutSelection?.();
    });

    fileCopyBtn.addEventListener("click", () => {
      closeAllMenus();
      copySelection?.();
    });

    filePasteBtn.addEventListener("click", () => {
      closeAllMenus();
      pasteSelection?.();
    });

    fileLoadInput.addEventListener("change", async () => {
      const file = fileLoadInput.files?.[0];
      if (!file) {
        return;
      }

      try {
        await loadDrawingFromFile(file);
      } finally {
        fileLoadInput.value = "";
      }
    });
  }

  function onCanvasClick(event) {
    if (state.drag.suppressClick) {
      state.drag.suppressClick = false;
      return;
    }

    const point = toCanvasPoint(event, svg, viewport);
    const target = event.target;
    const multiSelect = event.ctrlKey || event.metaKey;
    const continuousSelect = state.appSettings?.continuousSelectMode !== false && state.activeTool === "select";
    const handleEntityClick = (entity) => {
      if (multiSelect) {
        toggleEntitySelection(entity);
        return;
      }

      if (continuousSelect) {
        selectEntities([entity], { additive: true });
        return;
      }

      selectEntity(entity);
    };

    const stationEl = target.closest("[data-station-id]");
    const lineEl = target.closest("[data-line-id]");
    const shapeEl = target.closest("[data-shape-id]");
    const textEl = target.closest("[data-text-id]");

    if (state.lineMoveMode) {
      if (lineEl) {
        const targetLineId = lineEl.dataset.lineId;
        if (targetLineId && targetLineId !== state.lineMoveMode.sourceId) {
          const moved = moveLineInStack?.({
            sourceId: state.lineMoveMode.sourceId,
            targetId: targetLineId,
            mode: state.lineMoveMode.mode
          });
          if (moved) {
            renderer.renderLines();
            renderer.renderSettings();
            onStateChanged?.({ coalesceKey: "line-order" });
          }
        }
        state.lineMoveMode = null;
        renderer.renderSettings();
        return;
      }

      state.lineMoveMode = null;
      renderer.renderSettings();
    }

    if (stationEl) {
      const entity = { type: "station", id: stationEl.dataset.stationId };
      handleEntityClick(entity);
      return;
    }

    if (lineEl) {
      const entity = { type: "line", id: lineEl.dataset.lineId };
      handleEntityClick(entity);
      return;
    }

    if (textEl) {
      const entity = { type: "text", id: textEl.dataset.textId };
      handleEntityClick(entity);
      return;
    }

    if (shapeEl) {
      const entity = { type: "shape", id: shapeEl.dataset.shapeId };
      handleEntityClick(entity);
      return;
    }

    if (state.activeTool === "station" && state.menuSelection.station !== null) {
      addStation(point.x, point.y, state.menuSelection.station);
      if (state.appSettings?.continuousStationMode === false) {
        state.menuSelection.station = null;
        renderer.hideStationGhost?.();
        renderer.renderSubmenu();
      }
      return;
    }

    if (state.activeTool === "text") {
      addText(point.x, point.y);
      if (state.appSettings?.continuousTextMode === false) {
        state.activeTool = "select";
        renderer.setActiveToolButton();
        renderer.renderSubmenu();
        renderer.updateDragCursor();
      }
      return;
    }

    if (state.activeTool === "shape" && state.menuSelection.shape) {
      addShape(point.x, point.y, state.menuSelection.shape);
      if (state.appSettings?.continuousShapeMode === false) {
        state.menuSelection.shape = null;
        renderer.hideShapeGhost?.();
        renderer.renderSubmenu();
      }
      return;
    }

    if (state.activeTool === "select" && multiSelect) {
      return;
    }

    clearSelection();
  }

  function onCanvasMouseDown(event) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target;
    const stationEl = target.closest("[data-station-id]");
    const shapeEl = target.closest("[data-shape-id]");
    const textEl = target.closest("[data-text-id]");
    const point = toCanvasPoint(event, svg, viewport);
    const multiSelect = event.ctrlKey || event.metaKey;

    if (state.activeTool === "line" && state.menuSelection.lineType && state.menuSelection.lineGeometry && stationEl) {
      const stationId = stationEl.dataset.stationId;
      const station = state.nodes.find((node) => node.id === stationId);
      const selectedType = findLineType(state.menuSelection.lineType);
      if (!station || !selectedType) {
        return;
      }

      state.drag.mode = "line";
      state.drag.lineStartStationId = stationId;
      state.drag.didMove = false;
      renderer.drawLinePreview(station, station, selectedType, state.menuSelection.lineGeometry);
      event.preventDefault();
      return;
    }

    const targetEntity = stationEl
      ? { type: "station", id: stationEl.dataset.stationId }
      : shapeEl
        ? { type: "shape", id: shapeEl.dataset.shapeId }
        : textEl
          ? { type: "text", id: textEl.dataset.textId }
          : null;

    if (targetEntity && !multiSelect) {
      if (!isEntitySelected(targetEntity.type, targetEntity.id)) {
        selectEntity(targetEntity);
      }

      const moveEntities = collectMovableSelectionState();
      if (moveEntities.length) {
        state.drag.mode = "selection-move";
        state.drag.fromX = point.x;
        state.drag.fromY = point.y;
        state.drag.moveEntities = moveEntities;
        state.drag.snapVisibleRect = getVisibleCanvasRect();
        state.drag.snapTargets = collectSnapTargets(moveEntities, state.drag.snapVisibleRect);
        const anchorEntry = moveEntities.find((entry) => (
          entry.type === targetEntity.type && entry.id === targetEntity.id
        ));
        state.drag.snapAnchor = anchorEntry
          ? { type: anchorEntry.type, id: anchorEntry.id, startX: anchorEntry.startX, startY: anchorEntry.startY }
          : null;
        state.drag.didMove = false;
        renderer.updateDragCursor();
        event.preventDefault();
        return;
      }
    }

    if (!target.closest("[data-station-id],[data-line-id],[data-shape-id],[data-text-id]")) {
      if (state.activeTool === "select") {
        state.drag.mode = "marquee";
        state.drag.marqueeStart = point;
        state.drag.marqueeCurrent = point;
        state.drag.didMove = false;
        drawSelectionMarquee(point, point);
        event.preventDefault();
        return;
      }

      // In shape placement mode, blank click should place shape, not start panning.
      if (state.activeTool === "shape" && state.menuSelection.shape) {
        // Do not prevent default here: some SVG click flows may be swallowed,
        // causing placement click to never fire.
        return;
      }

      state.drag.mode = "pan";
      state.drag.fromX = event.clientX;
      state.drag.fromY = event.clientY;
      state.drag.panX = state.pan.x;
      state.drag.panY = state.pan.y;
      state.drag.didMove = false;
      renderer.updateDragCursor();
      event.preventDefault();
    }
  }

  function onCanvasMouseMove(event) {
    const point = toCanvasPoint(event, svg, viewport);
    const shouldShowStationGhost = state.activeTool === "station" && state.menuSelection.station !== null && !state.drag.mode;
    const shouldShowShapeGhost = state.activeTool === "shape" && state.menuSelection.shape && !state.drag.mode;
    let ghostPoint = point;

    if (shouldShowStationGhost || shouldShowShapeGhost) {
      const visibleRect = getVisibleCanvasRect();
      const snapTargets = collectSnapTargets([], visibleRect);
      const snapResult = applySelectionSnap(point, event, snapTargets, visibleRect);
      ghostPoint = snapResult?.point || point;
      updateSnapGuides(snapResult?.guides || [], visibleRect);
    } else if (!state.drag.mode) {
      clearSnapGuides();
    }

    if (shouldShowStationGhost) {
      renderer.drawStationGhost?.(ghostPoint, state.menuSelection.station);
    } else {
      renderer.hideStationGhost?.();
    }

    if (shouldShowShapeGhost) {
      renderer.drawShapeGhost?.(ghostPoint, state.menuSelection.shape);
    } else {
      renderer.hideShapeGhost?.();
    }

    if (state.drag.mode === "pan") {
      if (Math.abs(event.clientX - state.drag.fromX) > 2 || Math.abs(event.clientY - state.drag.fromY) > 2) {
        state.drag.didMove = true;
      }
      state.pan.x = state.drag.panX + (event.clientX - state.drag.fromX);
      state.pan.y = state.drag.panY + (event.clientY - state.drag.fromY);
      renderer.updateViewportTransform();
      return;
    }

    if (state.drag.mode === "selection-move" && Array.isArray(state.drag.moveEntities)) {
      const rawDx = point.x - state.drag.fromX;
      const rawDy = point.y - state.drag.fromY;
      let dx = rawDx;
      let dy = rawDy;

      const anchor = state.drag.snapAnchor;
      const snapTargets = state.drag.snapTargets;
      const visibleRect = state.drag.snapVisibleRect;
      if (anchor && Array.isArray(snapTargets)) {
        const snapResult = applySelectionSnap(
          { x: anchor.startX + rawDx, y: anchor.startY + rawDy },
          event,
          snapTargets,
          visibleRect
        );
        if (snapResult) {
          dx = snapResult.point.x - anchor.startX;
          dy = snapResult.point.y - anchor.startY;
          updateSnapGuides(snapResult.guides, visibleRect);
        } else {
          clearSnapGuides();
        }
      } else {
        clearSnapGuides();
      }

      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        state.drag.didMove = true;
      }

      state.drag.moveEntities.forEach((entry) => {
        if (entry.type === "station") {
          const station = state.nodes.find((node) => node.id === entry.id);
          if (station) {
            station.x = entry.startX + dx;
            station.y = entry.startY + dy;
          }
          return;
        }

        if (entry.type === "text") {
          const label = state.labels.find((item) => item.id === entry.id);
          if (label) {
            label.x = entry.startX + dx;
            label.y = entry.startY + dy;
          }
          return;
        }

        if (entry.type === "shape") {
          const shape = state.shapes.find((item) => item.id === entry.id);
          if (shape) {
            shape.x = entry.startX + dx;
            shape.y = entry.startY + dy;
          }
        }
      });

      renderer.renderStations();
      renderer.renderLines();
      renderer.renderShapes();
      renderer.renderTexts();
      return;
    }

    if (state.drag.mode === "line") {
      const startStation = state.nodes.find((node) => node.id === state.drag.lineStartStationId);
      const selectedType = findLineType(state.menuSelection.lineType);
      const geometry = state.menuSelection.lineGeometry;
      if (!startStation || !selectedType || !geometry) {
        return;
      }
      renderer.drawLinePreview(startStation, point, selectedType, geometry);
      state.drag.didMove = true;
      return;
    }

    if (state.drag.mode === "marquee" && state.drag.marqueeStart) {
      state.drag.marqueeCurrent = point;
      if (
        Math.abs(point.x - state.drag.marqueeStart.x) > 0.5 ||
        Math.abs(point.y - state.drag.marqueeStart.y) > 0.5
      ) {
        state.drag.didMove = true;
      }
      drawSelectionMarquee(state.drag.marqueeStart, point);
    }
  }

  function onCanvasMouseUp(event) {
    const dragMode = state.drag.mode;
    const isSelectionMoveDrag = dragMode === "selection-move";
    const hadMove = Boolean(state.drag.didMove);

    if (dragMode === "line") {
      const startId = state.drag.lineStartStationId;
      const endStationEl = event.target.closest("[data-station-id]");
      const lineTypeId = state.menuSelection.lineType;
      const geometry = state.menuSelection.lineGeometry;

      if (startId && endStationEl && lineTypeId && geometry) {
        const endId = endStationEl.dataset.stationId;
        if (endId && endId !== startId) {
          addLine(startId, endId, lineTypeId, geometry);

          if (state.appSettings?.continuousLineMode === false) {
            state.menuSelection.lineType = null;
            renderer.renderSubmenu();
          }
        }
      }

      linePreview.setAttribute("visibility", "hidden");
      linePreview.setAttribute("d", "");
    }

    if (dragMode === "marquee") {
      hideSelectionMarquee();

      if (state.drag.marqueeStart && state.drag.marqueeCurrent && hadMove) {
        const rect = normalizeRect(state.drag.marqueeStart, state.drag.marqueeCurrent);
        const matches = collectEntitiesInRect(rect);
        const additive = event.ctrlKey || event.metaKey;

        if (matches.length) {
          selectEntities(matches, { additive });
        } else if (!additive) {
          clearSelection();
        }
      }
    }

    if ((dragMode === "pan" || dragMode === "marquee" || dragMode === "selection-move") && hadMove) {
      state.drag.suppressClick = true;
    }

    state.drag.mode = null;
    state.drag.stationId = null;
    state.drag.lineStartStationId = null;
    state.drag.moveEntities = [];
    state.drag.snapTargets = null;
    state.drag.snapAnchor = null;
    state.drag.snapVisibleRect = null;
    state.drag.marqueeStart = null;
    state.drag.marqueeCurrent = null;
    state.drag.didMove = false;
    renderer.updateDragCursor();
    clearSnapGuides();

    if (isSelectionMoveDrag && hadMove) {
      onStateChanged?.();
      return;
    }

    if (dragMode === "pan" && hadMove) {
      onStateChanged?.({ coalesceKey: "viewport" });
    }
  }

  function onCanvasWheel(event) {
    event.preventDefault();

    const oldZoom = state.zoom;
    const step = event.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = clamp(oldZoom * step, 0.3, 4);
    if (newZoom === oldZoom) {
      return;
    }

    const before = toCanvasPoint(event, svg, viewport);
    const cursor = clientToSvgPoint(event.clientX, event.clientY, svg);

    state.zoom = newZoom;
    state.pan.x = cursor.x - before.x * newZoom;
    state.pan.y = cursor.y - before.y * newZoom;

    renderer.updateViewportTransform();
    renderer.updateZoomIndicator();
    onStateChanged?.({ coalesceKey: "viewport" });
  }

  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    if (target.isContentEditable) {
      return true;
    }

    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function isEntitySelected(type, id) {
    return Array.isArray(state.selectedEntities)
      && state.selectedEntities.some((entity) => entity.type === type && entity.id === id);
  }

  function collectMovableSelectionState() {
    if (!Array.isArray(state.selectedEntities)) {
      return [];
    }

    const moveEntities = [];

    state.selectedEntities.forEach((entity) => {
      if (entity.type === "station") {
        const station = state.nodes.find((node) => node.id === entity.id);
        if (station) {
          moveEntities.push({
            type: "station",
            id: station.id,
            startX: station.x,
            startY: station.y
          });
        }
        return;
      }

      if (entity.type === "text") {
        const label = state.labels.find((item) => item.id === entity.id);
        if (label) {
          moveEntities.push({
            type: "text",
            id: label.id,
            startX: label.x,
            startY: label.y
          });
        }
        return;
      }

      if (entity.type === "shape") {
        const shape = state.shapes.find((item) => item.id === entity.id);
        if (shape) {
          moveEntities.push({
            type: "shape",
            id: shape.id,
            startX: shape.x,
            startY: shape.y
          });
        }
      }
    });

    return moveEntities;
  }

  function getVisibleCanvasRect() {
    if (!svg || !viewport) {
      return null;
    }

    const rect = svg.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const topLeft = toCanvasPoint({ clientX: rect.left, clientY: rect.top }, svg, viewport);
    const bottomRight = toCanvasPoint({ clientX: rect.right, clientY: rect.bottom }, svg, viewport);
    return normalizeRect(topLeft, bottomRight);
  }

  function collectSnapTargets(moveEntities, visibleRect) {
    const excluded = new Set((moveEntities || []).map((entry) => `${entry.type}:${entry.id}`));
    const targets = [];

    const pushTarget = (type, id, x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      if (excluded.has(`${type}:${id}`)) {
        return;
      }
      if (visibleRect && !containsPoint(visibleRect, x, y)) {
        return;
      }
      targets.push({ type, id, x, y });
    };

    state.nodes.forEach((station) => {
      pushTarget("station", station.id, station.x, station.y);
    });

    state.labels.forEach((label) => {
      pushTarget("text", label.id, label.x, label.y);
    });

    (Array.isArray(state.shapes) ? state.shapes : []).forEach((shape) => {
      pushTarget("shape", shape.id, shape.x, shape.y);
    });

    return targets;
  }

  function applySelectionSnap(point, event, snapTargets, visibleRect) {
    if (!point) {
      return null;
    }

    const useAxisDiagonal = state.appSettings?.snapAxisDiagonal !== false;
    const useEqualSpacing = state.appSettings?.snapEqualSpacing !== false;
    if ((!useAxisDiagonal && !useEqualSpacing) || event.altKey) {
      return { point, guides: [] };
    }

    const tolerance = getSnapToleranceInCanvas();
    let snapX = { value: point.x, delta: Infinity, guide: null };
    let snapY = { value: point.y, delta: Infinity, guide: null };

    if (useAxisDiagonal) {
      snapTargets.forEach((target) => {
        const dx = Math.abs(target.x - point.x);
        if (dx <= tolerance && dx < snapX.delta) {
          snapX = { value: target.x, delta: dx, guide: { kind: "axis-x", value: target.x } };
        }

        const dy = Math.abs(target.y - point.y);
        if (dy <= tolerance && dy < snapY.delta) {
          snapY = { value: target.y, delta: dy, guide: { kind: "axis-y", value: target.y } };
        }
      });
    }

    if (useEqualSpacing && snapTargets.length >= 2) {
      const equalX = findEqualSpacingCandidate(point, snapTargets, tolerance, "x");
      if (equalX && equalX.delta < snapX.delta) {
        snapX = equalX;
      }

      const equalY = findEqualSpacingCandidate(point, snapTargets, tolerance, "y");
      if (equalY && equalY.delta < snapY.delta) {
        snapY = equalY;
      }
    }

    const appliedX = snapX.delta <= tolerance;
    const appliedY = snapY.delta <= tolerance;
    const axisPoint = {
      x: appliedX ? snapX.value : point.x,
      y: appliedY ? snapY.value : point.y
    };

    const guides = [];
    if (appliedX && snapX.guide) {
      guides.push(snapX.guide);
    }
    if (appliedY && snapY.guide) {
      guides.push(snapY.guide);
    }

    const axisSnapped = appliedX || appliedY;
    const axisDistance = axisSnapped
      ? Math.hypot(axisPoint.x - point.x, axisPoint.y - point.y)
      : Infinity;

    let best = axisSnapped
      ? { point: axisPoint, guides, distance: axisDistance }
      : null;

    if (useAxisDiagonal) {
      const diagonal = findDiagonalSnap(point, snapTargets, tolerance);
      if (diagonal) {
        if (axisSnapped) {
          const combined = combineAxisAndDiagonal(axisPoint, diagonal, appliedX, appliedY, tolerance, guides);
          if (combined) {
            const combinedDistance = Math.hypot(combined.point.x - point.x, combined.point.y - point.y);
            if (!best || combinedDistance < best.distance) {
              best = { point: combined.point, guides: combined.guides, distance: combinedDistance };
            }
          }
        }

        if (!best || diagonal.distance < best.distance) {
          best = { point: diagonal.point, guides: [diagonal.guide], distance: diagonal.distance };
        }
      }
    }

    if (useEqualSpacing && useAxisDiagonal && snapTargets.length >= 2) {
      const diagonalEqual = findEqualSpacingDiagonal(point, snapTargets, tolerance);
      if (diagonalEqual && diagonalEqual.delta <= tolerance) {
        const diagGuide = diagonalEqual.guide?.line
          ? {
            kind: "diag",
            from: diagonalEqual.guide.from,
            to: diagonalEqual.guide.to,
            line: diagonalEqual.guide.line
          }
          : null;
        const guides = diagGuide
          ? [diagGuide, diagonalEqual.guide]
          : [diagonalEqual.guide];
        return { point: diagonalEqual.point, guides };
      }
    }

    if (best) {
      return { point: best.point, guides: best.guides };
    }

    return { point, guides: [] };
  }

  function getSnapToleranceInCanvas() {
    if (!svg || !viewport) {
      return 2;
    }

    const rect = svg.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      return 2;
    }

    const base = toCanvasPoint({ clientX: rect.left, clientY: rect.top }, svg, viewport);
    const offset = toCanvasPoint(
      { clientX: rect.left + snapConfig.pixelTolerance, clientY: rect.top + snapConfig.pixelTolerance },
      svg,
      viewport
    );

    const dx = Math.abs(offset.x - base.x);
    const dy = Math.abs(offset.y - base.y);
    return Math.max(1, dx, dy);
  }

  function findDiagonalSnap(point, targets, tolerance) {
    let best = null;
    targets.forEach((target) => {
      const diagonalA = target.y - target.x;
      const distA = Math.abs((point.y - point.x) - diagonalA) / Math.SQRT2;
      if (distA <= tolerance && (!best || distA < best.distance)) {
        const x = (point.x + point.y - diagonalA) / 2;
        const y = x + diagonalA;
        const line = { type: "diff", c: diagonalA };
        best = {
          point: { x, y },
          distance: distA,
          guide: { kind: "diag", from: { x: target.x, y: target.y }, to: { x, y }, line },
          line
        };
      }

      const diagonalB = target.y + target.x;
      const distB = Math.abs((point.y + point.x) - diagonalB) / Math.SQRT2;
      if (distB <= tolerance && (!best || distB < best.distance)) {
        const x = (point.x - point.y + diagonalB) / 2;
        const y = -x + diagonalB;
        const line = { type: "sum", c: diagonalB };
        best = {
          point: { x, y },
          distance: distB,
          guide: { kind: "diag", from: { x: target.x, y: target.y }, to: { x, y }, line },
          line
        };
      }
    });

    return best;
  }

  function combineAxisAndDiagonal(axisPoint, diagonal, appliedX, appliedY, tolerance, axisGuides) {
    const line = diagonal?.line;
    if (!line) {
      return null;
    }

    if (appliedX && appliedY) {
      const distance = getDiagonalDistance(axisPoint, line);
      if (distance <= tolerance) {
        return { point: axisPoint, guides: [...axisGuides, diagonal.guide] };
      }
      return null;
    }

    if (appliedX) {
      const point = intersectDiagonalWithAxis(line, { x: axisPoint.x });
      if (point && Math.hypot(point.x - axisPoint.x, point.y - axisPoint.y) <= tolerance) {
        return { point, guides: [...axisGuides, diagonal.guide] };
      }
      return null;
    }

    if (appliedY) {
      const point = intersectDiagonalWithAxis(line, { y: axisPoint.y });
      if (point && Math.hypot(point.x - axisPoint.x, point.y - axisPoint.y) <= tolerance) {
        return { point, guides: [...axisGuides, diagonal.guide] };
      }
      return null;
    }

    return null;
  }

  function intersectDiagonalWithAxis(line, axis) {
    if (!line || (!Number.isFinite(axis?.x) && !Number.isFinite(axis?.y))) {
      return null;
    }

    if (Number.isFinite(axis.x)) {
      if (line.type === "diff") {
        return { x: axis.x, y: axis.x + line.c };
      }
      return { x: axis.x, y: -axis.x + line.c };
    }

    if (line.type === "diff") {
      return { x: axis.y - line.c, y: axis.y };
    }
    return { x: line.c - axis.y, y: axis.y };
  }

  function getDiagonalDistance(point, line) {
    if (!point || !line) {
      return Infinity;
    }

    if (line.type === "diff") {
      return Math.abs((point.y - point.x) - line.c) / Math.SQRT2;
    }
    return Math.abs((point.y + point.x) - line.c) / Math.SQRT2;
  }

  function findEqualSpacingCandidate(point, targets, tolerance, axis) {
    let best = null;
    const updateCandidate = (value, guide) => {
      const delta = Math.abs((axis === "x" ? point.x : point.y) - value);
      if (delta > tolerance || (best && delta >= best.delta)) {
        return;
      }
      best = { value, delta, guide };
    };

    for (let i = 0; i < targets.length; i += 1) {
      const a = targets[i];
      for (let j = i + 1; j < targets.length; j += 1) {
        const b = targets[j];
        if (axis === "x") {
          if (Math.abs(a.y - b.y) > tolerance) {
            continue;
          }
          const rowY = (a.y + b.y) / 2;
          if (Math.abs(point.y - rowY) > tolerance) {
            continue;
          }
          const midX = (a.x + b.x) / 2;
          updateCandidate(midX, {
            kind: "equal-x",
            from: { x: a.x, y: rowY },
            to: { x: b.x, y: rowY },
            target: { x: midX, y: rowY }
          });
          const leftX = Math.min(a.x, b.x);
          const rightX = Math.max(a.x, b.x);
          const spacingX = rightX - leftX;
          if (spacingX > 0) {
            const extendLeft = leftX - spacingX;
            const extendRight = rightX + spacingX;
            updateCandidate(extendLeft, {
              kind: "equal-x",
              from: { x: leftX, y: rowY },
              to: { x: rightX, y: rowY },
              target: { x: extendLeft, y: rowY }
            });
            updateCandidate(extendRight, {
              kind: "equal-x",
              from: { x: leftX, y: rowY },
              to: { x: rightX, y: rowY },
              target: { x: extendRight, y: rowY }
            });
          }
        } else {
          if (Math.abs(a.x - b.x) > tolerance) {
            continue;
          }
          const colX = (a.x + b.x) / 2;
          if (Math.abs(point.x - colX) > tolerance) {
            continue;
          }
          const midY = (a.y + b.y) / 2;
          updateCandidate(midY, {
            kind: "equal-y",
            from: { x: colX, y: a.y },
            to: { x: colX, y: b.y },
            target: { x: colX, y: midY }
          });
          const topY = Math.min(a.y, b.y);
          const bottomY = Math.max(a.y, b.y);
          const spacingY = bottomY - topY;
          if (spacingY > 0) {
            const extendTop = topY - spacingY;
            const extendBottom = bottomY + spacingY;
            updateCandidate(extendTop, {
              kind: "equal-y",
              from: { x: colX, y: topY },
              to: { x: colX, y: bottomY },
              target: { x: colX, y: extendTop }
            });
            updateCandidate(extendBottom, {
              kind: "equal-y",
              from: { x: colX, y: topY },
              to: { x: colX, y: bottomY },
              target: { x: colX, y: extendBottom }
            });
          }
        }
      }
    }

    return best;
  }

  function findEqualSpacingDiagonal(point, targets, tolerance) {
    let best = null;
    const updateCandidate = (candidate, guide) => {
      const delta = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      if (delta > tolerance || (best && delta >= best.delta)) {
        return;
      }
      best = { point: candidate, delta, guide };
    };

    for (let i = 0; i < targets.length; i += 1) {
      const a = targets[i];
      for (let j = i + 1; j < targets.length; j += 1) {
        const b = targets[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(Math.abs(dx) - Math.abs(dy)) > tolerance * 2) {
          continue;
        }

        const lineType = dx * dy >= 0 ? "diff" : "sum";
        const line = lineType === "diff"
          ? { type: "diff", c: a.y - a.x }
          : { type: "sum", c: a.y + a.x };

        if (getDiagonalDistance(point, line) > tolerance) {
          continue;
        }

        const x1 = a.x;
        const x2 = b.x;
        const leftX = Math.min(x1, x2);
        const rightX = Math.max(x1, x2);
        const spacing = rightX - leftX;
        if (spacing <= 0) {
          continue;
        }

        const midX = (leftX + rightX) / 2;
        const buildPoint = (x) => (
          line.type === "diff"
            ? { x, y: x + line.c }
            : { x, y: -x + line.c }
        );

        const buildGuide = (candidate) => ({
          kind: "equal-diag",
          from: { x: a.x, y: a.y },
          to: { x: b.x, y: b.y },
          target: candidate,
          line
        });

        const midPoint = buildPoint(midX);
        updateCandidate(midPoint, buildGuide(midPoint));
        const leftPoint = buildPoint(leftX - spacing);
        updateCandidate(leftPoint, buildGuide(leftPoint));
        const rightPoint = buildPoint(rightX + spacing);
        updateCandidate(rightPoint, buildGuide(rightPoint));
      }
    }

    return best;
  }

  function updateSnapGuides(guides, visibleRect) {
    if (!snapGuideLayer) {
      return;
    }

    snapGuideLayer.innerHTML = "";
    if (!Array.isArray(guides) || guides.length === 0) {
      return;
    }

    const rect = visibleRect || getVisibleCanvasRect();
    guides.forEach((guide) => {
      if (guide.kind === "axis-x") {
        if (!rect) {
          return;
        }
        const line = document.createElementNS(svgNs, "line");
        line.setAttribute("x1", String(guide.value));
        line.setAttribute("x2", String(guide.value));
        line.setAttribute("y1", String(rect.y));
        line.setAttribute("y2", String(rect.y + rect.height));
        line.setAttribute("class", "snap-guide-line");
        snapGuideLayer.appendChild(line);
        return;
      }

      if (guide.kind === "axis-y") {
        if (!rect) {
          return;
        }
        const line = document.createElementNS(svgNs, "line");
        line.setAttribute("x1", String(rect.x));
        line.setAttribute("x2", String(rect.x + rect.width));
        line.setAttribute("y1", String(guide.value));
        line.setAttribute("y2", String(guide.value));
        line.setAttribute("class", "snap-guide-line");
        snapGuideLayer.appendChild(line);
        return;
      }

      if (guide.kind === "diag") {
        const lineInfo = guide.line;
        if (rect && lineInfo) {
          const segment = getDiagonalGuideSegment(lineInfo, rect);
          if (segment) {
            const line = document.createElementNS(svgNs, "line");
            line.setAttribute("x1", String(segment.from.x));
            line.setAttribute("y1", String(segment.from.y));
            line.setAttribute("x2", String(segment.to.x));
            line.setAttribute("y2", String(segment.to.y));
            line.setAttribute("class", "snap-guide-line snap-guide-diagonal");
            snapGuideLayer.appendChild(line);
            return;
          }
        }

        const fallback = document.createElementNS(svgNs, "line");
        fallback.setAttribute("x1", String(guide.from.x));
        fallback.setAttribute("y1", String(guide.from.y));
        fallback.setAttribute("x2", String(guide.to.x));
        fallback.setAttribute("y2", String(guide.to.y));
        fallback.setAttribute("class", "snap-guide-line snap-guide-diagonal");
        snapGuideLayer.appendChild(fallback);
        return;
      }

      if (guide.kind === "equal-x" || guide.kind === "equal-y" || guide.kind === "equal-diag") {
        drawDimensionGuide(guide, rect);
      }
    });
  }

  function drawDimensionGuide(guide, rect) {
    if (!snapGuideLayer) {
      return;
    }

    const offsetBase = Math.max(4, Number(state.appSettings?.snapEqualSpacingOffset) || 12);
    if (guide.kind === "equal-x") {
      const y = guide.from.y;
      const x1 = guide.from.x;
      const x2 = guide.to.x;
      const target = guide.target;
      if (!target) {
        return;
      }
      let offset = -offsetBase;
      if (rect && y + offset < rect.y) {
        offset = offsetBase;
      }
      const yDim = y + offset;

      const points = [
        { x: x1, y },
        { x: x2, y },
        { x: target.x, y }
      ].sort((a, b) => a.x - b.x);

      const dimPoints = points.map((pt) => ({ x: pt.x, y: yDim }));
      points.forEach((pt) => {
        appendGuideLine(pt.x, pt.y, pt.x, yDim, "snap-guide-distance snap-guide-extension");
      });

      drawSegmentDoubleArrow(dimPoints[0], dimPoints[1]);
      drawSegmentDoubleArrow(dimPoints[1], dimPoints[2]);
      return;
    }

    if (guide.kind === "equal-diag") {
      const from = guide.from;
      const to = guide.to;
      const target = guide.target;
      if (!from || !to) {
        return;
      }

      if (!target) {
        return;
      }

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      if (!Number.isFinite(length) || length <= 0.01) {
        return;
      }

      const ux = dx / length;
      const uy = dy / length;
      const px = -uy;
      const py = ux;

      let sign = 1;
      const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      if (rect) {
        const pos = { x: mid.x + px * offsetBase, y: mid.y + py * offsetBase };
        const neg = { x: mid.x - px * offsetBase, y: mid.y - py * offsetBase };
        if (containsPoint(rect, neg.x, neg.y) && !containsPoint(rect, pos.x, pos.y)) {
          sign = -1;
        }
      }

      const offX = px * offsetBase * sign;
      const offY = py * offsetBase * sign;

      const basePoints = [from, to, target];
      const sorted = basePoints
        .map((pt) => ({
          point: pt,
          projection: (pt.x * ux) + (pt.y * uy)
        }))
        .sort((a, b) => a.projection - b.projection)
        .map((entry) => entry.point);

      const dimPoints = sorted.map((pt) => ({
        x: pt.x + offX,
        y: pt.y + offY
      }));

      sorted.forEach((pt, index) => {
        const dim = dimPoints[index];
        appendGuideLine(pt.x, pt.y, dim.x, dim.y, "snap-guide-distance snap-guide-extension");
      });

      drawSegmentDoubleArrow(dimPoints[0], dimPoints[1]);
      drawSegmentDoubleArrow(dimPoints[1], dimPoints[2]);
      return;
    }

    const x = guide.from.x;
    const y1 = guide.from.y;
    const y2 = guide.to.y;
    const target = guide.target;
    if (!target) {
      return;
    }
    let offset = -offsetBase;
    if (rect && x + offset < rect.x) {
      offset = offsetBase;
    }
    const xDim = x + offset;

    const points = [
      { x, y: y1 },
      { x, y: y2 },
      { x, y: target.y }
    ].sort((a, b) => a.y - b.y);

    const dimPoints = points.map((pt) => ({ x: xDim, y: pt.y }));
    points.forEach((pt) => {
      appendGuideLine(pt.x, pt.y, xDim, pt.y, "snap-guide-distance snap-guide-extension");
    });

    drawSegmentDoubleArrow(dimPoints[0], dimPoints[1]);
    drawSegmentDoubleArrow(dimPoints[1], dimPoints[2]);
    return;
  }

  function appendGuideLine(x1, y1, x2, y2, className) {
    const line = document.createElementNS(svgNs, "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    line.setAttribute("class", className);
    snapGuideLayer.appendChild(line);
  }

  function appendArrowHead(point, direction) {
    const size = 6;
    const spread = 4;
    if (direction === "left" || direction === "right") {
      const sign = direction === "left" ? -1 : 1;
      appendGuideLine(point.x, point.y, point.x + sign * size, point.y - spread, "snap-guide-arrow");
      appendGuideLine(point.x, point.y, point.x + sign * size, point.y + spread, "snap-guide-arrow");
      return;
    }

    const sign = direction === "up" ? -1 : 1;
    appendGuideLine(point.x, point.y, point.x - spread, point.y + sign * size, "snap-guide-arrow");
    appendGuideLine(point.x, point.y, point.x + spread, point.y + sign * size, "snap-guide-arrow");
  }

  function drawCenteredDoubleArrow(from, to) {
    if (!from || !to) {
      return;
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= 0.01) {
      return;
    }

    const ux = dx / length;
    const uy = dy / length;
    const arrowLength = Math.min(26, Math.max(12, length * 0.45));
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const half = arrowLength / 2;
    const start = { x: mid.x - ux * half, y: mid.y - uy * half };
    const end = { x: mid.x + ux * half, y: mid.y + uy * half };

    appendGuideLine(start.x, start.y, end.x, end.y, "snap-guide-arrow");
    appendArrowHeadAlong(start, -ux, -uy);
    appendArrowHeadAlong(end, ux, uy);
  }

  function drawSegmentDoubleArrow(from, to) {
    if (!from || !to) {
      return;
    }

    appendGuideLine(from.x, from.y, to.x, to.y, "snap-guide-distance");
    appendArrowHeadAlong(from, from.x - to.x, from.y - to.y);
    appendArrowHeadAlong(to, to.x - from.x, to.y - from.y);
  }

  function appendArrowHeadAlong(point, dirX, dirY) {
    const size = 6;
    const spread = 4;
    const length = Math.hypot(dirX, dirY);
    if (!Number.isFinite(length) || length === 0) {
      return;
    }

    const ux = dirX / length;
    const uy = dirY / length;
    const px = -uy;
    const py = ux;
    appendGuideLine(
      point.x,
      point.y,
      point.x - ux * size + px * spread,
      point.y - uy * size + py * spread,
      "snap-guide-arrow"
    );
    appendGuideLine(
      point.x,
      point.y,
      point.x - ux * size - px * spread,
      point.y - uy * size - py * spread,
      "snap-guide-arrow"
    );
  }

  function getDiagonalGuideSegment(line, rect) {
    if (!line || !rect) {
      return null;
    }

    const points = [];
    const minX = rect.x;
    const maxX = rect.x + rect.width;
    const minY = rect.y;
    const maxY = rect.y + rect.height;

    const pushPoint = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      if (x < minX - 0.01 || x > maxX + 0.01 || y < minY - 0.01 || y > maxY + 0.01) {
        return;
      }
      const rounded = { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
      if (!points.some((pt) => Math.hypot(pt.x - rounded.x, pt.y - rounded.y) < 0.1)) {
        points.push(rounded);
      }
    };

    if (line.type === "diff") {
      pushPoint(minX, minX + line.c);
      pushPoint(maxX, maxX + line.c);
      pushPoint(minY - line.c, minY);
      pushPoint(maxY - line.c, maxY);
    } else {
      pushPoint(minX, -minX + line.c);
      pushPoint(maxX, -maxX + line.c);
      pushPoint(line.c - minY, minY);
      pushPoint(line.c - maxY, maxY);
    }

    if (points.length < 2) {
      return null;
    }

    let from = points[0];
    let to = points[1];
    let maxDistance = Math.hypot(to.x - from.x, to.y - from.y);
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const distance = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
        if (distance > maxDistance) {
          maxDistance = distance;
          from = points[i];
          to = points[j];
        }
      }
    }

    return { from, to };
  }

  function clearSnapGuides() {
    if (!snapGuideLayer) {
      return;
    }

    snapGuideLayer.innerHTML = "";
  }

  function drawSelectionMarquee(from, to) {
    if (!selectionMarquee) {
      return;
    }

    const rect = normalizeRect(from, to);
    selectionMarquee.setAttribute("x", String(rect.x));
    selectionMarquee.setAttribute("y", String(rect.y));
    selectionMarquee.setAttribute("width", String(rect.width));
    selectionMarquee.setAttribute("height", String(rect.height));
    selectionMarquee.setAttribute("visibility", "visible");
  }

  function hideSelectionMarquee() {
    if (!selectionMarquee) {
      return;
    }

    selectionMarquee.setAttribute("visibility", "hidden");
    selectionMarquee.setAttribute("x", "0");
    selectionMarquee.setAttribute("y", "0");
    selectionMarquee.setAttribute("width", "0");
    selectionMarquee.setAttribute("height", "0");
  }

  function collectEntitiesInRect(rect) {
    const matches = [];

    state.nodes.forEach((station) => {
      if (containsPoint(rect, station.x, station.y)) {
        matches.push({ type: "station", id: station.id });
      }
    });

    if (lineLayer) {
      const hitLineIds = new Set();
      lineLayer.querySelectorAll("[data-line-id]").forEach((pathEl) => {
        const id = pathEl.getAttribute("data-line-id");
        if (!id || hitLineIds.has(id)) {
          return;
        }

        let bbox;
        try {
          bbox = pathEl.getBBox();
        } catch {
          return;
        }

        if (!intersectsRect(rect, bbox)) {
          return;
        }

        if (pathIntersectsRect(pathEl, rect)) {
          hitLineIds.add(id);
          matches.push({ type: "line", id });
        }
      });
    }

    if (textLayer) {
      textLayer.querySelectorAll("[data-text-id]").forEach((textEl) => {
        const id = textEl.getAttribute("data-text-id");
        if (!id) {
          return;
        }

        let bbox;
        try {
          bbox = textEl.getBBox();
        } catch {
          return;
        }

        if (intersectsRect(rect, bbox)) {
          matches.push({ type: "text", id });
        }
      });
    }

    if (shapeLayer) {
      shapeLayer.querySelectorAll("[data-shape-id]").forEach((shapeEl) => {
        const id = shapeEl.getAttribute("data-shape-id");
        if (!id) {
          return;
        }

        const bbox = getTransformedBBox(shapeEl);
        if (!bbox) {
          return;
        }

        if (intersectsRect(rect, bbox)) {
          matches.push({ type: "shape", id });
        }
      });
    }

    return matches;
  }

  function normalizeRect(a, b) {
    const minX = Math.min(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxX = Math.max(a.x, b.x);
    const maxY = Math.max(a.y, b.y);

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  function containsPoint(rect, x, y) {
    return x >= rect.x
      && x <= rect.x + rect.width
      && y >= rect.y
      && y <= rect.y + rect.height;
  }

  function intersectsRect(a, b) {
    return !(
      b.x > a.x + a.width
      || b.x + b.width < a.x
      || b.y > a.y + a.height
      || b.y + b.height < a.y
    );
  }

  function getTransformedBBox(element) {
    if (!element || typeof element.getBBox !== "function") {
      return null;
    }

    let bbox;
    try {
      bbox = element.getBBox();
    } catch {
      return null;
    }

    const elementMatrix = element.getScreenCTM?.();
    const viewportMatrix = viewport?.getScreenCTM?.();
    if (!elementMatrix || !viewportMatrix) {
      return bbox;
    }

    const viewportInverse = viewportMatrix.inverse();
    const ctm = viewportInverse.multiply(elementMatrix);

    const x1 = bbox.x;
    const y1 = bbox.y;
    const x2 = bbox.x + bbox.width;
    const y2 = bbox.y + bbox.height;

    const p1 = applyMatrix(ctm, x1, y1);
    const p2 = applyMatrix(ctm, x2, y1);
    const p3 = applyMatrix(ctm, x2, y2);
    const p4 = applyMatrix(ctm, x1, y2);

    const minX = Math.min(p1.x, p2.x, p3.x, p4.x);
    const minY = Math.min(p1.y, p2.y, p3.y, p4.y);
    const maxX = Math.max(p1.x, p2.x, p3.x, p4.x);
    const maxY = Math.max(p1.y, p2.y, p3.y, p4.y);

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  function applyMatrix(matrix, x, y) {
    return {
      x: matrix.a * x + matrix.c * y + matrix.e,
      y: matrix.b * x + matrix.d * y + matrix.f
    };
  }

  function pathIntersectsRect(pathEl, rect) {
    if (!pathEl || typeof pathEl.getTotalLength !== "function") {
      return false;
    }

    let totalLength = 0;
    try {
      totalLength = pathEl.getTotalLength();
    } catch {
      return false;
    }

    if (!Number.isFinite(totalLength) || totalLength <= 0) {
      return false;
    }

    // Sample along the path to approximate intersection with the marquee.
    const step = Math.max(4, Math.min(rect.width, rect.height) / 2);
    for (let distance = 0; distance <= totalLength; distance += step) {
      let point;
      try {
        point = pathEl.getPointAtLength(distance);
      } catch {
        return false;
      }
      if (containsPoint(rect, point.x, point.y)) {
        return true;
      }
    }

    // Ensure the end point is checked.
    try {
      const endPoint = pathEl.getPointAtLength(totalLength);
      return containsPoint(rect, endPoint.x, endPoint.y);
    } catch {
      return false;
    }
  }

  return {
    bindToolbar,
    bindCanvas,
    bindKeyboard,
    bindFileMenu
  };
}
