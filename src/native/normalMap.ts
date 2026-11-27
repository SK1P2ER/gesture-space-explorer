interface NormalMapExports {
  memory: WebAssembly.Memory;
  __heap_base: WebAssembly.Global;
  normal_map(input: number, output: number, size: number, strength: number): void;
  abi_version(): number;
}

let native: NormalMapExports | null = null;
let pending: Promise<boolean> | null = null;

/** Optional acceleration. Fetch/compile happens outside the render loop; failure keeps JS working. */
export function initNativeNormalMap(bytes?: BufferSource): Promise<boolean> {
  if (native) return Promise.resolve(true);
  if (pending) return pending;
  pending = (async () => {
    try {
      if (typeof WebAssembly === 'undefined') return false;
      const source = bytes ?? await fetch(`${import.meta.env.BASE_URL}native/normal-map-v1.wasm`).then((response) => {
        if (!response.ok) throw new Error(`Normal-map kernel: HTTP ${response.status}`);
        return response.arrayBuffer();
      });
      if (!source) return false;
      const { instance } = await WebAssembly.instantiate(source, {});
      const exports = instance.exports as unknown as NormalMapExports;
      if (!(exports.memory instanceof WebAssembly.Memory) || !(exports.__heap_base instanceof WebAssembly.Global)
        || typeof exports.normal_map !== 'function' || typeof exports.abi_version !== 'function' || exports.abi_version() !== 1) return false;
      native = exports;
      return true;
    } catch {
      return false;
    }
  })().finally(() => { pending = null; });
  return pending;
}

export const nativeNormalMapReady = () => native !== null;
/** Allocated linear memory, not total browser/process or GPU memory. */
export const nativeNormalMapMemoryBytes = () => native?.memory.buffer.byteLength ?? 0;

/** Owns its result: future kernel calls and memory growth cannot overwrite an uploaded texture. */
export function normalMap(height: Float32Array, size: number, strength: number): Uint8Array {
  const kernel = native;
  if (!kernel || !Number.isInteger(size) || size < 1 || size > 2048 || height.length !== size * size || !Number.isFinite(strength)) {
    return normalMapJS(height, size, strength);
  }
  try {
    const count = size * size;
    const input = Math.ceil(Number(kernel.__heap_base.value) / 16) * 16;
    const output = input + count * 4;
    const required = output + count * 4;
    const missing = required - kernel.memory.buffer.byteLength;
    if (missing > 0) kernel.memory.grow(Math.ceil(missing / 65536));
    new Float32Array(kernel.memory.buffer, input, count).set(height);
    kernel.normal_map(input, output, size, strength);
    return new Uint8Array(kernel.memory.buffer, output, count * 4).slice();
  } catch {
    native = null;
    return normalMapJS(height, size, strength);
  }
}

/** Sobel normal map, wrapped horizontally and clamped vertically, matching the original texture kit. */
export function normalMapJS(height: Float32Array, size: number, strength: number): Uint8Array {
  const output = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => height[Math.max(0, Math.min(size - 1, y)) * size + ((x + size) % size)];
  const byte = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8;
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8;
    const nx = -dx * strength, ny = -dy * strength;
    const length = Math.hypot(nx, ny, 1);
    output.set([byte((nx / length) * 127.5 + 127.5), byte((ny / length) * 127.5 + 127.5), byte((1 / length) * 127.5 + 127.5), 255], (y * size + x) * 4);
  }
  return output;
}
