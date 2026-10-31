import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Sky } from '../src/scene/sky';
import { disposeTexture, loadTexture, type UploadQueue } from '../src/planets/textureLoader';
import { deferred } from './helpers/media';

vi.mock('../src/planets/textureLoader', async (original) => ({
  ...await original<object>(), loadTexture: vi.fn(),
}));

const load = vi.mocked(loadTexture);
beforeEach(() => { load.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

function fixture() {
  let context = new AbortController();
  const upload = vi.fn(async (texture: THREE.Texture, _options?: { mipmaps?: boolean; signal?: AbortSignal }) => texture);
  const queue = { upload, get signal() { return context.signal; } };
  const sky = new Sky(queue as unknown as UploadQueue);
  const material = sky.mesh.material as THREE.MeshBasicMaterial;
  const placeholder = material.map!;
  const placeholderReleased = vi.fn(); placeholder.addEventListener('dispose', placeholderReleased);
  const suspend = () => context.abort();
  const resume = () => { context = new AbortController(); };
  return { sky, material, placeholder, placeholderReleased, upload, queue, suspend, resume };
}

function texture() {
  const value = new THREE.Texture(), released = vi.fn();
  value.addEventListener('dispose', released);
  return { value, released };
}

it('retains the recovery placeholder and detaches an old map before replacing it', async () => {
  const f = fixture(), first = texture(), second = texture();
  load.mockResolvedValueOnce(first.value).mockResolvedValueOnce(second.value);
  await f.sky.setTier('2k');
  expect(f.material.map).toBe(first.value);
  expect(first.value.wrapS).toBe(THREE.RepeatWrapping);
  expect(f.upload).toHaveBeenCalledWith(first.value, { mipmaps: false, signal: expect.any(AbortSignal) });
  expect(f.placeholderReleased).not.toHaveBeenCalled();
  first.value.addEventListener('dispose', () => { expect(f.material.map).toBe(second.value); });
  await f.sky.setTier('4k');
  expect(first.released).toHaveBeenCalledTimes(1);
  expect(second.released).not.toHaveBeenCalled();
  expect(f.placeholderReleased).not.toHaveBeenCalled();
  f.sky.dispose();
  expect(second.released).toHaveBeenCalledTimes(1);
  expect(f.placeholderReleased).toHaveBeenCalledTimes(1);
});

it('cancels A to B to A requests and cannot publish the first A after the latest A', async () => {
  const f = fixture(), old = deferred<THREE.Texture>(), stale = texture(), middle = texture(), latest = texture();
  load.mockReturnValueOnce(old.promise).mockResolvedValueOnce(middle.value).mockResolvedValueOnce(latest.value);
  const first = f.sky.setTier('2k');
  const oldSignal = load.mock.calls[0][4]!;
  await f.sky.setTier('4k'); await f.sky.setTier('2k');
  expect(oldSignal.aborted).toBe(true);
  old.resolve(stale.value); await first;
  expect(f.material.map).toBe(latest.value);
  expect(f.upload).toHaveBeenCalledTimes(2);
  expect(stale.released).toHaveBeenCalledTimes(1);
  expect(middle.released).toHaveBeenCalledTimes(1);
  expect(latest.released).not.toHaveBeenCalled();
  f.sky.dispose();
});

it('releases a late completed upload instead of publishing it after a tier change', async () => {
  const f = fixture(), old = texture(), uploaded = texture(), latest = texture(), waiting = deferred<THREE.Texture>();
  load.mockResolvedValueOnce(old.value).mockResolvedValueOnce(latest.value);
  f.upload.mockImplementationOnce(() => waiting.promise);
  const first = f.sky.setTier('2k'); await settle();
  const uploadSignal = f.upload.mock.calls[0][1]!.signal!;
  await f.sky.setTier('4k');
  expect(uploadSignal.aborted).toBe(true);
  // The fake uploader consumed the input and returns a distinct target.
  disposeTexture(old.value); waiting.resolve(uploaded.value); await first;
  expect(old.released).toHaveBeenCalledTimes(1);
  expect(uploaded.released).toHaveBeenCalledTimes(1);
  expect(f.material.map).toBe(latest.value);
  f.sky.dispose();
});

it('detaches recovered textures immediately and invalidates same-tier work across repeated reloads', async () => {
  const f = fixture(), initial = texture(), old = deferred<THREE.Texture>(), stale = texture(), latest = texture();
  load.mockResolvedValueOnce(initial.value).mockReturnValueOnce(old.promise).mockResolvedValueOnce(latest.value);
  await f.sky.setTier('2k');
  initial.value.addEventListener('dispose', () => { expect(f.material.map).toBe(f.placeholder); });
  f.sky.reload();
  expect(f.material.map).toBe(f.placeholder);
  expect(initial.released).toHaveBeenCalledTimes(1);
  const oldSignal = load.mock.calls[1][4]!;
  f.sky.reload(); await settle();
  expect(oldSignal.aborted).toBe(true);
  expect(f.material.map).toBe(latest.value);
  old.resolve(stale.value); await settle();
  expect(f.material.map).toBe(latest.value);
  expect(stale.released).toHaveBeenCalledTimes(1);
  expect(f.placeholderReleased).not.toHaveBeenCalled();
  f.sky.dispose();
});

it('captures context cancellation before decode and never uploads a late result after resume', async () => {
  const f = fixture(), old = deferred<THREE.Texture>(), stale = texture(), latest = texture();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  load.mockReturnValueOnce(old.promise).mockResolvedValueOnce(latest.value);
  const first = f.sky.setTier('2k');
  const oldSignal = load.mock.calls[0][4]!;
  f.suspend(); f.resume(); f.sky.reload(); await settle();
  old.resolve(stale.value); await first;
  expect(oldSignal.aborted).toBe(true);
  expect(stale.released).toHaveBeenCalledTimes(1);
  expect(f.upload).toHaveBeenCalledTimes(1);
  expect(f.material.map).toBe(latest.value);
  expect(warning).not.toHaveBeenCalled();
  f.sky.dispose();
});

it('does not dispose an input twice when the queue rejects after taking ownership', async () => {
  const f = fixture(), input = texture(), failure = new Error('renderer allocation failed');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  load.mockResolvedValueOnce(input.value);
  f.upload.mockImplementationOnce(async (decoded) => { disposeTexture(decoded); throw failure; });
  await f.sky.setTier('2k');
  expect(input.released).toHaveBeenCalledTimes(1);
  expect(warning).toHaveBeenCalledWith('[sky] star map unavailable; plain background', failure);
  expect(f.material.map).toBe(f.placeholder);
  f.sky.dispose();
  expect(input.released).toHaveBeenCalledTimes(1);
});

it('ignores obsolete rejections while preserving the latest published map', async () => {
  const f = fixture(), old = deferred<THREE.Texture>(), latest = texture();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  load.mockReturnValueOnce(old.promise).mockResolvedValueOnce(latest.value);
  const first = f.sky.setTier('2k'); await f.sky.setTier('4k');
  old.reject(new Error('old request failed')); await first;
  expect(f.material.map).toBe(latest.value);
  expect(warning).not.toHaveBeenCalled();
  f.sky.dispose();
});

it('terminal teardown detaches the sampler and releases each owned resource once', async () => {
  const f = fixture(), published = texture(), pending = deferred<THREE.Texture>(), late = texture();
  const scene = new THREE.Scene(); scene.add(f.sky.mesh);
  const geometryReleased = vi.fn(), materialReleased = vi.fn();
  f.sky.mesh.geometry.addEventListener('dispose', geometryReleased);
  f.material.addEventListener('dispose', materialReleased);
  load.mockResolvedValueOnce(published.value).mockReturnValueOnce(pending.promise);
  await f.sky.setTier('2k');
  const loading = f.sky.setTier('4k'), signal = load.mock.calls[1][4]!;
  for (const value of [f.placeholder, published.value]) value.addEventListener('dispose', () => {
    expect(f.material.map).toBeNull(); expect(f.sky.mesh.parent).toBeNull();
  });
  f.sky.dispose(); f.sky.dispose();
  pending.resolve(late.value); await loading;
  expect(signal.aborted).toBe(true);
  expect(published.released).toHaveBeenCalledTimes(1);
  expect(late.released).toHaveBeenCalledTimes(1);
  expect(f.placeholderReleased).toHaveBeenCalledTimes(1);
  expect(geometryReleased).toHaveBeenCalledTimes(1);
  expect(materialReleased).toHaveBeenCalledTimes(1);
  expect(f.material.map).toBeNull();
  const calls = load.mock.calls.length;
  f.sky.reload(); await f.sky.setTier('2k');
  expect(load).toHaveBeenCalledTimes(calls);
});

it('keeps a valid placeholder after a failed recovery and releases it only at terminal teardown', async () => {
  const f = fixture(), published = texture(), failure = new Error('offline');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  load.mockResolvedValueOnce(published.value).mockRejectedValueOnce(failure);
  await f.sky.setTier('2k'); f.sky.reload(); await settle();
  expect(f.material.map).toBe(f.placeholder);
  expect(published.released).toHaveBeenCalledTimes(1);
  expect(f.placeholderReleased).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledWith('[sky] star map unavailable; plain background', failure);
  f.sky.dispose(); expect(f.placeholderReleased).toHaveBeenCalledTimes(1);
});
