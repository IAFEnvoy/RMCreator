import { clamp } from "./utils.js";

export function createExportManager({ elements }) {
  const {
    viewport,
    lineLayer,
    shapeLayer,
    stationLayer,
    textLayer,
    exportPngModal,
    closeExportPngBtn,
    exportPngScaleSelect,
    exportPngTransparentInput,
    exportPngShowGridInput,
    exportPngCancelBtn,
    exportPngConfirmBtn
  } = elements;

  function exportDrawingAsSvg() {
    const built = buildExportSvg({ transparentBackground: true });
    if (!built) {
      window.alert("当前没有可导出的内容。");
      return;
    }

    downloadTextFile(
      built.svgMarkup,
      `rmcreator-export-${createFileTimestamp()}.svg`,
      "image/svg+xml"
    );
  }

  function openPngExportModal() {
    if (!exportPngModal) {
      return;
    }

    if (exportPngScaleSelect) {
      exportPngScaleSelect.value = "100";
    }
    if (exportPngTransparentInput) {
      exportPngTransparentInput.checked = false;
    }
    if (exportPngShowGridInput) {
      exportPngShowGridInput.checked = false;
    }

    exportPngModal.hidden = false;
  }

  function closePngExportModal() {
    if (!exportPngModal) {
      return;
    }

    exportPngModal.hidden = true;
  }

  function bind() {
    if (
      !exportPngModal
      || !closeExportPngBtn
      || !exportPngScaleSelect
      || !exportPngTransparentInput
      || !exportPngShowGridInput
      || !exportPngCancelBtn
      || !exportPngConfirmBtn
    ) {
      return;
    }

    closeExportPngBtn.addEventListener("click", closePngExportModal);
    exportPngCancelBtn.addEventListener("click", closePngExportModal);

    exportPngModal.addEventListener("click", (event) => {
      if (event.target === exportPngModal) {
        closePngExportModal();
      }
    });

    exportPngConfirmBtn.addEventListener("click", async () => {
      const scalePercent = clamp(Number(exportPngScaleSelect.value) || 100, 25, 800);
      exportPngScaleSelect.value = String(Math.round(scalePercent));
      const scale = scalePercent / 100;

      try {
        await exportDrawingAsPng({
          scale,
          transparentBackground: Boolean(exportPngTransparentInput.checked),
          showGrid: Boolean(exportPngShowGridInput.checked)
        });
        closePngExportModal();
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        window.alert(`PNG 导出失败：${message}`);
      }
    });
  }

  async function exportDrawingAsPng({ scale = 1, transparentBackground = false, showGrid = false } = {}) {
    const built = buildExportSvg({ transparentBackground, showGrid });
    if (!built) {
      window.alert("当前没有可导出的内容。");
      return;
    }

    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(built.svgMarkup)}`;
    const image = await loadImageFromUrl(url);

    const width = Math.max(1, Math.round(built.width * scale));
    const height = Math.max(1, Math.round(built.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("无法创建导出画布。");
    }

    if (!transparentBackground) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }

    ctx.drawImage(image, 0, 0, width, height);
    const pngBlob = await canvasToBlob(canvas, "image/png");
    downloadBlob(pngBlob, `rmcreator-export-${createFileTimestamp()}.png`);
  }

  function buildExportSvg({ transparentBackground = true, showGrid = false } = {}) {
    const layers = [lineLayer, shapeLayer, stationLayer, textLayer].filter((layer) => layer instanceof SVGGElement);
    if (!layers.length) {
      return null;
    }

    const bounds = computeExportBounds(layers, 16);
    if (!bounds) {
      return null;
    }

    const svgExport = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgExport.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svgExport.setAttribute("viewBox", `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`);
    svgExport.setAttribute("width", String(Math.ceil(bounds.width)));
    svgExport.setAttribute("height", String(Math.ceil(bounds.height)));

    if (showGrid) {
      const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      const pattern = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
      pattern.setAttribute("id", "exportGrid");
      pattern.setAttribute("width", "24");
      pattern.setAttribute("height", "24");
      pattern.setAttribute("patternUnits", "userSpaceOnUse");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M 24 0 L 0 0 0 24");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#eceff4");
      path.setAttribute("stroke-width", "1");
      pattern.appendChild(path);
      defs.appendChild(pattern);
      svgExport.appendChild(defs);
    }

    if (!transparentBackground) {
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.setAttribute("x", String(bounds.minX));
      bg.setAttribute("y", String(bounds.minY));
      bg.setAttribute("width", String(bounds.width));
      bg.setAttribute("height", String(bounds.height));
      bg.setAttribute("fill", "#ffffff");
      svgExport.appendChild(bg);
    }

    if (showGrid) {
      const grid = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      grid.setAttribute("x", String(bounds.minX));
      grid.setAttribute("y", String(bounds.minY));
      grid.setAttribute("width", String(bounds.width));
      grid.setAttribute("height", String(bounds.height));
      grid.setAttribute("fill", "url(#exportGrid)");
      svgExport.appendChild(grid);
    }

    const styleNode = document.createElementNS("http://www.w3.org/2000/svg", "style");
    styleNode.textContent = [
      ".station{fill:#ffffff;stroke:#203554;stroke-width:2}",
      ".station.interchange{stroke-width:3}",
      ".link-line{stroke-linecap:butt}",
      ".selected-shape{filter:none!important}"
    ].join("");
    svgExport.appendChild(styleNode);

    layers.forEach((layer) => {
      Array.from(layer.children).forEach((child) => {
        if (child instanceof Element && child.hasAttribute("data-virtual-node")) {
          return;
        }
        const cloned = child.cloneNode(true);
        sanitizeExportNode(cloned);
        svgExport.appendChild(cloned);
      });
    });

    const svgMarkup = new XMLSerializer().serializeToString(svgExport);
    return {
      svgMarkup,
      width: bounds.width,
      height: bounds.height
    };
  }

  function sanitizeExportNode(node) {
    if (!(node instanceof Element)) {
      return;
    }

    Array.from(node.attributes).forEach((attr) => {
      if (attr.name.startsWith("data-")) {
        node.removeAttribute(attr.name);
      }
    });

    if (node.classList.contains("selected-shape")) {
      node.classList.remove("selected-shape");
    }

    if (!node.classList.length) {
      node.removeAttribute("class");
    }

    node.removeAttribute("pointer-events");
    Array.from(node.children).forEach((child) => sanitizeExportNode(child));
  }

  function computeExportBounds(layers, padding = 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const viewportMatrix = viewport?.getCTM?.();
    let viewportInverse = null;
    if (viewportMatrix) {
      try {
        viewportInverse = viewportMatrix.inverse();
      } catch {
        viewportInverse = null;
      }
    }

    layers.forEach((layer) => {
      Array.from(layer.children).forEach((child) => {
        if (child instanceof Element && child.hasAttribute("data-virtual-node")) {
          return;
        }
        if (!(child instanceof SVGGraphicsElement)) {
          return;
        }

        let box;
        try {
          box = child.getBBox();
        } catch {
          return;
        }

        if (!Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.width) || !Number.isFinite(box.height)) {
          return;
        }

        if (box.width <= 0 && box.height <= 0) {
          return;
        }

        let matrix = child.getCTM?.();
        if (!matrix) {
          return;
        }

        if (viewportInverse) {
          matrix = viewportInverse.multiply(matrix);
        }

        const corners = [
          new DOMPoint(box.x, box.y),
          new DOMPoint(box.x + box.width, box.y),
          new DOMPoint(box.x, box.y + box.height),
          new DOMPoint(box.x + box.width, box.y + box.height)
        ].map((point) => point.matrixTransform(matrix));

        corners.forEach((point) => {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        });
      });
    });

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }

    return {
      minX: minX - padding,
      minY: minY - padding,
      width: Math.max(1, maxX - minX + padding * 2),
      height: Math.max(1, maxY - minY + padding * 2)
    };
  }

  function downloadTextFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    downloadBlob(blob, filename);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function createFileTimestamp() {
    return new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  }

  function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("无法读取导出的 SVG 数据。"));
      image.src = url;
    });
  }

  function canvasToBlob(canvas, type) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("PNG 编码失败。"));
          return;
        }
        resolve(blob);
      }, type);
    });
  }

  return {
    bind,
    exportDrawingAsSvg,
    openPngExportModal
  };
}
