import { getTemplate } from "./template-store.js";
import { clamp } from "./utils.js";

// Helper: flash temporary feedback on a button
function flashItemText(state, feedbackTimers, button, message) {
  if (!button) return;
  const durationSec = clamp(Number(state.appSettings?.feedbackDuration) || 0.63, 0, 5);
  if (durationSec <= 0) return;
  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent || "";
  }
  button.textContent = message;

  const existing = feedbackTimers.get(button);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = window.setTimeout(() => {
    button.textContent = button.dataset.originalText || "";
    feedbackTimers.delete(button);
  }, durationSec * 1000);
  feedbackTimers.set(button, timer);
}

// Ensure menu DOM exists and attach to document.body
function ensureMenu(holder) {
  if (holder.menuEl && holder.menuEl.isConnected) return;
  try {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = getTemplate("context-menu");
    holder.menuEl = wrapper.getElementById('contextMenu');
  } catch (e) {
    holder.menuEl = null;
  }
  if (!holder.menuEl) {
    const fallback = document.createElement("div");
    fallback.className = "context-menu";
    fallback.id = "contextMenu";
    fallback.hidden = true;
    fallback.innerHTML =
      "<div class=\"context-menu-quick\" id=\"contextMenuQuick\"></div>" +
      "<div class=\"context-menu-list\" id=\"contextMenuList\"></div>" +
      "<div class=\"context-menu-submenu\" id=\"contextMenuSubmenu\" hidden></div>";
    holder.menuEl = fallback;
  }
  document.body.appendChild(holder.menuEl);
  holder.quickEl = holder.menuEl.querySelector("#contextMenuQuick");
  holder.listEl = holder.menuEl.querySelector("#contextMenuList");
  holder.submenuEl = holder.menuEl.querySelector("#contextMenuSubmenu");

  holder.menuEl.addEventListener("contextmenu", (event) => event.preventDefault());
  holder.menuEl.addEventListener("mouseleave", () => hideSubmenu(holder));
  holder.submenuEl?.addEventListener("mouseleave", () => hideSubmenu(holder));
}

function getSelectionType(entities) {
  if (!Array.isArray(entities) || !entities.length) return null;
  const firstType = entities[0]?.type;
  if (!firstType) return null;
  return entities.every((item) => item.type === firstType) ? firstType : null;
}

function getEntityFromTarget(target) {
  if (!(target instanceof Element)) return null;
  const stationEl = target.closest("[data-station-id]");
  if (stationEl) return { type: "station", id: stationEl.dataset.stationId };
  const lineEl = target.closest("[data-line-id]");
  if (lineEl) return { type: "line", id: lineEl.dataset.lineId };
  const shapeEl = target.closest("[data-shape-id]");
  if (shapeEl) return { type: "shape", id: shapeEl.dataset.shapeId };
  const textEl = target.closest("[data-text-id]");
  if (textEl) return { type: "text", id: textEl.dataset.textId };
  return null;
}

function isEntitySelected(state, entity) {
  if (!entity) return false;
  return Array.isArray(state.selectedEntities)
    && state.selectedEntities.some((item) => item.type === entity.type && item.id === entity.id);
}

function hideSubmenu(holder) {
  if (!holder.submenuEl) return;
  holder.submenuEl.hidden = true;
  holder.submenuEl.innerHTML = "";
  holder.openSubmenuAnchor = null;
}

function hideMenu(holder) {
  if (holder.menuEl) {
    holder.menuEl.hidden = true;
  }
  hideSubmenu(holder);
}

function openMenuAt(holder, x, y) {
  if (!holder.menuEl) return;
  holder.menuEl.hidden = false;
  holder.menuEl.removeAttribute("hidden");
  holder.menuEl.style.left = `${x}px`;
  holder.menuEl.style.top = `${y}px`;

  const rect = holder.menuEl.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  const nextX = Math.max(8, Math.min(x, maxX));
  const nextY = Math.max(8, Math.min(y, maxY));
  holder.menuEl.style.left = `${nextX}px`;
  holder.menuEl.style.top = `${nextY}px`;
}

