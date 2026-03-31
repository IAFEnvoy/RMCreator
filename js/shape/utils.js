import { svgNs } from "../dom.js";

export const shapeParameterTypeDefinitions = Object.freeze({
  color: { label: "颜色参数", defaultValue: "#2f5d9d" },
  text: { label: "文本参数", defaultValue: "" },
  number: { label: "数字参数", defaultValue: 0 },
  checkbox: { label: "勾选参数", defaultValue: false }
});

export function getShapeParameterDefaults(shape) {
  const defaults = {};
  normalizeShapeParameters(shape?.parameters).forEach((param) => {
    defaults[param.id] = normalizeShapeParameterDefault(param.type, param.defaultValue);
  });
  return defaults;
}

export function resolveShapeParametersWithValues(shape, paramValues) {
  const values = paramValues && typeof paramValues === "object" ? paramValues : {};
  return normalizeShapeParameters(shape?.parameters).map((param) => {
    if (!Object.prototype.hasOwnProperty.call(values, param.id)) {
      return param;
    }

    return {
      ...param,
      defaultValue: normalizeShapeParameterDefault(param.type, values[param.id])
    };
  });
}

export function buildRenderableShapeSvg(shape, paramValues) {
  if (!shape || typeof shape !== "object") {
    return "";
  }

  const resolvedParams = resolveShapeParametersWithValues(shape, paramValues);
  if (Array.isArray(shape.editableElements)) {
    return buildSvgFromEditableElements(resolveEditableElementsWithParameters(shape.editableElements, resolvedParams));
  }

  return normalizeImportedSvg(shape.svg || "");
}

export function getFirstPrimitiveIndex(shape) {
  return Array.isArray(shape?.editableElements) && shape.editableElements.length ? 0 : null;
}

export function clampPrimitiveIndex(index, length) {
  if (!Number.isInteger(index)) {
    return 0;
  }

  return Math.max(0, Math.min(length - 1, index));
}

export function createPrimitiveElement(type, index) {
  const shift = (index % 6) * 8;

  if (type === "circle") {
    return {
      type: "circle",
      cx: 120 + shift * 0.4,
      cy: 120 - shift * 0.35,
      r: 42,
      fill: "none",
      stroke: "#2f5d9d",
      strokeWidth: 6,
      rotation: 0
    };
  }

  if (type === "rect") {
    return {
      type: "rect",
      x: 56 + shift * 0.3,
      y: 56 + shift * 0.2,
      width: 128,
      height: 128,
      rounded: true,
      rx: 10,
      fill: "none",
      stroke: "#2f5d9d",
      strokeWidth: 6,
      rotation: 0
    };
  }

  if (type === "hexagon") {
    return {
      type: "hexagon",
      cx: 120,
      cy: 120,
      r: 54,
      fill: "none",
      stroke: "#2f5d9d",
      strokeWidth: 6,
      rotation: 0
    };
  }

  if (type === "octagon") {
    return {
      type: "octagon",
      cx: 120,
      cy: 120,
      r: 54,
      fill: "none",
      stroke: "#2f5d9d",
      strokeWidth: 6,
      rotation: 0
    };
  }

  if (type === "bezier") {
    return {
      type: "bezier",
      x1: 40,
      y1: 170,
      cx1: 90,
      cy1: 60,
      cx2: 150,
      cy2: 180,
      x2: 200,
      y2: 70,
      stroke: "#2f5d9d",
      strokeWidth: 6,
      roundCap: true,
      rotation: 0
    };
  }

  if (type === "text") {
    return {
      type: "text",
      x: 120,
      y: 120,
      value: "文本",
      fontSize: 26,
      fontFamily: "Segoe UI",
      fill: "#2f5d9d",
      rotation: 0
    };
  }

  return {
    type: "line",
    x1: 40,
    y1: 60 + shift,
    x2: 200,
    y2: 180 - shift,
    stroke: "#2f5d9d",
    strokeWidth: 6,
    roundCap: true,
    rotation: 0
  };
}

export function normalizeEditableElements(elements) {
  return (Array.isArray(elements) ? elements : [])
    .map((item) => normalizePrimitive(item))
    .filter(Boolean);
}

