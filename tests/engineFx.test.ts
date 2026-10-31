import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DUST_FROM, SHAKE_SECONDS } from '../src/app/mission';
import { atmosphereOf, dustFor, FLAME } from '../src/data/atmosphere';
import { DUST_PUFFS, PadDust } from '../src/scene/padDust';
import { Rocket, ROCKET, SEPARATE_AT } from '../src/scene/rocketKit';

const rocket = (quality: 'low' | 'high' = 'high') => new Rocket({ textureSize: 32, quality });
const flame = (r: Rocket, name: string) => r.group.getObjectByName(name) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

describe('air and dust per world', () => {
  it('no dust on the Moon; frost on Europa; most on Mars', () => {
    expect(dustFor('moon').amount).toBe(0);
    expect(dustFor('europa').amount).toBeGreaterThan(0);
    expect(dustFor('mars').amount).toBeGreaterThan(dustFor('earth').amount);
    expect(dustFor('ceres').amount).toBe(0); // anywhere else: none
  });

  it('flames: blue-white and wide in vacuum, orange and narrow in thick air', () => {
    expect(atmosphereOf('earth')).toBe('thick');
    expect(atmosphereOf('mars')).toBe('thin');
    expect(atmosphereOf('moon')).toBe('none');
    expect(FLAME.none.edge[2]).toBeGreaterThan(FLAME.none.edge[0]); // blue
    expect(FLAME.thick.edge[0]).toBeGreaterThan(FLAME.thick.edge[2]); // orange
    expect(FLAME.none.spread).toBeGreaterThan(FLAME.thin.spread);
    expect(FLAME.thin.spread).toBeGreaterThan(FLAME.thick.spread);
  });
});

describe('stage separation and the lander', () => {
  it('a stack fires the booster; after separation the upper stage fires, and the booster tumbles away then is gone', () => {
    const r = rocket();
    r.setThrust(1, 1, 'thick');
    expect(flame(r, 'flame').visible).toBe(true);
    expect(flame(r, 'flame:upper').visible).toBe(false);
    r.separate(false);
    expect(r.stacked).toBe(false);
    r.setThrust(1, 1, 'none');
    expect(flame(r, 'flame').visible).toBe(false);
    expect(flame(r, 'flame:upper').visible).toBe(true);
    r.update(1);
    expect(r.booster.visible).toBe(true); // still tumbling
    expect(r.booster.position.y).toBeLessThan(0); // falling back
    expect(r.booster.rotation.x).not.toBe(0);
    r.update(2.5);
    expect(r.booster.visible).toBe(false);
  });

  it('with reduced motion the booster just goes (no tumble)', () => {
    const r = rocket();
    r.separate(true);
    expect(r.booster.visible).toBe(false);
    expect(r.booster.rotation.x).toBe(0);
  });

  it('the lander stands on its legs: its base at the pad, feet on the ground; restacking brings the booster back', () => {
    const r = rocket();
    r.separate(true);
    r.setLander(true);
    r.setLegs(1);
    r.group.updateMatrixWorld(true);
    const upperFlame = flame(r, 'flame:upper');
    r.upper.remove(upperFlame); // the flame hangs below; measure the stage
    const box = new THREE.Box3().setFromObject(r.upper);
    expect(box.min.y).toBeGreaterThan(-0.07); // only its vacuum bell dips below the base, between the legs
    expect(box.max.y).toBeCloseTo(ROCKET.height - ROCKET.split, 2);
    r.restack();
    expect(r.booster.visible).toBe(true);
    expect(r.upper.position.y).toBe(0);
  });

  it('a steady flame with reduced motion (no flicker)', () => {
    const r = rocket();
    r.setThrust(1, 5, 'thin', true);
    expect(flame(r, 'flame').material.uniforms.flicker.value).toBe(0);
    r.setThrust(1, 5, 'thin', false);
    expect(flame(r, 'flame').material.uniforms.flicker.value).toBe(1);
  });

  it('6 draw calls in all (two hulls, engines, legs, two flames); shock diamonds on High only', () => {
    expect(rocket('high').stats().meshes).toBeLessThanOrEqual(6);
    expect(flame(rocket('high'), 'flame').material.uniforms.shocks.value).toBe(1);
    expect(flame(rocket('low'), 'flame').material.uniforms.shocks.value).toBe(0);
    expect(SEPARATE_AT).toBeGreaterThan(0.2);
    expect(SEPARATE_AT).toBeLessThan(0.5);
    expect(DUST_FROM).toBeGreaterThan(0.5);
    expect(SHAKE_SECONDS).toBeLessThanOrEqual(1.5);
  });
});

describe('pad dust', () => {
  const pad = { center: new THREE.Vector3(5, 0, 0), normal: new THREE.Vector3(1, 0, 0), size: 0.1 };
  const cam = new THREE.PerspectiveCamera();
  const run = (d: PadDust, seconds: number, emit: number, amount: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) d.update(1 / 60, pad, cam, emit, amount, 0xc0704a, 0);
  };

  it('billows while the engines blow, up to its budget; none where there is no dust (the Moon)', () => {
    const mars = new PadDust(DUST_PUFFS.full);
    run(mars, 1, 1, 1);
    expect(mars.live).toBeGreaterThan(50);
    expect(mars.live).toBeLessThanOrEqual(DUST_PUFFS.full);
    const moon = new PadDust(DUST_PUFFS.full);
    run(moon, 2, 1, dustFor('moon').amount);
    expect(moon.live).toBe(0);
    const low = new PadDust(DUST_PUFFS.few);
    run(low, 2, 1, 1);
    expect(low.live).toBeLessThanOrEqual(DUST_PUFFS.few);
  });

  it('settles and clears once the engines stop; puffs spread out over the pad, not into it', () => {
    const d = new PadDust(DUST_PUFFS.full);
    run(d, 0.8, 1, 1);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < d.mesh.count; i++) {
      d.mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(p.x).toBeGreaterThanOrEqual(5 - 1e-9); // on or above the pad's plane (normal +x)
    }
    run(d, 4, 0, 1);
    expect(d.live).toBe(0);
    d.dispose();
  });
});

describe('the chase camera at liftoff', () => {
  it('is pushed out above the ground when "behind the rocket" would be inside the planet', async () => {
    const { keepAbove } = await import('../src/app/mission');
    const c = new THREE.Vector3(0, 0, 0);
    expect(keepAbove(new THREE.Vector3(0, 0.5, 0), c, 1.06).length()).toBeCloseTo(1.06, 9);
    expect(keepAbove(new THREE.Vector3(0, 2, 0), c, 1.06).y).toBe(2); // already above: untouched
  });
});

describe('the look-back at separation', () => {
  it('eases in, holds, and eases out within its ~1.5 s', async () => {
    const { lookBackWeight, LOOK_BACK_SECONDS } = await import('../src/app/mission');
    expect(LOOK_BACK_SECONDS).toBeCloseTo(1.5, 9);
    expect(lookBackWeight(0)).toBe(0);
    expect(lookBackWeight(LOOK_BACK_SECONDS / 2)).toBe(1);
    expect(lookBackWeight(LOOK_BACK_SECONDS)).toBe(0);
    expect(lookBackWeight(0.1)).toBeGreaterThan(0);
    expect(lookBackWeight(0.1)).toBeLessThan(1);
  });
});