function applyAlignment(renderer, onStateChanged, action, items) {
  if (!Array.isArray(items) || items.length < 2) {
    return;
  }
  const positions = items.map(({ item, type }) => ({
    item,
    type,
    x: Number(item.x) || 0,
    y: Number(item.y) || 0
  }));

  if (action === "align-left") {
    const minX = Math.min(...positions.map((entry) => entry.x));
    positions.forEach((entry) => { entry.item.x = minX; });
  } else if (action === "align-right") {
    const maxX = Math.max(...positions.map((entry) => entry.x));
    positions.forEach((entry) => { entry.item.x = maxX; });
  } else if (action === "align-top") {
    const minY = Math.min(...positions.map((entry) => entry.y));
    positions.forEach((entry) => { entry.item.y = minY; });
  } else if (action === "align-bottom") {
    const maxY = Math.max(...positions.map((entry) => entry.y));
    positions.forEach((entry) => { entry.item.y = maxY; });
  } else if (action === "distribute-x") {
    const sorted = [...positions].sort((a, b) => a.x - b.x);
    const minX = sorted[0].x;
    const maxX = sorted[sorted.length - 1].x;
    const step = (maxX - minX) / (sorted.length - 1 || 1);
    sorted.forEach((entry, index) => { entry.item.x = minX + step * index; });
  } else if (action === "distribute-y") {
    const sorted = [...positions].sort((a, b) => a.y - b.y);
    const minY = sorted[0].y;
    const maxY = sorted[sorted.length - 1].y;
    const step = (maxY - minY) / (sorted.length - 1 || 1);
    sorted.forEach((entry, index) => { entry.item.y = minY + step * index; });
  }

  const hasStation = positions.some((entry) => entry.type === "station");
  const hasShape = positions.some((entry) => entry.type === "shape");
  if (hasStation) {
    renderer.renderStations();
    renderer.renderLines();
  }
  if (hasShape) {
    renderer.renderShapes();
  }
  onStateChanged?.({ coalesceKey: "align-multi" });
  renderer.renderSettings();
}

function showSubmenu(holder, items, anchor) {
  if (!holder.submenuEl || !anchor) return;
  holder.submenuEl.innerHTML = "";
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "context-menu-item";
    button.textContent = item.label;
    if (item.icon) {
      const icon = document.createElement("img");
      icon.src = item.icon;
      icon.alt = item.label;
      button.prepend(icon);
    }
    if (item.disabled) {
      button.disabled = true;
    }
    button.addEventListener("click", () => {
      if (item.disabled) return;
      item.onClick?.();
      hideMenu(holder);
    });
    holder.submenuEl.appendChild(button);
  });

  const rect = anchor.getBoundingClientRect();
  holder.submenuEl.hidden = false;
  const left = rect.right + 6;
  const top = rect.top;
  holder.submenuEl.style.left = `${left}px`;
  holder.submenuEl.style.top = `${top}px`;

  const subRect = holder.submenuEl.getBoundingClientRect();
  if (subRect.right > window.innerWidth - 8) {
    holder.submenuEl.style.left = `${rect.left - subRect.width - 6}px`;
  }
  if (subRect.bottom > window.innerHeight - 8) {
    holder.submenuEl.style.top = `${window.innerHeight - subRect.height - 8}px`;
  }
}

