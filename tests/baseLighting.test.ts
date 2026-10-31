import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { BASE_LAYER, BaseLighting, envStale, relativeSunlight, SCENE_SUN, setBaseLayer, shadowRadius, shadowStale, skyFill, sunIntensity, type ShadowKey } from '../src/scene/baseKit/baseLighting';
import { addGrime, Showcase, WIND_FROM } from '../src/scene/baseKit/showcase';

const R = 1.574 / 0.28;
const site = { point: new THREE.Vector3(0, 1, 0), quaternion: new THREE.Quaternion(), scale: 1 / R };
const deg = THREE.MathUtils.degToRad;

describe('the base Sun', () => {
  it('owns and reuses the filtered sky target, releases it once, and ignores late updates', () => {
    const lighting = new BaseLighting(new THREE.Group(), { shadows: true, shadowSize: 256, envSize: 16 }, 2.4);
    const renderer = { shadowMap: { needsUpdate: false } } as unknown as THREE.WebGLRenderer;
    const filtered = new THREE.WebGLRenderTarget(16, 16);
    const targetDispose = vi.spyOn(filtered, 'dispose');
    const cubeDispose = vi.spyOn(lighting['envTarget']!, 'dispose');
    const cubeUpdate = vi.spyOn(lighting['envCamera']!, 'update').mockImplementation(() => {});
    const filter = vi.spyOn(THREE.PMREMGenerator.prototype, 'fromCubemap').mockReturnValue(filtered);
    const filterDispose = vi.spyOn(THREE.PMREMGenerator.prototype, 'dispose');
    try {
      expect(lighting.envMap).toBeNull();
      const sun = new THREE.Vector3(0, 1, 0);
      lighting.update(renderer, sun, 90, 0, 1.52, 1, null, 0);
      expect(filter).toHaveBeenLastCalledWith(lighting['envTarget']!.texture, null);
      expect(lighting.envMap).toBe(filtered.texture);
      lighting.update(renderer, sun, 90, 0, 1.52, 1, null, 0);
      expect(filter).toHaveBeenCalledTimes(1); // unchanged sky remains cached
      lighting.update(renderer, sun, 90, 0.5, 1.52, 1, null, 0);
      expect(filter).toHaveBeenLastCalledWith(lighting['envTarget']!.texture, filtered);
      expect(lighting.envMap).toBe(filtered.texture);
      expect(targetDispose).not.toHaveBeenCalled();
      lighting.dispose(); lighting.dispose();
      expect(targetDispose).toHaveBeenCalledTimes(1);
      expect(cubeDispose).toHaveBeenCalledTimes(1);
      expect(filterDispose).toHaveBeenCalledTimes(1);
      expect(lighting.envMap).toBeNull();
      expect(lighting.update(renderer, sun, 90, 1, 1.52, 1, null, 0)).toBe(false);
      expect(cubeUpdate).toHaveBeenCalledTimes(2);
      expect(filter).toHaveBeenCalledTimes(2);
    } finally {
      lighting.dispose(); filter.mockRestore(); filterDispose.mockRestore();
    }
  });

  it('does not expose an uninitialized shadow sampler on night-first High entry, and enables shadows at sunrise', () => {
    const lighting = new BaseLighting(new THREE.Group(), { shadows: true, shadowSize: 256, envSize: 16 }, 2.4);
    const renderer = { shadowMap: { needsUpdate: false } } as unknown as THREE.WebGLRenderer;
    (lighting as unknown as { envCamera: null }).envCamera = null;
    try {
      lighting.update(renderer, new THREE.Vector3(0, -1, 0), -90, 1, 1.52, 1, null, 0);
      expect(lighting.sun.shadow.map).toBeNull();
      expect(lighting.sun.castShadow).toBe(false);
      expect(renderer.shadowMap.needsUpdate).toBe(false);
      lighting.update(renderer, new THREE.Vector3(0, 1, 0), 90, 0, 1.52, 1, null, 0);
      expect(lighting.sun.castShadow).toBe(true);
      expect(renderer.shadowMap.needsUpdate).toBe(true);
      expect(lighting.shadowUpdates).toBe(1);
      lighting.update(renderer, new THREE.Vector3(0, -1, 0), -90, 1, 1.52, 1, null, 0);
      expect(lighting.sun.castShadow).toBe(false);
    } finally { lighting.dispose(); }
  });
  it('matches the planet’s light (no dark island), dust shifts direct light to sky light; none below the horizon', () => {
    expect(relativeSunlight(1.524)).toBeCloseTo(0.43, 2); // the real figure, for the card
    expect(sunIntensity(1.524, 1) + skyFill(1, 0)).toBeGreaterThan(SCENE_SUN * 0.9); // about the planet's own light
    expect(sunIntensity(1.524, 1)).toBeLessThan(SCENE_SUN);
    expect(sunIntensity(1.524, 0.6)).toBeLessThan(sunIntensity(1.524, 1));
    expect(skyFill(0.6, 0)).toBeGreaterThan(skyFill(1, 0));
    const g = new THREE.Group();
    const l = new BaseLighting(g, { shadows: false, shadowSize: 256, envSize: 16 }, 2.4);
    const renderer = {} as THREE.WebGLRenderer;
    l.update(renderer, new THREE.Vector3(0, -0.5, 0.86).normalize(), -30, 1, 1.52, 1, null, 0);
    expect(l.sun.intensity).toBe(0); // night is just the Sun below the horizon
    l.update(renderer, new THREE.Vector3(0, 0.8, 0.6).normalize(), 53, 0, 1.52, 1, null, 0);
    expect(l.sun.intensity).toBeCloseTo(sunIntensity(1.52, 1), 6);
  });

  it('dust softens shadows and raises the sky fill (haze); night dims the fill', () => {
    expect(shadowRadius(1)).toBeLessThan(shadowRadius(0.6));
    expect(skyFill(0.6, 0)).toBeGreaterThan(skyFill(1, 0));
    expect(skyFill(1, 1)).toBeLessThan(skyFill(1, 0));
  });

  it('lights only the base pass, and its shadow camera sees only the base layer', () => {
    const g = new THREE.Group();
    const l = new BaseLighting(g, { shadows: true, shadowSize: 256, envSize: 16 }, 2.4);
    expect(l.sun.layers.isEnabled(BASE_LAYER)).toBe(true);
    expect(l.sun.layers.isEnabled(0)).toBe(false);
    expect(l.fill.layers.isEnabled(0)).toBe(false);
    expect(l.sun.castShadow).toBe(true);
    const low = new BaseLighting(new THREE.Group(), { shadows: false, shadowSize: 256, envSize: 16 }, 2.4);
    expect(low.sun.castShadow).toBe(false);
    expect(low.envMap).toBeNull();
  });
});

