import {
  clamp,
  normalizeTextStyleFlags
} from "./utils.js";
import { normalizeLineType } from "./line/type-store.js";

const drawingVersion = 1;
const stationTextSlotSet = new Set(["nw", "n", "ne", "w", "e", "sw", "s", "se"]);

export function serializeDrawing(state) {
  // 收集所有使用的图形类型：直接放置的图形 + 车站预设引用的图形
  const usedShapeIds = new Set();
  (Array.isArray(state.shapes) ? state.shapes : []).forEach((shape) => {
    if (shape?.shapeId) usedShapeIds.add(String(shape.shapeId));
  });
  (Array.isArray(state.stationLibrary) ? state.stationLibrary : []).forEach((preset) => {
    if (preset?.shapeId) usedShapeIds.add(String(preset.shapeId));
  });

  const usedShapeTypes = (Array.isArray(state.shapeLibrary) ? state.shapeLibrary : [])
    .filter((shape) => shape && usedShapeIds.has(String(shape.id)))
    .map((shape) => structuredClone(shape));

  return {
    version: drawingVersion,
    exportedAt: new Date().toISOString(),
    counter: Math.max(1, Number(state.counter) || 1),
    viewport: {
      zoom: clamp(Number(state.zoom) || 1, 0.3, 4),
      pan: {
        x: Number(state.pan?.x) || 0,
        y: Number(state.pan?.y) || 0
      }
    },
    nodes: sanitizeNodes(state.nodes),
    edges: sanitizeEdges(state.edges),
    labels: sanitizeLabels(state.labels),
    shapes: sanitizePlacedShapes(state.shapes),
    subDrawings: sanitizeSubDrawings(state.subDrawings),
    customLineTypes: sanitizeCustomLineTypes(state.lineTypes, state.edges),
    stationPresets: sanitizeStationPresets(state.stationLibrary),
    shapeTypes: usedShapeTypes
  };
}

function sanitizeStationPresets(library) {
  if (!Array.isArray(library)) return [];
  return library.map((preset) => {
    if (!preset || typeof preset !== "object") return null;
    return {
      id: String(preset.id || ""),
      name: String(preset.name || "车站预设"),
      shapeId: preset.shapeId ? String(preset.shapeId) : null,
      textCards: structuredClone(preset.textCards || []),
      textPlacement: structuredClone(preset.textPlacement || {}),
      virtualNode: Boolean(preset.virtualNode),
      radius: Number.isFinite(Number(preset.radius)) ? Number(preset.radius) : 12,
      oval: Boolean(preset.oval),
      rotation: Number.isFinite(Number(preset.rotation)) ? Number(preset.rotation) : 0,
      rotationParamId: String(preset.rotationParamId || "").trim() || undefined,
      shapeParamSettings: structuredClone(preset.shapeParamSettings || {}),
      paramExpressions: preset.paramExpressions && typeof preset.paramExpressions === "object"
        ? { ...preset.paramExpressions }
        : undefined,
      params: Array.isArray(preset.params) ? structuredClone(preset.params) : []
    };
  }).filter(Boolean);
}

export function serializeDrawingToJson(state) {
  return JSON.stringify(serializeDrawing(state));
}

export function parseDrawingJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("JSON 格式无效，无法解析。");
  }

  return normalizeDrawingData(parsed);
}

export function normalizeDrawingData(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("绘图数据格式错误，根对象不存在。");
  }

  return {
    version: Number(raw.version) || drawingVersion,
    counter: Math.max(1, Number(raw.counter) || 1),
    viewport: normalizeViewport(raw.viewport),
    nodes: sanitizeNodes(raw.nodes),
    edges: sanitizeEdges(raw.edges),
    labels: sanitizeLabels(raw.labels),
    shapes: sanitizePlacedShapes(raw.shapes),
    subDrawings: sanitizeSubDrawings(raw.subDrawings),
    customLineTypes: normalizeCustomLineTypes(raw.customLineTypes),
    stationPresets: Array.isArray(raw.stationPresets) ? structuredClone(raw.stationPresets) : [],
    shapeTypes: Array.isArray(raw.shapeTypes) ? structuredClone(raw.shapeTypes) : []
  };
}

