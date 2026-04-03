const templateCache = new Map();

const templateSources = {
  "submenu-station": "/template/submenu-station.html",
  "submenu-line": "/template/submenu-line.html",
  "submenu-text": "/template/submenu-text.html",
  "submenu-shape": "/template/submenu-shape.html",
  "submenu-shape-empty": "/template/submenu-shape-empty.html",
  "submenu-settings": "/template/submenu-settings.html",
  "submenu-about": "/template/submenu-about.html",
  "submenu-select-tip": "/template/submenu-select-tip.html",
  "submenu-idle": "/template/submenu-idle.html",
  "settings-message": "/template/settings-message.html",
  "settings-station-single": "/template/settings-station-single.html",
  "settings-station-batch": "/template/settings-station-batch.html",
  "settings-line-single": "/template/settings-line-single.html",
  "settings-line-batch": "/template/settings-line-batch.html",
  "settings-text-single": "/template/settings-text-single.html",
  "settings-shape-single": "/template/settings-shape-single.html",
  "settings-shape-batch": "/template/settings-shape-batch.html",
  "settings-arrange-card": "/template/settings-arrange-card.html",
  "settings-align-card": "/template/settings-align-card.html"
};

async function fetchTemplate(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load template: ${url}`);
  }
  return res.text();
}

export async function preloadTemplates() {
  const entries = Object.entries(templateSources);
  await Promise.all(entries.map(async ([key, url]) => {
    const html = await fetchTemplate(url);
    templateCache.set(key, html);
  }));
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