describe('caching: redraw only when something changed', () => {
  const key = (o: Partial<ShadowKey> = {}): ShadowKey => ({ sun: new THREE.Vector3(0, 1, 0), rocket: null, layout: 0, scale: 1, ...o });

  it('the shadow map: the Sun moved > 0.5°, the rocket moved, the layout or scale changed', () => {
    expect(shadowStale(null, key())).toBe(true);
    expect(shadowStale(key(), key({ sun: new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), deg(0.4)) }))).toBe(false);
    expect(shadowStale(key(), key({ sun: new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), deg(0.6)) }))).toBe(true);
    expect(shadowStale(key({ rocket: new THREE.Vector3() }), key({ rocket: new THREE.Vector3(0, 0.01, 0) }))).toBe(true);
    expect(shadowStale(key({ rocket: new THREE.Vector3() }), key({ rocket: new THREE.Vector3() }))).toBe(false);
    expect(shadowStale(key(), key({ layout: 1 }))).toBe(true);
    expect(shadowStale(key(), key({ scale: 1.01 }))).toBe(true);
  });

  it('the environment cube: the sky changed (Sun > 2°, darkness > 0.05) or the base turned > 2°', () => {
    const k = { sun: new THREE.Vector3(0, 1, 0), night: 0, turn: new THREE.Quaternion() };
    expect(envStale(null, k)).toBe(true);
    expect(envStale(k, { ...k, sun: new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), deg(1)) })).toBe(false);
    expect(envStale(k, { ...k, sun: new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), deg(3)) })).toBe(true);
    expect(envStale(k, { ...k, night: 0.04 })).toBe(false);
    expect(envStale(k, { ...k, night: 0.06 })).toBe(true);
    expect(envStale(k, { ...k, turn: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg(3)) })).toBe(true);
  });

  it('a still Sun at a still base draws the shadow map once', () => {
    const g = new THREE.Group();
    const l = new BaseLighting(g, { shadows: true, shadowSize: 256, envSize: 16 }, 2.4);
    const renderer = { shadowMap: { needsUpdate: false } } as unknown as THREE.WebGLRenderer;
    (l as unknown as { envCamera: null }).envCamera = null; // no GL here: skip the cube render
    const sun = new THREE.Vector3(0.3, 0.9, 0.2).normalize();
    for (let i = 0; i < 100; i++) l.update(renderer, sun, 60, 0, 1.52, 1, null, 0);
    expect(l.shadowUpdates).toBe(1);
  });
});

