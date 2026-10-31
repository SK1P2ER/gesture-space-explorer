import * as THREE from 'three';
import { beforeEach, expect, it, vi } from 'vitest';
import { BODIES } from '../src/data/bodies';
import { PlanetSurface, type TextureContext } from '../src/planets/surface';
import { loadTexture } from '../src/planets/textureLoader';
import { deferred } from './helpers/media';

vi.mock('../src/planets/textureLoader', async (original) => ({
  ...await original<object>(), loadTexture: vi.fn(),
}));
const load = vi.mocked(loadTexture);
beforeEach(() => { load.mockReset(); });
function fixture() {
  const material = new THREE.MeshStandardMaterial();
  const fallback = vi.fn(() => ({ map: new THREE.Texture() }));
  const upload = vi.fn(async (texture: THREE.Texture) => texture);
  const surface = new PlanetSurface({ ...BODIES[0], textures: { map: 'test.webp', maxTier: '4k' } },
    { surface: material }, { uploads: { upload }, anisotropy: 1 } as unknown as TextureContext, fallback);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  const uniforms = shader.uniforms as Record<string, { value: THREE.Texture | null }>;
  const dispose = () => (surface as PlanetSurface & { dispose(): void }).dispose();
  return { surface, material, uniforms, fallback, dispose, upload };
}
async function settle() { await new Promise(resolve => setTimeout(resolve, 0)); }
it('detaches primary and next samplers before retirement, including repeated recovery during loads', async () => {
  const f = fixture();
  const initial = f.material.map;
  const disposed = new Set<THREE.Texture>();
  for (let cycle = 0; cycle < 3; cycle++) {
    const texture = new THREE.Texture();
    const released = vi.fn(() => {
      expect(f.material.map).not.toBe(texture);
      expect(f.uniforms.mapNext.value).not.toBe(texture);
      expect(disposed.has(texture)).toBe(false); disposed.add(texture);
    });
    texture.addEventListener('dispose', released);
    if (cycle === 0) { load.mockResolvedValueOnce(texture); await f.surface.loadBase('1k'); }
    else { pending.resolve(texture); await settle(); }
    f.surface.update(1);
    expect(f.material.map).toBe(texture);
    pending = deferred<THREE.Texture>(); load.mockReturnValueOnce(pending.promise);
    f.surface.reload(); f.surface.update(0.1);
    expect(f.material.map).toBe(initial); expect(f.uniforms.mapNext.value).toBe(initial);
    expect(f.surface.fade.value).toBe(0); expect(released).toHaveBeenCalledTimes(1);
  }
});
let pending: ReturnType<typeof deferred<THREE.Texture>>;
it('ignores an old rejection after a newer initial quality load succeeds', async () => {
  const f = fixture(), old = deferred<THREE.Texture>(), newest = new THREE.Texture();
  load.mockReturnValueOnce(old.promise).mockResolvedValueOnce(newest);
  const first = f.surface.loadBase('1k'); await f.surface.loadBase('2k');
  old.reject(new Error('obsolete failure')); await first; f.surface.update(1);
  expect(f.surface.baseState).toBe('ready'); expect(f.material.map).toBe(newest);
  expect(f.fallback).not.toHaveBeenCalled();
});
it('disposes out-of-order successes even when quality cycles back to the same tier', async () => {
  const f = fixture(), old = deferred<THREE.Texture>(), stale = new THREE.Texture(), latest = new THREE.Texture();
  const release = vi.fn(); stale.addEventListener('dispose', release);
  load.mockReturnValueOnce(old.promise).mockResolvedValueOnce(new THREE.Texture()).mockResolvedValueOnce(latest);
  const first = f.surface.loadBase('1k'); await f.surface.loadBase('2k'); await f.surface.loadBase('1k');
  old.resolve(stale); await first; f.surface.update(1);
  expect(f.material.map).toBe(latest); expect(release).toHaveBeenCalledTimes(1);
});
it('invalidates same-tier requests across recovery', async () => {
  const f = fixture(), old = deferred<THREE.Texture>(), stale = new THREE.Texture(), latest = new THREE.Texture();
  const release = vi.fn(); stale.addEventListener('dispose', release);
  load.mockReturnValueOnce(old.promise).mockResolvedValueOnce(latest);
  const first = f.surface.loadBase('1k'); f.surface.reload(); await settle();
  old.resolve(stale); await first; f.surface.update(1);
  expect(f.material.map).toBe(latest); expect(release).toHaveBeenCalledTimes(1);
});
it('teardown invalidates pending base and HD loads and releases each owned texture once', async () => {
  const f = fixture(), base = new THREE.Texture(), lateHd = new THREE.Texture(), hd = deferred<THREE.Texture>();
  const release = vi.fn(), hdRelease = vi.fn(); base.addEventListener('dispose', release); lateHd.addEventListener('dispose', hdRelease);
  load.mockResolvedValueOnce(base).mockReturnValueOnce(hd.promise);
  await f.surface.loadBase('1k'); f.surface.update(1); f.surface.setHd('2k');
  f.dispose(); f.dispose(); hd.resolve(lateHd); await settle();
  expect(f.material.map).toBeNull(); expect(f.uniforms.mapNext.value).toBeNull();
  expect(release).toHaveBeenCalledTimes(1); expect(hdRelease).toHaveBeenCalledTimes(1);
  const g = fixture(), request = deferred<THREE.Texture>(), lateBase = new THREE.Texture(), released = vi.fn();
  lateBase.addEventListener('dispose', released); load.mockReturnValueOnce(request.promise);
  const loading = g.surface.loadBase('1k'); g.dispose(); request.resolve(lateBase); await loading;
  expect(released).toHaveBeenCalledTimes(1); expect(g.material.map).toBeNull();
});
it('keeps procedural fallback and placeholders valid on recovery', async () => {
  const f = fixture(); load.mockRejectedValueOnce(new Error('offline'));
  await f.surface.loadBase('1k'); f.surface.update(1); const procedural = f.material.map;
  f.surface.reload(); f.surface.update(1);
  expect(f.material.map).toBe(procedural); expect(f.surface.baseState).toBe('fallback');
  expect(f.fallback).toHaveBeenCalledTimes(1);
});

