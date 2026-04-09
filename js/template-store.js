const templateCache = new Map();
const templateElements = new Map();
const imageCache = new Map();

const templateSources = {
  "submenu-station": "/template/submenu/submenu-station.html",
  "submenu-line": "/template/submenu/submenu-line.html",
  "submenu-text": "/template/submenu/submenu-text.html",
  "submenu-shape": "/template/submenu/submenu-shape.html",
  "submenu-shape-empty": "/template/submenu/submenu-shape-empty.html",
  "submenu-settings": "/template/submenu/submenu-settings.html",
  "submenu-about": "/template/submenu/submenu-about.html",
  "submenu-select-tip": "/template/submenu/submenu-select-tip.html",
  "submenu-idle": "/template/submenu/submenu-idle.html",
  "settings-message": "/template/settings/settings-message.html",
  "settings-station-single": "/template/settings/settings-station-single.html",
  "settings-station-batch": "/template/settings/settings-station-batch.html",
  "settings-line-single": "/template/settings/settings-line-single.html",
  "settings-line-batch": "/template/settings/settings-line-batch.html",
  "settings-text-single": "/template/settings/settings-text-single.html",
  "settings-shape-single": "/template/settings/settings-shape-single.html",
  "settings-shape-batch": "/template/settings/settings-shape-batch.html",
  "settings-arrange-card": "/template/settings/settings-arrange-card.html",
  "settings-align-card": "/template/settings/settings-align-card.html",
  "line-manager-segment-item": "/template/manager/line/segment-item.html",
  "line-manager-color-item": "/template/manager/line/color-item.html",
  "station-manager-text-card-empty": "/template/manager/station/text-card-empty.html",
  "station-manager-custom-param-empty": "/template/manager/station/custom-param-empty.html",
  "station-manager-custom-param-unselected": "/template/manager/station/custom-param-unselected.html",
  "station-manager-existing-param-empty": "/template/manager/station/existing-param-empty.html",
  "station-manager-existing-param-unselected": "/template/manager/station/existing-param-unselected.html",
  "station-manager-existing-param-no-shape": "/template/manager/station/existing-param-no-shape.html",
  "shortcuts-modal": "/template/manager/shortcuts/shortcuts-modal.html"
  , "drawing-manager": "/template/manager/drawing-manager.html"
  , "context-menu": "/template/menu/context-menu.html"
};

function preloadImage(src) {
  const normalized = String(src || "").trim();
  if (!normalized) return;
  if (imageCache.has(normalized)) return;
  const img = new Image();
  img.decoding = "async";
  img.src = normalized;
  imageCache.set(normalized, img);
}

function primeTemplateAssets(html) {
  if (!html || typeof DOMParser === "undefined") {
    return;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("img[src]").forEach((img) => {
    preloadImage(img.getAttribute("src"));
  });
}

class RmTemplate extends HTMLElement {
  connectedCallback() {
    if (this._ready) return;
    const key = this.getAttribute("data-key") || this.getAttribute("key") || this.id;
    const src = this.getAttribute("src");
    this._key = key;
    this._ready = (async () => {
      if (!key) {
        throw new Error("rm-template requires a data-key attribute");
      }
      if (templateCache.has(key)) {
        return;
      }
      if (!src) {
        throw new Error(`rm-template missing src for ${key}`);
      }
      const res = await fetch(src);
      if (!res.ok) {
        throw new Error(`Failed to load template: ${src}`);
      }
      const html = await res.text();
      templateCache.set(key, html);
      primeTemplateAssets(html);
    })();
  }

  whenReady() {
    return this._ready || Promise.resolve();
  }
}

function ensureTemplateElementDefined() {
  if (!customElements.get("rm-template")) {
    customElements.define("rm-template", RmTemplate);
  }
}

function ensureTemplateHost() {
  const existing = document.getElementById("templateHost");
  if (existing) {
    return existing;
  }
  const host = document.createElement("div");
  host.id = "templateHost";
  host.hidden = true;
  document.body.appendChild(host);
  return host;
}

export async function preloadTemplates() {
  ensureTemplateElementDefined();
  await customElements.whenDefined("rm-template");

  const host = ensureTemplateHost();
  Object.entries(templateSources).forEach(([key, url]) => {
    if (templateElements.has(key)) {
      return;
    }
    let el = host.querySelector(`rm-template[data-key="${key}"]`);
    if (!el) {
      el = document.createElement("rm-template");
      el.setAttribute("data-key", key);
      el.setAttribute("src", url);
      host.appendChild(el);
    }
    templateElements.set(key, el);
  });

  const pending = Array.from(templateElements.values()).map((el) => (
    typeof el.whenReady === "function" ? el.whenReady() : Promise.resolve()
  ));
  await Promise.all(pending);
}

export function getTemplate(key) {
  const html = templateCache.get(key);
  if (!html) {
    throw new Error(`Template not loaded: ${key}`);
  }
  return html;
}

export function renderTemplate(key, data = {}) {
  let html = getTemplate(key);
  Object.entries(data).forEach(([token, value]) => {
    const safeValue = value == null ? "" : String(value);
    html = html.replaceAll(`{{${token}}}`, safeValue);
  });
  return html;
}
