import { clamp, clientToSvgPoint, toCanvasPoint } from "./utils.js";

export function createEventBinder({
  state,
  elements,
  renderer,
  findLineType,
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
  loadDrawingFromFile,
  undo,
  redo,
  onStateChanged
}) {
  const {
    svg,
    viewport,
    lineLayer,
    shapeLayer,
    textLayer,
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
    fileUndoBtn,
    fileRedoBtn,
    fileLoadInput
  } = elements;

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
      renderer.updateDragCursor();
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
        if (event.shiftKey) {
          redo?.();
        } else {
          undo?.();
        }
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      if (isEditableTarget(event.target) || state.lineManager.isOpen || state.shapeManager?.isOpen) {
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
    if (!fileNewBtn || !fileSaveBtn || !fileLoadBtn || !fileUndoBtn || !fileRedoBtn || !fileLoadInput) {
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

    const stationEl = target.closest("[data-station-id]");
    const lineEl = target.closest("[data-line-id]");
    const shapeEl = target.closest("[data-shape-id]");
    const textEl = target.closest("[data-text-id]");

    if (stationEl) {
      const entity = { type: "station", id: stationEl.dataset.stationId };
      if (multiSelect) {
        toggleEntitySelection(entity);
      } else {
        selectEntity(entity);
      }
      return;
    }

    if (lineEl) {
      const entity = { type: "line", id: lineEl.dataset.lineId };
      if (multiSelect) {
        toggleEntitySelection(entity);
      } else {
        selectEntity(entity);
      }
      return;
    }

    if (textEl) {
      const entity = { type: "text", id: textEl.dataset.textId };
      if (multiSelect) {
        toggleEntitySelection(entity);
      } else {
        selectEntity(entity);
      }
      return;
    }

    if (shapeEl) {
      const entity = { type: "shape", id: shapeEl.dataset.shapeId };
      if (multiSelect) {
        toggleEntitySelection(entity);
      } else {
        selectEntity(entity);
      }
      return;
    }

    if (state.activeTool === "station" && state.menuSelection.station !== null) {
      addStation(point.x, point.y, state.menuSelection.station);
      return;
    }

    if (state.activeTool === "text") {
      addText(point.x, point.y);
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

    if (state.activeTool === "shape" && state.menuSelection.shape && !state.drag.mode) {
      renderer.drawShapeGhost?.(point, state.menuSelection.shape);
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
      const dx = point.x - state.drag.fromX;
      const dy = point.y - state.drag.fromY;

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
    state.drag.marqueeStart = null;
    state.drag.marqueeCurrent = null;
    state.drag.didMove = false;
    renderer.updateDragCursor();

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
      const lineBoxes = new Map();
      lineLayer.querySelectorAll("[data-line-id]").forEach((pathEl) => {
        const id = pathEl.getAttribute("data-line-id");
        if (!id) {
          return;
        }

        let bbox;
        try {
          bbox = pathEl.getBBox();
        } catch {
          return;
        }

        const existing = lineBoxes.get(id);
        if (!existing) {
          lineBoxes.set(id, bbox);
          return;
        }

        const minX = Math.min(existing.x, bbox.x);
        const minY = Math.min(existing.y, bbox.y);
        const maxX = Math.max(existing.x + existing.width, bbox.x + bbox.width);
        const maxY = Math.max(existing.y + existing.height, bbox.y + bbox.height);
        lineBoxes.set(id, {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY
        });
      });

      lineBoxes.forEach((bbox, id) => {
        if (intersectsRect(rect, bbox)) {
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

        let bbox;
        try {
          bbox = shapeEl.getBBox();
        } catch {
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

  return {
    bindToolbar,
    bindCanvas,
    bindKeyboard,
    bindFileMenu
  };
}