function sanitizePlacedShapes(rawShapes) {
  if (!Array.isArray(rawShapes)) {
    return [];
  }

  return rawShapes
    .map((shape) => {
      const paramValues = {};
      if (shape?.paramValues && typeof shape.paramValues === "object") {
        Object.entries(shape.paramValues).forEach(([key, value]) => {
          const paramKey = String(key || "").trim();
          if (!paramKey) {
            return;
          }

          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            paramValues[paramKey] = value;
          }
        });
      }

      const paramExpressions = sanitizeParamExpressions(shape?.paramExpressions);

      return {
        id: String(shape?.id || "").trim(),
        shapeId: String(shape?.shapeId || "").trim(),
        x: Number(shape?.x) || 0,
        y: Number(shape?.y) || 0,
        scale: clamp(Number(shape?.scale) || 0.25, 0.001, 10),
        rotation: Number.isFinite(Number(shape?.rotation)) ? Number(shape.rotation) : 0,
        paramValues,
        paramExpressions
      };
    })
    .filter((shape) => shape.id.length > 0 && shape.shapeId.length > 0);
}

function normalizeViewport(viewport) {
  const zoom = clamp(Number(viewport?.zoom) || 1, 0.3, 4);
  return {
    zoom,
    pan: {
      x: Number(viewport?.pan?.x) || 0,
      y: Number(viewport?.pan?.y) || 0
    }
  };
}

function sanitizeNodes(rawNodes) {
  if (!Array.isArray(rawNodes)) {
    return [];
  }

  return rawNodes
    .map((node) => {
      const paramValues = {};
      const textValues = {};
      const textStyleValues = {};
      if (node?.paramValues && typeof node.paramValues === "object") {
        Object.entries(node.paramValues).forEach(([key, value]) => {
          const paramKey = String(key || "").trim();
          if (!paramKey) {
            return;
          }

          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            paramValues[paramKey] = value;
          }
        });
      }

      if (node?.textValues && typeof node.textValues === "object") {
        Object.entries(node.textValues).forEach(([key, value]) => {
          const textKey = String(key || "").trim();
          if (!textKey) {
            return;
          }

          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            textValues[textKey] = String(value);
          }
        });
      }

      if (node?.textStyleValues && typeof node.textStyleValues === "object") {
        Object.entries(node.textStyleValues).forEach(([key, value]) => {
          const textKey = String(key || "").trim();
          if (!textKey) {
            return;
          }

          textStyleValues[textKey] = normalizeTextStyleFlags(value);
        });
      }

      const slot = String(node?.textPlacement?.slot || "").toLowerCase();
      const textPlacement = {
        slot: stationTextSlotSet.has(slot) ? slot : "s"
      };

      const paramExpressions = sanitizeParamExpressions(node?.paramExpressions);

      const result = {
        id: String(node?.id || "").trim(),
        x: Number(node?.x) || 0,
        y: Number(node?.y) || 0,
        name: String(node?.name || "车站"),
        radius: clamp(Number(node?.radius) || 10, 2, 80),
        oval: Boolean(node?.oval),
        stationTypeIndex: Number.isInteger(node?.stationTypeIndex) ? node.stationTypeIndex : 0,
        rotation: Number.isFinite(Number(node?.rotation)) ? Number(node.rotation) : 0,
        paramValues,
        paramExpressions,
        textValues,
        textStyleValues,
        textPlacement
      };
      // 只有源数据显式包含 rotationParamId 时才写入（支持空字符串 sentinel）
      if (Object.prototype.hasOwnProperty.call(node, "rotationParamId")) {
        result.rotationParamId = String(node.rotationParamId || "").trim() || undefined;
      }
      return result;
    })
    .filter((node) => node.id.length > 0);
}

