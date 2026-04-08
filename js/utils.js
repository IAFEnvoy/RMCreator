export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function rotatePoint(point, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos
  };
}

export function escapeHtml(raw) {
  return String(raw)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function normalizeColor(value) {
  const color = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color.toLowerCase()}ff`;
  }

  if (/^#[0-9a-fA-F]{8}$/.test(color)) {
    return color.toLowerCase();
  }

  return "#2f5d9dff";
}

export function splitColorAndAlpha(value) {
  const normalized = normalizeColor(value);
  const hex = normalized.slice(0, 7);
  const alphaHex = normalized.slice(7, 9);
  const alpha = Number.parseInt(alphaHex, 16) / 255;
  return {
    hex,
    alpha
  };
}

export function mergeColorAndAlpha(hexColor, alpha) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(String(hexColor || ""))
    ? String(hexColor).toLowerCase()
    : "#2f5d9d";
  const a = clamp(Number(alpha) || 0, 0, 1);
  const alphaHex = Math.round(a * 255).toString(16).padStart(2, "0");
  return `${hex}${alphaHex}`;
}

export function formatColorWithAlpha(value) {
  return normalizeColor(value).toUpperCase();
}

export function toCanvasPoint(event, svg, viewport) {
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const matrix = viewport.getScreenCTM();

  if (!matrix) {
    return { x: 0, y: 0 };
  }

  const result = pt.matrixTransform(matrix.inverse());
  return { x: result.x, y: result.y };
}

export function clientToSvgPoint(clientX, clientY, svg) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const svgMatrix = svg.getScreenCTM();

  if (!svgMatrix) {
    return { x: 0, y: 0 };
  }

  const result = pt.matrixTransform(svgMatrix.inverse());
  return { x: result.x, y: result.y };
}

export function normalizeTextStyleFlags(rawStyle, fallbackStyle = null) {
  const fallback = fallbackStyle && typeof fallbackStyle === "object"
    ? fallbackStyle
    : {};
  const source = rawStyle && typeof rawStyle === "object"
    ? rawStyle
    : {};

  return {
    bold: Boolean(source.bold ?? fallback.bold),
    italic: Boolean(source.italic ?? fallback.italic),
    underline: Boolean(source.underline ?? fallback.underline),
    strikethrough: Boolean(source.strikethrough ?? source.strikeThrough ?? fallback.strikethrough)
  };
}

export function getSvgTextDecoration(textStyle) {
  const style = normalizeTextStyleFlags(textStyle);
  const segments = [];

  if (style.underline) {
    segments.push("underline");
  }
  if (style.strikethrough) {
    segments.push("line-through");
  }

  return segments.join(" ") || "none";
}

export function applyTextInputStyle(inputEl, textStyle) {
  if (!inputEl || typeof inputEl.style === "undefined") {
    return;
  }

  const style = normalizeTextStyleFlags(textStyle);
  inputEl.style.fontWeight = style.bold ? "700" : "400";
  inputEl.style.fontStyle = style.italic ? "italic" : "normal";
  inputEl.style.textDecoration = getSvgTextDecoration(style);
}

let toastEl = null;
let toastTimer = null;

export function showToast(message, durationMs = 600) {
  const duration = Math.max(0, Number(durationMs) || 0);
  if (!message || duration <= 0) {
    return;
  }

  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "app-toast";
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    document.body.appendChild(toastEl);
  }

  toastEl.textContent = String(message);
  toastEl.classList.add("show");

  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  toastTimer = window.setTimeout(() => {
    if (toastEl) {
      toastEl.classList.remove("show");
    }
  }, duration);
}
