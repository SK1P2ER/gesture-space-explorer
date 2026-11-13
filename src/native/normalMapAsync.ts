import { normalMapJS } from './normalMap';

export interface NormalMapResult { pixels: Uint8Array; backend: 'wasm' | 'js'; wasmMemoryBytes?: number }

/** One owned worker per job; neither cancellation nor transfer detaches the caller's height field. */
export function normalMapAsync(height: Float32Array, size: number, strength: number, signal?: AbortSignal): Promise<NormalMapResult> {
  if (signal?.aborted) return Promise.reject(new DOMException('Normal map cancelled', 'AbortError'));
  if (!Number.isInteger(size) || size < 1 || size > 2048 || height.length !== size * size || !Number.isFinite(strength)) {
    return Promise.reject(new RangeError('Invalid normal-map input'));
  }
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined, done = false;
    const finish = (result?: NormalMapResult, cancelled = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); }
      if (cancelled) reject(new DOMException('Normal map cancelled', 'AbortError'));
      else resolve(result ?? { pixels: normalMapJS(height, size, strength), backend: 'js' });
    };
    const abort = () => finish(undefined, true);
    try {
      if (typeof Worker === 'undefined') { finish(); return; }
      worker = new Worker(new URL('./normalMap.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<NormalMapResult>) => {
        if (!(data?.pixels instanceof Uint8Array) || data.pixels.length !== size * size * 4
          || !['wasm', 'js'].includes(data.backend)) finish();
        else finish(data);
      };
      worker.onerror = (event) => { event.preventDefault(); finish(); };
      worker.onmessageerror = () => finish();
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(), 5000);
      const copy = height.slice();
      worker.postMessage({ height: copy, size, strength }, [copy.buffer]);
    } catch { finish(); }
  });
}