function sanitizeEdges(rawEdges) {
  if (!Array.isArray(rawEdges)) {
    return [];
  }

  const validGeometry = ["straight", "bend135", "bend90", "bend90rot45"];

  return rawEdges
    .map((edge) => ({
      id: String(edge?.id || "").trim(),
      fromStationId: String(edge?.fromStationId || "").trim(),
      toStationId: String(edge?.toStationId || "").trim(),
      lineTypeId: String(edge?.lineTypeId || "").trim(),
      geometry: validGeometry.includes(edge?.geometry) ? edge.geometry : "straight",
      colorList: Array.isArray(edge?.colorList) ? edge.colorList.map((c) => String(c || "")).filter(Boolean) : [],
      flip: Boolean(edge?.flip),
      flipColor: Boolean(edge?.flipColor),
      cornerRadius: clamp(Number(edge?.cornerRadius) || 0, 0, 120),
      startOffset: clamp(Number(edge?.startOffset) || 0, -120, 120),
      endOffset: clamp(Number(edge?.endOffset) || 0, -120, 120),
      paramExpressions: sanitizeParamExpressions(edge?.paramExpressions)
    }))
    .filter((edge) => edge.id && edge.fromStationId && edge.toStationId && edge.lineTypeId);
}

function sanitizeLabels(rawLabels) {
  if (!Array.isArray(rawLabels)) {
    return [];
  }

  return rawLabels
    .map((label) => ({
      id: String(label?.id || "").trim(),
      x: Number(label?.x) || 0,
      y: Number(label?.y) || 0,
      value: String(label?.value || "Text"),
      fontSize: clamp(Number(label?.fontSize) || 20, 8, 200),
      color: String(label?.color || "#23344d"),
      fontFamily: String(label?.fontFamily || "Segoe UI"),
      ...normalizeTextStyleFlags(label),
      paramExpressions: sanitizeParamExpressions(label?.paramExpressions)
    }))
    .filter((label) => label.id.length > 0);
}

function sanitizeCustomLineTypes(lineTypes, edges) {
  if (!Array.isArray(lineTypes)) {
    return [];
  }

  const usedLineTypeIds = new Set(
    sanitizeEdges(edges).map((edge) => edge.lineTypeId)
  );

  return lineTypes
    .filter((lineType) => lineType && lineType.source === "custom" && usedLineTypeIds.has(String(lineType.id || "")))
    .map((lineType) => ({
      id: lineType.id,
      source: "custom",
      isTemporaryImported: Boolean(lineType.isTemporaryImported),
      name: lineType.name,
      colorList: Array.isArray(lineType.colorList) ? [...lineType.colorList] : [],
      segments: Array.isArray(lineType.segments) ? structuredClone(lineType.segments) : []
    }));
}

function normalizeCustomLineTypes(rawCustomLineTypes) {
  if (!Array.isArray(rawCustomLineTypes)) {
    return [];
  }

  return rawCustomLineTypes
    .map((lineType) => normalizeLineType({ ...lineType, source: "custom" }))
    .filter(Boolean)
    .map((lineType) => ({ ...lineType, source: "custom" }));
}

/**
 * 清理 paramExpressions 对象，仅保留有效的字符串表达式。
 * @param {object} raw - 原始 paramExpressions
 * @returns {object}
 */
function sanitizeParamExpressions(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const result = {};
  Object.entries(raw).forEach(([key, value]) => {
    const paramKey = String(key || "").trim();
    if (!paramKey) return;
    if (typeof value === "string" && value.trim()) {
      result[paramKey] = value.trim();
    }
  });
  return result;
}

function sanitizeSubDrawings(rawSubDrawings) {
  if (!Array.isArray(rawSubDrawings)) {
    return [];
  }

  return rawSubDrawings
    .map((sd) => {
      if (!sd || typeof sd !== "object") return null;
      return {
        id: String(sd.id || "").trim(),
        drawingId: String(sd.drawingId || "").trim(),
        x: Number(sd.x) || 0,
        y: Number(sd.y) || 0,
        scale: clamp(Number(sd.scale) || 0.5, 0.001, 10),
        rotation: Number.isFinite(Number(sd.rotation)) ? Number(sd.rotation) : 0,
        name: String(sd.name || "").trim() || "子绘图"
      };
    })
    .filter((sd) => sd.id.length > 0 && sd.drawingId.length > 0);
}
