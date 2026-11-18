import { STATION_STORAGE_KEYS } from '../../shared/storage-keys.js';
import { defaultProject, migrateProject } from './project.js';
import changshouExample from '../examples/长寿路站-7号线-13号线-全6A.json' with { type: 'json' };

export const WORKSPACE_KEY = STATION_STORAGE_KEYS.workspace;
export const LEGACY_KEY = STATION_STORAGE_KEYS.legacyProject;
export const RECOVERY_KEY = STATION_STORAGE_KEYS.recovery;
const copy = value => structuredClone(value);
const timestamp = () => new Date().toISOString();
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const titleOf = value => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) throw new Error('方案名称需为 1–100 个字符');
  return value.trim();
};

export function blankProject(name = '未命名车站') {
  const project = defaultProject();
  project.name = titleOf(name);project.english = '';project.entities = [];
  project.zones = Object.fromEntries(project.floors.map(floor => [floor.id, {}]));
  project.zonePaths = [];project.updatedAt = null;
  return project;
}

export function projectFilename(title) {
  return `${titleOf(title).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/[. ]+$/, '') || '车站方案'}.json`;
}

// Each change is written as one snapshot before replacing the in-memory workspace.
export class ProjectFiles {
  constructor(storage) {
    this.storage = storage;this.warning = '';this.recoveryRaw = null;this.persisted = false;
    let raw;this.persistedRaw = null;
    try {
      raw = storage.getItem(WORKSPACE_KEY);
      this.persistedRaw = raw;
      if (raw) {
        const workspace = JSON.parse(raw);
        if (workspace.version !== 1 || !Array.isArray(workspace.files) || !workspace.files.length) throw new Error();
        const ids = new Set();
        for (const file of workspace.files) {
          if (!file || typeof file.id !== 'string' || !/^[\w-]{1,80}$/.test(file.id) || ids.has(file.id) ||
            !validDate(file.createdAt) || !validDate(file.updatedAt) || (file.deletedAt !== undefined && !validDate(file.deletedAt))) throw new Error();
          ids.add(file.id);file.title = titleOf(file.title);file.project = migrateProject(file.project);
        }
        if (!workspace.files.some(file => !file.deletedAt)) throw new Error();
        if (!workspace.files.some(file => file.id === workspace.activeId && !file.deletedAt)) workspace.activeId = workspace.files.find(file => !file.deletedAt).id;
        this.workspace = workspace;this.persisted = true;return;
      }
    } catch {
      this.recoveryRaw = raw || null;
      this.warning = '方案库读取失败，已保留原数据并尝试恢复上次方案';
    }
    let project;
    try { project = migrateProject(JSON.parse(storage.getItem(LEGACY_KEY))); } catch { project = migrateProject(changshouExample); }
    const file = this.makeFile(project.name || '车站设计方案', project);
    this.workspace = { version: 1, activeId: file.id, files: [file] };
  }

  makeFile(title, project) {
    const now = timestamp();
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return { id: `project-${id}`, title: titleOf(title), createdAt: now, updatedAt: now, project: migrateProject(project) };
  }

  get current() { return copy(this.workspace.files.find(file => file.id === this.workspace.activeId && !file.deletedAt)); }
  list(trash = false) {
    return copy(this.workspace.files.filter(file => !!file.deletedAt === trash)
      .sort((a, b) => (b.deletedAt || b.updatedAt).localeCompare(a.deletedAt || a.updatedAt)));
  }
  find(id, trash = false) {
    const file = this.workspace.files.find(file => file.id === id && !!file.deletedAt === trash);
    if (!file) throw new Error('找不到该方案');return copy(file);
  }
  uniqueTitle(title, files = this.workspace.files) {
    const base = titleOf(title), exists = name => files.some(file => !file.deletedAt && file.title === name);
    let name = base, n = 2;
    while (exists(name)) { const suffix = ` (${n++})`;name = base.slice(0, 100 - suffix.length) + suffix; }
    return name;
  }
  change(action) {
    const next = copy(this.workspace), result = action(next);
    if(this.storage.getItem(WORKSPACE_KEY)!==this.persistedRaw)throw new Error('方案库已在其他窗口更新，请下载当前方案后刷新');
    try {
      if (this.recoveryRaw) this.storage.setItem(RECOVERY_KEY, this.recoveryRaw);
      const raw = JSON.stringify(next);this.storage.setItem(WORKSPACE_KEY, raw);this.persistedRaw = raw;
    } catch { throw new Error('无法保存到浏览器，请下载 JSON 备份后重试'); }
    this.recoveryRaw = null;this.workspace = next;this.persisted = true;return result;
  }
  save(project) {
    const saved = migrateProject(project), now = timestamp();saved.updatedAt = now;
    this.change(next => { const file = next.files.find(file => file.id === next.activeId);file.project = saved;file.updatedAt = now; });
    return copy(saved);
  }
  create(title, project) {
    const file = this.makeFile(this.uniqueTitle(title), project);
    this.change(next => { next.files.push(file);next.activeId = file.id; });return this.current;
  }
  open(id) {
    this.find(id);this.change(next => { next.activeId = id; });return this.current;
  }
  rename(id, title) {
    this.find(id);title = titleOf(title);
    if (this.workspace.files.some(file => file.id !== id && !file.deletedAt && file.title === title)) throw new Error('已有同名方案，请换一个名称');
    this.change(next => { const file = next.files.find(file => file.id === id);file.title = title;file.updatedAt = timestamp(); });
  }
  duplicate(id, title) { return this.create(title, this.find(id).project); }
  trash(id) {
    this.find(id);
    if (this.list().length === 1) throw new Error('请至少保留一个方案，可以先新建再移入回收站');
    this.change(next => {
      next.files.find(file => file.id === id).deletedAt = timestamp();
      if (next.activeId === id) next.activeId = next.files.filter(file => !file.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0].id;
    });return this.current;
  }
  restore(id) {
    const file = this.find(id, true), title = this.uniqueTitle(file.title);
    this.change(next => { const restored = next.files.find(file => file.id === id);delete restored.deletedAt;restored.title = title; });
  }
}
