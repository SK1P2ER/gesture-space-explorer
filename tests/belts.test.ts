import { describe, expect, it } from 'vitest';
import { ASTEROIDS, beltBand, clearOf, KUIPER, NEAR_CAMERA, nearCameraScale, sampleBelt, sceneDistance } from '../src/data/belts';
import { BODIES } from '../src/data/bodies';
import { PROFILES } from '../src/quality';

const planets = BODIES.filter((b) => b.kind === 'planet');

describe('sceneDistance (small bodies)', () => {
  it('passes through every planet’s orbit, so 1 AU is on Earth’s', () => {
    for (const p of planets) expect(sceneDistance(p.orbitAU), p.id).toBeCloseTo(p.orbitRadius, 6);
  });

  it('only ever grows with real distance', () => {
    let last = -Infinity;
    for (let au = 0.2; au < 60; au *= 1.05) {
      expect(sceneDistance(au)).toBeGreaterThan(last);
      last = sceneDistance(au);
    }
  });
});

describe('the asteroid belt', () => {
  const sample = sampleBelt(ASTEROIDS, 6000, 11);
  const [inner, outer] = beltBand(ASTEROIDS);

  it('fits between Mars and Jupiter’s moons, touching neither', () => {
    expect(outer - inner).toBeGreaterThan(5);
    expect(clearOf(ASTEROIDS, planets)).toBe(true);
    for (let i = 0; i < sample.count; i++) {
      const r = sample.orbit[i * 4];
      expect(r).toBeGreaterThanOrEqual(inner - 1e-4);
      expect(r).toBeLessThanOrEqual(outer + 1e-4);
    }
  });

  it('leaves the Kirkwood gaps empty (resonances with Jupiter)', () => {
    for (const gap of ASTEROIDS.gaps) {
      const inside = Array.from(sample.a).filter((a) => Math.abs(a - gap) < ASTEROIDS.gapHalfWidth);
      expect(inside, `${gap} AU`).toEqual([]);
    }
    // …while just outside them there are plenty.
    expect(Array.from(sample.a).filter((a) => Math.abs(a - 2.6) < 0.05).length).toBeGreaterThan(100);
  });

  it('moves each rock at its Kepler period (inner rocks overtake outer ones)', () => {
    for (const i of [0, 100, 5999]) {
      const periodYears = (2 * Math.PI) / sample.orbit[i * 4 + 2] / 365.25;
      expect(periodYears).toBeCloseTo(sample.a[i] ** 1.5, 3);
    }
  });

  it('is the same on every load (seeded)', () => {
    expect(sampleBelt(ASTEROIDS, 50, 11).orbit).toEqual(sampleBelt(ASTEROIDS, 50, 11).orbit);
    expect(sampleBelt(ASTEROIDS, 50, 12).orbit).not.toEqual(sampleBelt(ASTEROIDS, 50, 11).orbit);
  });

  it('is a thin disc: mostly within a few units of the plane', () => {
    const heights = Array.from({ length: sample.count }, (_, i) => sample.orbit[i * 4 + 3]).sort((a, b) => a - b);
    expect(heights[Math.floor(heights.length / 2)]).toBeLessThan(3);
  });
});

describe('the Kuiper belt hint', () => {
  it('starts just outside Neptune and its clearance', () => {
    const [inner, outer] = beltBand(KUIPER);
    const neptune = planets.at(-1)!;
    expect(inner).toBeGreaterThan(neptune.orbitRadius + neptune.radius);
    expect(outer).toBeGreaterThan(inner);
    expect(clearOf(KUIPER, planets)).toBe(true);
  });
});

describe('rocks near the camera', () => {
  it('shrink up close, so none looks like a boulder, and are full size well before the overview', () => {
    expect(nearCameraScale(0)).toBe(0);
    expect(nearCameraScale(NEAR_CAMERA.hidden)).toBe(0);
    expect(nearCameraScale(20)).toBeLessThan(0.3);
    expect(nearCameraScale(NEAR_CAMERA.full)).toBe(1);
    expect(nearCameraScale(200)).toBe(1); // the overview's nearest rocks are untouched
    // The largest rock, as wide on screen as it can get: radius / distance, at its worst distance.
    let worst = 0;
    for (let d = 0.5; d < 300; d += 0.1) worst = Math.max(worst, (ASTEROIDS.size[1] * nearCameraScale(d)) / d);
    expect(worst * (900 / 2 / Math.tan((25 * Math.PI) / 180))).toBeLessThan(7); // px of radius on a 900 px tall view
  });
});

describe('quality', () => {
  it('draws fewer rocks on Low, the phone default', () => {
    expect(PROFILES.low.asteroids).toBeLessThan(PROFILES.high.asteroids);
    expect(PROFILES.low.kuiper).toBeLessThan(PROFILES.high.kuiper);
  });
});
