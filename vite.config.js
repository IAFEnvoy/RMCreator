import { defineConfig } from 'vite';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
function* files(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* files(path); else yield path;
  }
}

// Legacy templates and presets are fetched at runtime and need stable URLs.
const staticAssets = {
  name: 'rmcreator-static-assets',
  generateBundle() {
    const paths = ['img', 'preset', 'template', 'schema'].flatMap(dir => [...files(resolve(root, 'route-map', dir))]);
    paths.push(resolve(root, 'route-map/sw.js'), resolve(root, 'favicon.webp'));
    for (const path of paths) this.emitFile({ type: 'asset', fileName: relative(root, path).replaceAll('\\', '/'), source: readFileSync(path) });
  },
};

export default defineConfig({
  base: './',
  plugins: [staticAssets],
  build: {
    rolldownOptions: {
      input: {
        home: resolve(root, 'index.html'),
        route: resolve(root, 'route-map/index.html'),
        station: resolve(root, 'station-designer/index.html'),
        layout: resolve(root, 'track-layout/index.html'),
      },
      output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/].*three/ }] } },
    },
  },
});