describe('materials (v2.3)', () => {
  it('High: curved fabric smooth with fabric and normal maps; boxes flat; Low: the v2.1 look, flat and plain', () => {
    const high = new Showcase(JEZERO, { quality: 'high', R, site, textureSize: 32 });
    const hull = (high.group.getObjectByName('kit:hull') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material;
    const flat = (high.group.getObjectByName('kit:hullFlat') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material;
    expect(hull.flatShading).toBe(false);
    expect(hull.map).not.toBeNull();
    expect(hull.normalMap).not.toBeNull();
    expect(flat.flatShading).toBe(true);
    const low = new Showcase(JEZERO, { quality: 'low', R, site, textureSize: 32 });
    const lowHull = (low.group.getObjectByName('kit:hull') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material;
    expect(lowHull.flatShading).toBe(true);
    expect(lowHull.map).toBeNull();
    expect(lowHull.vertexColors).toBe(false);
  });

  it('grime: the lower third darkens toward dust, the windward side (NW) more', () => {
    const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed();
    addGrime(g, WIND_FROM, 1);
    const col = g.getAttribute('color');
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    let top = 1;
    let windward = 1;
    let lee = 1;
    for (let i = 0; i < pos.count; i++) {
      const c = col.getX(i) + col.getY(i) + col.getZ(i);
      if (pos.getY(i) > 0.9) top = Math.min(top, c / 3);
      if (pos.getY(i) < 0.01 && nor.getX(i) < -0.5) windward = Math.min(windward, col.getZ(i));
      if (pos.getY(i) < 0.01 && nor.getX(i) > 0.5) lee = Math.min(lee, col.getZ(i));
    }
    expect(top).toBeCloseTo(1, 6); // clean up high
    expect(windward).toBeLessThan(lee); // dustier facing the wind
    expect(lee).toBeLessThan(1); // some dust all round at the bottom
  });

  it('contact shadows under the modules and movers (one draw call), on every quality', () => {
    for (const quality of ['high', 'low'] as const) {
      const s = new Showcase(JEZERO, { quality, R, site, textureSize: 32 });
      const blobs = s.group.getObjectByName('kit:contact') as THREE.InstancedMesh;
      expect(blobs.count).toBe(JEZERO.modules.length - 1 + JEZERO.roverLoops.length + JEZERO.walks.length); // all but the solar field
    }
  });

  it('only big things cast real shadows: rovers and astronauts get contact blobs instead', () => {
    const s = new Showcase(JEZERO, { quality: 'high', R, site, textureSize: 32 });
    s.setShadows(true);
    expect((s.group.getObjectByName('kit:hull') as THREE.Mesh).castShadow).toBe(true);
    expect((s.group.getObjectByName('kit:rovers:hullFlat') as THREE.Mesh).castShadow).toBe(false);
    expect((s.group.getObjectByName('kit:terrain') as THREE.Mesh).receiveShadow).toBe(true);
    setBaseLayer(s.group, true);
    s.group.traverse((o) => expect(o.layers.isEnabled(BASE_LAYER) && !o.layers.isEnabled(0)).toBe(true));
  });

  it('everything new is freed when leaving: textures, the light, its shadow map and the sky cube', () => {
    const s = new Showcase(JEZERO, { quality: 'high', R, site, textureSize: 32 });
    const textures: THREE.Texture[] = [];
    s.group.traverse((o) => {
      if (o instanceof THREE.Mesh) for (const t of ['map', 'normalMap'] as const) if ((o.material as THREE.MeshStandardMaterial)[t]) textures.push((o.material as THREE.MeshStandardMaterial)[t]!);
    });
    const spies = [...new Set(textures)].filter((t) => t !== s.terrain.material.map).map((t) => vi.spyOn(t, 'dispose'));
    s.dispose();
    for (const sp of spies) expect(sp).toHaveBeenCalled();
    const g = new THREE.Group();
    const l = new BaseLighting(g, { shadows: true, shadowSize: 256, envSize: 16 }, 2.4);
    const env = vi.spyOn(l['envTarget']!, 'dispose');
    l.dispose();
    expect(env).toHaveBeenCalled();
    expect(g.children).toHaveLength(0);
  });
});

describe('Low: no base pass, night by dimming (the v2.2 way)', () => {
  it('lit materials darken as night falls, and come back by day', () => {
    const s = new Showcase(JEZERO, { quality: 'low', R, site, textureSize: 32 });
    const hull = (s.group.getObjectByName('kit:hull') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material;
    const day = hull.color.r;
    s.dimForNight(1);
    expect(hull.color.r).toBeLessThan(day * 0.2);
    s.dimForNight(0);
    expect(hull.color.r).toBeCloseTo(day, 9);
  });
});