it('does not publish a late failure after terminal teardown', async () => {
  const f = fixture(), request = deferred<THREE.Texture>(); load.mockReturnValueOnce(request.promise);
  const loading = f.surface.loadBase('1k'); f.dispose(); request.reject(new Error('late failure'));
  await loading; expect(f.fallback).not.toHaveBeenCalled(); expect(f.material.map).toBeNull();
});

it('invalidates pending HD across recovery without clearing a newer HD request or publishing the old one', async () => {
  const f = fixture(), old = deferred<THREE.Texture>(), current = deferred<THREE.Texture>();
  const oldTexture = new THREE.Texture(), latest = new THREE.Texture(), release = vi.fn();
  oldTexture.addEventListener('dispose', release);
  load.mockResolvedValueOnce(new THREE.Texture()).mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(new THREE.Texture()).mockReturnValueOnce(current.promise);
  await f.surface.loadBase('1k'); f.surface.update(1); f.surface.setHd('2k');
  f.surface.reload(); await settle(); old.resolve(oldTexture); await settle();
  expect(release).toHaveBeenCalledTimes(1); expect(f.surface.hdLoading).toBe(true);
  current.resolve(latest); await settle(); f.surface.update(1);
  expect(f.material.map).toBe(latest); expect(f.surface.hdLoading).toBe(false);
});

