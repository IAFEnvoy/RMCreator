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
function ensureMenu(holder, opts) {
  if (holder.menuEl && holder.menuEl.isConnected) return;
  try {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = getTemplate("context-menu");
    holder.menuEl = wrapper.querySelector("#contextMenu");
  } catch (e) {
    holder.menuEl = null;
  }
  if (!holder.menuEl) {
    return;
  }

  document.body.appendChild(holder.menuEl);
  holder.quickEl = holder.menuEl.querySelector("#contextMenuQuick");
  holder.listEl = holder.menuEl.querySelector("#contextMenuList");

  holder.menuEl.addEventListener("contextmenu", (event) => event.preventDefault());
  holder.menuEl.addEventListener("mouseleave", () => hideSubmenu(holder));

  collectMenuElements(holder);
  bindMenuHandlers(holder, opts);
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
  if (!holder.submenus) return;
  Object.values(holder.submenus).forEach((submenu) => {
    setHidden(submenu, true);
  });
  holder.openSubmenuAnchor = null;
}

function hideMenu(holder) {
  if (holder.menuEl) {
    holder.menuEl.hidden = true;
  }
  hideSubmenu(holder);
}

function setHidden(el, hidden) {
  if (!el) return;
  el.hidden = hidden;
  el.classList.toggle("is-hidden", hidden);
}

function setDisabled(el, disabled) {
  if (!el) return;
  el.classList.toggle("is-disabled", disabled);
  el.setAttribute("aria-disabled", disabled ? "true" : "false");
  if ("disabled" in el) {
    el.disabled = Boolean(disabled);
  }
}

function isDisabled(el) {
  if (!el) return true;
  return el.classList.contains("is-disabled") || Boolean(el.disabled);
}

function collectMenuElements(holder) {
  if (!holder.menuEl) return;
  const byAction = (name) => holder.menuEl.querySelector(`[data-action="${name}"]`);

  holder.quickButtons = {
    refresh: byAction("refresh"),
    cut: byAction("cut"),
    copy: byAction("copy"),
    delete: byAction("delete")
  };

  holder.listItems = {
    paste: byAction("paste"),
    copyParams: byAction("copy-params"),
    pasteParams: byAction("paste-params"),
    arrange: byAction("arrange"),
    align: byAction("align")
  };

  holder.dividerEl = holder.menuEl.querySelector("[data-role=\"divider\"]");

  holder.submenus = {
    arrange: holder.menuEl.querySelector("#contextMenuArrange"),
    align: holder.menuEl.querySelector("#contextMenuAlign")
  };

  holder.arrangeItems = {
    front: byAction("arrange-front"),
    back: byAction("arrange-back"),
    up: byAction("arrange-up"),
    down: byAction("arrange-down"),
    below: byAction("arrange-below"),
    above: byAction("arrange-above")
  };

  holder.alignItems = {
    left: byAction("align-left"),
    right: byAction("align-right"),
    top: byAction("align-top"),
    bottom: byAction("align-bottom"),
    spaceX: byAction("align-space-x"),
    spaceY: byAction("align-space-y")
  };
}

