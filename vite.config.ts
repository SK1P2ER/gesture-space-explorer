import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { prepareRecoveryThree } from './scripts/three-recovery/prepare.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

const mediapipeVersion: string = JSON.parse(
  readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8'),
).version;
const appVersion: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export default defineConfig(async () => ({
  resolve: {
    // Use a hash-verified patched copy; never rewrite the installed dependency.
    alias: [{ find: /^three$/, replacement: await prepareRecoveryThree(root) }],
  },
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
    // Generated QA builds and isolated repro projects also contain HTML. They
    // must not become inputs to this application's development optimizer.
    entries: ['index.html', 'tests/browser/fixtures/webglRecovery.html'],
    // Pre-bundle the complete runtime package graph before serving it. Late
    // discovery otherwise holds optimized core/stats requests behind the crawl.
    noDiscovery: true,
    include: [
      'three',
      'three/addons/postprocessing/EffectComposer.js',
      'three/addons/postprocessing/OutputPass.js',
      'three/addons/postprocessing/RenderPass.js',
      'three/addons/postprocessing/UnrealBloomPass.js',
      'three/addons/utils/BufferGeometryUtils.js',
      'three/addons/loaders/GLTFLoader.js',
      'lil-gui', '@mediapipe/tasks-vision', 'three/addons/libs/stats.module.js',
    ],
  },
  build: {
    chunkSizeWarningLimit: 700, // three.js alone is ~550 kB
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
