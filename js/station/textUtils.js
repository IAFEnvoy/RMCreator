import {
  normalizeShapeParameterDefault,
  normalizeShapeParameters,
  shapeParameterTypeDefinitions
} from "../shape/utils.js";

const defaultTextColor = "#000000";
const defaultTextFontFamily = "Segoe UI";
const defaultTextFontSize = 18;
const defaultTextDistance = 18;
const defaultTextSlot = "s";
const defaultBlockGap = 4;

const slotSet = new Set(["nw", "n", "ne", "w", "e", "sw", "s", "se"]);

let measureCanvas = null;

export function createDefaultStationTextCard(index = 0, createId) {
  const id = typeof createId === "function"
    ? String(createId())
    : `station-text-${index + 1}`;

  return {
    id,
    label: `文本 ${index + 1}`,
    defaultValue: "",
    fontFamily: defaultTextFontFamily,
    colorBinding: {
      mode: "value",
      value: defaultTextColor,
      paramId: ""
    },
    fontSizeBinding: {
      mode: "value",
      value: defaultTextFontSize,
      paramId: ""
    }
  };
}

export function createDefaultStationTextPlacement() {
  return {
    slot: defaultTextSlot,
    distanceBinding: {
      mode: "value",
      value: defaultTextDistance,
      paramId: ""
    },
    lineGap: defaultBlockGap
  };
}

export function normalizeStationTextCards(rawCards, createId) {
  const normalized = (Array.isArray(rawCards) ? rawCards : [])
    .map((card, index) => normalizeStationTextCard(card, index, createId))
    .filter(Boolean);

  if (normalized.length) {
    return normalized;
  }

  return [createDefaultStationTextCard(0, createId)];
}

export function normalizeStationTextCard(raw, index = 0, createId) {
  const fallback = createDefaultStationTextCard(index, createId);
  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const card = {
    ...fallback,
    id: String(raw.id || fallback.id),
    label: String(raw.label || fallback.label).trim() || fallback.label,
    defaultValue: String(raw.defaultValue || ""),
    fontFamily: String(raw.fontFamily || fallback.fontFamily).trim() || fallback.fontFamily,
    colorBinding: normalizeTextBinding(
      raw.colorBinding || (Object.prototype.hasOwnProperty.call(raw, "color") ? { mode: "value", value: raw.color } : null),
      "color",
      fallback.colorBinding.value
    ),
    fontSizeBinding: normalizeTextBinding(
      raw.fontSizeBinding || (Object.prototype.hasOwnProperty.call(raw, "fontSize") ? { mode: "value", value: raw.fontSize } : null),
      "number",
      fallback.fontSizeBinding.value
    )
  }

  return card;
}

export function normalizeTextBinding(raw, type, fallbackValue) {
  const mode = raw?.mode === "param" ? "param" : "value";
  const value = normalizeShapeParameterDefault(type, raw?.value ?? fallbackValue);
  return {
    mode,
    value,
    paramId: String(raw?.paramId || "")
  };
}

export function normalizeStationTextPlacement(raw, fallback = createDefaultStationTextPlacement()) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    slot: normalizeTextSlot(source.slot || fallback.slot),
    distanceBinding: normalizeTextBinding(
      source.distanceBinding,
      "number",
      fallback.distanceBinding.value
    ),
    lineGap: Number.isFinite(Number(source.lineGap ?? fallback.lineGap ?? defaultBlockGap))
      ? Number(source.lineGap ?? fallback.lineGap ?? defaultBlockGap)
      : defaultBlockGap
  };
}

export function normalizeTextSlot(rawSlot) {
  const slot = String(rawSlot || "").toLowerCase();
  return slotSet.has(slot) ? slot : defaultTextSlot;
}

