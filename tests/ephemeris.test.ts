import { describe, expect, it } from 'vitest';
import { BODIES } from '../src/data/bodies';
import {
  cross,
  dot,
  heliocentric,
  length,
  lightSeconds,
  longitude,
  primeMeridian,
  spinFrame,
  type Vec3,
} from '../src/data/ephemeris';

// Checked against real events (dates from published almanacs, UTC).

const body = (id: string) => BODIES.find((b) => b.id === id)!;
const at = (iso: string) => Date.parse(iso);
const deg = (r: number) => (r * 180) / Math.PI;
const lonDeg = (id: string, iso: string) => (deg(longitude(heliocentric(body(id).orbit!, at(iso)))) + 360) % 360;
/** Signed difference a − b in degrees, in (-180, 180]. */
const diff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

// The data is in the J2000 frame; equinoxes "of date" have precessed by ~50.3″ per year since.
const PRECESSION_2024 = (24.2 * 50.29) / 3600;

describe('planet positions (JPL elements)', () => {
  it.each([
    ['March equinox', '2024-03-20T03:06Z', 180],
    ['June solstice', '2024-06-20T20:51Z', 270],
    ['September equinox', '2024-09-22T12:44Z', 0],
    ['December solstice', '2024-12-21T09:20Z', 90],
  ])('Earth is opposite the Sun’s seasonal point at the %s', (_, iso, expected) => {
    expect(Math.abs(diff(lonDeg('earth', iso), expected - PRECESSION_2024))).toBeLessThan(0.5);
  });

  it.each([
    ['Mars opposition', 'mars', '2025-01-16T02:38Z'],
    ['Jupiter opposition', 'jupiter', '2024-12-07T21:00Z'],
    ['Saturn opposition', 'saturn', '2024-09-08T04:00Z'],
    ['Uranus opposition', 'uranus', '2024-11-17T02:00Z'],
    ['Neptune opposition', 'neptune', '2024-09-21T00:00Z'],
    ['Venus inferior conjunction', 'venus', '2025-03-23T01:00Z'],
  ])('%s: lined up with Earth', (_, id, iso) => {
    expect(Math.abs(diff(lonDeg(id, iso), lonDeg('earth', iso)))).toBeLessThan(1.5);
  });

  it('puts Earth closest to the Sun in early January and farthest in early July', () => {
    expect(length(heliocentric(body('earth').orbit!, at('2024-01-03T00:39Z')))).toBeCloseTo(0.98331, 3);
    expect(length(heliocentric(body('earth').orbit!, at('2024-07-05T05:06Z')))).toBeCloseTo(1.01673, 3);
  });

  it('follows Mercury’s eccentric orbit (0.307–0.467 AU)', () => {
    const r = Array.from({ length: 90 }, (_, d) => length(heliocentric(body('mercury').orbit!, at('2025-01-01T00:00Z') + d * 86_400_000)));
    expect(Math.min(...r)).toBeCloseTo(0.3075, 3);
    expect(Math.max(...r)).toBeCloseTo(0.4667, 3);
  });

  it('sunlight takes ~499 s to reach Earth', () => {
    expect(lightSeconds(body('earth').orbit!, at('2024-04-04T00:00Z'))).toBeGreaterThan(495);
    expect(lightSeconds(body('earth').orbit!, at('2024-04-04T00:00Z'))).toBeLessThan(502);
  });

  it('orbitAU (used for the scene scale) matches each orbit’s semi-major axis', () => {
    for (const b of BODIES.filter((x) => x.orbit)) expect(b.orbitAU, b.id).toBeCloseTo(b.orbit!.a[0], 2);
  });
});

describe('rotation (IAU poles and prime meridians)', () => {
  /** Where the Sun is overhead on Earth: latitude and east longitude, degrees. */
  function subsolar(iso: string) {
    const earth = body('earth');
    const r = heliocentric(earth.orbit!, at(iso));
    const toSun: Vec3 = [-r[0] / length(r), -r[1] / length(r), -r[2] / length(r)];
    const frame = spinFrame(earth, at(iso));
    const meridian = primeMeridian(frame);
    const east = cross(frame.pole, meridian);
    return { lat: deg(Math.asin(dot(toSun, frame.pole))), lon: deg(Math.atan2(dot(toSun, east), dot(toSun, meridian))) };
  }

  it('at noon UTC on the March equinox the Sun is overhead near Greenwich', () => {
    const s = subsolar('2024-03-20T12:00Z');
    expect(Math.abs(s.lat)).toBeLessThan(0.5);
    // The equation of time is about −7.5 min then: the Sun crosses Greenwich at ~12:07, so it's ~1.9° east at 12:00.
    expect(s.lon).toBeGreaterThan(0.4);
    expect(s.lon).toBeLessThan(3.4);
  });

  it('gives seasons: the Sun is over the Tropic of Cancer in June and Capricorn in December', () => {
    expect(subsolar('2024-06-20T20:51Z').lat).toBeCloseTo(23.44, 0);
    expect(subsolar('2024-12-21T09:20Z').lat).toBeCloseTo(-23.44, 0);
  });

  it('pole directions agree with each planet’s axial tilt', () => {
    for (const b of BODIES.filter((x) => x.orbit)) {
      const o = b.orbit!;
      const [i, node] = [(o.i[0] * Math.PI) / 180, (o.node[0] * Math.PI) / 180];
      const orbitNormal: Vec3 = [Math.sin(i) * Math.sin(node), -Math.sin(i) * Math.cos(node), Math.cos(i)];
      const angle = deg(Math.acos(dot(spinFrame(b, 0).pole, orbitNormal)));
      // IAU "north" is the pole on the north side of the Solar System, so compare the axis, not its direction.
      const axis = Math.min(angle, 180 - angle);
      expect(Math.abs(axis - Math.min(b.tiltDeg, 180 - b.tiltDeg)), b.id).toBeLessThan(1.5);
    }
  });
});