export function normalizeShapeParameters(parameters) {
  return (Array.isArray(parameters) ? parameters : [])
    .map((param, index) => normalizeShapeParameter(param, index))
    .filter(Boolean);
}

export function normalizeShapeParameter(param, index) {
  if (!param || typeof param !== "object") {
    return null;
  }

  const type = shapeParameterTypeDefinitions[param.type] ? param.type : "text";
  const definition = shapeParameterTypeDefinitions[type] || shapeParameterTypeDefinitions.text;

  return {
    id: String(param.id || `shape-param-${index + 1}`),
    type,
    label: String(param.label || `${definition.label} ${index + 1}`).trim() || `${definition.label} ${index + 1}`,
    defaultValue: normalizeShapeParameterDefault(type, param.defaultValue),
    conditions: Array.isArray(param.conditions) ? structuredClone(param.conditions) : [],
    extensions: param.extensions && typeof param.extensions === "object" ? structuredClone(param.extensions) : {}
  };
}

export function normalizeShapeParameterDefault(type, value) {
  if (type === "color") {
    return safeColor(value || "#2f5d9d");
  }

  if (type === "number") {
    return normalizeNumber(value, 0, -100000, 100000);
  }

  if (type === "checkbox") {
    return Boolean(value);
  }

  return String(value || "");
}

export function normalizePrimitiveParamBindings(rawBindings) {
  if (!rawBindings || typeof rawBindings !== "object") {
    return {};
  }

  const normalized = {};
  Object.entries(rawBindings).forEach(([key, binding]) => {
    if (!binding || typeof binding !== "object") {
      return;
    }

    const type = shapeParameterTypeDefinitions[binding.type] ? binding.type : null;
    const paramId = String(binding.paramId || "").trim();
    if (!type || !paramId) {
      return;
    }

    normalized[key] = { type, paramId };
  });

  return normalized;
}

export function getPrimitiveParamBindings(primitive) {
  if (!primitive || typeof primitive !== "object") {
    return {};
  }

  if (!primitive.paramBindings || typeof primitive.paramBindings !== "object") {
    primitive.paramBindings = {};
  }

  return primitive.paramBindings;
}

export function getPrimitiveParamBinding(primitive, key, expectedType) {
  const bindings = getPrimitiveParamBindings(primitive);
  const binding = bindings[key];
  if (!binding || typeof binding !== "object") {
    return null;
  }

  if (expectedType && binding.type !== expectedType) {
    return null;
  }

  return binding;
}

export function setPrimitiveParamBinding(primitive, key, binding) {
  const bindings = getPrimitiveParamBindings(primitive);

  if (!binding) {
    delete bindings[key];
    return;
  }

  bindings[key] = {
    type: binding.type,
    paramId: String(binding.paramId || "")
  };
}

export function resolvePrimitiveFieldValue(primitive, parameters, key, paramType, fallback) {
  const binding = getPrimitiveParamBinding(primitive, key, paramType);
  if (!binding) {
    return primitive?.[key] ?? fallback;
  }

  const param = (Array.isArray(parameters) ? parameters : []).find((item) => item.id === binding.paramId && item.type === paramType);
  if (!param) {
    return primitive?.[key] ?? fallback;
  }

  return normalizeShapeParameterDefault(paramType, param.defaultValue);
}

export function resolvePrimitiveWithParameters(primitive, parameters) {
  if (!primitive || typeof primitive !== "object") {
    return primitive;
  }

  const result = { ...primitive };
  const bindings = getPrimitiveParamBindings(primitive);
  Object.entries(bindings).forEach(([key, binding]) => {
    if (!binding?.type || !shapeParameterTypeDefinitions[binding.type]) {
      return;
    }

    result[key] = resolvePrimitiveFieldValue(primitive, parameters, key, binding.type, primitive[key]);
  });

  return result;
}

export function resolveEditableElementsWithParameters(elements, parameters) {
  return (Array.isArray(elements) ? elements : []).map((primitive) => resolvePrimitiveWithParameters(primitive, parameters));
}

