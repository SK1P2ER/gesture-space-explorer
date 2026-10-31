import { describe, expect, it } from 'vitest';
import { BASES } from '../src/data/bases';
import { parsePassport, stamp } from '../src/sim/passport';
import { fuelLeft, KM_PER_AU, mapPoint, routeKm, tripFuel } from '../src/sim/route';

const NOW = Date.UTC(2026, 9, 24);

describe('trip numbers', () => {
  it('measures real distances: the Moon’s orbit, Earth–Mars between 0.37 and 2.7 AU, Saturn ~8–11 AU away', () => {
    expect(routeKm('earth', 'moon', NOW)).toBe(384_400);
    expect(routeKm('moon', 'earth', NOW)).toBe(384_400);
    const mars = routeKm('earth', 'mars', NOW) / KM_PER_AU;
    expect(mars).toBeGreaterThan(0.37);
    expect(mars).toBeLessThan(2.7);
    const titan = routeKm('moon', 'titan', NOW) / KM_PER_AU;
    expect(titan).toBeGreaterThan(8);
    expect(titan).toBeLessThan(11);
    expect(routeKm('mars', 'earth', NOW)).toBeCloseTo(routeKm('earth', 'mars', NOW), 3);
  });

  it('burns more fuel for longer trips, never the whole tank; drains as you go', () => {
    const moon = tripFuel(384_400);
    const saturn = tripFuel(10 * KM_PER_AU);
    expect(moon).toBeLessThan(0.15);
    expect(saturn).toBeGreaterThan(moon);
    expect(saturn).toBeLessThanOrEqual(0.85);
    expect(fuelLeft(0, saturn)).toBe(1);
    expect(fuelLeft(1, saturn)).toBeCloseTo(1 - saturn, 9);
    expect(fuelLeft(2, saturn)).toBeCloseTo(1 - saturn, 9);
  });

  it('maps the system onto the mini-map: inside the circle, in order, directions kept', () => {
    const [x, z] = mapPoint(30, 0, 300);
    expect(x).toBeGreaterThan(0);
    expect(z).toBe(0);
    expect(Math.hypot(...mapPoint(300, 0, 300))).toBeCloseTo(1, 9);
    expect(Math.hypot(...mapPoint(10, 10, 300))).toBeLessThan(Math.hypot(...mapPoint(50, 0, 300)));
    expect(mapPoint(0, 0, 300)).toEqual([0, 0]);
    const [a, b] = mapPoint(-3, 4, 300);
    expect(Math.atan2(b, a)).toBeCloseTo(Math.atan2(4, -3), 9);
  });
});

describe('the passport', () => {
  const ids = BASES.map((b) => b.id);

  it('stamps the first visit only', () => {
    const one = stamp({}, 'cape', 1);
    expect(one.isNew).toBe(true);
    const again = stamp(one.passport, 'cape', 2);
    expect(again.isNew).toBe(false);
    expect(again.passport).toEqual({ cape: 1 });
  });

  it('survives anything in storage', () => {
    for (const bad of [null, '', 'nope', '[1,2]', '42', 'null', '{"cape":"x"}']) expect(parsePassport(bad, ids)).toEqual({});
    expect(parsePassport('{"cape":5,"atlantis":6,"jezero":7}', ids)).toEqual({ cape: 5, jezero: 7 });
    expect(parsePassport(JSON.stringify(stamp({}, 'kraken', 9).passport), ids)).toEqual({ kraken: 9 });
  });
});
