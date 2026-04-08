const DEFAULT_PASTE_OFFSET = 18;

const cloneValue = (value) => structuredClone(value);

function getSelectedIds(entities, type) {
  return new Set(
    Array.isArray(entities)
      ? entities.filter((item) => item.type === type).map((item) => item.id)
      : []
  );
}

function createCopyName(baseName, existingNames) {
  const trimmed = String(baseName || "").trim() || "Shape";
  const candidates = new Set(existingNames || []);
  const suffix = " Copy";
  if (!candidates.has(trimmed + suffix)) {
    return trimmed + suffix;
  }

  let counter = 2;
  while (candidates.has(`${trimmed}${suffix} ${counter}`)) {
    counter += 1;
  }
  return `${trimmed}${suffix} ${counter}`;
}

function offsetPrimitive(primitive, delta) {
  if (!primitive || typeof primitive !== "object") {
    return;
  }

  const shift = (value) => (Number.isFinite(value) ? value + delta : value);

  if (primitive.type === "line") {
    primitive.x1 = shift(primitive.x1);
    primitive.y1 = shift(primitive.y1);
    primitive.x2 = shift(primitive.x2);
    primitive.y2 = shift(primitive.y2);
    return;
  }

  if (primitive.type === "bezier") {
    primitive.x1 = shift(primitive.x1);
    primitive.y1 = shift(primitive.y1);
    primitive.x2 = shift(primitive.x2);
    primitive.y2 = shift(primitive.y2);
    primitive.cx1 = shift(primitive.cx1);
    primitive.cy1 = shift(primitive.cy1);
    primitive.cx2 = shift(primitive.cx2);
    primitive.cy2 = shift(primitive.cy2);
    return;
  }

  if (primitive.type === "circle" || primitive.type === "hexagon" || primitive.type === "octagon") {
    primitive.cx = shift(primitive.cx);
    primitive.cy = shift(primitive.cy);
    return;
  }

  if (primitive.type === "rect") {
    primitive.x = shift(primitive.x);
    primitive.y = shift(primitive.y);
    return;
  }

  if (primitive.type === "text") {
    primitive.x = shift(primitive.x);
    primitive.y = shift(primitive.y);
  }
}