export function normalizePrimitive(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const type = String(raw.type || "line").toLowerCase();
  const paramBindings = normalizePrimitiveParamBindings(raw.paramBindings);

  if (type === "line") {
    return {
      type,
      x1: toNumber(raw.x1, 40),
      y1: toNumber(raw.y1, 60),
      x2: toNumber(raw.x2, 200),
      y2: toNumber(raw.y2, 180),
      stroke: safeColor(raw.stroke),
      strokeWidth: normalizeNumber(raw.strokeWidth, 6, 0.1, 100),
      roundCap: Boolean(raw.roundCap),
      rotation: toNumber(raw.rotation, 0),
      paramBindings
    };
  }

  if (type === "circle") {
    return {
      type,
      cx: toNumber(raw.cx, 120),
      cy: toNumber(raw.cy, 120),
      r: normalizeNumber(raw.r, 42, 1, 400),
      fill: safeFill(raw.fill),
      stroke: safeColor(raw.stroke),
      strokeWidth: normalizeNumber(raw.strokeWidth, 6, 0.1, 100),
      rotation: toNumber(raw.rotation, 0),
      paramBindings
    };
  }

  if (type === "rect") {
    const rx = normalizeNumber(raw.rx, 10, 0, 400);
    const rounded = raw.rounded === undefined ? rx > 0 : Boolean(raw.rounded);

    return {
      type,
      x: toNumber(raw.x, 56),
      y: toNumber(raw.y, 56),
      width: normalizeNumber(raw.width, 128, 1, 800),
      height: normalizeNumber(raw.height, 128, 1, 800),
      rounded,
      rx,
      fill: safeFill(raw.fill),
      stroke: safeColor(raw.stroke),
      strokeWidth: normalizeNumber(raw.strokeWidth, 6, 0.1, 100),
      rotation: toNumber(raw.rotation, 0),
      paramBindings
    };
  }

  if (type === "hexagon" || type === "octagon") {
    return {
      type,
      cx: toNumber(raw.cx, 120),
      cy: toNumber(raw.cy, 120),
      r: normalizeNumber(raw.r, 52, 1, 600),
      fill: safeFill(raw.fill),
      stroke: safeColor(raw.stroke),
      strokeWidth: normalizeNumber(raw.strokeWidth, 6, 0.1, 100),
      rotation: toNumber(raw.rotation, 0),
      paramBindings
    };
  }

  if (type === "bezier") {
    return {
      type,
      x1: toNumber(raw.x1, 40),
      y1: toNumber(raw.y1, 170),
      cx1: toNumber(raw.cx1, 90),
      cy1: toNumber(raw.cy1, 60),
      cx2: toNumber(raw.cx2, 150),
      cy2: toNumber(raw.cy2, 180),
      x2: toNumber(raw.x2, 200),
      y2: toNumber(raw.y2, 70),
      stroke: safeColor(raw.stroke),
      strokeWidth: normalizeNumber(raw.strokeWidth, 6, 0.1, 100),
      roundCap: Boolean(raw.roundCap),
      rotation: toNumber(raw.rotation, 0),
      paramBindings
    };
  }

  if (type === "text") {
    return {
      type,
      x: toNumber(raw.x, 120),
      y: toNumber(raw.y, 120),
      value: String(raw.value || "文本"),
      fontSize: normalizeNumber(raw.fontSize, 26, 1, 240),
      fontFamily: String(raw.fontFamily || "Segoe UI"),
      fill: safeColor(raw.fill),
      rotation: toNumber(raw.rotation, 0),
      paramBindings
    };
  }

  return null;
}

