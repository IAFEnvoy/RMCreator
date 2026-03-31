import { shapeStorageKey } from "./constants.js";
import { svgNs } from "./dom.js";

export function createShapeManager({
  state,
  elements,
  createShapeId,
  renderSubmenu
}) {
  const {
    shapeManagerModal,
    closeShapeManagerBtn,
    newShapeBtn,
    shapeLibraryList,
    shapePrimitiveSelect,
    shapeAddPrimitiveBtn,
    shapeImportSvgBtn,
    shapeImportSvgInput,
    shapeEditorCanvas,
    addColorParamBtn,
    addTextParamBtn,
    addCheckboxParamBtn,
    shapeParamList
  } = elements;

  function bind() {
    if (
      !shapeManagerModal
      || !closeShapeManagerBtn
      || !newShapeBtn
      || !shapeLibraryList
      || !shapePrimitiveSelect
      || !shapeAddPrimitiveBtn
      || !shapeImportSvgBtn
      || !shapeImportSvgInput
      || !shapeEditorCanvas
      || !addColorParamBtn
      || !addTextParamBtn
      || !addCheckboxParamBtn
      || !shapeParamList
    ) {
      return;
    }

    loadShapeLibraryFromStorage();

    closeShapeManagerBtn.addEventListener("click", close);
    newShapeBtn.addEventListener("click", createEmptyShape);
    shapePrimitiveSelect.addEventListener("change", () => {
      state.shapeManager.primitiveType = shapePrimitiveSelect.value;
    });
    shapeAddPrimitiveBtn.addEventListener("click", addPrimitiveToCurrentShape);
    shapeImportSvgBtn.addEventListener("click", () => shapeImportSvgInput.click());
    shapeImportSvgInput.addEventListener("change", importExternalSvgShape);

    addColorParamBtn.addEventListener("click", () => addParameter("color"));
    addTextParamBtn.addEventListener("click", () => addParameter("text"));
    addCheckboxParamBtn.addEventListener("click", () => addParameter("checkbox"));

    shapeManagerModal.hidden = true;
  }

  function open() {
    if (!shapeManagerModal) {
      return;
    }

    state.shapeManager.isOpen = true;
    shapeManagerModal.hidden = false;
    ensureSelectedShape();
    renderShapeManager();
  }

  function close() {
    if (!shapeManagerModal) {
      return;
    }

    state.shapeManager.isOpen = false;
    shapeManagerModal.hidden = true;
  }

  function renderShapeManager() {
    renderShapeLibraryList();
    renderShapeEditor();
  }

  function renderShapeLibraryList() {
    shapeLibraryList.innerHTML = "";

    if (!state.shapeLibrary.length) {
      const empty = document.createElement("div");
      empty.className = "kv";
      empty.textContent = "图形库为空，请创建或导入 SVG 图形。";
      shapeLibraryList.appendChild(empty);
      return;
    }

    state.shapeLibrary.forEach((shape) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "line-library-item";
      item.classList.toggle("active", shape.id === state.shapeManager.selectedId);

      const row = document.createElement("div");
      row.className = "line-library-item-row";

      const title = document.createElement("span");
      title.className = "line-library-item-title";
      title.textContent = shape.name;

      const preview = document.createElement("img");
      preview.className = "shape-library-preview-inline";
      preview.alt = `${shape.name}预览`;
      preview.src = toSvgDataUrl(shape.svg);

      row.appendChild(title);
      row.appendChild(preview);
      item.appendChild(row);

      const tag = document.createElement("span");
      tag.className = "line-library-item-tag";
      tag.textContent = shape.imported ? "外部SVG" : "编辑图形";
      item.appendChild(tag);

      item.addEventListener("click", () => {
        state.shapeManager.selectedId = shape.id;
        renderShapeManager();
      });

      shapeLibraryList.appendChild(item);
    });
  }

  function renderShapeEditor() {
    const selectedShape = getSelectedShape();
    shapePrimitiveSelect.value = state.shapeManager.primitiveType;

    renderEditorCanvas(selectedShape);
    renderParameterList(selectedShape);
  }

  function renderEditorCanvas(shape) {
    shapeEditorCanvas.innerHTML = "";

    const defs = document.createElementNS(svgNs, "defs");
    const pattern = document.createElementNS(svgNs, "pattern");
    pattern.setAttribute("id", "shapeGridPattern");
    pattern.setAttribute("width", "20");
    pattern.setAttribute("height", "20");
    pattern.setAttribute("patternUnits", "userSpaceOnUse");

    const gridPath = document.createElementNS(svgNs, "path");
    gridPath.setAttribute("d", "M 20 0 L 0 0 0 20");
    gridPath.setAttribute("fill", "none");
    gridPath.setAttribute("stroke", "#e8edf6");
    gridPath.setAttribute("stroke-width", "1");

    pattern.appendChild(gridPath);
    defs.appendChild(pattern);
    shapeEditorCanvas.appendChild(defs);

    const bg = document.createElementNS(svgNs, "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", "240");
    bg.setAttribute("height", "240");
    bg.setAttribute("fill", "url(#shapeGridPattern)");
    shapeEditorCanvas.appendChild(bg);

    const axisX = document.createElementNS(svgNs, "line");
    axisX.setAttribute("x1", "16");
    axisX.setAttribute("y1", "120");
    axisX.setAttribute("x2", "224");
    axisX.setAttribute("y2", "120");
    axisX.setAttribute("stroke", "#7b8da8");
    axisX.setAttribute("stroke-width", "1.4");
    shapeEditorCanvas.appendChild(axisX);

    const axisY = document.createElementNS(svgNs, "line");
    axisY.setAttribute("x1", "120");
    axisY.setAttribute("y1", "16");
    axisY.setAttribute("x2", "120");
    axisY.setAttribute("y2", "224");
    axisY.setAttribute("stroke", "#7b8da8");
    axisY.setAttribute("stroke-width", "1.4");
    shapeEditorCanvas.appendChild(axisY);

    if (!shape?.svg) {
      return;
    }

    const parsed = parseSvg(shape.svg);
    if (!parsed) {
      return;
    }

    const { root, viewBox } = parsed;
    const pad = 18;
    const sx = (240 - pad * 2) / Math.max(1, viewBox.width);
    const sy = (240 - pad * 2) / Math.max(1, viewBox.height);
    const scale = Math.min(sx, sy);
    const tx = 120 - (viewBox.x + viewBox.width / 2) * scale;
    const ty = 120 - (viewBox.y + viewBox.height / 2) * scale;

    const g = document.createElementNS(svgNs, "g");
    g.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);

    Array.from(root.children).forEach((child) => {
      const tag = child.tagName.toLowerCase();
      if (tag === "script" || tag === "foreignobject") {
        return;
      }

      const clone = child.cloneNode(true);
      stripUnsafeAttributes(clone);
      g.appendChild(shapeEditorCanvas.ownerDocument.importNode(clone, true));
    });

    shapeEditorCanvas.appendChild(g);
  }

  function renderParameterList(shape) {
    shapeParamList.innerHTML = "";
    const params = Array.isArray(shape?.parameters) ? shape.parameters : [];

    if (!params.length) {
      const empty = document.createElement("div");
      empty.className = "shape-param-item";
      empty.textContent = "暂无参数（可通过上方按钮添加）";
      shapeParamList.appendChild(empty);
      return;
    }

    params.forEach((param) => {
      const row = document.createElement("div");
      row.className = "shape-param-item";
      row.textContent = `${param.label} (${param.type})`;
      shapeParamList.appendChild(row);
    });
  }

  function createEmptyShape() {
    const shape = {
      id: createShapeId(),
      name: `图形 ${state.shapeLibrary.length + 1}`,
      svg: buildSvgFromEditableElements([]),
      editableElements: [],
      parameters: [],
      imported: false
    };

    state.shapeLibrary.push(shape);
    state.shapeManager.selectedId = shape.id;
    persistShapeLibrary();
    renderShapeManager();
    renderSubmenu();
  }

  function addPrimitiveToCurrentShape() {
    let shape = getSelectedShape();
    if (!shape || !Array.isArray(shape.editableElements)) {
      shape = {
        id: createShapeId(),
        name: `图形 ${state.shapeLibrary.length + 1}`,
        svg: buildSvgFromEditableElements([]),
        editableElements: [],
        parameters: [],
        imported: false
      };
      state.shapeLibrary.push(shape);
      state.shapeManager.selectedId = shape.id;
    }

    const nextIndex = shape.editableElements.length;
    shape.editableElements.push(createPrimitiveElement(state.shapeManager.primitiveType, nextIndex));
    shape.svg = buildSvgFromEditableElements(shape.editableElements);

    persistShapeLibrary();
    renderShapeManager();
    renderSubmenu();
  }

  async function importExternalSvgShape(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const normalized = normalizeImportedSvg(text);
      if (!normalized) {
        return;
      }

      const shape = {
        id: createShapeId(),
        name: (file.name || "导入图形").replace(/\.svg$/i, "") || `图形 ${state.shapeLibrary.length + 1}`,
        svg: normalized,
        editableElements: null,
        parameters: [],
        imported: true
      };

      state.shapeLibrary.push(shape);
      state.shapeManager.selectedId = shape.id;
      persistShapeLibrary();
      renderShapeManager();
      renderSubmenu();
    } catch {
      window.alert("导入失败：SVG 文件格式无效。");
    } finally {
      shapeImportSvgInput.value = "";
    }
  }

  function addParameter(type) {
    const shape = getSelectedShape();
    if (!shape) {
      return;
    }

    if (!Array.isArray(shape.parameters)) {
      shape.parameters = [];
    }

    const nextNo = shape.parameters.length + 1;
    const label = type === "color"
      ? `颜色参数 ${nextNo}`
      : type === "text"
        ? `文本参数 ${nextNo}`
        : `勾选参数 ${nextNo}`;

    shape.parameters.push({ type, label });
    persistShapeLibrary();
    renderParameterList(shape);
  }

  function getSelectedShape() {
    return state.shapeLibrary.find((shape) => shape.id === state.shapeManager.selectedId) || null;
  }

  function ensureSelectedShape() {
    if (getSelectedShape()) {
      return;
    }

    state.shapeManager.selectedId = state.shapeLibrary[0]?.id || null;
  }

  function loadShapeLibraryFromStorage() {
    state.shapeLibrary = readShapeLibrary();
    ensureSelectedShape();
    renderSubmenu();
  }

  function persistShapeLibrary() {
    try {
      const payload = state.shapeLibrary.map((shape) => ({
        id: String(shape.id || createShapeId()),
        name: String(shape.name || "图形").trim() || "图形",
        svg: String(shape.svg || buildSvgFromEditableElements([])),
        editableElements: Array.isArray(shape.editableElements) ? structuredClone(shape.editableElements) : null,
        parameters: Array.isArray(shape.parameters) ? structuredClone(shape.parameters) : [],
        imported: Boolean(shape.imported)
      }));
      localStorage.setItem(shapeStorageKey, JSON.stringify(payload));
    } catch {
      // Ignore localStorage quota/availability errors.
    }
  }

  function readShapeLibrary() {
    try {
      const raw = localStorage.getItem(shapeStorageKey);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((shape) => sanitizeShape(shape))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function sanitizeShape(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const normalizedSvg = normalizeImportedSvg(raw.svg || "");
    if (!normalizedSvg) {
      return null;
    }

    return {
      id: String(raw.id || createShapeId()),
      name: String(raw.name || "图形").trim() || "图形",
      svg: normalizedSvg,
      editableElements: Array.isArray(raw.editableElements) ? raw.editableElements.map((item) => ({ ...item })) : null,
      parameters: Array.isArray(raw.parameters)
        ? raw.parameters.map((param) => ({
          type: ["color", "text", "checkbox"].includes(param?.type) ? param.type : "text",
          label: String(param?.label || "参数")
        }))
        : [],
      imported: Boolean(raw.imported)
    };
  }

  return {
    bind,
    open,
    close
  };
}

function createPrimitiveElement(type, index) {
  const shift = (index % 5) * 10;

  if (type === "circle") {
    return {
      type: "circle",
      cx: 120 + shift * 0.5,
      cy: 120 - shift * 0.5,
      r: 42,
      fill: "none",
      stroke: "#2f5d9d",
      strokeWidth: 8
    };
  }

  if (type === "rect") {
    return {
      type: "rect",
      x: 56 + shift * 0.5,
      y: 56 + shift * 0.3,
      width: 128,
      height: 128,
      rx: 8,
      fill: "none",
      stroke: "#2f5d9d",
      strokeWidth: 8
    };
  }

  return {
    type: "line",
    x1: 40,
    y1: 60 + shift,
    x2: 200,
    y2: 180 - shift,
    stroke: "#2f5d9d",
    strokeWidth: 8
  };
}

function buildSvgFromEditableElements(elements) {
  const rows = [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 240 240\">"
  ];

  (Array.isArray(elements) ? elements : []).forEach((element) => {
    if (element.type === "line") {
      rows.push(
        `  <line x1=\"${num(element.x1)}\" y1=\"${num(element.y1)}\" x2=\"${num(element.x2)}\" y2=\"${num(element.y2)}\" stroke=\"${safeColor(element.stroke)}\" stroke-width=\"${num(element.strokeWidth)}\" stroke-linecap=\"round\" />`
      );
      return;
    }

    if (element.type === "circle") {
      rows.push(
        `  <circle cx=\"${num(element.cx)}\" cy=\"${num(element.cy)}\" r=\"${num(element.r)}\" fill=\"${safeFill(element.fill)}\" stroke=\"${safeColor(element.stroke)}\" stroke-width=\"${num(element.strokeWidth)}\" />`
      );
      return;
    }

    if (element.type === "rect") {
      rows.push(
        `  <rect x=\"${num(element.x)}\" y=\"${num(element.y)}\" width=\"${num(element.width)}\" height=\"${num(element.height)}\" rx=\"${num(element.rx)}\" fill=\"${safeFill(element.fill)}\" stroke=\"${safeColor(element.stroke)}\" stroke-width=\"${num(element.strokeWidth)}\" />`
      );
    }
  });

  rows.push("</svg>");
  return rows.join("\n");
}

function normalizeImportedSvg(rawSvg) {
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

function parseSvg(svgText) {
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

function stripUnsafeAttributes(node) {
  if (!(node instanceof Element)) {
    return;
  }

  Array.from(node.attributes).forEach((attr) => {
    const name = attr.name.toLowerCase();
    const value = attr.value.toLowerCase();
    if (name.startsWith("on") || value.includes("javascript:")) {
      node.removeAttribute(attr.name);
    }
  });

  Array.from(node.children).forEach((child) => stripUnsafeAttributes(child));
}

function toSvgDataUrl(svgText) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svgText || ""))}`;
}

function num(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Number(n.toFixed(2));
}

function safeColor(value) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(value || "").trim()) ? String(value).trim() : "#2f5d9d";
}

function safeFill(value) {
  const raw = String(value || "none").trim();
  if (raw === "none") {
    return "none";
  }
  return safeColor(raw);
}
