import { afterEach, expect, it, vi } from 'vitest';
import { normalMapAsync } from '../src/native/normalMapAsync';
import { normalMapJS } from '../src/native/normalMap';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('retains the JavaScript fallback when Workers are unavailable', async () => {
  vi.stubGlobal('Worker', undefined);
  const height = new Float32Array([0, 1, 2, 3]);
  const result = await normalMapAsync(height, 2, 2.5);
  expect(result.backend).toBe('js');
  expect(result.pixels).toEqual(normalMapJS(height, 2, 2.5));
});

it('transfers a copy of the input and terminates the worker after completion', async () => {
  const terminate = vi.fn();
  const height = new Float32Array([0, 1, 2, 3]);
  const expected = normalMapJS(height, 2, 2.5);
  vi.stubGlobal('Worker', class {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    terminate = terminate;
    postMessage(data: { height: Float32Array }, transfer: Transferable[]) {
      expect(data.height.buffer).not.toBe(height.buffer);
      expect(transfer).toEqual([data.height.buffer]);
      queueMicrotask(() => this.onmessage?.({ data: { pixels: expected, backend: 'wasm' } }));
    }
  });
  expect((await normalMapAsync(height, 2, 2.5)).pixels).toEqual(expected);
  expect(height).toEqual(new Float32Array([0, 1, 2, 3]));
  expect(terminate).toHaveBeenCalledOnce();
});

it('cancels pending work without computing a fallback after disposal', async () => {
  const terminate = vi.fn();
  vi.stubGlobal('Worker', class { terminate = terminate; postMessage() {} });
  const controller = new AbortController();
  const task = normalMapAsync(new Float32Array(4), 2, 1, controller.signal);
  controller.abort();
  await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  expect(terminate).toHaveBeenCalledOnce();
});

it('terminates a stuck worker and falls back after the timeout', async () => {
  vi.useFakeTimers();
  const terminate = vi.fn();
  vi.stubGlobal('Worker', class { terminate = terminate; postMessage() {} });
  const height = new Float32Array(4);
  const task = normalMapAsync(height, 2, 1);
  await vi.advanceTimersByTimeAsync(5000);
  expect((await task).pixels).toEqual(normalMapJS(height, 2, 1));
  expect(terminate).toHaveBeenCalledOnce();
});

it.each(['construction', 'error', 'malformed'])('falls back safely after a worker %s failure', async (failure) => {
  const terminate = vi.fn();
  vi.stubGlobal('Worker', class {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { preventDefault(): void }) => void) | null = null;
    terminate = terminate;
    constructor() { if (failure === 'construction') throw new Error('Worker blocked'); }
    postMessage() {
      queueMicrotask(() => {
        if (failure === 'error') this.onerror?.({ preventDefault() {} });
        else this.onmessage?.({ data: { pixels: new Uint8Array(1), backend: 'wasm' } });
      });
    }
  });
  const height = new Float32Array([0, 1, 2, 3]);
  const result = await normalMapAsync(height, 2, 1);
  expect(result.backend).toBe('js');
  expect(result.pixels).toEqual(normalMapJS(height, 2, 1));
  if (failure !== 'construction') expect(terminate).toHaveBeenCalledOnce();
});
