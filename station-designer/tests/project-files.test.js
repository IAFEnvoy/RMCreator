import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, isProject, migrateProject } from '../src/project.js';
import changshouExample from '../examples/长寿路站-7号线-13号线-全6A.json' with { type: 'json' };
import { ProjectFiles, blankProject, projectFilename, WORKSPACE_KEY, LEGACY_KEY, RECOVERY_KEY } from '../src/project-files.js';

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, fail: false, getItem(key) { return data.get(key) ?? null; }, setItem(key, value) { if(this.fail)throw new Error('QuotaExceededError');data.set(key, value); } };
}

test('a fresh workspace loads the complete Changshou Road JSON as an independent default project', () => {
  const files = new ProjectFiles(storage()), expected = migrateProject(changshouExample);
  assert.deepEqual(files.current.project, expected);assert.equal(files.current.title, expected.name);
  assert.ok(isProject(files.current.project));assert.equal(files.current.project.floors.length, 3);
  const edited = files.current.project;edited.entities[0].name = '修改后的对象';files.save(edited);
  assert.deepEqual(new ProjectFiles(storage()).current.project, expected);
});

test('unreadable legacy data falls back to the Changshou Road example', () => {
  const local = storage({[LEGACY_KEY]:'{invalid'}), files = new ProjectFiles(local);
  assert.deepEqual(files.current.project, migrateProject(changshouExample));
  assert.equal(local.getItem(LEGACY_KEY), '{invalid');
});

test('blank files have editable floors and lines with no example entities or painted areas', () => {
  const blank = blankProject('新车站');assert.equal(blank.name, '新车站');assert.ok(isProject(blank));
  assert.equal(blank.entities.length, 0);assert.equal(blank.zonePaths.length, 0);
  assert.equal(blank.floors.length, 2);assert.equal(blank.lines.length, 1);
  assert.ok(Object.values(blank.zones).every(cells => Object.keys(cells).length === 0));
});

test('single-file browser data migrates to a workspace without changing or removing the legacy backup', () => {
  const original = defaultProject();original.name = '原有车站';original.entities[0].arrowVisible = true;
  const raw = JSON.stringify(original),local = storage({[LEGACY_KEY]: raw}),files = new ProjectFiles(local);
  assert.deepEqual(files.current.project, original);assert.equal(files.list().length, 1);
  const saved = files.save(files.current.project),reopened = new ProjectFiles(local);
  assert.equal(local.getItem(LEGACY_KEY), raw);assert.equal(reopened.current.id, files.current.id);
  assert.deepEqual(reopened.current.project, saved);assert.equal(files.persisted, true);
});

test('new, copied, renamed and imported files remain independent through switching and reload', () => {
  const local = storage(),files = new ProjectFiles(local);files.save(files.current.project);
  const original = files.current,blank = files.create('设计', blankProject('新站'));
  assert.equal(files.current.id, blank.id);assert.deepEqual(files.find(original.id).project, original.project);
  const edited = files.current.project;edited.english = 'New Station';files.save(edited);
  const duplicate = files.duplicate(blank.id, '设计');assert.equal(duplicate.title, '设计 (2)');
  const copied = duplicate.project;copied.name = '副本站名';files.save(copied);
  assert.equal(files.find(blank.id).project.name, '新站');
  files.rename(duplicate.id, '独立方案');assert.equal(files.current.project.name, '副本站名');
  assert.throws(() => files.rename(duplicate.id, '设计'), /同名/);
  files.open(blank.id);assert.equal(files.current.project.english, 'New Station');
  assert.equal(new ProjectFiles(local).current.id, blank.id);
  const imported = files.create('导入', JSON.parse(JSON.stringify(original.project)));
  assert.equal(files.list().length, 4);assert.equal(imported.project.entities.length, original.project.entities.length);
  assert.equal(files.find(blank.id).project.entities.length, 0);
  assert.deepEqual(new ProjectFiles(local).current, imported);
});

test('trash preserves file content, moves away from the active file and restores safely through a name conflict', () => {
  const local = storage(),files = new ProjectFiles(local),original = files.current;
  const created = files.create('测试', blankProject('新站'));files.trash(created.id);
  assert.equal(files.current.id, original.id);assert.deepEqual(files.find(created.id, true).project, created.project);
  assert.throws(() => files.open(created.id), /找不到/);assert.throws(() => files.trash(original.id), /至少保留/);
  files.create('测试', blankProject('另一车站'));
  new ProjectFiles(local).restore(created.id);
  const reloaded = new ProjectFiles(local);assert.equal(reloaded.find(created.id).title, '测试 (2)');
  assert.deepEqual(reloaded.find(created.id).project, created.project);assert.equal(reloaded.list(true).length, 0);
});

test('failed storage writes cannot switch, create, rename, trash or replace the last saved contents', () => {
  const local = storage(),files = new ProjectFiles(local),first = files.current;
  files.create('第二份', blankProject());const before = structuredClone(files.workspace),persisted = local.getItem(WORKSPACE_KEY);
  local.fail = true;
  for (const action of [() => files.open(first.id), () => files.create('失败', blankProject()), () => files.rename(files.current.id, '失败'),
    () => files.trash(first.id), () => files.save({...files.current.project, name: '未保存'})]) {
    assert.throws(action, /无法保存/);assert.deepEqual(files.workspace, before);assert.equal(local.getItem(WORKSPACE_KEY), persisted);
  }
});

test('corrupt workspace data is retained in a recovery copy before a replacement is saved', () => {
  const raw = '{invalid',legacy = defaultProject();legacy.name = '恢复的车站';
  const local = storage({[WORKSPACE_KEY]: raw,[LEGACY_KEY]: JSON.stringify(legacy)}),files = new ProjectFiles(local);
  assert.match(files.warning, /保留/);assert.equal(files.current.project.name, legacy.name);
  assert.equal(local.getItem(WORKSPACE_KEY), raw);files.save(files.current.project);
  assert.equal(local.getItem(RECOVERY_KEY), raw);assert.equal(new ProjectFiles(local).current.project.name, legacy.name);
});

test('invalid files and names do not alter the workspace; download filenames are safe', () => {
  const local = storage(),files = new ProjectFiles(local),before = structuredClone(files.workspace);
  for (const title of ['', '   ', '字'.repeat(101)]) assert.throws(() => files.create(title, blankProject()), /方案名称/);
  assert.throws(() => files.create('错误文件', {}), /无效方案/);assert.deepEqual(files.workspace, before);
  const title = '字'.repeat(100);files.create(title, blankProject());assert.equal(files.create(title, blankProject()).title.length, 100);
  assert.equal(projectFilename('  换乘站:A/B*测试  '), '换乘站-A-B-测试.json');
});

test('a stale browser tab cannot overwrite documents created in another window', () => {
  const local = storage(),first = new ProjectFiles(local);first.save(first.current.project);
  const other = new ProjectFiles(local);first.create('另一个窗口', blankProject());
  const persisted = local.getItem(WORKSPACE_KEY);
  assert.throws(() => other.save({...other.current.project,name:'过期编辑'}), /其他窗口更新/);
  assert.equal(local.getItem(WORKSPACE_KEY), persisted);
  assert.equal(new ProjectFiles(local).list().length, 2);
});
