import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BODIES } from '../src/data/bodies';
import { dot, moonAngle, moonDirection, type Vec3 } from '../src/data/ephemeris';
import { SKY_MOONS } from '../src/data/skyMoons';
import { clockLabel, nightness, planetDirection, siteFrame, skyMoonDirection, skyPosition, solarDay, sunDirection } from '../src/sim/localSky';

const body = (id: string) => BODIES.find((b) => b.id === id)!;
const at = (iso: string) => Date.parse(iso);
const day = (id: string, lat: number, lon: number, iso: string) => {
  const b = body(id);
  return solarDay(siteFrame(b, lat, lon, at(iso)), sunDirection(b, at(iso)));
};

describe('the local sky: checked on Earth first', () => {
  it('Greenwich at 12:00 UTC on the March equinox: local solar noon (within the equation of time)', () => {
    const d = day('earth', 51.48, 0, '2026-03-20T12:00:00Z');
    expect(Math.abs(d.hours - 12)).toBeLessThan(0.25); // the equation of time is −7.5 min that day
  });

  it('on the equator at an equinox the Sun rises at 6 and sets at 18', () => {
    const d = day('earth', 0, 30, '2026-03-20T12:00:00Z');
    expect(d.sunrise!).toBeCloseTo(6, 1);
    expect(d.sunset!).toBeCloseTo(18, 1);
  });

  it('London at midsummer has a ~16.4 h day (Sun center, no refraction); Tromsø has the midnight sun', () => {
    const d = day('earth', 51.5, 0, '2026-06-21T12:00:00Z');
    expect(d.sunset! - d.sunrise!).toBeGreaterThan(16.1);
    expect(d.sunset! - d.sunrise!).toBeLessThan(16.6);
    expect(day('earth', 69.6, 18.9, '2026-06-21T12:00:00Z').polar).toBe('day');
    expect(day('earth', 69.6, 18.9, '2026-12-21T12:00:00Z').polar).toBe('night');
  });

  it('the hours follow the Sun: 6 hours later is a quarter turn later', () => {
    const a = day('earth', 10, 100, '2026-05-01T00:00:00Z').hours;
    const b = day('earth', 10, 100, '2026-05-01T06:00:00Z').hours;
    expect(((b - a + 24) % 24)).toBeCloseTo(6, 1);
  });

  it('labels and night', () => {
    expect(clockLabel(9.69)).toBe('09:41');
    expect(clockLabel(23.999)).toBe('00:00');
    expect(nightness(30)).toBe(0);
    expect(nightness(-6)).toBe(1);
  });
});

describe('Jezero’s sky', () => {
  const mars = body('mars');
  const T0 = at('2026-12-24T00:00:00Z');

  it('a Martian day: sunrise before noon before sunset, 10–14 local hours of daylight, and the Sun highest at noon', () => {
    const d = solarDay(siteFrame(mars, 18.4, 77.6, T0), sunDirection(mars, T0));
    expect(d.sunrise!).toBeLessThan(12);
    expect(d.sunset!).toBeGreaterThan(12);
    expect(d.sunset! - d.sunrise!).toBeGreaterThan(10);
    expect(d.sunset! - d.sunrise!).toBeLessThan(14);
    // Step through one sol: elevation peaks near local noon.
    let best = { e: -90, h: 0 };
    for (let k = 0; k < 296; k++) {
      const ms = T0 + k * 5 * 60e3;
      const s = solarDay(siteFrame(mars, 18.4, 77.6, ms), sunDirection(mars, ms));
      if (s.elevation > best.e) best = { e: s.elevation, h: s.hours };
    }
    expect(Math.abs(best.h - 12)).toBeLessThan(0.2);
  });

  it('Phobos rises and sets over Jezero, but never clears the horizon near the poles (it orbits too low)', () => {
    const phobos = SKY_MOONS.find((m) => m.id === 'phobos')!;
    const elevations = (lat: number) => Array.from({ length: 200 }, (_, k) => {
      const ms = T0 + k * 20 * 60e3;
      const f = siteFrame(mars, lat, 77.6, ms);
      return skyPosition(f, skyMoonDirection(phobos, mars, f, ms)).elevation;
    });
    const jezero = elevations(18.4);
    expect(Math.max(...jezero)).toBeGreaterThan(30);
    expect(Math.min(...jezero)).toBeLessThan(0);
    expect(Math.max(...elevations(75))).toBeLessThan(0);
  });

  it('Earth is sometimes above Jezero’s horizon', () => {
    const earth = body('earth');
    const els = Array.from({ length: 50 }, (_, k) => {
      const ms = T0 + k * 30 * 60e3;
      return skyPosition(siteFrame(mars, 18.4, 77.6, ms), planetDirection(mars, earth, ms)).elevation;
    });
    expect(Math.max(...els)).toBeGreaterThan(0);
    expect(Math.min(...els)).toBeLessThan(0);
  });
});

describe('Phobos and Deimos against JPL Horizons (held-out positions, 2024–2032)', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/horizons-mars-moons.json', 'utf8'));
  const fromJd = (jd: number) => (jd - 2440587.5) * 86400000;
  for (const [id, tolerance] of [['phobos', 3.5], ['deimos', 2.5]] as const) {
    it(`${id} is within ${tolerance}°`, () => {
      const moon = SKY_MOONS.find((m) => m.id === id)!;
      for (const [jd, ...xyz] of fixture.moons[id].rows as number[][]) {
        const ms = fromJd(jd);
        const ours = moonDirection(moon.orbit, body('mars'), moonAngle(moon.orbit, ms), ms);
        const l = Math.hypot(...xyz);
        const angle = (Math.acos(Math.min(1, dot(ours, xyz.map((v) => v / l) as Vec3))) * 180) / Math.PI;
        expect(angle, `${id} at JD ${jd}`).toBeLessThan(tolerance);
      }
    });
  }
});

describe('golden hour', () => {
  it('finds the Sun 6° up and setting, before the next sunset at Jezero', async () => {
    const { nextSetting, GOLDEN_ELEVATION } = await import('../src/sim/localSky');
    const mars = BODIES.find((b) => b.id === 'mars')!;
    const from = Date.parse('2026-12-24T00:00:00Z');
    const ms = nextSetting(mars, 18.4, 77.6, from)!;
    expect(ms).toBeGreaterThan(from);
    expect(ms - from).toBeLessThan(1.03 * 86_400e3 * 1.03); // within about a sol
    const elev = (t: number) => skyPosition(siteFrame(mars, 18.4, 77.6, t), sunDirection(mars, t)).elevation;
    expect(elev(ms)).toBeCloseTo(GOLDEN_ELEVATION, 0);
    expect(elev(ms + 600e3)).toBeLessThan(elev(ms)); // setting, not rising
    expect(nextSetting(BODIES.find((b) => b.id === 'earth')!, 89, 0, Date.parse('2026-06-21T00:00:00Z'))).toBeNull(); // midnight sun
  });
});