export function buildStationRuntimeParamMap({ preset, shape, stationParamValues }) {
  const valueSource = stationParamValues && typeof stationParamValues === "object"
    ? stationParamValues
    : {};
  const runtime = new Map();

  normalizeShapeParameters(preset?.params).forEach((param) => {
    const hasValue = Object.prototype.hasOwnProperty.call(valueSource, param.id);
    const value = hasValue ? valueSource[param.id] : param.defaultValue;
    runtime.set(param.id, {
      id: param.id,
      label: param.label,
      type: param.type,
      source: "custom",
      value: normalizeShapeParameterDefault(param.type, value)
    });
  });

  const settings = preset?.shapeParamSettings && typeof preset.shapeParamSettings === "object"
    ? preset.shapeParamSettings
    : {};

  normalizeShapeParameters(shape?.parameters).forEach((param) => {
    const setting = settings[param.id];
    const mode = setting?.mode === "default" || setting?.mode === "locked"
      ? setting.mode
      : "inherit";

    let rawValue;
    if (mode === "locked") {
      rawValue = setting?.value;
    } else if (Object.prototype.hasOwnProperty.call(valueSource, param.id)) {
      rawValue = valueSource[param.id];
    } else if (mode === "default") {
      rawValue = setting?.value;
    } else {
      rawValue = param.defaultValue;
    }

    if (runtime.has(param.id)) {
      return;
    }

    runtime.set(param.id, {
      id: param.id,
      label: param.label,
      type: param.type,
      source: "shape",
      value: normalizeShapeParameterDefault(param.type, rawValue)
    });
  });

  return runtime;
}

export function buildShapeParamValuesFromRuntime(shape, runtimeParamMap) {
  const out = {};
  const runtime = runtimeParamMap instanceof Map ? runtimeParamMap : new Map();

  normalizeShapeParameters(shape?.parameters).forEach((param) => {
    const entry = runtime.get(param.id);
    if (!entry || entry.type !== param.type) {
      return;
    }

    out[param.id] = normalizeShapeParameterDefault(param.type, entry.value);
  });

  return out;
}

export function buildStationTextParamOptions({ preset, shape }) {
  const runtime = buildStationRuntimeParamMap({
    preset,
    shape,
    stationParamValues: null
  });

  return Array.from(runtime.values()).map((entry) => ({
    id: entry.id,
    label: entry.source === "shape" ? `${entry.label}（父图形）` : entry.label,
    type: entry.type,
    value: entry.value
  }));
}

export function resolveTextBindingValue(binding, type, runtimeParamMap, fallbackValue) {
  const normalized = normalizeTextBinding(binding, type, fallbackValue);
  if (normalized.mode === "param") {
    const runtime = runtimeParamMap instanceof Map ? runtimeParamMap : new Map();
    const entry = runtime.get(normalized.paramId);
    if (entry && entry.type === type) {
      return normalizeShapeParameterDefault(type, entry.value);
    }
  }

  return normalizeShapeParameterDefault(type, normalized.value);
}

export function appendStationTexts({
  container,
  preset,
  runtimeParamMap,
  centerX,
  centerY,
  pointerEvents = "none",
  textValueMap = null,
  placementOverride = null
}) {
  if (!container || !preset) {
    return;
  }

  const cards = normalizeStationTextCards(preset.textCards);
  if (!cards.length) {
    return;
  }

  const fallbackPlacement = normalizeStationTextPlacement(
    preset.textPlacement || {
      slot: cards[0]?.placement?.slot,
      distanceBinding: cards[0]?.placement?.distanceBinding,
      lineGap: defaultBlockGap
    }
  );
  const placementSource = placementOverride && typeof placementOverride === "object"
    ? {
      ...fallbackPlacement,
      ...placementOverride
    }
    : preset.textPlacement;
  const placement = normalizeStationTextPlacement(placementSource, fallbackPlacement);
  const distance = Math.max(0, Number(resolveTextBindingValue(
    placement.distanceBinding,
    "number",
    runtimeParamMap,
    defaultTextDistance
  )) || defaultTextDistance);

  const blocks = cards.map((card) => {
    const color = resolveTextBindingValue(card.colorBinding, "color", runtimeParamMap, defaultTextColor);
    const fontSize = Math.max(1, Number(resolveTextBindingValue(card.fontSizeBinding, "number", runtimeParamMap, defaultTextFontSize)) || defaultTextFontSize);
    const hasOverride = textValueMap && typeof textValueMap === "object"
      && Object.prototype.hasOwnProperty.call(textValueMap, card.id);
    const textValue = hasOverride
      ? String(textValueMap[card.id] ?? "")
      : String(card.defaultValue || "");
    const lines = textValue.split("\n");
    const metrics = measureTextBox(lines, card.fontFamily || defaultTextFontFamily, fontSize);

    return {
      color,
      fontSize,
      fontFamily: card.fontFamily || defaultTextFontFamily,
      lines,
      metrics
    };
  });

  const blockGap = Number.isFinite(Number(placement.lineGap)) ? Number(placement.lineGap) : defaultBlockGap;
  const totalHeight = blocks.reduce((sum, block, index) => {
    return sum + block.metrics.height + (index < blocks.length - 1 ? blockGap : 0);
  }, 0);
  const maxWidth = blocks.reduce((max, block) => Math.max(max, block.metrics.width), 0);

  const layout = computeTextLayout({
    slot: normalizeTextSlot(placement.slot),
    distance,
    centerX,
    centerY,
    boxWidth: maxWidth,
    boxHeight: totalHeight
  });

  let offsetY = 0;
  blocks.forEach((block, index) => {
    const top = layout.top + offsetY;

    const text = container.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(layout.anchorX));
    text.setAttribute("y", String(top));
    text.setAttribute("fill", block.color);
    text.setAttribute("font-size", String(block.fontSize));
    text.setAttribute("font-family", block.fontFamily);
    text.setAttribute("text-anchor", layout.textAnchor);
    text.setAttribute("dominant-baseline", "hanging");
    text.setAttribute("pointer-events", pointerEvents);

    block.lines.forEach((line, lineIndex) => {
      const tspan = container.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "tspan");
      tspan.setAttribute("x", String(layout.anchorX));
      tspan.setAttribute("dy", lineIndex === 0 ? "0" : String(block.metrics.lineHeight));
      tspan.textContent = line.length ? line : " ";
      text.appendChild(tspan);
    });

    container.appendChild(text);

    offsetY += block.metrics.height;
    if (index < blocks.length - 1) {
      offsetY += blockGap;
    }
  });
}

