import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BASES, baseOn, mapUv, surfacePoint } from '../src/data/bases';
import { BODIES, LANGS } from '../src/data/bodies';
import { baseSize, PAD_RADIUS } from '../src/scene/bases';

describe('bases', () => {
  it('are the five planned, each on an existing planet or moon', () => {
    expect(BASES.map((b) => `${b.id}@${b.body}`)).toEqual(['cape@earth', 'tranquility@moon', 'jezero@mars', 'conamara@europa', 'kraken@titan']);
    for (const b of BASES) expect(['planet', 'moon']).toContain(BODIES.find((x) => x.id === b.body)?.kind);
    expect(baseOn('mars')?.id).toBe('jezero');
    expect(baseOn('venus')).toBeNull();
  });

  it('have names and descriptions in English, Burmese and Japanese', () => {
    for (const b of BASES) for (const lang of LANGS) {
      expect(b.name[lang].trim(), `${b.id}.${lang}`).not.toBe('');
      expect(b.blurb[lang].trim(), `${b.id}.${lang}`).not.toBe('');
    }
  });

  it('stand where the texture shows that latitude and longitude (same mapping as the sphere)', () => {
    // three's SphereGeometry, with the UVs flipped north → south as planets/planet.ts does.
    const sphere = new THREE.SphereGeometry(1, 128, 64);
    const pos = sphere.attributes.position;
    const uv = sphere.attributes.uv;
    for (const b of BASES) {
      const p = new THREE.Vector3(...surfacePoint(b.lat, b.lon));
      let best = 0;
      for (let i = 1; i < pos.count; i++) if (p.distanceToSquared(new THREE.Vector3().fromBufferAttribute(pos, i)) < p.distanceToSquared(new THREE.Vector3().fromBufferAttribute(pos, best))) best = i;
      const [u, v] = mapUv(b.lat, b.lon);
      expect(Math.abs(uv.getX(best) - u), b.id).toBeLessThan(0.01);
      expect(Math.abs(1 - uv.getY(best) - v), b.id).toBeLessThan(0.02);
      expect(p.length()).toBeCloseTo(1, 9);
    }
  });

  it('fit on their body: the pad is a small patch of the surface', () => {
    for (const b of BASES) {
      const r = BODIES.find((x) => x.id === b.body)!.radius;
      expect((baseSize(r) * PAD_RADIUS) / r, b.id).toBeLessThan(0.1);
    }
  });
});