function renderMenu(opts, context) {
  const {
    state,
    holder,
    renderer,
    rerenderScene,
    copySelection,
    cutSelection,
    pasteSelection,
    deleteSelectedEntity,
    moveLineInStack,
    onStateChanged,
    hasClipboard
  } = opts;

  if (!holder.quickEl || !holder.listEl) return;
  holder.quickEl.innerHTML = "";
  holder.listEl.innerHTML = "";
  hideSubmenu(holder);

  const { selectionType, hasSelection, hasEntity, isLineSelection, alignTargets, lineTarget } = context;

  const quickButtons = [];
  const addQuickButton = (label, icon, onClick, disabled = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-quick-btn";
    button.textContent = label;
    if (icon) {
      const img = document.createElement("img");
      img.src = icon;
      img.alt = label;
      button.prepend(img);
    }
    if (disabled) button.disabled = true;
    button.addEventListener("click", () => {
      if (disabled) return;
      onClick?.(button);
    });
    quickButtons.push(button);
  };

  const refresh = () => {
    rerenderScene();
    renderer.renderSettings();
    hideMenu(holder);
  };

  const doDelete = () => {
    if (!hasSelection) return;
    deleteSelectedEntity?.();
    hideMenu(holder);
  };

  const canCopy = hasSelection && !isLineSelection;
  const canCut = canCopy;

  if (hasEntity && !isLineSelection) {
    holder.quickEl.classList.remove("compact");
    addQuickButton("刷新", "/img/menu/icon-refresh.svg", refresh);
    addQuickButton("剪切", "/img/menu/icon-cut.svg", () => {
      cutSelection?.();
      hideMenu(holder);
    }, !canCut);
    addQuickButton("复制", "/img/menu/icon-copy.svg", (btn) => {
      if (copySelection?.()) {
        flashItemText(state, holder.feedbackTimers, btn, "复制成功");
      }
      hideMenu(holder);
    }, !canCopy);
    addQuickButton("删除", "/img/menu/icon-delete.svg", () => doDelete(), !hasSelection);
  } else {
    holder.quickEl.classList.add("compact");
    addQuickButton("刷新", "/img/menu/icon-refresh.svg", refresh);
    addQuickButton("删除", "/img/menu/icon-delete.svg", () => doDelete(), !hasSelection);
  }

  quickButtons.forEach((btn) => holder.quickEl.appendChild(btn));

  const addItem = (label, icon, onClick, disabled = false, submenu) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "context-menu-item";
    button.textContent = label;
    if (icon) {
      const img = document.createElement("img");
      img.src = icon;
      img.alt = label;
      button.prepend(img);
    }
    if (submenu) {
      button.classList.add("has-submenu");
      button.addEventListener("mouseenter", () => {
        holder.openSubmenuAnchor = button;
        showSubmenu(holder, submenu, button);
      });
    }
    if (disabled) button.disabled = true;
    button.addEventListener("click", () => {
      if (disabled || submenu) return;
      onClick?.(button);
    });
    holder.listEl.appendChild(button);
    return button;
  };

  const addDivider = () => {
    const div = document.createElement("div");
    div.className = "context-menu-divider";
    holder.listEl.appendChild(div);
  };

  const clipboardAvailable = Boolean(hasClipboard?.());
  const paramClipboard = state.paramClipboard;
  const canCopyParams = hasSelection && Array.isArray(state.selectedEntities) && state.selectedEntities.length === 1;
  const canPasteParams = Boolean(paramClipboard)
    && Boolean(selectionType)
    && paramClipboard.type === selectionType;

  const pasteBtn = addItem("粘贴", "/img/menu/icon-copy.svg", () => {
    if (pasteSelection?.()) {
      flashItemText(state, holder.feedbackTimers, pasteBtn, "粘贴成功");
    }
    hideMenu(holder);
  }, !clipboardAvailable);

  const copyParamBtn = addItem("复制参数", "/img/menu/icon-copy.svg", () => {
    if (state.paramClipboardActions?.copy?.()) {
      flashItemText(state, holder.feedbackTimers, copyParamBtn, "复制成功");
    }
    hideMenu(holder);
  }, !canCopyParams);

  const pasteParamBtn = addItem("粘贴属性", "/img/menu/icon-copy.svg", () => {
    if (state.paramClipboardActions?.paste?.()) {
      flashItemText(state, holder.feedbackTimers, pasteParamBtn, "粘贴成功");
    }
    hideMenu(holder);
  }, !canPasteParams);

  addDivider();

  if (isLineSelection && lineTarget) {
    const arrangeItems = [
      { label: "置顶", icon: "/img/layer/icon-layer-bring-to-front.svg", onClick: () => moveLineInStack?.({ sourceId: lineTarget.id, mode: "to-front" }) },
      { label: "置底", icon: "/img/layer/icon-layer-send-to-back.svg", onClick: () => moveLineInStack?.({ sourceId: lineTarget.id, mode: "to-back" }) },
      { label: "上移", icon: "/img/layer/icon-layer-bring-forward.svg", onClick: () => moveLineInStack?.({ sourceId: lineTarget.id, mode: "up" }) },
      { label: "下移", icon: "/img/layer/icon-layer-send-backward.svg", onClick: () => moveLineInStack?.({ sourceId: lineTarget.id, mode: "down" }) },
      { label: "移到下方", icon: "/img/layer/icon-layer-down-to.svg", onClick: () => { state.lineMoveMode = { sourceId: lineTarget.id, mode: "below" }; } },
      { label: "移到上方", icon: "/img/layer/icon-layer-up-to.svg", onClick: () => { state.lineMoveMode = { sourceId: lineTarget.id, mode: "above" }; } }
    ];
    addItem("排列", null, null, false, arrangeItems);
  }

  if (alignTargets && alignTargets.length >= 2) {
    const alignItems = [
      { label: "左对齐", icon: "/img/align/align-left-svgrepo-com.svg", onClick: () => applyAlignment(renderer, onStateChanged, "align-left", alignTargets) },
      { label: "右对齐", icon: "/img/align/align-right-svgrepo-com.svg", onClick: () => applyAlignment(renderer, onStateChanged, "align-right", alignTargets) },
      { label: "顶部对齐", icon: "/img/align/align-top-svgrepo-com.svg", onClick: () => applyAlignment(renderer, onStateChanged, "align-top", alignTargets) },
      { label: "底部对齐", icon: "/img/align/align-bottom-svgrepo-com.svg", onClick: () => applyAlignment(renderer, onStateChanged, "align-bottom", alignTargets) },
      { label: "水平等距", icon: "/img/align/align-horizonta-spacing-svgrepo-com.svg", onClick: () => applyAlignment(renderer, onStateChanged, "distribute-x", alignTargets) },
      { label: "垂直等距", icon: "/img/align/align-vertical-spacing-svgrepo-com.svg", onClick: () => applyAlignment(renderer, onStateChanged, "distribute-y", alignTargets) }
    ];
    addItem("对齐", null, null, false, alignItems);
  }
}

