import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../..', import.meta.url));
const installedRoot = path.join(workspace, 'node_modules', 'three');
const helperPath = 'src/renderers/webgl/WebGLDisposalScope.js';
const marker = 'EXPERIMENTAL_RECOVERY_DISPOSAL_SCOPE_V1';

// Byte identities deliberately pin this experiment to the installed npm build.
// Refuse an upgrade, a previously patched copy, line-ending drift or new source
// layout rather than applying approximate replacements to another engine.
export const BASELINE_SHA256 = Object.freeze({
  'package.json': 'f9c474a27c920b9435353a6235968f4453436bee0444fac7e5fd289c8fa463de',
  'build/three.module.js': '9052042d676cb0fdc1ddfefe193053f34b7ac0513a616fdac4535d49987812ea',
  'build/three.core.js': '9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6',
  'build/three.cjs': 'b326d5a8b9639e18e3d8debae1c331eaaf426ec703bf218c5ab72b9d6bfa1e94',
  'src/renderers/WebGLRenderer.js': '9e8740aad691246b31b3704014e8f3bbd38a8e7bf4b1b4d23868541b023cc63a',
  'src/renderers/webgl/WebGLTextures.js': 'a1947fd09ac98b3a57e40018dc8eccfce9c40f2cf4b6200b3180a00af5406451',
  'src/renderers/webgl/WebGLGeometries.js': 'd04c0ef5e4ccf862867be3a00d5c4a12de1f0939f81e7d5c50c5c4dcb3bc0eff',
  'src/renderers/webgl/WebGLObjects.js': '60829abba98579b02a84177ce86b3eea127a7decac487b69c70f0e3e83a1d923',
  'src/renderers/webgl/WebGLUniformsGroups.js': 'ef8e5dabfbf4fb57dabd09614a9482c2e2b691004669e0d6a8ecec58b24a8800',
  'src/renderers/webgl/WebGLMorphtargets.js': '2ce90a7fbe8d817b2addec2e70047c5c240dd366ba2b5a4ffb52acf5b5758907',
  'src/renderers/webgl/WebGLEnvironments.js': '69d82f1752b3244682b480cdf31d88c508b4617c5035217061635a326601ff38',
  'src/renderers/webgl/WebGLShadowMap.js': '88669e97ab02b2132a175eb94f9bfeea2a705d5f6c59e677bcb6421f258ff696',
});

