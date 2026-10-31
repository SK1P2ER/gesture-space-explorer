import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ACCEPTS } from '../src/app/modes';
import { config } from '../src/config';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { keyToIntent } from '../src/input/keyboard';
import { HORIZON, HorizonSky } from '../src/scene/baseKit/horizon';
import { Showcase, TRACKER_LIMIT } from '../src/scene/baseKit/showcase';

const R = 1.574 / 0.28;
const site = { point: new THREE.Vector3(0, 1, 0), quaternion: new THREE.Quaternion(), scale: 1 / R };

describe('day and night at the showcase base', () => {
  it('windows light up and the greenhouse glows brighter as it gets dark', () => {
    const s = new Showcase(JEZERO, { quality: 'low', R, site });
    const window = (s.group.getObjectByName('kit:window') as THREE.Mesh).material as THREE.MeshBasicMaterial;
    s.setDaylight(0, new THREE.Vector3(0, 1, 0), 1);
    const day = window.color.getHSL({ h: 0, s: 0, l: 0 }).l;
    s.setDaylight(1, new THREE.Vector3(0, -1, 0), 1);
    expect(window.color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(day + 0.2);
  });

  it('solar panels track the Sun east to west, within their limit, and stow flat at night', () => {
    const s = new Showcase(JEZERO, { quality: 'low', R, site });
    s.setDaylight(0, new THREE.Vector3(1, 1, 0).normalize(), 1); // morning: Sun in the east, 45° up
    expect(s.tilt).toBeCloseTo(Math.PI / 4, 6);
    s.setDaylight(0, new THREE.Vector3(-1, 0.05, 0).normalize(), 1); // low in the west
    expect(s.tilt).toBeCloseTo(-TRACKER_LIMIT, 6);
    s.setDaylight(1, new THREE.Vector3(0, -1, 0), 1);
    expect(s.tilt).toBe(0);
    // Eased, not snapped, in normal use.
    s.setDaylight(0, new THREE.Vector3(1, 1, 0).normalize(), 0.1);
    expect(s.tilt).toBeCloseTo((Math.PI / 4) * 0.1, 6);
  });

  it('a flat build (the horizon view) stands on level ground', () => {
    const flat = new Showcase(JEZERO, { quality: 'low', R: 1e6, site });
    const box = new THREE.Box3().setFromObject(flat.group.getObjectByName('kit:hull')!);
    expect(box.min.y).toBeGreaterThan(-0.001);
  });
});

describe('the horizon sky', () => {
  const sky = () => new HorizonSky(() => [0.5, 0.5]);
  const up = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();
  const eye = new THREE.Vector3(0, 0.055, 2);

  it('shows the sky moons only above the horizon, sized from their real angular size (magnified)', () => {
    const s = sky();
    s.update({ dir: up(0, 1, 0), elevation: 60, night: 0 }, [
      { id: 'phobos', dir: up(0.2, 0.8, 0), angularRadius: 0.0019 },
      { id: 'deimos', dir: up(0, -0.3, 1), angularRadius: 0.0003 },
    ], eye);
    const phobos = s.group.getObjectByName('horizon:phobos')!;
    expect(phobos.visible).toBe(true);
    expect(s.group.getObjectByName('horizon:deimos')!.visible).toBe(false);
    expect(phobos.scale.x).toBeCloseTo(0.0019 * HORIZON.moonMagnify * HORIZON.skyDistance, 6);
    expect(phobos.position.distanceTo(new THREE.Vector3(eye.x, 0, eye.z))).toBeCloseTo(HORIZON.skyDistance, 6);
  });

  it('Earth is a star only once the sky is dark; the dome clears at night', () => {
    const s = sky();
    const earth = s.group.getObjectByName('horizon:earth')!;
    const dome = s.group.getObjectByName('horizon:sky') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    s.update({ dir: up(0, 1, 0), elevation: 50, night: 0 }, [{ id: 'earth', dir: up(0, 0.5, 1), angularRadius: 0 }], eye);
    expect(earth.visible).toBe(false);
    expect(dome.material.uniforms.night.value).toBe(0);
    s.update({ dir: up(0, -1, 0), elevation: -30, night: 1 }, [{ id: 'earth', dir: up(0, 0.5, 1), angularRadius: 0 }], eye);
    expect(earth.visible).toBe(true);
    expect(dome.material.uniforms.night.value).toBe(1);
  });

  it('labels only what is showing; true scale draws the moons at real size; 5 draw calls in all', () => {
    const s = sky();
    const objects = [
      { id: 'phobos', dir: up(0.2, 0.8, 0), angularRadius: 0.0019 },
      { id: 'deimos', dir: up(0, -0.3, 1), angularRadius: 0.0003 },
      { id: 'earth', dir: up(0, 0.5, 1), angularRadius: 0 },
    ];
    s.update({ dir: up(0, -1, 0), elevation: -30, night: 1 }, objects, eye, 1);
    expect(s.labelPoints().map((l) => l.id).sort()).toEqual(['earth', 'phobos']); // Deimos is below the horizon
    expect(s.group.getObjectByName('horizon:phobos')!.scale.x).toBeCloseTo(0.0019 * HORIZON.skyDistance, 9);
    let meshes = 0;
    s.group.traverse((o) => { if (o instanceof THREE.Mesh) meshes++; });
    expect(meshes).toBeLessThanOrEqual(5);
  });

  it('frees what it made', () => {
    const s = sky();
    const parent = new THREE.Group().add(s.group);
    s.dispose();
    expect(parent.children).toHaveLength(0);
  });
});

describe('the horizon view’s input', () => {
  it('O toggles it, and only BaseView takes it', () => {
    expect(keyToIntent('o', config.keyboard)).toEqual({ type: 'toggleHorizon' });
    expect(ACCEPTS.baseView.has('toggleHorizon')).toBe(true);
    for (const mode of ['launch', 'travel', 'docking'] as const) expect(ACCEPTS[mode].has('toggleHorizon'), mode).toBe(false);
  });
});

describe('Phobos outside its fitted years', () => {
  it('is marked approximate before 2020 and after 2035', async () => {
    const { skyOver } = await import('../src/app/baseSky');
    const { BODIES } = await import('../src/data/bodies');
    const mars = BODIES.find((b) => b.id === 'mars')!;
    const node = { base: { lat: 18.4, lon: 77.6 }, body: { body: mars }, group: new THREE.Group() } as unknown as Parameters<typeof skyOver>[0];
    const phobosFlag = (iso: string) => {
      // Step until Phobos is up, then read its flag.
      for (let h = 0; h < 48; h++) {
        const u = skyOver(node, Date.parse(iso) + h * 3600e3).up.find((x) => x.id === 'phobos');
        if (u) return u.approximate;
      }
      return undefined;
    };
    expect(phobosFlag('2026-12-24T00:00:00Z')).toBe(false);
    expect(phobosFlag('2040-06-01T00:00:00Z')).toBe(true);
    expect(phobosFlag('2015-06-01T00:00:00Z')).toBe(true);
  });
});
