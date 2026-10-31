import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BODIES, moonsOf, reachFactor, systemReach } from '../src/data/bodies';
import { dot, heliocentric, longitude, moonAngle, moonDirection, primeMeridian, spinFrame, type Vec3 } from '../src/data/ephemeris';
import { MOON_SCALE, SCALE, sceneRadius } from '../src/data/scale';

const body = (id: string) => BODIES.find((b) => b.id === id)!;
const moons = BODIES.filter((b) => b.kind === 'moon');
const planets = BODIES.filter((b) => b.kind === 'planet');
const deg = (r: number) => (r * 180) / Math.PI;
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const at = (iso: string) => Date.parse(iso);
const fromJd = (jd: number) => (jd - 2440587.5) * 86_400_000;
const unit = (v: number[]): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

describe('moon data', () => {
  it('has the six moons, each around an existing planet', () => {
    expect(moons.map((m) => m.id)).toEqual(['moon', 'io', 'europa', 'ganymede', 'callisto', 'titan']);
    for (const m of moons) expect(body(m.parent!).kind, m.id).toBe('planet');
  });

  it('keeps the Galilean moons in their 1:2:4 resonance (Laplace: λ₁ − 3λ₂ + 2λ₃ = 180°)', () => {
    const [io, eu, ga] = ['io', 'europa', 'ganymede'].map((id) => body(id).moon!);
    expect(wrap(io.L0! - 3 * eu.L0! + 2 * ga.L0! - 180)).toBeCloseTo(0, 1);
    expect(io.n - 3 * eu.n + 2 * ga.n).toBeCloseTo(0, 5);
  });
});

describe('moon scale', () => {
  it('sizes moons by the planets’ law at half scale, so Ganymede > Titan > Callisto > Io > Moon > Europa', () => {
    for (const m of moons) expect(m.radius, m.id).toBeCloseTo(sceneRadius(m.facts.diameterKm) * MOON_SCALE.size);
    const bySize = [...moons].sort((a, b) => b.radius - a.radius).map((m) => m.id);
    expect(bySize).toEqual(['ganymede', 'titan', 'callisto', 'io', 'moon', 'europa']);
    const smallestPlanet = Math.min(...planets.map((p) => p.radius));
    for (const m of moons) expect(m.radius, m.id).toBeLessThan(smallestPlanet);
  });

  it('never lets a moon touch its planet, its rings or another moon', () => {
    for (const p of planets) {
      const ms = moonsOf(p.id);
      if (!ms.length) continue;
      expect(ms[0].orbitRadius - ms[0].radius - p.radius * reachFactor(p), ms[0].id).toBeGreaterThanOrEqual(MOON_SCALE.gap - 1e-9);
      for (let i = 1; i < ms.length; i++) {
        const gap = ms[i].orbitRadius - ms[i].radius - ms[i - 1].orbitRadius - ms[i - 1].radius;
        expect(gap, `${ms[i - 1].id} → ${ms[i].id}`).toBeGreaterThanOrEqual(MOON_SCALE.gap - 1e-9);
      }
    }
    expect(body('titan').orbitRadius - body('titan').radius).toBeGreaterThan(body('saturn').radius * body('saturn').ring!.outer);
  });

  it('keeps the real order of moon distances, and Callisto clearly farthest', () => {
    const jovian = moonsOf('jupiter').map((m) => m.id);
    expect(jovian).toEqual(['io', 'europa', 'ganymede', 'callisto']);
    const r = moonsOf('jupiter').map((m) => m.orbitRadius);
    expect(r[3] - r[2]).toBeGreaterThan(r[1] - r[0]);
  });

  it('makes room for whole planet systems, so no moon ever touches a neighbouring planet or its moons', () => {
    for (let i = 1; i < planets.length; i++) {
      const [a, b] = [planets[i - 1], planets[i]];
      const gap = b.orbitRadius - a.orbitRadius - systemReach(a) - systemReach(b);
      expect(gap, `${a.id} → ${b.id}`).toBeGreaterThanOrEqual(SCALE.clearance - 1e-9);
    }
  });
});

describe('moon positions (fitted to JPL Horizons)', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/horizons-moons.json', 'utf8'));

  // Titan's orbit is tilted ~0.5° from Saturn's equator, which the model leaves out.
  for (const [id, tolerance] of [['io', 1.2], ['europa', 1.5], ['ganymede', 0.5], ['callisto', 1.2], ['titan', 0.6], ['moon', 0.5]] as const) {
    it(`${id} is within ${tolerance}° of Horizons, 1950–2100`, () => {
      const m = body(id);
      const planet = body(m.parent!);
      for (const [jd, ...xyz] of fixture.moons[id].rows as number[][]) {
        const ms = fromJd(jd);
        const ours = moonDirection(m.moon!, planet, moonAngle(m.moon!, ms), ms);
        const angle = deg(Math.acos(Math.min(1, dot(ours, unit(xyz)))));
        expect(angle, `${id} at JD ${jd}`).toBeLessThan(tolerance);
      }
    });
  }
});

describe('the Moon’s phases', () => {
  // The Sun's direction from Earth is opposite Earth's heliocentric direction.
  const elongation = (iso: string) => {
    const moon = body('moon').moon!;
    const sun = longitude(heliocentric(body('earth').orbit!, at(iso))) + Math.PI;
    return wrap(deg(moonAngle(moon, at(iso)) - sun));
  };

  it('is new at the total solar eclipse of 8 April 2024 (18:17 UTC)', () => {
    expect(Math.abs(elongation('2024-04-08T18:17Z'))).toBeLessThan(1);
  });

  it('is full at the total lunar eclipse of 14 March 2025 (06:59 UTC)', () => {
    expect(Math.abs(wrap(elongation('2025-03-14T06:59Z') - 180))).toBeLessThan(1);
  });

  it('is close to its orbit’s node at both eclipses (that’s why they happened)', () => {
    for (const iso of ['2024-04-08T18:17Z', '2025-03-14T06:59Z']) {
      const moon = body('moon').moon!;
      const dir = moonDirection(moon, body('earth'), moonAngle(moon, at(iso)), at(iso));
      expect(Math.abs(deg(Math.asin(dir[2]))), iso).toBeLessThan(1.5);
    }
  });
});

describe('tidal locking', () => {
  it('each moon’s prime meridian (IAU) faces its planet, so the near side is the right one', () => {
    for (const m of moons) {
      for (const iso of ['1979-03-05T12:00Z', '2000-01-01T12:00Z', '2026-10-23T00:00Z', '2061-07-28T00:00Z']) {
        const ms = at(iso);
        const toPlanet = moonDirection(m.moon!, body(m.parent!), moonAngle(m.moon!, ms), ms).map((x) => -x) as Vec3;
        const meridian = primeMeridian(spinFrame(m, ms));
        // Eccentric orbits make moons wobble (libration): the Moon by up to ~8° as seen from Earth, Titan ~3°.
        const libration = { moon: 10, titan: 5 }[m.id] ?? 3;
        expect(deg(Math.acos(dot(meridian, toPlanet))), `${m.id} ${iso}`).toBeLessThan(libration);
      }
    }
  });
});
