import { activeDrawingIdStorageKey, drawingsListStorageKey, drawingStorageKey } from "./constants.js";
import { getTemplate } from "./template-store.js";

export function createDrawingManager({ state, elements, parseDrawingJson: parseFn, safeSerializeSnapshot, applyDrawingData, confirmOverwrite }) {
  const mount = elements.drawingManagerModal;
  let injected = false;
  const exportType = "drawing";

  if (!state.drawingManager) {
    state.drawingManager = { selectedId: null, checkedIds: [], isOpen: false, activeId: null };
  }

  function el(selector) {
    if (!mount) return null;
    return mount.querySelector(selector);
  }

  function loadSavedList() {
    const raw = localStorage.getItem(drawingsListStorageKey);
    if (!raw) {
      // try migrate from legacy single-drawing key
      const legacy = localStorage.getItem(drawingStorageKey);
      if (!legacy) {
        return [];
      }

      try {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed)) {
          const normalized = parsed.map((it) => normalizeSavedEntry(it)).filter(Boolean);
          persistSavedList(normalized);
          return normalized;
        }

        // single drawing object -> wrap
        const snapshot = typeof legacy === "string" ? legacy : JSON.stringify(parsed);
        const saved = createSavedFromSnapshot(snapshot, "本地绘图");
        const arr = [saved];
        persistSavedList(arr);
        return arr;
      } catch {
        return [];
      }
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        const saved = createSavedFromSnapshot(JSON.stringify(parsed), "本地绘图");
        const arr = [saved];
        persistSavedList(arr);
        return arr;
      }
      return parsed.map((it) => normalizeSavedEntry(it)).filter(Boolean);
    } catch {
      localStorage.removeItem(drawingsListStorageKey);
      return [];
    }
  }

  function persistSavedList(list) {
    try {
      localStorage.setItem(drawingsListStorageKey, JSON.stringify(list));
    } catch {
      // ignore
    }
  }

  function normalizeSavedEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    if (entry.id && entry.snapshot) {
      return {
        id: String(entry.id),
        name: String(entry.name || "无名绘图"),
        author: String(entry.author || ""),
        snapshot: String(entry.snapshot),
        createdAt: entry.createdAt || entry.modifiedAt || new Date().toISOString(),
        modifiedAt: entry.modifiedAt || entry.createdAt || new Date().toISOString(),
        counts: entry.counts || computeCountsFromSnapshot(entry.snapshot)
      };
    }

    // if raw drawing object
    try {
      const snapshot = JSON.stringify(entry);
      return createSavedFromSnapshot(snapshot, entry.name || "本地绘图");
    } catch {
      return null;
    }
  }

  function computeCountsFromSnapshot(snapshot) {
    try {
      const obj = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
      return {
        nodes: Array.isArray(obj.nodes) ? obj.nodes.length : 0,
        edges: Array.isArray(obj.edges) ? obj.edges.length : 0,
        labels: Array.isArray(obj.labels) ? obj.labels.length : 0,
        shapes: Array.isArray(obj.shapes) ? obj.shapes.length : 0
      };
    } catch {
      return { nodes: 0, edges: 0, labels: 0, shapes: 0 };
    }
  }

  function createSavedFromSnapshot(snapshot, name) {
    const id = `drawing-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    let counts = { nodes: 0, edges: 0, labels: 0, shapes: 0 };
    try {
      const parsed = parseFn(typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot));
      counts = computeCountsFromSnapshot(JSON.stringify(parsed));
      snapshot = JSON.stringify(parsed);
    } catch {
      // keep original snapshot string if parse failed
    }

    const now = new Date().toISOString();
    return {
      id,
      name: String(name || `绘图 ${now}`),
      author: "",
      snapshot: String(snapshot),
      createdAt: now,
      modifiedAt: now,
      counts
    };
  }

  function createEmptySnapshot() {
    return JSON.stringify({
      version: 1,
      counter: 1,
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
      nodes: [],
      edges: [],
      labels: [],
      shapes: [],
      customLineTypes: []
    });
  }

  function buildExportTimestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  function getSavedList() {
    return loadSavedList();
  }

  function resolveActiveId(list) {
    const activeId = state.drawingManager.activeId;
    if (!activeId) return null;
    return list.some((item) => String(item.id) === String(activeId)) ? String(activeId) : null;
  }

  function persistActiveDrawingId(id) {
    if (id) {
      localStorage.setItem(activeDrawingIdStorageKey, String(id));
    } else {
      localStorage.removeItem(activeDrawingIdStorageKey);
    }
  }

  function findSavedById(id) {
    const list = getSavedList();
    return list.find((item) => String(item.id) === String(id)) || null;
  }

  function setCheckedDrawingIds(ids) {
    const list = getSavedList();
    const valid = new Set(list.map((i) => String(i.id)));
    const next = [];
    const seen = new Set();
    (Array.isArray(ids) ? ids : []).forEach((id) => {
      const key = String(id || "");
      if (!key || !valid.has(key) || seen.has(key)) return;
      seen.add(key);
      next.push(key);
    });
    state.drawingManager.checkedIds = next;
  }

  function getCheckedDrawingIds() {
    return Array.isArray(state.drawingManager.checkedIds) ? state.drawingManager.checkedIds.map(String) : [];
  }

  function syncBulkActionState() {
    const list = getSavedList();
    const checked = getCheckedDrawingIds();
    const checkedCount = checked.length;
    const activeId = resolveActiveId(list);
    const selectAllEl = el('#drawingSelectAllInput');
    if (selectAllEl) {
      selectAllEl.checked = list.length > 0 && checkedCount === list.length;
      selectAllEl.indeterminate = checkedCount > 0 && checkedCount < list.length;
    }

    const selected = findSavedById(state.drawingManager.selectedId);
    const selectedDeletable = selected && (!activeId || String(selected.id) !== activeId);
    const checkedHasActive = activeId && checked.some((id) => String(id) === String(activeId));
    const deletableCheckedCount = checkedHasActive ? checkedCount - 1 : checkedCount;

    const loadBtn = el('#loadDrawingBtn');
    if (loadBtn) loadBtn.disabled = !selected;

    const exportBtn = el('#exportDrawingBtn');
    if (exportBtn) exportBtn.disabled = !(checkedCount > 0 || selected);
    const deleteBtn = el('#deleteDrawingBtn');
    if (deleteBtn) {
      deleteBtn.disabled = !(deletableCheckedCount > 0 || selectedDeletable);
      if (!selectedDeletable && deletableCheckedCount === 0) {
        deleteBtn.title = activeId && (checkedHasActive || selected)
          ? "当前打开的绘图不可删除"
          : "请选择要删除的绘图";
      } else if (checkedHasActive) {
        deleteBtn.title = "当前打开的绘图不会被删除";
      } else {
        deleteBtn.title = "";
      }
    }
  }

  function updateDrawingListTitle(id, nextName) {
    if (!id) return;
    const raw = String(id);
    const safeId = (window.CSS && typeof window.CSS.escape === "function") ? window.CSS.escape(raw) : raw.replace(/"/g, "");
    const titleEl = el(`.line-library-item[data-drawing-id="${safeId}"] .line-library-item-title`);
    if (titleEl) titleEl.textContent = nextName || "无名绘图";
  }

  function updateModifiedCard(value) {
    const modifiedEl = el('#drawingMetaModified');
    if (modifiedEl) modifiedEl.textContent = value ? new Date(value).toLocaleString() : "";
  }

  function updateSavedMeta(id, patch) {
    const list = getSavedList();
    const idx = list.findIndex((item) => String(item.id) === String(id));
    if (idx < 0) return null;
    const now = new Date().toISOString();
    const next = {
      ...list[idx],
      ...patch,
      modifiedAt: now
    };
    list[idx] = next;
    persistSavedList(list);
    return next;
  }

  function renderMetadataFor(id) {
    const saved = findSavedById(id);
    if (!saved) {
      const nameInput = el('#drawingMetaNameInput'); if (nameInput) nameInput.value = "";
      const authorInput = el('#drawingMetaAuthorInput'); if (authorInput) authorInput.value = "";
      const nodesEl = el('#drawingMetaNodes'); if (nodesEl) nodesEl.textContent = "";
      const edgesEl = el('#drawingMetaEdges'); if (edgesEl) edgesEl.textContent = "";
      const labelsEl = el('#drawingMetaLabels'); if (labelsEl) labelsEl.textContent = "";
      const shapesEl = el('#drawingMetaShapes'); if (shapesEl) shapesEl.textContent = "";
      const modifiedEl = el('#drawingMetaModified'); if (modifiedEl) modifiedEl.textContent = "";
      return;
    }
    const nameInput = el('#drawingMetaNameInput'); if (nameInput) nameInput.value = saved.name || "";
    const authorInput = el('#drawingMetaAuthorInput'); if (authorInput) authorInput.value = saved.author || "";
    const nodesEl = el('#drawingMetaNodes'); if (nodesEl) nodesEl.textContent = String(saved.counts.nodes || 0);
    const edgesEl = el('#drawingMetaEdges'); if (edgesEl) edgesEl.textContent = String(saved.counts.edges || 0);
    const labelsEl = el('#drawingMetaLabels'); if (labelsEl) labelsEl.textContent = String(saved.counts.labels || 0);
    const shapesEl = el('#drawingMetaShapes'); if (shapesEl) shapesEl.textContent = String(saved.counts.shapes || 0);
    const modifiedEl = el('#drawingMetaModified'); if (modifiedEl) modifiedEl.textContent = saved.modifiedAt ? new Date(saved.modifiedAt).toLocaleString() : "";
  }

  function renderDrawingLibraryList() {
    const list = getSavedList();
    const activeId = resolveActiveId(list);
    const libEl = el('#drawingLibraryList');
    if (!libEl) return;
    libEl.innerHTML = "";
    setCheckedDrawingIds(getCheckedDrawingIds());
    const checkedSet = new Set(getCheckedDrawingIds());

    list.forEach((item) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "line-library-item";
      el.classList.toggle("active", String(item.id) === String(state.drawingManager.selectedId));
      el.classList.toggle("opened", activeId && String(item.id) === activeId);
      el.dataset.drawingId = String(item.id);

      const row = document.createElement("div");
      row.className = "line-library-item-row";

      const lead = document.createElement("div");
      lead.className = "line-library-item-lead";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "library-item-checkbox";
      const isActive = activeId && String(item.id) === activeId;
      checkbox.checked = checkedSet.has(String(item.id));
      if (isActive) {
        const tip = "当前打开的绘图不可删除";
        el.title = tip;
        checkbox.title = tip;
      }
      checkbox.addEventListener("click", (ev) => ev.stopPropagation());
      checkbox.addEventListener("change", (ev) => {
        ev.stopPropagation();
        const next = new Set(getCheckedDrawingIds());
        if (checkbox.checked) next.add(String(item.id)); else next.delete(String(item.id));
        setCheckedDrawingIds(Array.from(next));
        renderDrawingLibraryList();
        syncBulkActionState();
      });

      const title = document.createElement("div");
      title.className = "line-library-item-title";
      title.textContent = item.name || "无名绘图";

      const meta = document.createElement("div");
      meta.className = "line-library-item-meta";
      meta.textContent = `${item.counts.nodes || 0} 车站 · ${item.counts.edges || 0} 线段`;

      lead.appendChild(checkbox);
      lead.appendChild(title);
      row.appendChild(lead);
      row.appendChild(meta);
      el.appendChild(row);

      el.addEventListener("click", () => {
        state.drawingManager.selectedId = item.id;
        // keep current checked set
        renderDrawingLibraryList();
        renderMetadataFor(item.id);
        syncBulkActionState();
      });

      libEl.appendChild(el);
    });

    // ensure metadata reflects selection
    renderMetadataFor(state.drawingManager.selectedId);
  }

  function addSavedDrawing(snapshot, name) {
    const list = getSavedList();
    const saved = createSavedFromSnapshot(snapshot, name);
    list.unshift(saved);
    persistSavedList(list);
    state.drawingManager.selectedId = saved.id;
    setCheckedDrawingIds([]);
    renderDrawingLibraryList();
    syncBulkActionState();
  }

  function removeSaved(ids) {
    const activeId = resolveActiveId(getSavedList());
    if (activeId && ids.includes(activeId)) {
      state.drawingManager.activeId = null;
    }
    const list = getSavedList().filter((item) => !ids.includes(String(item.id)));
    persistSavedList(list);
    if (ids.includes(String(state.drawingManager.selectedId))) {
      state.drawingManager.selectedId = list.length ? list[0].id : null;
    }
    setCheckedDrawingIds([]);
    renderDrawingLibraryList();
    syncBulkActionState();
  }

  function exportSaved(ids) {
    const list = getSavedList();
    const targets = list.filter((i) => ids.includes(String(i.id)));
    if (!targets.length) return;
    try {
      const exportArray = targets.map((t) => {
        let snapshotObj;
        try {
          snapshotObj = parseFn ? parseFn(t.snapshot) : JSON.parse(t.snapshot);
        } catch {
          snapshotObj = t.snapshot;
        }
        return {
          name: t.name || "",
          author: t.author || "",
          snapshot: snapshotObj,
          counts: t.counts || {},
          createdAt: t.createdAt,
          modifiedAt: t.modifiedAt
        };
      });
      const payload = {
        type: exportType,
        data: exportArray
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `RMC_Drawing_${buildExportTimestamp()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }

  function openImportSelection(items, fileName) {
    if (!Array.isArray(items) || !items.length) {
      window.alert("导入失败：文件中没有可导入的绘图。");
      return;
    }

    const modalId = 'drawingImportSelectModal';
    const modal = (mount && mount.querySelector(`#${modalId}`)) || document.getElementById(modalId);
    const listEl = modal ? modal.querySelector('#drawingImportSelectList') : null;
    const confirmBtn = modal ? modal.querySelector('#confirmDrawingImportSelectBtn') : null;
    const cancelBtn = modal ? modal.querySelector('#cancelDrawingImportSelectBtn') : null;
    const selectAllCheckbox = modal ? modal.querySelector('#drawingImportSelectAll') : null;
    const closeBtn2 = modal ? modal.querySelector('#closeDrawingImportSelectBtn') : null;

    if (!modal || !listEl || !confirmBtn || !cancelBtn) {
      // fallback: import all items
      try {
        items.forEach((entry, idx) => {
          const snapshot = entry && entry.snapshot !== undefined ? entry.snapshot : entry;
          const name = entry && entry.name ? entry.name : `${String(fileName || '').replace(/\.[^/.]+$/, '')} ${idx + 1}`;
          addSavedDrawing(snapshot, name);
        });
        renderDrawingLibraryList();
        syncBulkActionState();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`导入失败：${msg}`);
      }
      return;
    }

    listEl.innerHTML = '';
    items.forEach((entry, idx) => {
      const row = document.createElement('div');
      row.className = 'drawing-import-item';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'drawing-import-item-checkbox';
      checkbox.dataset.index = String(idx);
      checkbox.checked = true;

      const baseName = String(fileName || '').replace(/\.[^/.]+$/, '');
      const previewName = (entry && typeof entry === 'object' && entry.name) ? entry.name : `${baseName} ${idx + 1}`;
      const counts = computeCountsFromSnapshot(entry && entry.snapshot !== undefined ? entry.snapshot : entry);
      const meta = `${counts.nodes || 0} 车站 · ${counts.edges || 0} 线段`;

      const label = document.createElement('label');
      label.appendChild(checkbox);
      const span = document.createElement('span');
      span.textContent = `${previewName} — ${meta}`;
      label.appendChild(span);
      row.appendChild(label);
      listEl.appendChild(row);
    });

    function getSelectedIndexes() {
      const boxes = listEl.querySelectorAll('.drawing-import-item-checkbox');
      const res = [];
      boxes.forEach((b) => { if (b.checked) res.push(Number(b.dataset.index)); });
      return res;
    }

    function cleanupHandlers() {
      confirmBtn.removeEventListener('click', confirmHandler);
      cancelBtn.removeEventListener('click', cancelHandler);
      if (selectAllCheckbox) selectAllCheckbox.removeEventListener('change', selectAllHandler);
      if (closeBtn2) closeBtn2.removeEventListener('click', cancelHandler);
    }

    function confirmHandler() {
      const idxs = getSelectedIndexes();
      if (!idxs.length) {
        window.alert('请先选择要导入的绘图。');
        return;
      }
      try {
        const baseName = String(fileName || '').replace(/\.[^/.]+$/, '');
        idxs.forEach((i) => {
          const entry = items[i];
          const snapshot = entry && entry.snapshot !== undefined ? entry.snapshot : entry;
          const name = entry && entry.name ? entry.name : `${baseName} ${i + 1}`;
          addSavedDrawing(snapshot, name);
        });
        renderDrawingLibraryList();
        syncBulkActionState();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`导入失败：${msg}`);
      } finally {
        cleanupHandlers();
        modal.hidden = true;
      }
    }

    function cancelHandler() {
      cleanupHandlers();
      modal.hidden = true;
    }

    function selectAllHandler() {
      const boxes = listEl.querySelectorAll('.drawing-import-item-checkbox');
      boxes.forEach((b) => { b.checked = selectAllCheckbox.checked; });
    }

    if (selectAllCheckbox) {
      selectAllCheckbox.checked = true;
      selectAllCheckbox.addEventListener('change', selectAllHandler);
    }
    confirmBtn.addEventListener('click', confirmHandler);
    cancelBtn.addEventListener('click', cancelHandler);
    if (closeBtn2) closeBtn2.addEventListener('click', cancelHandler);
    modal.hidden = false;
  }

  function open() {
    state.drawingManager.isOpen = true;
    if (!mount) return;
    ensureInjected();
    mount.hidden = false;

    const list = getSavedList();
    if (state.drawingManager.activeId && !resolveActiveId(list)) {
      state.drawingManager.activeId = null;
      persistActiveDrawingId(null);
    }
    if ((!state.drawingManager.selectedId || !findSavedById(state.drawingManager.selectedId)) && list.length) {
      state.drawingManager.selectedId = list[0].id;
    }

    renderDrawingLibraryList();
    syncBulkActionState();
  }

  function close() {
    state.drawingManager.isOpen = false;
    if (mount) mount.hidden = true;
  }

  function attachInjectedHandlers() {
    if (!mount) return;
    const closeBtn = el('#closeDrawingManagerBtn');
    const newBtn = el('#newDrawingBtn');
    const loadBtn = el('#loadDrawingBtn');
    const exportBtn = el('#exportDrawingBtn');
    const importBtn = el('#importDrawingBtn');
    const deleteBtn = el('#deleteDrawingBtn');
    const importInput = el('#drawingImportInput');
    const selectAll = el('#drawingSelectAllInput');
    const nameInput = el('#drawingMetaNameInput');
    const authorInput = el('#drawingMetaAuthorInput');

    if (closeBtn) closeBtn.addEventListener('click', close);

    function handleNewClick() {
      const snapshot = createEmptySnapshot();
      const name = `未命名绘图 ${new Date().toLocaleString()}`;
      addSavedDrawing(snapshot, name);
      renderMetadataFor(state.drawingManager.selectedId);
      if (nameInput) {
        requestAnimationFrame(() => {
          nameInput.focus();
          nameInput.select();
        });
      }
    }

    if (newBtn) newBtn.addEventListener('click', handleNewClick);

    if (importBtn && importInput) importBtn.addEventListener('click', () => importInput.click());

    if (nameInput) nameInput.addEventListener('input', () => {
      const id = state.drawingManager.selectedId;
      if (!id) return;
      const value = String(nameInput.value || '').trim();
      const nextName = value || '无名绘图';
      const saved = updateSavedMeta(id, { name: nextName });
      updateDrawingListTitle(id, nextName);
      updateModifiedCard(saved?.modifiedAt);
    });

    if (authorInput) authorInput.addEventListener('input', () => {
      const id = state.drawingManager.selectedId;
      if (!id) return;
      const value = String(authorInput.value || '').trim();
      const saved = updateSavedMeta(id, { author: value });
      updateModifiedCard(saved?.modifiedAt);
    });

    if (loadBtn) loadBtn.addEventListener('click', () => {
      const id = state.drawingManager.selectedId;
      if (!id) {
        window.alert('请先点击列表中要加载的绘图（单击高亮），然后点击加载。');
        return;
      }
      const saved = findSavedById(id);
      if (!saved) return;
      if (!confirmOverwrite('加载绘图会覆盖当前内容，是否继续？')) return;
      try {
        state.drawingManager.activeId = id;
        persistActiveDrawingId(id);
        const drawing = parseFn ? parseFn(saved.snapshot) : JSON.parse(saved.snapshot);
        applyDrawingData(drawing, { persistSnapshot: true, markTemporaryImported: false, includePersistedPermanentCustoms: true });
        close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`加载失败：${msg}`);
      }
    });

    if (exportBtn) exportBtn.addEventListener('click', () => {
      let ids = getCheckedDrawingIds();
      if (!ids.length) {
        const selectedId = state.drawingManager.selectedId;
        if (!selectedId) {
          window.alert('请选择要导出的绘图（勾选项或选中项）');
          return;
        }
        ids = [selectedId];
      }
      exportSaved(ids);
    });

    if (deleteBtn) deleteBtn.addEventListener('click', () => {
      const activeId = resolveActiveId(getSavedList());
      let ids = getCheckedDrawingIds();
      if (!ids.length) {
        const selectedId = state.drawingManager.selectedId;
        if (!selectedId) {
          window.alert('请选择要删除的绘图（勾选项或选中项）');
          return;
        }
        if (activeId && String(selectedId) === String(activeId)) {
          window.alert('当前打开的绘图不可删除。');
          return;
        }
        ids = [selectedId];
      }
      if (activeId) {
        ids = ids.filter((id) => String(id) !== String(activeId));
      }
      if (!ids.length) {
        window.alert('当前打开的绘图不可删除。');
        return;
      }
      if (!window.confirm(`将删除 ${ids.length} 个绘图。此操作不可撤销，是否继续？`)) return;
      removeSaved(ids);
    });

    if (importInput) importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
        if (!parsed || typeof parsed !== "object") {
          window.alert("导入失败：文件格式无效。");
          return;
        }
        if (parsed.type !== exportType) {
          window.alert("导入失败：文件类型不匹配。");
          return;
        }
        const items = Array.isArray(parsed.data) ? parsed.data : [];
        if (!items.length) {
          window.alert("导入失败：文件中没有可导入的绘图。");
          return;
        }
        openImportSelection(items, file.name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`导入失败：${msg}`);
      } finally {
        importInput.value = '';
      }
    });

    if (selectAll) selectAll.addEventListener('change', () => {
      const list = getSavedList();
      if (selectAll.checked) {
        setCheckedDrawingIds(list.map((i) => i.id));
      } else {
        setCheckedDrawingIds([]);
      }
      renderDrawingLibraryList();
      syncBulkActionState();
    });
  }

  function ensureInjected() {
    if (injected || !mount) return;
    const html = getTemplate('drawing-manager');
    mount.innerHTML = html;
    injected = true;
    attachInjectedHandlers();
  }


  function bind() {
    if (!Array.isArray(state.drawingManager.checkedIds)) state.drawingManager.checkedIds = [];
    if (!state.drawingManager.activeId) state.drawingManager.activeId = null;
    if (mount) mount.hidden = true;
  }

  return {
    bind,
    open,
    close,
    getSavedList,
    openImportSelection
  };
}
