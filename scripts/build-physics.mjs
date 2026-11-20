import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
const mode = process.argv[2];
if (mode !== 'wasm' && mode !== 'native') {
  throw new Error('Usage: node scripts/build-physics.mjs <wasm|native>');
}

const workspaceId = createHash('sha256').update(root).digest('hex').slice(0, 12);
const buildDir = join(tmpdir(), `gse-physics-${workspaceId}-${mode}`);
const configure = [
  '-S', resolve(root, 'physics/wasm'),
  '-B', buildDir,
  '-G', 'Ninja',
  '-DCMAKE_BUILD_TYPE=Release',
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (mode === 'wasm') {
  if (!process.env.EMSDK) {
    throw new Error('Activate Emscripten 3.1.64 before running the WASM build.');
  }
  configure.push(
    `-DCMAKE_TOOLCHAIN_FILE=${resolve(process.env.EMSDK, 'upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake')}`,
  );
  if (process.env.EMSDK_NODE) {
    configure.push(`-DCMAKE_CROSSCOMPILING_EMULATOR=${process.env.EMSDK_NODE}`);
  }
}
run('cmake', configure);
run('cmake', ['--build', buildDir, '--config', 'Release', '--parallel', '2']);

if (mode === 'native') {
  run('ctest', ['--test-dir', buildDir, '--output-on-failure']);
}
