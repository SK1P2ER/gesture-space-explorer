import { initNativeNormalMap, nativeNormalMapReady, nativeNormalMapMemoryBytes, normalMap } from './normalMap';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ height: Float32Array; size: number; strength: number }>) => void) | null;
  postMessage(data: unknown, transfer: Transferable[]): void;
};
scope.onmessage = async ({ data: { height, size, strength } }) => {
  await initNativeNormalMap();
  const pixels = normalMap(height, size, strength);
  scope.postMessage({ pixels, backend: nativeNormalMapReady() ? 'wasm' : 'js', wasmMemoryBytes: nativeNormalMapMemoryBytes() }, [pixels.buffer]);
};
