/**
 * 图标预加载器
 *
 * 启动时将所有 SVG 图标加载到内存缓存，后续使用 data: URI 或内联 SVG 跳过网络请求。
 * 解决 img 文件夹内 SVG 资源缓存随机失效导致的界面卡顿问题。
 */

// --- 所有需要预加载的图标清单 ---
const iconManifest = [
  // 顶层图标
  "img/icon-about.svg",
  "img/icon-bold.svg",
  "img/icon-close.svg",
  "img/icon-download.svg",
  "img/icon-drag-vertical.svg",
  "img/icon-italic.svg",
  "img/icon-line.svg",
  "img/icon-select.svg",
  "img/icon-settings.svg",
  "img/icon-shape.svg",
  "img/icon-station.svg",
  "img/icon-strikethrough.svg",
  "img/icon-text.svg",
  "img/icon-underline.svg",

  // 对齐
  "img/align/align-bottom-svgrepo-com.svg",
  "img/align/align-horizonta-spacing-svgrepo-com.svg",
  "img/align/align-left-svgrepo-com.svg",
  "img/align/align-right-svgrepo-com.svg",
  "img/align/align-top-svgrepo-com.svg",
  "img/align/align-vertical-spacing-svgrepo-com.svg",

  // 箭头
  "img/arrow/icon-arrow-down.svg",
  "img/arrow/icon-arrow-down-left.svg",
  "img/arrow/icon-arrow-down-right.svg",
  "img/arrow/icon-arrow-left.svg",
  "img/arrow/icon-arrow-right.svg",
  "img/arrow/icon-arrow-up.svg",
  "img/arrow/icon-arrow-up-left.svg",
  "img/arrow/icon-arrow-up-right.svg",

  // 快捷键
  "img/key/icon-alt.svg",
  "img/key/icon-ctrl.svg",
  "img/key/icon-down.svg",
  "img/key/icon-left.svg",
  "img/key/icon-right.svg",
  "img/key/icon-shift.svg",
  "img/key/icon-up.svg",

  // 层级
  "img/layer/icon-layer-bring-forward.svg",
  "img/layer/icon-layer-bring-to-front.svg",
  "img/layer/icon-layer-down-to.svg",
  "img/layer/icon-layer-send-backward.svg",
  "img/layer/icon-layer-send-to-back.svg",
  "img/layer/icon-layer-up-to.svg",

  // 右键菜单
  "img/menu/icon-copy.svg",
  "img/menu/icon-copy-args.svg",
  "img/menu/icon-cut.svg",
  "img/menu/icon-delete.svg",
  "img/menu/icon-paste.svg",
  "img/menu/icon-paste-args.svg",
  "img/menu/icon-refresh.svg",

  // 平台
  "img/platform/icon-github.svg",
];

// --- 内存缓存 ---
const svgCache = new Map();
let preloadComplete = false;

/**
 * 预加载所有图标到内存缓存
 * @returns {Promise<void>}
 */
export async function preloadIcons() {
  if (preloadComplete) return;

  const results = await Promise.allSettled(
    iconManifest.map(async (path) => {
      try {
        const resp = await fetch("/" + path);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        // 使用原始路径作为 key
        svgCache.set(path, text);
        // 同时用 / 开头路径（兼容不同引用方式）
        svgCache.set("/" + path, text);
      } catch {
        // 静默跳过缺失图标
      }
    })
  );

  preloadComplete = true;

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.warn(`[IconLoader] ${failed}/${iconManifest.length} 个图标加载失败`);
  }
}

/**
 * 获取图标内容（SVG 文本）
 * @param {string} src - 图标路径，如 "img/icon-close.svg" 或 "/img/icon-close.svg"
 * @returns {string|null} SVG 文本，若未预加载则返回 null
 */
export function getIconText(src) {
  if (!src) return null;
  const key = src.startsWith("/") ? src : "/" + src;
  return svgCache.get(key) || svgCache.get(src.replace(/^\//, "")) || null;
}

/**
 * 将图标路径转换为 data:image/svg+xml URI
 * @param {string} src - 图标路径
 * @returns {string} data: URI 或原始路径（fallback）
 */
export function getIconDataUri(src) {
  const text = getIconText(src);
  if (!text) return src; // fallback 到原始路径
  const encoded = encodeURIComponent(text)
    .replace(/'/g, "%27")
    .replace(/"/g, "%22");
  return `data:image/svg+xml,${encoded}`;
}

/**
 * 预加载图标并重写所有已存在的 HTML/img 中的 src 为 data URI
 */
export function syncExistingImages() {
  // 匹配 /img/... 和 img/... 两种写法
  document.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (!src) return;
    const isIcon = src.startsWith("/img/") || src.startsWith("img/");
    if (!isIcon) return;
    const dataUri = getIconDataUri(src);
    if (dataUri !== src) {
      img.setAttribute("data-original-src", src);
      img.src = dataUri;
    }
  });
}

let observerStarted = false;

/**
 * 启动 MutationObserver，自动将动态添加的 img 图标 src 替换为 data URI
 */
export function startAutoRewrite() {
  if (observerStarted) return;
  observerStarted = true;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        // 直接新增的 img 元素
        if (node.tagName === "IMG") {
          rewriteImgElement(node);
        }
        // 子节点中的 img 元素
        if (node.querySelectorAll) {
          node.querySelectorAll("img").forEach(rewriteImgElement);
        }
      });
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function rewriteImgElement(img) {
  const src = img.getAttribute("src");
  if (!src) return;
  const isIcon = src.startsWith("/img/") || src.startsWith("img/");
  if (!isIcon) return;
  // 跳过已替换的
  if (img.src.startsWith("data:")) return;
  const dataUri = getIconDataUri(src);
  if (dataUri !== src) {
    img.setAttribute("data-original-src", src);
    img.src = dataUri;
  }
}

/**
 * 将图标路径转换为内联 SVG 元素字符串
 * @param {string} src - 图标路径
 * @param {string} [alt=""] - 无障碍文本
 * @returns {string} 内联 SVG HTML 字符串，或 <img> 标签 (fallback)
 */
export function getIconInline(src, alt = "") {
  const text = getIconText(src);
  if (!text) return `<img src="${src}" alt="${alt}" />`;

  // 提取 viewBox 并注入无障碍属性
  let svgText = text;
  if (!svgText.includes("aria-hidden")) {
    if (alt) {
      svgText = svgText.replace("<svg", `<svg role="img" aria-label="${alt}"`);
    } else {
      svgText = svgText.replace("<svg", `<svg aria-hidden="true"`);
    }
  }

  return svgText;
}