export function createMainClipboard({
  state,
  getNextId,
  selectEntities,
  rerenderScene,
  commitStateChange,
  deleteSelectedEntity
}) {
  let snapshot = null;
  let pasteIndex = 0;

  const clear = () => {
    snapshot = null;
    pasteIndex = 0;
  };

  const hasData = () => Boolean(snapshot);

  const copySelection = () => {
    if (!Array.isArray(state.selectedEntities) || !state.selectedEntities.length) {
      clear();
      return false;
    }

    const selectedStationIds = getSelectedIds(state.selectedEntities, "station");
    const selectedLineIds = getSelectedIds(state.selectedEntities, "line");
    const selectedTextIds = getSelectedIds(state.selectedEntities, "text");
    const selectedShapeIds = getSelectedIds(state.selectedEntities, "shape");

    const stations = state.nodes.filter((node) => selectedStationIds.has(node.id));
    const lines = state.edges.filter((edge) => selectedLineIds.has(edge.id));
    const texts = state.labels.filter((label) => selectedTextIds.has(label.id));
    const shapes = state.shapes.filter((shape) => selectedShapeIds.has(shape.id));

    if (!stations.length && !lines.length && !texts.length && !shapes.length) {
      clear();
      return false;
    }

    snapshot = {
      stations: cloneValue(stations),
      lines: cloneValue(lines),
      texts: cloneValue(texts),
      shapes: cloneValue(shapes)
    };
    pasteIndex = 0;
    return true;
  };

  const cutSelection = () => {
    const copied = copySelection();
    if (!copied) {
      return false;
    }
    deleteSelectedEntity();
    return true;
  };

  const paste = () => {
    if (!snapshot) {
      return false;
    }

    const offset = DEFAULT_PASTE_OFFSET * (pasteIndex + 1);
    pasteIndex += 1;

    const stationIdMap = new Map();
    const nextSelection = [];

    snapshot.stations.forEach((source) => {
      const station = cloneValue(source);
      station.id = getNextId("station");
      station.x = Number(station.x) + offset;
      station.y = Number(station.y) + offset;
      stationIdMap.set(source.id, station.id);
      state.nodes.push(station);
      nextSelection.push({ type: "station", id: station.id });
    });

    snapshot.lines.forEach((source) => {
      const line = cloneValue(source);
      line.id = getNextId("line");
      line.fromStationId = stationIdMap.get(line.fromStationId) || line.fromStationId;
      line.toStationId = stationIdMap.get(line.toStationId) || line.toStationId;
      state.edges.push(line);
      nextSelection.push({ type: "line", id: line.id });
    });

    snapshot.texts.forEach((source) => {
      const label = cloneValue(source);
      label.id = getNextId("text");
      label.x = Number(label.x) + offset;
      label.y = Number(label.y) + offset;
      state.labels.push(label);
      nextSelection.push({ type: "text", id: label.id });
    });

    snapshot.shapes.forEach((source) => {
      const shape = cloneValue(source);
      shape.id = getNextId("shape");
      shape.x = Number(shape.x) + offset;
      shape.y = Number(shape.y) + offset;
      state.shapes.push(shape);
      nextSelection.push({ type: "shape", id: shape.id });
    });

    if (!nextSelection.length) {
      return false;
    }

    rerenderScene();
    selectEntities(nextSelection);
    commitStateChange();
    return true;
  };

  const duplicateSelection = () => {
    const prevSnapshot = snapshot ? cloneValue(snapshot) : null;
    const prevPasteIndex = pasteIndex;
    const copied = copySelection();
    if (!copied) {
      return false;
    }
    const result = paste();
    snapshot = prevSnapshot;
    pasteIndex = prevPasteIndex;
    return result;
  };

  return {
    copySelection,
    cutSelection,
    paste,
    duplicateSelection,
    clear,
    hasData
  };
}