const managers = [
  ['WebGLTextures', '_gl, extensions, state, properties, capabilities, utils, info', 4, 3, 0],
  ['WebGLGeometries', 'gl, attributes, info, bindingStates', 1, 1, 0],
  ['WebGLObjects', 'gl, geometries, attributes, bindingStates, info', 1, 1, 1],
  ['WebGLUniformsGroups', 'gl, info, capabilities, state', 1, 1, 0],
  ['WebGLMorphtargets', 'gl, capabilities, textures', 1, 1, 0],
  ['WebGLEnvironments', 'renderer', 2, 2, 0],
  ['WebGLShadowMap', 'renderer, objects, capabilities', 1, 1, 0],
];
const constructorArgs = {
  WebGLTextures: '_gl, extensions, state, properties, capabilities, utils, info',
  WebGLGeometries: '_gl, attributes, info, bindingStates',
  WebGLObjects: '_gl, geometries, attributes, bindingStates, info',
  WebGLUniformsGroups: '_gl, info, capabilities, state',
  WebGLMorphtargets: '_gl, capabilities, textures',
  WebGLEnvironments: '_this',
  WebGLShadowMap: '_this, objects, capabilities',
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function contains(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function replaceOnce(source, anchor, replacement, label) {
  const first = source.indexOf(anchor);
  if (first === -1 || source.indexOf(anchor, first + anchor.length) !== -1) {
    throw new Error(`Expected exactly one ${label} anchor`);
  }
  return source.slice(0, first) + replacement + source.slice(first + anchor.length);
}

function routeSubscriptions(source, expected, label) {
  const counts = { addEventListener: 0, removeEventListener: 0, hasEventListener: 0 };
  const routes = { addEventListener: 'subscribe', removeEventListener: 'unsubscribe', hasEventListener: 'has' };
  const rewritten = source.replace(
    /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.(addEventListener|removeEventListener|hasEventListener)\( 'dispose', ([A-Za-z_$][\w$]*) \)/g,
    (_match, owner, operation, listener) => {
      counts[operation]++;
      return `disposalScope.${routes[operation]}( ${owner}, ${listener} )`;
    },
  );
  const actual = Object.values(counts);
  if (actual.some((count, index) => count !== expected[index])) {
    throw new Error(`${label} disposal routes changed: expected ${expected}, got ${actual}`);
  }
  if (/\.(?:add|remove|has)EventListener\( 'dispose'/.test(rewritten)) {
    throw new Error(`Uncovered disposal subscription in ${label}`);
  }
  return rewritten;
}

function scopeManager(source, [name, args]) {
  return replaceOnce(source, `function ${name}( ${args} ) {`,
    `function ${name}( ${args}, disposalScope ) {`, `${name} factory`);
}

function scopeRenderer(source) {
  source = replaceOnce(source, '\t\tlet _gl = context;', `\t\tlet _gl = context;
\t\tlet disposalScope;
\t\tlet disposalEpoch = 0;
\t\tlet disposalAbandonedEpochs = 0;
\t\tlet disposalAbandonedSubscriptions = 0;
\t\t// ${marker}: diagnostic numbers only; retain no former scope.
\t\tthis.__experimentalDisposalScopeStats = () => ( {
\t\t\t...disposalScope?.stats(),
\t\t\tabandonedEpochs: disposalAbandonedEpochs,
\t\t\tabandonedSubscriptions: disposalAbandonedSubscriptions
\t\t} );`, 'renderer scope declarations');
  source = replaceOnce(source, '\t\tfunction initGLContext() {', `\t\tfunction initGLContext() {

\t\t\tdisposalScope = createDisposalScope( ++disposalEpoch );`, 'new context scope');
  source = replaceOnce(source, '\t\t\t_isContextLost = true;', `\t\t\t_isContextLost = true;
\t\t\tif ( disposalScope !== undefined && disposalScope.active ) {

\t\t\t\tdisposalAbandonedSubscriptions += disposalScope.abandon();
\t\t\t\tdisposalAbandonedEpochs ++;

\t\t\t}`, 'loss-time scope abandonment');
  for (const [name] of managers) {
    const args = constructorArgs[name];
    source = replaceOnce(source, `new ${name}( ${args} )`,
      `new ${name}( ${args}, disposalScope )`, `${name} scope injection`);
  }
  // Do not abandon a live scope in renderer.dispose(): baseline teardown does
  // not free every caller-owned allocation. Later Texture/Geometry.dispose()
  // must retain the baseline current-context cleanup behavior.
  return source;
}

/** Prepare and verify every change in memory, without filesystem mutation. */
export function prepareThreePatch(files) {
  for (const [relative, expected] of Object.entries(BASELINE_SHA256)) {
    const bytes = files[relative];
    if (bytes === undefined || sha256(bytes) !== expected) {
      throw new Error(`Baseline identity mismatch: ${relative}`);
    }
  }
  const packageData = JSON.parse(files['package.json'].toString());
  if (packageData.name !== 'three' || packageData.version !== '0.186.1') {
    throw new Error('Expected three@0.186.1');
  }
  const cjs = files['build/three.cjs'].toString();
  if (!cjs.includes("module.exports = require( './three.module.js' );")) {
    throw new Error('CJS no longer delegates to the patched ESM entry');
  }
  // Config bundlers rewrite functions: Function#toString would produce different
  // patched bytes for direct Node versus Vite under the same immutable key.
  const canonicalHelper = replaceOnce(
    readFileSync(new URL('./lifetime-scope.mjs', import.meta.url), 'utf8'),
    'export function createDisposalScope', 'function createDisposalScope', 'canonical helper export',
  );
  const helperSource = `// ${marker}\n${canonicalHelper}\n`;
  const changes = { [helperPath]: `${helperSource}\nexport { createDisposalScope };\n` };
  for (const spec of managers) {
    const relative = `src/renderers/webgl/${spec[0]}.js`;
    let source = scopeManager(files[relative].toString(), spec);
    source = routeSubscriptions(source, spec.slice(2), relative);
    changes[relative] = source;
  }
  const rendererPath = 'src/renderers/WebGLRenderer.js';
  let renderer = scopeRenderer(files[rendererPath].toString());
  renderer = routeSubscriptions(renderer, [1, 1, 0], rendererPath);
  changes[rendererPath] = `import { createDisposalScope } from './webgl/WebGLDisposalScope.js';\n${renderer}`;
  let bundle = files['build/three.module.js'].toString();
  for (const spec of managers) bundle = scopeManager(bundle, spec);
  bundle = scopeRenderer(bundle);
  bundle = routeSubscriptions(bundle, [12, 11, 1], 'ESM bundle');
  changes['build/three.module.js'] = `${helperSource}\n${bundle}`;
  return {
    changes,
    manifest: {
      marker,
      baselineVersion: packageData.version,
      baselineSha256: { ...BASELINE_SHA256 },
      patchedSha256: Object.fromEntries(Object.entries(changes).map(([name, source]) => [name, sha256(source)])),
      managers: managers.map(([name]) => name),
      disposalRoutes: { registrations: 12, removals: 11, identityChecks: 1 },
      cjs: 'Verified unchanged shim delegates to patched build/three.module.js',
      terminalDisposal: 'Preserved; current scope is abandoned only on context loss',
      absentModules: ['WebGLCubeMaps', 'WebGLCubeUVMaps'],
      excluded: ['WebGPURenderer', 'WebGLBackend/webgl-fallback', 'WebGPUBackend'],
    },
  };
}

/** Patch only a fresh physical copy, never the installed engine or linked files. */
export async function patchThree(copyRoot, { baselineRoot = installedRoot } = {}) {
  const root = await realpath(copyRoot);
  const protectedRoots = new Set(await Promise.all([installedRoot, baselineRoot].map((item) => realpath(item))));
  for (const installed of protectedRoots) {
    if (contains(root, installed) || contains(installed, root)) {
      throw new Error('Refusing to patch the installed Three.js package');
    }
  }
  const files = {};
  for (const relative of Object.keys(BASELINE_SHA256)) {
    const target = path.join(root, relative);
    const resolved = await realpath(target);
    if (!contains(root, resolved) || [...protectedRoots].some((installed) => contains(installed, resolved))) {
      throw new Error(`Copy contains an escaping path: ${relative}`);
    }
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) {
      throw new Error(`Copy must contain independent regular files: ${relative}`);
    }
    files[relative] = await readFile(target);
  }
  try {
    await lstat(path.join(root, helperPath));
    throw new Error('Copy already contains an experimental disposal helper');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const { changes, manifest } = prepareThreePatch(files);
  // All baseline/anchor/path checks above complete before the first write.
  for (const [relative, source] of Object.entries(changes)) {
    await writeFile(path.join(root, relative), source, { flag: relative === helperPath ? 'wx' : 'w' });
  }
  return { ...manifest, copyRoot: root };
}