function buildContext(state, targetEntity) {
  const selected = Array.isArray(state.selectedEntities) ? state.selectedEntities : [];
  const selectionType = getSelectionType(selected);
  const hasSelection = selected.length > 0;
  const hasEntity = Boolean(targetEntity);
  const isLineSelection = selectionType === "line";

  const lineTarget = isLineSelection
    ? (selected.find((item) => item.type === "line") || null)
    : null;

  const alignTargets = selected
    .filter((item) => item.type === "station" || item.type === "shape")
    .map((item) => ({
      type: item.type,
      item: item.type === "station"
        ? state.nodes.find((node) => node.id === item.id)
        : state.shapes.find((shape) => shape.id === item.id)
    }))
    .filter((entry) => entry.item);

  const types = new Set(selected.map((item) => item.type));
  const alignAllowed = alignTargets.length >= 2
    && Array.from(types).every((t) => t === "station" || t === "shape");

  return {
    selectionType,
    hasSelection,
    hasEntity,
    isLineSelection,
    alignTargets: alignAllowed ? alignTargets : [],
    lineTarget
  };
}

function onContextMenu(event, opts) {
  const { state, selectEntity, holder } = opts;
  if (state.appSettings?.enableContextMenu === false) {
    return;
  }
  event.preventDefault();
  ensureMenu(holder);

  const targetEntity = getEntityFromTarget(event.target);
  if (targetEntity && !isEntitySelected(state, targetEntity)) {
    selectEntity?.(targetEntity);
  }

  const context = buildContext(state, targetEntity);
  renderMenu(opts, context);
  openMenuAt(holder, event.clientX, event.clientY);
}

function bindContextMenu(svg, opts) {
  if (!svg) return;
  const { holder } = opts;
  svg.addEventListener("contextmenu", (e) => onContextMenu(e, opts));
  window.addEventListener("click", (event) => {
    if (!holder.menuEl) return;
    if (holder.menuEl.contains(event.target) || holder.submenuEl?.contains(event.target)) {
      return;
    }
    hideMenu(holder);
  });
  window.addEventListener("resize", () => hideMenu(holder));
  window.addEventListener("scroll", () => hideMenu(holder), true);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideMenu(holder);
    }
  });
}

export function createContextMenu({
  state,
  elements,
  renderer,
  rerenderScene,
  copySelection,
  cutSelection,
  pasteSelection,
  deleteSelectedEntity,
  moveLineInStack,
  onStateChanged,
  selectEntity,
  hasClipboard
}) {
  const { svg } = elements;
  const holder = {
    menuEl: null,
    quickEl: null,
    listEl: null,
    submenuEl: null,
    openSubmenuAnchor: null,
    feedbackTimers: new WeakMap()
  };

  const opts = {
    state,
    holder,
    renderer,
    rerenderScene,
    copySelection,
    cutSelection,
    pasteSelection,
    deleteSelectedEntity,
    moveLineInStack,
    onStateChanged,
    selectEntity,
    hasClipboard
  };

  const bind = () => bindContextMenu(svg, opts);
  const hide = () => hideMenu(holder);

  return { bind, hide };
}