export function createShapeManagerClipboard({
  state,
  createShapeId,
  setSelectedPrimitiveIndices,
  getSelectedShape,
  ensureEditableShape,
  getFirstPrimitiveIndex,
  syncShapeSvg,
  persistShapeLibrary,
  renderShapeManager,
  renderSubmenu,
  resetViewToSelectedShape,
  deleteCurrentSelection
}) {
  let snapshot = null;
  let pasteIndex = 0;

  const getSelectedPrimitiveIndices = (shape) => {
    if (!shape || !Array.isArray(shape.editableElements)) {
      return [];
    }

    const result = [];
    const seen = new Set();
    const indices = Array.isArray(state.shapeManager.selectedPrimitiveIndices)
      ? state.shapeManager.selectedPrimitiveIndices
      : [];

    indices.forEach((index) => {
      if (!Number.isInteger(index)) {
        return;
      }
      if (!seen.has(index)) {
        seen.add(index);
        result.push(index);
      }
    });

    if (!result.length && Number.isInteger(state.shapeManager.selectedPrimitiveIndex)) {
      result.push(state.shapeManager.selectedPrimitiveIndex);
    }

    return result;
  };

  const clear = () => {
    snapshot = null;
    pasteIndex = 0;
  };

  const hasData = () => Boolean(snapshot);

  const copySelection = () => {
    const shape = getSelectedShape();
    if (!shape) {
      clear();
      return false;
    }

    if (Array.isArray(shape.editableElements)) {
      const indices = getSelectedPrimitiveIndices(shape);
      if (indices.length) {
        const sorted = [...indices].sort((a, b) => a - b);
        if (sorted.length === 1) {
          const primitive = shape.editableElements[sorted[0]];
          if (!primitive) {
            clear();
            return false;
          }
          snapshot = {
            type: "primitive",
            primitive: cloneValue(primitive)
          };
        } else {
          snapshot = {
            type: "primitive-list",
            primitives: sorted
              .map((index) => shape.editableElements[index])
              .filter(Boolean)
              .map((item) => cloneValue(item))
          };
        }
        pasteIndex = 0;
        return true;
      }
    }

    snapshot = {
      type: "shape",
      shape: cloneValue(shape)
    };
    pasteIndex = 0;
    return true;
  };

  const cutSelection = () => {
    const copied = copySelection();
    if (!copied) {
      return false;
    }

    deleteCurrentSelection();
    return true;
  };

  const paste = () => {
    if (!snapshot) {
      return false;
    }

    const offset = DEFAULT_PASTE_OFFSET * (pasteIndex + 1);
    pasteIndex += 1;

    if (snapshot.type === "primitive") {
      const shape = ensureEditableShape();
      if (!shape || !Array.isArray(shape.editableElements)) {
        return false;
        const duplicateSelection = () => {
          const prevSnapshot = snapshot ? cloneValue(snapshot) : null;
          const prevPasteIndex = pasteIndex;
          const copied = copySelection();
          if (!copied) {
            return false;
          }
          const result = paste();
          snapshot = prevSnapshot;
          pasteIndex = prevPasteIndex;
          return result;
        };
      }

      const primitive = cloneValue(snapshot.primitive);
      offsetPrimitive(primitive, offset * 0.3);
      shape.editableElements.push(primitive);
      duplicateSelection,
        setSelectedPrimitiveIndices(shape, [shape.editableElements.length - 1]);
      syncShapeSvg(shape, { preserveParameters: true });
      persistShapeLibrary();
      renderShapeManager();
      renderSubmenu();
      return true;
    }

    if (snapshot.type === "primitive-list") {
      const shape = ensureEditableShape();
      if (!shape || !Array.isArray(shape.editableElements)) {
        return false;
      }

      const createdIndices = [];
      snapshot.primitives.forEach((source) => {
        const primitive = cloneValue(source);
        offsetPrimitive(primitive, offset * 0.3);
        shape.editableElements.push(primitive);
        createdIndices.push(shape.editableElements.length - 1);
      });

      setSelectedPrimitiveIndices(shape, createdIndices, {
        primaryIndex: createdIndices[createdIndices.length - 1]
      });
      syncShapeSvg(shape, { preserveParameters: true });
      persistShapeLibrary();
      renderShapeManager();
      renderSubmenu();
      return true;
    }

    if (snapshot.type === "shape") {
      const existingNames = state.shapeLibrary.map((item) => item.name);
      const shape = cloneValue(snapshot.shape);
      shape.id = createShapeId();
      shape.name = createCopyName(shape.name, existingNames);
      if (Array.isArray(shape.editableElements)) {
        shape.editableElements = cloneValue(shape.editableElements);
        syncShapeSvg(shape, { preserveParameters: true });
      }

      state.shapeLibrary.push(shape);
      state.shapeManager.selectedId = shape.id;
      setSelectedPrimitiveIndices(shape, [getFirstPrimitiveIndex(shape)]);
      resetViewToSelectedShape();
      persistShapeLibrary();
      renderShapeManager();
      renderSubmenu();
      return true;
    }

    return false;
  };

  const duplicateSelection = () => {
    const prevSnapshot = snapshot ? cloneValue(snapshot) : null;
    const prevPasteIndex = pasteIndex;
    const copied = copySelection();
    if (!copied) {
      return false;
    }
    const result = paste();
    snapshot = prevSnapshot;
    pasteIndex = prevPasteIndex;
    return result;
  };

  return {
    copySelection,
    cutSelection,
    paste,
    duplicateSelection,
    clear,
    hasData
  };
}