export function createPrimitiveNode(primitive) {
  if (!primitive || typeof primitive !== "object") {
    return null;
  }

  const type = primitive.type;
  if (type === "line") {
    const line = document.createElementNS(svgNs, "line");
    line.setAttribute("x1", String(primitive.x1));
    line.setAttribute("y1", String(primitive.y1));
    line.setAttribute("x2", String(primitive.x2));
    line.setAttribute("y2", String(primitive.y2));
    line.setAttribute("stroke", safeColor(primitive.stroke));
    line.setAttribute("stroke-width", String(primitive.strokeWidth));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke-linecap", primitive.roundCap ? "round" : "butt");
    setRotationTransform(line, primitive.rotation, (primitive.x1 + primitive.x2) / 2, (primitive.y1 + primitive.y2) / 2);
    return line;
  }

  if (type === "circle") {
    const circle = document.createElementNS(svgNs, "circle");
    circle.setAttribute("cx", String(primitive.cx));
    circle.setAttribute("cy", String(primitive.cy));
    circle.setAttribute("r", String(primitive.r));
    circle.setAttribute("fill", safeFill(primitive.fill));
    circle.setAttribute("stroke", safeColor(primitive.stroke));
    circle.setAttribute("stroke-width", String(primitive.strokeWidth));
    setRotationTransform(circle, primitive.rotation, primitive.cx, primitive.cy);
    return circle;
  }

  if (type === "rect") {
    const rect = document.createElementNS(svgNs, "rect");
    const rx = primitive.rounded === false ? 0 : normalizeNumber(primitive.rx, 10, 0, 400);
    rect.setAttribute("x", String(primitive.x));
    rect.setAttribute("y", String(primitive.y));
    rect.setAttribute("width", String(primitive.width));
    rect.setAttribute("height", String(primitive.height));
    rect.setAttribute("rx", String(rx));
    rect.setAttribute("fill", safeFill(primitive.fill));
    rect.setAttribute("stroke", safeColor(primitive.stroke));
    rect.setAttribute("stroke-width", String(primitive.strokeWidth));
    setRotationTransform(rect, primitive.rotation, primitive.x + primitive.width / 2, primitive.y + primitive.height / 2);
    return rect;
  }

  if (type === "hexagon" || type === "octagon") {
    const polygon = document.createElementNS(svgNs, "polygon");
    const sides = type === "hexagon" ? 6 : 8;
    polygon.setAttribute("points", buildRegularPolygonPoints(primitive.cx, primitive.cy, primitive.r, sides));
    polygon.setAttribute("fill", safeFill(primitive.fill));
    polygon.setAttribute("stroke", safeColor(primitive.stroke));
    polygon.setAttribute("stroke-width", String(primitive.strokeWidth));
    setRotationTransform(polygon, primitive.rotation, primitive.cx, primitive.cy);
    return polygon;
  }

  if (type === "bezier") {
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", `M ${primitive.x1} ${primitive.y1} C ${primitive.cx1} ${primitive.cy1} ${primitive.cx2} ${primitive.cy2} ${primitive.x2} ${primitive.y2}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", safeColor(primitive.stroke));
    path.setAttribute("stroke-width", String(primitive.strokeWidth));
    path.setAttribute("stroke-linecap", primitive.roundCap ? "round" : "butt");
    setRotationTransform(path, primitive.rotation, (primitive.x1 + primitive.x2) / 2, (primitive.y1 + primitive.y2) / 2);
    return path;
  }

  if (type === "text") {
    const text = document.createElementNS(svgNs, "text");
    text.setAttribute("x", String(primitive.x));
    text.setAttribute("y", String(primitive.y));
    text.setAttribute("fill", safeColor(primitive.fill));
    text.setAttribute("font-size", String(primitive.fontSize));
    text.setAttribute("font-family", String(primitive.fontFamily || "Segoe UI"));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.textContent = String(primitive.value || "文本");
    setRotationTransform(text, primitive.rotation, primitive.x, primitive.y);
    return text;
  }

  return null;
}

export function buildSvgFromEditableElements(elements) {
  const rows = ["<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 240 240\">"];

  normalizeEditableElements(elements).forEach((primitive) => {
    rows.push(`  ${primitiveToMarkup(primitive)}`);
  });

  rows.push("</svg>");
  return rows.join("\n");
}

