import { lineStorageKey } from "./constants.js";
import { clamp, normalizeColor } from "./utils.js";

export function createRandomLineTypeId(prefix = "custom-line") {
  const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replaceAll("-", "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomPart.slice(0, 18)}`;
}

export function createDefaultLineTypes(lineJson) {
  const thinWidth = Number(lineJson?.[0]?.width) || 5;
  const thickWidth = Number(lineJson?.[1]?.width) || thinWidth + 2;

  return [
    {
      id: "default-thin",
      source: "default",
      name: lineJson?.[0]?.name || "细线",
      colorList: ["#284f8fff", "#3f7ddaff"],
      segments: [
        {
          width: thinWidth,
          strokeStyle: "solid",
          colorMode: "palette",
          paletteIndex: 0,
          fixedColor: "#284f8fff"
        }
      ]
    },
    {
      id: "default-thick",
      source: "default",
      name: lineJson?.[1]?.name || "粗线",
      colorList: ["#183c72ff"],
      segments: [
        {
          width: thickWidth,
          strokeStyle: "solid",
          colorMode: "palette",
          paletteIndex: 0,
          fixedColor: "#183c72ff"
        },
        {
          width: Math.max(2, thickWidth - 2),
          strokeStyle: "solid",
          colorMode: "fixed",
          paletteIndex: 0,
          fixedColor: "#ffffffff"
        }
      ]
    }
  ];
}

export function normalizeLineType(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const initialColorList = Array.isArray(raw.colorList)
    ? raw.colorList.map((color) => normalizeColor(color)).filter(Boolean)
    : [];

  const segments = Array.isArray(raw.segments) ? raw.segments : [raw];
  const colorList = [...initialColorList];

  const normalizedSegments = segments.map((seg) => {
    const strokeStyle = seg.strokeStyle === "dashed" ? "dashed" : "solid";
    const legacyColor = normalizeColor(seg.color);
    const fixedColorValue = typeof seg.fixedColor === "string"
      ? normalizeColor(seg.fixedColor)
      : normalizeColor(seg.fixedColorValue || legacyColor);
    const dashSolidLength = normalizePositiveDashLength(seg.dashSolidLength ?? seg.dashLength, 10);
    const dashGapLength = normalizePositiveDashLength(seg.dashGapLength ?? seg.gapLength, 6);

    let colorMode = ["fixed", "palette"].includes(seg.colorMode)
      ? seg.colorMode
      : null;

    if (!colorMode) {
      if (typeof seg.fixedColor === "boolean") {
        colorMode = seg.fixedColor ? "fixed" : "palette";
      } else if (Number.isInteger(seg.paletteIndex)) {
        colorMode = "palette";
      } else {
        colorMode = "fixed";
      }
    }

    if (colorMode === "palette" && colorList.length === 0) {
      colorList.push(legacyColor);
    }

    const paletteMax = Math.max(0, colorList.length - 1);
    const paletteIndex = clamp(Number(seg.paletteIndex) || 0, 0, paletteMax);

    return {
      width: clamp(Number(seg.width) || 5, 1, 20),
      strokeStyle,
      dashSolidLength,
      dashGapLength,
      roundCap: Boolean(seg.roundCap),
      colorMode,
      paletteIndex,
      fixedColor: fixedColorValue
    };
  });

  if (!colorList.length) {
    colorList.push("#2f5d9d");
  }

  return {
    id: raw.id || null,
    source: raw.source === "default" ? "default" : "custom",
    name: String(raw.name || "未命名线条").trim() || "未命名线条",
    isTemporaryImported: raw.isTemporaryImported === true,
    colorList,
    segments: normalizedSegments
  };
}

export function getLineTypeById(lineTypes, id) {
  return lineTypes.find((item) => item.id === id) || null;
}

export function getSegmentStyle(lineType, index) {
  const seg = lineType.segments[index] || lineType.segments[lineType.segments.length - 1];
  return seg || {
    width: 5,
    strokeStyle: "solid",
    colorMode: "fixed",
    paletteIndex: 0,
    fixedColor: "#2f5d9dff"
  };
}

export function getColorListDefault(lineType) {
  return [...(lineType.colorList || ["#2f5d9dff"])];
}

export function resolveSegmentColor(segment, colorList) {
  if (segment.colorMode === "palette") {
    const idx = clamp(Number(segment.paletteIndex) || 0, 0, Math.max(0, colorList.length - 1));
    return normalizeColor(colorList[idx] || "#2f5d9dff");
  }
  return normalizeColor(segment.fixedColor);
}

export function loadCustomLineTypes() {
  try {
    const raw = localStorage.getItem(lineStorageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => normalizeLineType(item))
      .filter(Boolean)
      .map((item) => ({
        ...item,
        source: "custom",
        isTemporaryImported: false,
        id: item.id || createRandomLineTypeId("custom-line")
      }));
  } catch {
    return [];
  }
}

export function persistCustomLineTypes(lineTypes) {
  const customs = lineTypes.filter((item) => item.source === "custom" && !item.isTemporaryImported);
  localStorage.setItem(lineStorageKey, JSON.stringify(customs));
}

function normalizePositiveDashLength(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }

  return clamp(n, 0.1, 200);
}
