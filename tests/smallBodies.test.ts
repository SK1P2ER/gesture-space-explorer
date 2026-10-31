import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BODIES, sceneDistance, systemReach } from '../src/data/bodies';
import { dot, heliocentric, length, longitude, nextPerihelion, sunCentered, type Vec3 } from '../src/data/ephemeris';
import { activity, tailShape } from '../src/scene/comet';
import { SimClock, YEAR } from '../src/sim/clock';
import { monthLabel } from '../src/ui/timeFormat';
import { kgLabel } from '../src/ui/weightPanel';

const body = (id: string) => BODIES.find((b) => b.id === id)!;
const fromJd = (jd: number) => (jd - 2440587.5) * 86_400_000;
const at = (iso: string) => Date.parse(iso);
const deg = (r: number) => (r * 180) / Math.PI;
const angle = (a: Vec3, b: Vec3) => deg(Math.acos(Math.min(1, dot(a, b) / length(a) / length(b))));

describe('Pluto and Halley’s Comet vs JPL Horizons', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/horizons-small-bodies.json', 'utf8'));

  it('puts Pluto within 0.05° and 0.1% of Horizons, 1910–2061', () => {
    for (const [jd, ...xyz] of fixture.bodies.pluto as number[][]) {
      const ours = sunCentered(body('pluto'), fromJd(jd));
      expect(angle(ours, xyz as Vec3), `JD ${jd}`).toBeLessThan(0.05);
      expect(length(ours) / length(xyz as Vec3), `JD ${jd}`).toBeCloseTo(1, 2);
    }
  });

  it('puts Halley within 3.5° and 3% of Horizons from its 1986 visit to its 2061 one', () => {
    for (const [jd, ...xyz] of fixture.bodies.halley as number[][]) {
      if (jd < 2446000) continue; // 1910: a two-body orbit can't match every return (see bodies.ts)
      const ours = sunCentered(body('halley'), fromJd(jd));
      expect(angle(ours, xyz as Vec3), `JD ${jd}`).toBeLessThan(3.5);
      expect(Math.abs(length(ours) / length(xyz as Vec3) - 1), `JD ${jd}`).toBeLessThan(0.03);
    }
  });

  it('brings Halley back on 28 July 2061', () => {
    const next = nextPerihelion(body('halley').comet!, at('2026-10-23T00:00Z'));
    expect(Math.abs(next - at('2061-07-28T00:00Z')) / 86_400_000).toBeLessThan(2);
    expect(length(sunCentered(body('halley'), next))).toBeCloseTo(0.59, 2);
  });
});

describe('Pluto in the scene', () => {
  it('really was closer to the Sun than Neptune from 1979 to 1999, and is farther now', () => {
    const r = (id: string, iso: string) => length(heliocentric(body(id).orbit!, at(iso)));
    expect(r('pluto', '1990-01-01T00:00Z')).toBeLessThan(r('neptune', '1990-01-01T00:00Z'));
    expect(r('pluto', '2026-10-23T00:00Z')).toBeGreaterThan(r('neptune', '2026-10-23T00:00Z'));
  });

  it('never comes near Neptune on screen, 1800–2100 (they never meet: a 3:2 resonance)', () => {
    const neptune = body('neptune');
    let closest = Infinity;
    for (let t = at('1800-01-01T00:00Z'); t < at('2100-01-01T00:00Z'); t += 30 * 86_400_000) {
      const p = sunCentered(body('pluto'), t);
      const pluto = new THREE.Vector3(p[0], p[2], -p[1]).setLength(sceneDistance(length(p)));
      const lon = longitude(heliocentric(neptune.orbit!, t));
      const nep = new THREE.Vector3(Math.cos(lon), 0, -Math.sin(lon)).multiplyScalar(neptune.orbitRadius);
      closest = Math.min(closest, pluto.distanceTo(nep));
    }
    expect(closest).toBeGreaterThan(systemReach(neptune) + body('pluto').radius + 10);
  });
});

describe('the comet’s tails', () => {
  it('only grow inside ~4 AU, fullest at perihelion', () => {
    expect(activity(35)).toBe(0);
    expect(activity(4.5)).toBe(0);
    expect(activity(0.59)).toBe(1);
    expect(activity(2)).toBeGreaterThan(activity(3));
  });

  it('point away from the Sun; the dust tail curves back along the orbit', () => {
    const head = new THREE.Vector3(10, 2, -5);
    const motion = new THREE.Vector3(0, 0, 1);
    const shape = tailShape(head, motion, 1);
    const ion = shape.ion(1, new THREE.Vector3()).sub(head).normalize();
    expect(ion.dot(head.clone().normalize())).toBeCloseTo(1, 6);
    const dust = shape.dust(1, new THREE.Vector3()).sub(head);
    expect(dust.dot(head)).toBeGreaterThan(0);
    expect(dust.dot(motion)).toBeLessThan(0);
  });
});

describe('the comet’s card', () => {
  it('names the month of its next visit in every language', () => {
    const t = at('2061-07-28T00:00Z');
    expect(monthLabel(t, 'en', 'UTC')).toBe('Jul 2061');
    expect(monthLabel(t, 'ja', 'UTC')).toBe('2061年7月');
    expect(monthLabel(t, 'my', 'UTC')).toBe('၂၀၆၁ ဇူ');
  });

  it('weighs you in grams on an 11 km nucleus', () => {
    expect(kgLabel((70 * 0.0005) / 9.8, 'en')).toBe('3.6 g');
    expect(kgLabel(26.43, 'en')).toBe('26.4 kg');
  });

  it('can set a watchable speed for the visit', () => {
    const clock = new SimClock(0);
    clock.togglePause();
    clock.setRate(86_400);
    expect(clock.paused).toBe(false);
    expect(clock.rate).toBe(86_400);
    clock.setRate(-10 * YEAR);
    expect(clock.rate).toBe(-YEAR);
  });
});
