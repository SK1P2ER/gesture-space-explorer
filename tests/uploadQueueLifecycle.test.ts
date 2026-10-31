import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deferred } from './helpers/media';

class FakeBitmap {
  readonly close = vi.fn();
  constructor(readonly width = 1024, readonly height = 1536) {}
}

let loader: typeof import('../src/planets/textureLoader');
let frames: Map<number, FrameRequestCallback>;
let decode: ReturnType<typeof vi.fn>;
let fetchImage: ReturnType<typeof vi.fn>;

// Drain the promise continuations of the serial queue without timers or a GPU.
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
async function frame(beforeContinuation?: () => void) {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(0);
  beforeContinuation?.();
  await settle();
}

beforeEach(async () => {
  vi.resetModules();
  frames = new Map();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((frame: number) => { frames.delete(frame); }));
  vi.stubGlobal('ImageBitmap', FakeBitmap);
  vi.stubGlobal('navigator', { userAgent: 'Chrome/130.0' });
  decode = vi.fn();
  fetchImage = vi.fn();
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('fetch', fetchImage);
  loader = await import('../src/planets/textureLoader');
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function source(width = 1024, height = 1536) {
  const bitmap = new FakeBitmap(width, height);
  const texture = new THREE.Texture(bitmap as unknown as ImageBitmap);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.wrapS = THREE.RepeatWrapping;
  const disposed = vi.fn();
  texture.addEventListener('dispose', disposed);
  return { texture, bitmap, disposed };
}

function fixture() {
  const targets: { texture: THREE.Texture; disposed: ReturnType<typeof vi.fn> }[] = [];
  const copies: { region: number[]; position: number[]; mipmaps: boolean }[] = [];
  const initTexture = vi.fn((texture: THREE.Texture) => {
    const disposed = vi.fn();
    texture.addEventListener('dispose', disposed);
    targets.push({ texture, disposed });
  });
  const copyTextureToTexture = vi.fn((_source: THREE.Texture, target: THREE.Texture, region: THREE.Box2, position: THREE.Vector2) => {
    copies.push({ region: [region.min.x, region.min.y, region.max.x, region.max.y], position: position.toArray(), mipmaps: target.generateMipmaps });
  });
  const queue = new loader.UploadQueue({ initTexture, copyTextureToTexture } as unknown as THREE.WebGLRenderer);
  return { queue, targets, copies, initTexture, copyTextureToTexture };
}

it('uploads one slice per frame and transfers the completed target while releasing its input once', async () => {
  const f = fixture(), input = source();
  const done = f.queue.upload(input.texture);
  await settle();
  expect(f.initTexture).not.toHaveBeenCalled();
  await frame();
  expect(f.copies).toHaveLength(1);
  await frame();
  expect(f.copies).toHaveLength(2);
  await frame();
  const texture = await done;
  expect(f.copies).toEqual([
    { region: [0, 0, 1024, 512], position: [0, 0], mipmaps: false },
    { region: [0, 512, 1024, 1024], position: [0, 512], mipmaps: false },
    { region: [0, 1024, 1024, 1536], position: [0, 1024], mipmaps: true },
  ]);
  expect(texture).toBe(f.targets[0].texture);
  expect(texture).not.toBe(input.texture);
  expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  expect(texture.anisotropy).toBe(4);
  expect(texture.wrapS).toBe(THREE.RepeatWrapping);
  expect(texture.generateMipmaps).toBe(true);
  expect(input.disposed).toHaveBeenCalledTimes(1);
  expect(input.bitmap.close).toHaveBeenCalledTimes(1);
  expect(f.targets[0].disposed).not.toHaveBeenCalled();
  loader.disposeTexture(texture);
  expect(f.targets[0].disposed).toHaveBeenCalledTimes(1);
});

it('transfers a small texture intact and keeps its decoded pixels until caller disposal', async () => {
  const f = fixture(), input = source(128, 128);
  const done = f.queue.upload(input.texture, { mipmaps: false });
  await settle(); await frame();
  expect(await done).toBe(input.texture);
  expect(input.texture.generateMipmaps).toBe(false);
  expect(input.texture.minFilter).toBe(THREE.LinearFilter);
  expect(f.copyTextureToTexture).not.toHaveBeenCalled();
  expect(input.disposed).not.toHaveBeenCalled();
  expect(input.bitmap.close).not.toHaveBeenCalled();
  loader.disposeTexture(input.texture);
  expect(input.disposed).toHaveBeenCalledTimes(1);
  expect(input.bitmap.close).toHaveBeenCalledTimes(1);
});

it('keeps mipmaps disabled throughout a sliced sky upload', async () => {
  const f = fixture(), input = source();
  const done = f.queue.upload(input.texture, { mipmaps: false });
  await settle(); await frame(); await frame(); await frame();
  const texture = await done;
  expect(texture.generateMipmaps).toBe(false);
  expect(texture.minFilter).toBe(THREE.LinearFilter);
  expect(f.copies.every((copy) => !copy.mipmaps)).toBe(true);
  expect(input.disposed).toHaveBeenCalledTimes(1);
  expect(input.bitmap.close).toHaveBeenCalledTimes(1);
  loader.disposeTexture(texture);
});

it('releases an already canceled input before scheduling a frame or allocating on the GPU', async () => {
  const f = fixture(), input = source(), cancellation = new AbortController();
  cancellation.abort();
  await expect(f.queue.upload(input.texture, { signal: cancellation.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(frames.size).toBe(0);
  expect(f.initTexture).not.toHaveBeenCalled();
  expect(input.disposed).toHaveBeenCalledTimes(1);
  expect(input.bitmap.close).toHaveBeenCalledTimes(1);
});

it('releases a canceled queued input promptly while preserving upload order for following jobs', async () => {
  const f = fixture(), first = source(128, 128), canceled = source(), last = source(128, 128);
  const cancellation = new AbortController();
  const firstDone = f.queue.upload(first.texture);
  await settle();
  const canceledDone = f.queue.upload(canceled.texture, { signal: cancellation.signal });
  const rejected = expect(canceledDone).rejects.toMatchObject({ name: 'AbortError' });
  const lastDone = f.queue.upload(last.texture);
  cancellation.abort();
  await rejected;
  expect(canceled.disposed).toHaveBeenCalledTimes(1);
  expect(canceled.bitmap.close).toHaveBeenCalledTimes(1);
  expect(f.initTexture).not.toHaveBeenCalled();
  expect(frames.size).toBe(1);
  await frame();
  expect(await firstDone).toBe(first.texture);
  expect(f.initTexture).toHaveBeenCalledTimes(1);
  expect(f.initTexture).toHaveBeenLastCalledWith(first.texture);
  await frame();
  expect(await lastDone).toBe(last.texture);
  expect(f.initTexture).toHaveBeenCalledTimes(2);
  loader.disposeTexture(first.texture); loader.disposeTexture(last.texture);
});

it('cancels an initial frame wait and never allocates the texture', async () => {
  const f = fixture(), input = source(), cancellation = new AbortController();
  const done = f.queue.upload(input.texture, { signal: cancellation.signal });
  const rejected = expect(done).rejects.toMatchObject({ name: 'AbortError' });
  await settle();
  expect(frames.size).toBe(1);
  cancellation.abort(); await rejected;
  expect(frames.size).toBe(0);
  expect(f.initTexture).not.toHaveBeenCalled();
  expect(input.disposed).toHaveBeenCalledTimes(1);
  expect(input.bitmap.close).toHaveBeenCalledTimes(1);
});

it('checks cancellation again after a frame callback and before GPU allocation', async () => {
  const f = fixture(), input = source(), cancellation = new AbortController();
  const done = f.queue.upload(input.texture, { signal: cancellation.signal });
  const rejected = expect(done).rejects.toMatchObject({ name: 'AbortError' });
  await settle(); await frame(() => cancellation.abort()); await rejected;
  expect(f.initTexture).not.toHaveBeenCalled();
  expect(input.disposed).toHaveBeenCalledTimes(1);
  expect(input.bitmap.close).toHaveBeenCalledTimes(1);
});

it('releases both a partial target and decoded input once when canceled between slices', async () => {
  const f = fixture(), input = source(), cancellation = new AbortController();
  const done = f.queue.upload(input.texture, { signal: cancellation.signal });
  const rejected = expect(done).rejects.toMatchObject({ name: 'AbortError' });
  await settle(); await frame();
  expect(f.copies).toHaveLength(1);
  cancellation.abort(); await rejected; await frame();
  expect(f.copies).toHaveLength(1);
  expect(f.targets[0].disposed).toHaveBeenCalledTimes(1);
  expect(input.disposed).toHaveBeenCalledTimes(1);
  expect(input.bitmap.close).toHaveBeenCalledTimes(1);
});

it('invalidates running and queued work across context restore and accepts only new work', async () => {
  const f = fixture(), running = source(), queued = source(), fresh = source(128, 128);
  const oldSignal = f.queue.signal;
  const runningDone = f.queue.upload(running.texture), queuedDone = f.queue.upload(queued.texture);
  const runningRejected = expect(runningDone).rejects.toMatchObject({ name: 'AbortError' });
  const queuedRejected = expect(queuedDone).rejects.toMatchObject({ name: 'AbortError' });
  await settle(); await frame();
  f.queue.suspend(); f.queue.resume();
  await Promise.all([runningRejected, queuedRejected]);
  expect(oldSignal.aborted).toBe(true);
  expect(f.queue.signal).not.toBe(oldSignal);
  expect(f.queue.signal.aborted).toBe(false);
  expect(running.disposed).toHaveBeenCalledTimes(1);
  expect(queued.disposed).toHaveBeenCalledTimes(1);
  expect(running.bitmap.close).toHaveBeenCalledTimes(1);
  expect(queued.bitmap.close).toHaveBeenCalledTimes(1);
  expect(f.targets[0].disposed).toHaveBeenCalledTimes(1);
  const freshDone = f.queue.upload(fresh.texture);
  await settle(); await frame();
  expect(await freshDone).toBe(fresh.texture);
  expect(f.copies).toHaveLength(1);
  loader.disposeTexture(fresh.texture);
});

it('rejects and releases new inputs while suspended without allocating', async () => {
  const f = fixture(), input = source();
  f.queue.suspend(); f.queue.suspend();
  await expect(f.queue.upload(input.texture)).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.initTexture).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
  expect(input.disposed).toHaveBeenCalledTimes(1);
  expect(input.bitmap.close).toHaveBeenCalledTimes(1);
});

it.each(['allocation', 'copy'] as const)('preserves a renderer %s error and releases both resources once', async (stage) => {
  const f = fixture(), input = source(), failure = new Error(`renderer ${stage} failure`);
  if (stage === 'allocation') f.initTexture.mockImplementationOnce((texture) => {
    const disposed = vi.fn(); texture.addEventListener('dispose', disposed);
    f.targets.push({ texture, disposed }); throw failure;
  });
  else f.copyTextureToTexture.mockImplementationOnce(() => { throw failure; });
  const done = f.queue.upload(input.texture);
  const rejected = expect(done).rejects.toBe(failure);
  await settle(); await frame(); await rejected;
  expect(f.targets[0].disposed).toHaveBeenCalledTimes(1);
  expect(input.disposed).toHaveBeenCalledTimes(1);
  expect(input.bitmap.close).toHaveBeenCalledTimes(1);
});

it('continues with the next queued upload after a renderer failure', async () => {
  const f = fixture(), failed = source(), next = source(128, 128), failure = new Error('copy failed');
  f.copyTextureToTexture.mockImplementationOnce(() => { throw failure; });
  const failedDone = f.queue.upload(failed.texture);
  const rejected = expect(failedDone).rejects.toBe(failure);
  const nextDone = f.queue.upload(next.texture);
  await settle(); await frame(); await rejected;
  expect(f.initTexture).toHaveBeenCalledTimes(1);
  await frame();
  expect(await nextDone).toBe(next.texture);
  expect(f.initTexture).toHaveBeenCalledTimes(2);
  loader.disposeTexture(next.texture);
});

it('passes cancellation to fetch and stops before decoding a canceled response body', async () => {
  const body = deferred<Blob>(), cancellation = new AbortController();
  fetchImage.mockResolvedValue({ ok: true, blob: () => body.promise });
  const done = loader.loadTexture('test.webp', '1k', 'color', 1, cancellation.signal);
  const rejected = expect(done).rejects.toMatchObject({ name: 'AbortError' });
  await settle(); cancellation.abort(); body.resolve(new Blob()); await rejected;
  expect(fetchImage).toHaveBeenCalledWith(expect.stringContaining('1k/test.webp'), { signal: cancellation.signal });
  expect(decode).not.toHaveBeenCalled();
});

it('closes a bitmap returned after cancellation during an unabortable decode', async () => {
  const decoding = deferred<ImageBitmap>(), cancellation = new AbortController(), bitmap = new FakeBitmap();
  fetchImage.mockResolvedValue({ ok: true, blob: async () => new Blob() });
  decode.mockReturnValue(decoding.promise);
  const done = loader.loadTexture('test.webp', '1k', 'color', 1, cancellation.signal);
  const rejected = expect(done).rejects.toMatchObject({ name: 'AbortError' });
  await settle(); expect(decode).toHaveBeenCalledTimes(1);
  cancellation.abort(); decoding.resolve(bitmap as unknown as ImageBitmap); await rejected;
  expect(bitmap.close).toHaveBeenCalledTimes(1);
});

it('keeps a normally decoded bitmap open until its texture owner disposes it', async () => {
  const bitmap = new FakeBitmap();
  fetchImage.mockResolvedValue({ ok: true, blob: async () => new Blob() });
  decode.mockResolvedValue(bitmap);
  const texture = await loader.loadTexture('test.webp', '2k', 'color', 8);
  expect(texture.image).toBe(bitmap);
  expect(texture.flipY).toBe(false);
  expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  expect(texture.anisotropy).toBe(8);
  expect(bitmap.close).not.toHaveBeenCalled();
  loader.disposeTexture(texture);
  expect(bitmap.close).toHaveBeenCalledTimes(1);
});

it('does not start fetching for an already canceled decode request', async () => {
  const cancellation = new AbortController(); cancellation.abort();
  await expect(loader.loadTexture('test.webp', '1k', 'data', 1, cancellation.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchImage).not.toHaveBeenCalled(); expect(decode).not.toHaveBeenCalled();
});

it('releases a late TextureLoader result on browsers without ImageBitmap decoding', async () => {
  vi.stubGlobal('createImageBitmap', undefined); vi.resetModules();
  const fallbackLoader = await import('../src/planets/textureLoader');
  const loading = deferred<THREE.Texture<HTMLImageElement>>(), cancellation = new AbortController();
  const texture = new THREE.Texture<HTMLImageElement>(), disposed = vi.fn(); texture.addEventListener('dispose', disposed);
  vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockReturnValue(loading.promise);
  const done = fallbackLoader.loadTexture('test.webp', '1k', 'color', 1, cancellation.signal);
  const rejected = expect(done).rejects.toMatchObject({ name: 'AbortError' });
  cancellation.abort(); loading.resolve(texture); await rejected;
  expect(disposed).toHaveBeenCalledTimes(1);
});

it('removes combined-signal listeners after success and forwards the original abort reason', async () => {
  const request = new AbortController(), context = new AbortController();
  const removeRequest = vi.spyOn(request.signal, 'removeEventListener');
  const removeContext = vi.spyOn(context.signal, 'removeEventListener');
  const combined = loader.combineTextureSignals(request.signal, context.signal);
  const reason = new Error('superseded request');
  request.abort(reason);
  expect(combined.signal.aborted).toBe(true);
  expect(combined.signal.reason).toBe(reason);
  expect(removeRequest).toHaveBeenCalledTimes(1);
  expect(removeContext).toHaveBeenCalledTimes(1);
  combined.dispose();
  expect(removeRequest).toHaveBeenCalledTimes(1);
  expect(removeContext).toHaveBeenCalledTimes(1);

  const f = fixture(), input = source(128, 128), active = new AbortController();
  const removeActive = vi.spyOn(active.signal, 'removeEventListener');
  const removeQueueContext = vi.spyOn(f.queue.signal, 'removeEventListener');
  const done = f.queue.upload(input.texture, { signal: active.signal });
  await settle(); await frame(); await done;
  expect(removeActive).toHaveBeenCalledTimes(1);
  expect(removeQueueContext).toHaveBeenCalledTimes(1);
  loader.disposeTexture(input.texture);
});