export function primitiveToMarkup(primitive) {
  const rotationAttr = buildRotationAttr(primitive);

  if (primitive.type === "line") {
    return `<line x1=\"${num(primitive.x1)}\" y1=\"${num(primitive.y1)}\" x2=\"${num(primitive.x2)}\" y2=\"${num(primitive.y2)}\" stroke=\"${safeColor(primitive.stroke)}\" stroke-width=\"${num(primitive.strokeWidth)}\" stroke-linecap=\"${primitive.roundCap ? "round" : "butt"}\" fill=\"none\"${rotationAttr} />`;
  }

  if (primitive.type === "circle") {
    return `<circle cx=\"${num(primitive.cx)}\" cy=\"${num(primitive.cy)}\" r=\"${num(primitive.r)}\" fill=\"${safeFill(primitive.fill)}\" stroke=\"${safeColor(primitive.stroke)}\" stroke-width=\"${num(primitive.strokeWidth)}\"${rotationAttr} />`;
  }

  if (primitive.type === "rect") {
    const rx = primitive.rounded === false ? 0 : normalizeNumber(primitive.rx, 10, 0, 400);
    return `<rect x=\"${num(primitive.x)}\" y=\"${num(primitive.y)}\" width=\"${num(primitive.width)}\" height=\"${num(primitive.height)}\" rx=\"${num(rx)}\" fill=\"${safeFill(primitive.fill)}\" stroke=\"${safeColor(primitive.stroke)}\" stroke-width=\"${num(primitive.strokeWidth)}\"${rotationAttr} />`;
  }

  if (primitive.type === "hexagon" || primitive.type === "octagon") {
    const sides = primitive.type === "hexagon" ? 6 : 8;
    return `<polygon points=\"${buildRegularPolygonPoints(primitive.cx, primitive.cy, primitive.r, sides)}\" fill=\"${safeFill(primitive.fill)}\" stroke=\"${safeColor(primitive.stroke)}\" stroke-width=\"${num(primitive.strokeWidth)}\"${rotationAttr} />`;
  }

  if (primitive.type === "bezier") {
    return `<path d=\"M ${num(primitive.x1)} ${num(primitive.y1)} C ${num(primitive.cx1)} ${num(primitive.cy1)} ${num(primitive.cx2)} ${num(primitive.cy2)} ${num(primitive.x2)} ${num(primitive.y2)}\" fill=\"none\" stroke=\"${safeColor(primitive.stroke)}\" stroke-width=\"${num(primitive.strokeWidth)}\" stroke-linecap=\"${primitive.roundCap ? "round" : "butt"}\"${rotationAttr} />`;
  }

  if (primitive.type === "text") {
    return `<text x=\"${num(primitive.x)}\" y=\"${num(primitive.y)}\" fill=\"${safeColor(primitive.fill)}\" font-size=\"${num(primitive.fontSize)}\" font-family=\"${escapeXml(String(primitive.fontFamily || "Segoe UI"))}\" text-anchor=\"middle\" dominant-baseline=\"middle\"${rotationAttr}>${escapeXml(String(primitive.value || "文本"))}</text>`;
  }

  return "";
}

export function buildRotationAttr(primitive) {
  const angle = toNumber(primitive.rotation, 0);
  if (Math.abs(angle) < 1e-6) {
    return "";
  }

  const center = getPrimitiveCenter(primitive);
  return ` transform=\"rotate(${num(angle)} ${num(center.x)} ${num(center.y)})\"`;
}

export function setRotationTransform(node, angle, cx, cy) {
  const n = toNumber(angle, 0);
  if (Math.abs(n) < 1e-6) {
    return;
  }

  node.setAttribute("transform", `rotate(${n} ${cx} ${cy})`);
}

export function getPrimitiveCenter(primitive) {
  if (primitive.type === "line") {
    return { x: (primitive.x1 + primitive.x2) / 2, y: (primitive.y1 + primitive.y2) / 2 };
  }

  if (primitive.type === "circle") {
    return { x: primitive.cx, y: primitive.cy };
  }

  if (primitive.type === "rect") {
    return { x: primitive.x + primitive.width / 2, y: primitive.y + primitive.height / 2 };
  }

  if (primitive.type === "hexagon" || primitive.type === "octagon") {
    return { x: primitive.cx, y: primitive.cy };
  }

  if (primitive.type === "bezier") {
    return { x: (primitive.x1 + primitive.x2) / 2, y: (primitive.y1 + primitive.y2) / 2 };
  }

  if (primitive.type === "text") {
    return { x: primitive.x, y: primitive.y };
  }

  return { x: 120, y: 120 };
}

export function buildRegularPolygonPoints(cx, cy, r, sides) {
  const points = [];
  const radius = Math.max(1, toNumber(r, 50));
  const centerX = toNumber(cx, 120);
  const centerY = toNumber(cy, 120);
  const count = Math.max(3, Number(sides) || 6);

  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
    points.push(`${num(centerX + radius * Math.cos(angle))},${num(centerY + radius * Math.sin(angle))}`);
  }

  return points.join(" ");
}

