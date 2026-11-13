import { readFileSync } from 'node:fs';
import {deepStrictEqual} from 'node:assert';
import { afterEach, describe, expect, it, vi } from 'vitest';

const bytes = new Uint8Array(readFileSync(new URL('../public/native/normal-map-v1.wasm', import.meta.url))).buffer;
const fresh = async () => { vi.resetModules(); return import('../src/native/normalMap'); };
const field = (size: number) => Float32Array.from({ length: size * size }, (_, i) =>
  Math.sin(i * 0.71) * 0.8 + (i % 11 === 0 ? 0.6 : -0.4));
afterEach(() => vi.unstubAllGlobals());

describe('C++ normal-map acceleration', () => {
  it('ships a self-contained module without WASI or JavaScript imports', () => {
    const module = new WebAssembly.Module(bytes);
    expect(WebAssembly.Module.imports(module)).toEqual([]);
    expect(WebAssembly.Module.exports(module).map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['memory', '__heap_base', 'normal_map', 'abi_version']));
  });

  it('preserves the original pixels, including small maps, vertical edges and horizontal wrapping', async () => {
    const kernel = await fresh();
    expect(await kernel.initNativeNormalMap(bytes)).toBe(true);
    expect(kernel.nativeNormalMapReady()).toBe(true);
    for (const size of [1, 2, 3, 7, 16, 63, 128, 256]) for (const strength of [0, 1.5, 2.5, 3, 1000]) {
      const h = field(size);
      deepStrictEqual(kernel.normalMap(h, size, strength),kernel.normalMapJS(h, size, strength),`${size}px / strength ${strength}`);
    }
  });

  it('does not retain a view into reusable Wasm memory or overwrite an earlier result when memory grows', async () => {
    const kernel = await fresh();
    await kernel.initNativeNormalMap(bytes);
    const h = field(8);
    const first = kernel.normalMap(h, 8, 2.5);
    const expected = kernel.normalMapJS(h, 8, 2.5);
    const large = kernel.normalMap(field(1024), 1024, 3);
    expect(large.length).toBe(1024 * 1024 * 4);
    expect(first).toEqual(expected);
    expect(first.buffer).not.toBe(large.buffer);
    first.fill(0);
    expect(kernel.normalMap(h, 8, 2.5)).toEqual(expected);
  });

  it('keeps the JS path usable before initialization, and retries after a corrupt download', async () => {
    const kernel = await fresh();
    const h = field(16);
    expect(kernel.nativeNormalMapReady()).toBe(false);
    expect(kernel.normalMap(h, 16, 1.5)).toEqual(kernel.normalMapJS(h, 16, 1.5));
    expect(await kernel.initNativeNormalMap(new Uint8Array([0, 1, 2]).buffer)).toBe(false);
    expect(kernel.normalMap(h, 16, 1.5)).toEqual(kernel.normalMapJS(h, 16, 1.5));
    expect(await kernel.initNativeNormalMap(bytes)).toBe(true);
  });

  it('continues working when WebAssembly is unavailable', async () => {
    const kernel = await fresh();
    const wasm = WebAssembly;
    vi.stubGlobal('WebAssembly', undefined);
    expect(await kernel.initNativeNormalMap(bytes)).toBe(false);
    expect(kernel.normalMap(field(3), 3, 3)).toEqual(kernel.normalMapJS(field(3), 3, 3));
    vi.stubGlobal('WebAssembly', wasm);
    expect(await kernel.initNativeNormalMap(bytes)).toBe(true);
  });

  it('handles network failure and a valid Wasm file with the wrong ABI without rejecting initialization', async () => {
    const kernel = await fresh();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await kernel.initNativeNormalMap()).toBe(false);
    const emptyModule = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer;
    expect(await kernel.initNativeNormalMap(emptyModule)).toBe(false);
    expect(await kernel.initNativeNormalMap(bytes)).toBe(true);
  });
});