function measureTextBox(lines, fontFamily, fontSize) {
  const safeLines = Array.isArray(lines) && lines.length ? lines : [""];
  const safeFontSize = Math.max(1, Number(fontSize) || defaultTextFontSize);
  const lineHeight = safeFontSize * 1.2;

  let width = safeFontSize;
  if (typeof document !== "undefined") {
    if (!measureCanvas) {
      measureCanvas = document.createElement("canvas");
    }

    const ctx = measureCanvas.getContext("2d");
    if (ctx) {
      ctx.font = `${safeFontSize}px ${fontFamily || defaultTextFontFamily}`;
      width = safeLines.reduce((max, line) => Math.max(max, ctx.measureText(String(line || " ")).width), safeFontSize);
    } else {
      width = safeLines.reduce((max, line) => Math.max(max, String(line || " ").length * safeFontSize * 0.55), safeFontSize);
    }
  } else {
    width = safeLines.reduce((max, line) => Math.max(max, String(line || " ").length * safeFontSize * 0.55), safeFontSize);
  }

  return {
    width,
    lineHeight,
    height: lineHeight * safeLines.length
  };
}

function computeTextLayout({ slot, distance, centerX, centerY, boxWidth, boxHeight }) {
  const halfW = boxWidth / 2;
  const halfH = boxHeight / 2;
  const diagonal = distance / Math.sqrt(2);

  if (slot === "n") {
    return {
      textAnchor: "middle",
      anchorX: centerX,
      top: centerY - distance - boxHeight
    };
  }

  if (slot === "s") {
    return {
      textAnchor: "middle",
      anchorX: centerX,
      top: centerY + distance
    };
  }

  if (slot === "w") {
    return {
      textAnchor: "end",
      anchorX: centerX - distance,
      top: centerY - halfH
    };
  }

  if (slot === "e") {
    return {
      textAnchor: "start",
      anchorX: centerX + distance,
      top: centerY - halfH
    };
  }

  if (slot === "nw") {
    const cornerX = centerX - diagonal;
    const cornerY = centerY - diagonal;
    return {
      textAnchor: "end",
      anchorX: cornerX,
      top: cornerY - boxHeight
    };
  }

  if (slot === "ne") {
    const cornerX = centerX + diagonal;
    const cornerY = centerY - diagonal;
    return {
      textAnchor: "start",
      anchorX: cornerX,
      top: cornerY - boxHeight
    };
  }

  if (slot === "sw") {
    const cornerX = centerX - diagonal;
    const cornerY = centerY + diagonal;
    return {
      textAnchor: "end",
      anchorX: cornerX,
      top: cornerY
    };
  }

  const cornerX = centerX + diagonal;
  const cornerY = centerY + diagonal;
  return {
    textAnchor: "start",
    anchorX: cornerX,
    top: cornerY
  };
}

export function getStationTextFontOptions() {
  return [
    "Segoe UI",
    "Microsoft YaHei",
    "SimSun",
    "Arial",
    "Noto Sans SC"
  ];
}

export function getStationTextTypeDefinition(type) {
  return shapeParameterTypeDefinitions[type] || null;
}