function bindMenuHandlers(holder, opts) {
  if (holder.bound || !holder.menuEl) return;
  holder.bound = true;

  const { state, renderer, rerenderScene, copySelection, cutSelection, pasteSelection, deleteSelectedEntity, moveLineInStack, onStateChanged } = opts;

  const handleQuick = (action, button) => {
    if (isDisabled(button)) return;
    const context = holder.context;

    if (action === "refresh") {
      rerenderScene();
      renderer.renderSettings();
      hideMenu(holder);
      return;
    }

    if (action === "cut") {
      cutSelection?.();
      hideMenu(holder);
      return;
    }

    if (action === "copy") {
      if (copySelection?.()) {
        flashItemText(state, holder.feedbackTimers, button, "复制成功");
      }
      hideMenu(holder);
      return;
    }

    if (action === "delete") {
      if (context?.hasSelection) {
        deleteSelectedEntity?.();
      }
      hideMenu(holder);
    }
  };

  const handleList = (action, button) => {
    if (isDisabled(button)) return;
    if (action === "paste") {
      if (pasteSelection?.()) {
        flashItemText(state, holder.feedbackTimers, button, "粘贴成功");
      }
      hideMenu(holder);
      return;
    }

    if (action === "copy-params") {
      if (state.paramClipboardActions?.copy?.()) {
        flashItemText(state, holder.feedbackTimers, button, "复制成功");
      }
      hideMenu(holder);
      return;
    }

    if (action === "paste-params") {
      if (state.paramClipboardActions?.paste?.()) {
        flashItemText(state, holder.feedbackTimers, button, "粘贴成功");
      }
      hideMenu(holder);
    }
  };

  const handleArrange = (mode) => {
    const context = holder.context;
    const target = context?.lineTarget;
    if (!target) return;
    if (mode === "below" || mode === "above") {
      state.lineMoveMode = { sourceId: target.id, mode };
    } else {
      moveLineInStack?.({ sourceId: target.id, mode });
    }
    hideMenu(holder);
  };

  const handleAlign = (action) => {
    const context = holder.context;
    const targets = context?.alignTargets || [];
    if (!targets.length) return;
    applyAlignment(renderer, onStateChanged, action, targets);
    hideMenu(holder);
  };

  const quick = holder.quickButtons || {};
  quick.refresh?.addEventListener("click", () => handleQuick("refresh", quick.refresh));
  quick.cut?.addEventListener("click", () => handleQuick("cut", quick.cut));
  quick.copy?.addEventListener("click", () => handleQuick("copy", quick.copy));
  quick.delete?.addEventListener("click", () => handleQuick("delete", quick.delete));

  const list = holder.listItems || {};
  list.paste?.addEventListener("click", () => handleList("paste", list.paste));
  list.copyParams?.addEventListener("click", () => handleList("copy-params", list.copyParams));
  list.pasteParams?.addEventListener("click", () => handleList("paste-params", list.pasteParams));

  const showArrange = () => {
    if (!list.arrange || isDisabled(list.arrange) || list.arrange.hidden) return;
    showSubmenu(holder, holder.submenus?.arrange, list.arrange);
  };
  list.arrange?.addEventListener("mouseenter", showArrange);
  list.arrange?.addEventListener("click", (event) => {
    event.preventDefault();
    showArrange();
  });

  const showAlign = () => {
    if (!list.align || isDisabled(list.align) || list.align.hidden) return;
    showSubmenu(holder, holder.submenus?.align, list.align);
  };
  list.align?.addEventListener("mouseenter", showAlign);
  list.align?.addEventListener("click", (event) => {
    event.preventDefault();
    showAlign();
  });

  const arrange = holder.arrangeItems || {};
  arrange.front?.addEventListener("click", () => handleArrange("to-front"));
  arrange.back?.addEventListener("click", () => handleArrange("to-back"));
  arrange.up?.addEventListener("click", () => handleArrange("up"));
  arrange.down?.addEventListener("click", () => handleArrange("down"));
  arrange.below?.addEventListener("click", () => handleArrange("below"));
  arrange.above?.addEventListener("click", () => handleArrange("above"));

  const align = holder.alignItems || {};
  align.left?.addEventListener("click", () => handleAlign("align-left"));
  align.right?.addEventListener("click", () => handleAlign("align-right"));
  align.top?.addEventListener("click", () => handleAlign("align-top"));
  align.bottom?.addEventListener("click", () => handleAlign("align-bottom"));
  align.spaceX?.addEventListener("click", () => handleAlign("distribute-x"));
  align.spaceY?.addEventListener("click", () => handleAlign("distribute-y"));
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

function showSubmenu(holder, submenuEl, anchor) {
  if (!submenuEl || !anchor) return;
  hideSubmenu(holder);

  const rect = anchor.getBoundingClientRect();
  setHidden(submenuEl, false);
  const left = rect.right + 6;
  const top = rect.top;
  submenuEl.style.left = `${left}px`;
  submenuEl.style.top = `${top}px`;

  const subRect = submenuEl.getBoundingClientRect();
  if (subRect.right > window.innerWidth - 8) {
    submenuEl.style.left = `${rect.left - subRect.width - 6}px`;
  }
  if (subRect.bottom > window.innerHeight - 8) {
    submenuEl.style.top = `${window.innerHeight - subRect.height - 8}px`;
  }
}

function renderMenu(opts, context) {
  const { state, holder, hasClipboard } = opts;

  if (!holder.quickEl || !holder.listEl) return;
  holder.context = context;
  hideSubmenu(holder);

  const { selectionType, hasSelection, hasEntity, isLineSelection, alignTargets, lineTarget } = context;
  const canCopy = hasSelection && !isLineSelection;
  const canCut = canCopy;
  const showFullQuick = hasEntity && !isLineSelection;

  holder.quickEl.classList.toggle("compact", !showFullQuick);

  setHidden(holder.quickButtons?.cut, !showFullQuick);
  setHidden(holder.quickButtons?.copy, !showFullQuick);

  setDisabled(holder.quickButtons?.cut, !canCut);
  setDisabled(holder.quickButtons?.copy, !canCopy);
  setDisabled(holder.quickButtons?.delete, !hasSelection);

  const clipboardAvailable = Boolean(hasClipboard?.());
  const paramClipboard = state.paramClipboard;
  const canCopyParams = hasSelection && Array.isArray(state.selectedEntities) && state.selectedEntities.length === 1;
  const canPasteParams = Boolean(paramClipboard)
    && Boolean(selectionType)
    && paramClipboard.type === selectionType;

  setDisabled(holder.listItems?.paste, !clipboardAvailable);
  setDisabled(holder.listItems?.copyParams, !canCopyParams);
  setDisabled(holder.listItems?.pasteParams, !canPasteParams);

  const showArrange = Boolean(isLineSelection && lineTarget);
  const showAlign = Boolean(alignTargets && alignTargets.length >= 2);

  setHidden(holder.listItems?.arrange, !showArrange);
  setHidden(holder.listItems?.align, !showAlign);
  setHidden(holder.dividerEl, !(showArrange || showAlign));

  if (!showArrange) {
    setHidden(holder.submenus?.arrange, true);
  }
  if (!showAlign) {
    setHidden(holder.submenus?.align, true);
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
  ensureMenu(holder, opts);
  if (!holder.menuEl) {
    return;
  }

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
    const inSubmenu = holder.submenus
      ? Object.values(holder.submenus).some((submenu) => submenu?.contains(event.target))
      : false;
    if (holder.menuEl.contains(event.target) || inSubmenu) {
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
