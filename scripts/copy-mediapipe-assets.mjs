// Copies MediaPipe WASM + the hand model into public/ under versioned paths,
// so they can be served with `immutable` cache headers and work offline.
// Runs on postinstall and prebuild. Fails loudly: never deploy without WASM.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const MODEL_FILE = 'hand_landmarker.v1.task';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MODEL_SHA256 = 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1';

function fail(msg) {
  console.error(`[copy-mediapipe-assets] ${msg}`);
  process.exit(1);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// --- WASM ---------------------------------------------------------------
const pkgDir = join(root, 'node_modules', '@mediapipe', 'tasks-vision');
if (!existsSync(pkgDir)) fail('@mediapipe/tasks-vision is not installed. Run `npm ci`.');
const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

const wasmSrc = join(pkgDir, 'wasm');
const wasmDest = join(root, 'public', 'mediapipe', version, 'wasm');
if (!existsSync(join(wasmSrc, 'vision_wasm_internal.wasm'))) fail(`WASM not found in ${wasmSrc}`);
rmSync(join(root, 'public', 'mediapipe'), { recursive: true, force: true });
mkdirSync(wasmDest, { recursive: true });
cpSync(wasmSrc, wasmDest, { recursive: true });

// --- Model --------------------------------------------------------------
// The model is not in the npm package. It is committed under assets/models/
// so installs and builds need no network. Missing → download once, verified.
const modelSrc = join(root, 'assets', 'models', MODEL_FILE);
if (!existsSync(modelSrc)) {
  console.log(`[copy-mediapipe-assets] downloading ${MODEL_FILE} ...`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) fail(`model download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== MODEL_SHA256) fail('downloaded model checksum mismatch');
  mkdirSync(dirname(modelSrc), { recursive: true });
  writeFileSync(modelSrc, buf);
}
if (sha256(readFileSync(modelSrc)) !== MODEL_SHA256) fail(`${modelSrc} checksum mismatch`);

const modelDest = join(root, 'public', 'models');
rmSync(modelDest, { recursive: true, force: true });
mkdirSync(modelDest, { recursive: true });
cpSync(modelSrc, join(modelDest, MODEL_FILE));

console.log(`[copy-mediapipe-assets] ok: mediapipe ${version}, ${MODEL_FILE}`);
