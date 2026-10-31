import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const mediapipeVersion: string = JSON.parse(
  readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8'),
).version;
const appVersion: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

// three.js is patched in node_modules by patch-package (patches/, docs/decisions.md entry 18).
export default defineConfig(() => ({
  define: {
    __MEDIAPIPE_VERSION__: JSON.stringify(mediapipeVersion),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    // Generated evidence and isolated experiments are not the app. Watching them (tens of
    // thousands of files) slowed every dev-server start. New evidence lives outside the repository
    // (scripts/evidence-path.mjs); this covers older runs and folders configured inside it.
    watch: { ignored: ['**/tests/artifacts/**', '**/tests/experiments/**'] },
  },
  // These are imported lazily (import()), so Vite would only discover them after
  // startup and serve a stale pre-bundle ("504 Outdated Optimize Dep").
  optimizeDeps: {
    include: ['lil-gui', '@mediapipe/tasks-vision', 'three/addons/libs/stats.module.js'],
  },
  build: {
    chunkSizeWarningLimit: 700, // three.js alone is ~550 kB
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