it('detaches every surface, cloud and ring sampler before freeing any layer', async () => {
  const materials = { surface: new THREE.MeshStandardMaterial(), clouds: new THREE.MeshStandardMaterial(), ring: new THREE.MeshStandardMaterial() };
  const surface = new PlanetSurface({ ...BODIES[0], textures: {
    map: 'map', normal: 'normal', bump: 'bump', night: 'night', roughness: 'roughness', clouds: 'clouds', ring: 'ring', maxTier: '4k',
  } }, materials, { uploads: { upload: async (t: THREE.Texture) => t }, anisotropy: 1 } as TextureContext, () => ({}));
  const uniforms = Object.values(materials).map(material => {
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    return shader.uniforms as Record<string, { value: unknown }>;
  });
  const textures: THREE.Texture[] = [];
  load.mockImplementation(async () => { const t = new THREE.Texture(); textures.push(t); return t; });
  await surface.loadBase('1k'); surface.update(1);
  let freed = 0;
  for (const texture of textures) texture.addEventListener('dispose', () => {
    freed++;
    for (const material of Object.values(materials)) {
      for (const slot of ['map', 'normalMap', 'bumpMap', 'emissiveMap', 'roughnessMap', 'alphaMap'] as const) expect(material[slot]).not.toBe(texture);
    }
    for (const set of uniforms) for (const uniform of Object.values(set)) expect(uniform.value).not.toBe(texture);
  });
  load.mockImplementation(() => new Promise(() => {}));
  surface.reload(); surface.update(0.1);
  expect(freed).toBe(7); expect(surface.fade.value).toBe(0);
  surface.dispose(); surface.dispose(); expect(freed).toBe(7);
});

it('aborts obsolete quality work and never enqueues its late decoded texture', async () => {
  const f = fixture(), old = deferred<THREE.Texture>(), stale = new THREE.Texture(), latest = new THREE.Texture();
  const released = vi.fn(); stale.addEventListener('dispose', released);
  load.mockReturnValueOnce(old.promise).mockResolvedValueOnce(latest);
  const first = f.surface.loadBase('1k');
  const oldSignal = load.mock.calls[0][4]!;
  await f.surface.loadBase('2k');
  expect(oldSignal.aborted).toBe(true);
  old.resolve(stale); await first; f.surface.update(1);
  expect(f.upload).toHaveBeenCalledTimes(1);
  expect(f.upload).toHaveBeenCalledWith(latest, { signal: expect.any(AbortSignal) });
  expect(released).toHaveBeenCalledTimes(1);
  expect(f.material.map).toBe(latest);
  expect(f.fallback).not.toHaveBeenCalled();
  f.dispose();
});

it('aborts HD work when it is no longer wanted and releases its late decode before upload', async () => {
  const f = fixture(), hd = deferred<THREE.Texture>(), late = new THREE.Texture(), released = vi.fn();
  late.addEventListener('dispose', released);
  load.mockResolvedValueOnce(new THREE.Texture()).mockReturnValueOnce(hd.promise);
  await f.surface.loadBase('1k'); f.surface.setHd('2k');
  const hdSignal = load.mock.calls[1][4]!;
  f.surface.setHd(null);
  expect(hdSignal.aborted).toBe(true);
  expect(f.surface.hdLoading).toBe(false);
  hd.resolve(late); await settle();
  expect(f.upload).toHaveBeenCalledTimes(1);
  expect(released).toHaveBeenCalledTimes(1);
  f.dispose();
});

it('treats context cancellation as obsolete work and releases completed sibling layers once', async () => {
  const context = new AbortController(), normal = deferred<THREE.Texture>();
  const material = new THREE.MeshStandardMaterial(), map = new THREE.Texture(), late = new THREE.Texture();
  const mapReleased = vi.fn(), lateReleased = vi.fn(), fallback = vi.fn(() => ({}));
  map.addEventListener('dispose', mapReleased); late.addEventListener('dispose', lateReleased);
  const upload = vi.fn(async (texture: THREE.Texture) => texture);
  const surface = new PlanetSurface({ ...BODIES[0], textures: { map: 'map', normal: 'normal', maxTier: '4k' } },
    { surface: material }, { uploads: { upload, signal: context.signal }, anisotropy: 1 } as unknown as TextureContext, fallback);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    load.mockResolvedValueOnce(map).mockReturnValueOnce(normal.promise);
    const loading = surface.loadBase('1k'); await settle();
    expect(upload).toHaveBeenCalledTimes(1);
    const requestSignal = load.mock.calls[0][4]!;
    context.abort(); normal.resolve(late); await loading;
    expect(requestSignal.aborted).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(mapReleased).toHaveBeenCalledTimes(1);
    expect(lateReleased).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
    expect(surface.baseState).toBe('loading');
    surface.dispose();
    expect(mapReleased).toHaveBeenCalledTimes(1);
    expect(lateReleased).toHaveBeenCalledTimes(1);
  } finally { warning.mockRestore(); }
});
