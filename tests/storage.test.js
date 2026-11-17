import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTE_STORAGE_KEYS, STATION_STORAGE_KEYS } from '../shared/storage-keys.js';
import { ProjectFiles } from '../station-designer/src/project-files.js';
import { themeTokens } from '../shared/theme.js';

test('route drawings and station projects have distinct storage keys', () => {
  const all = [...Object.values(ROUTE_STORAGE_KEYS), ...Object.values(STATION_STORAGE_KEYS)];
  assert.equal(new Set(all).size, all.length);
  assert.ok(Object.values(ROUTE_STORAGE_KEYS).every(key => key.startsWith('rmcreator.')));
  assert.ok(Object.values(STATION_STORAGE_KEYS).every(key => key.startsWith('station-studio-')));
});

test('creating, saving and deleting station projects preserves every route key and restores legacy stations', () => {
  const existing = Object.fromEntries(Object.values(ROUTE_STORAGE_KEYS).map(key => [key, `saved:${key}`]));
  const values = new Map(Object.entries(existing));
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const projects = new ProjectFiles(storage);
  projects.save(projects.current.project);
  const copy = new ProjectFiles(storage);
  assert.deepEqual(copy.current.project, projects.current.project);
  const duplicate = projects.duplicate(projects.current.id, '存储隔离验证');
  projects.rename(duplicate.id, '改名后的车站');
  projects.trash(duplicate.id);
  projects.restore(duplicate.id);
  for (const [key, value] of Object.entries(existing)) assert.equal(storage.getItem(key), value);
  const project = projects.current.project;
  values.delete(STATION_STORAGE_KEYS.workspace);
  values.set(STATION_STORAGE_KEYS.legacyProject, JSON.stringify(project));
  const migrated = new ProjectFiles(storage);
  assert.equal(migrated.current.project.name, project.name);
  migrated.save(migrated.current.project);
  for (const [key, value] of Object.entries(existing)) assert.equal(storage.getItem(key), value);
  assert.equal(storage.getItem(STATION_STORAGE_KEYS.legacyProject), JSON.stringify(project));
});

test('shared theme accepts existing accent formats and falls back on invalid input', () => {
  assert.equal(themeTokens('#abc')['--accent'], '#aabbcc');
  assert.equal(themeTokens('#ab1234ff')['--accent'], '#ab1234');
  assert.equal(themeTokens('invalid')['--accent'], '#2f6de5');
  assert.equal(themeTokens('#000000')['--accent-soft'], '#e0e0e0');
});
