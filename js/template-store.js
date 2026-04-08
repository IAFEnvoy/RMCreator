const templateCache = new Map();

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
  "station-manager-existing-param-no-shape": "/template/manager/station/existing-param-no-shape.html"
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