export function computeEditableBounds(elements) {
  if (!Array.isArray(elements) || !elements.length) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const pushPoint = (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  elements.forEach((primitive) => {
    if (primitive.type === "line") {
      pushPoint(primitive.x1, primitive.y1);
      pushPoint(primitive.x2, primitive.y2);
      return;
    }

    if (primitive.type === "circle") {
      pushPoint(primitive.cx - primitive.r, primitive.cy - primitive.r);
      pushPoint(primitive.cx + primitive.r, primitive.cy + primitive.r);
      return;
    }

    if (primitive.type === "rect") {
      pushPoint(primitive.x, primitive.y);
      pushPoint(primitive.x + primitive.width, primitive.y + primitive.height);
      return;
    }

    if (primitive.type === "hexagon" || primitive.type === "octagon") {
      pushPoint(primitive.cx - primitive.r, primitive.cy - primitive.r);
      pushPoint(primitive.cx + primitive.r, primitive.cy + primitive.r);
      return;
    }

    if (primitive.type === "bezier") {
      [
        [primitive.x1, primitive.y1],
        [primitive.cx1, primitive.cy1],
        [primitive.cx2, primitive.cy2],
        [primitive.x2, primitive.y2]
      ].forEach(([x, y]) => pushPoint(x, y));
      return;
    }

    if (primitive.type === "text") {
      const width = Math.max(12, String(primitive.value || "").length * primitive.fontSize * 0.55);
      const height = Math.max(primitive.fontSize, 12);
      pushPoint(primitive.x - width / 2, primitive.y - height / 2);
      pushPoint(primitive.x + width / 2, primitive.y + height / 2);
    }
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

export function boundsToViewBox(bounds, padding) {
  const pad = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const width = Math.max(80, bounds.maxX - bounds.minX + pad * 2);
  const height = Math.max(80, bounds.maxY - bounds.minY + pad * 2);
  return {
    x: bounds.minX - pad,
    y: bounds.minY - pad,
    width,
    height
  };
}

export function parseSvg(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(svgText || ""), "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    return null;
  }

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") {
    return null;
  }

  const viewBoxText = root.getAttribute("viewBox") || "0 0 240 240";
  const parts = viewBoxText.split(/[\s,]+/).map((v) => Number(v)).filter((v) => Number.isFinite(v));
  const viewBox = parts.length >= 4
    ? {
      x: parts[0],
      y: parts[1],
      width: parts[2] || 240,
      height: parts[3] || 240
    }
    : { x: 0, y: 0, width: 240, height: 240 };

  return {
    root,
    viewBox
  };
}

export function stripUnsafeAttributes(node) {
  if (!(node instanceof Element)) {
    return;
  }

  Array.from(node.attributes).forEach((attr) => {
    const name = attr.name.toLowerCase();
    const value = String(attr.value || "").toLowerCase();
    if (name.startsWith("on") || value.includes("javascript:")) {
      node.removeAttribute(attr.name);
    }
  });

  Array.from(node.children).forEach((child) => stripUnsafeAttributes(child));
}

export function normalizeImportedSvg(rawSvg) {
  const text = String(rawSvg || "").trim();
  if (!text) {
    return "";
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    return "";
  }

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") {
    return "";
  }

  if (!root.getAttribute("xmlns")) {
    root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(root);
}

export function toSvgDataUrl(svgText) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svgText || ""))}`;
}

export function primitiveTypeLabel(type) {
  const map = {
    line: "线段",
    circle: "圆形",
    rect: "方形",
    hexagon: "六边形",
    octagon: "八边形",
    bezier: "贝塞尔曲线",
    text: "文本"
  };
  return map[type] || "图元";
}

export function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeNumber(value, fallback, min, max) {
  let next = toNumber(value, fallback);
  if (Number.isFinite(min)) {
    next = Math.max(min, next);
  }
  if (Number.isFinite(max)) {
    next = Math.min(max, next);
  }
  return Number(next.toFixed(2));
}

export function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function num(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Number(n.toFixed(2));
}

export function safeColor(value) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(value || "").trim()) ? String(value).trim() : "#2f5d9d";
}

export function safeFill(value) {
  const raw = String(value || "none").trim();
  if (raw === "none") {
    return "none";
  }
  return safeColor(raw);
}

export function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
