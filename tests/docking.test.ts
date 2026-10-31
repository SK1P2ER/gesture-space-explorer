import { describe, expect, it } from 'vitest';
import { dockingParams, startDocking, stepDocking, type DockingState } from '../src/sim/docking';

const GRAVITIES = { moon: 1.62, titan: 1.354, europa: 1.315, mars: 3.7, earth: 9.8 };

function fly(gravity: number, steer: (s: DockingState) => { x: number; z: number } | null, auto = false, alt = 8) {
  const p = dockingParams(gravity);
  let s = startDocking(alt);
  let seconds = 0;
  while (!s.outcome && seconds < 120) {
    s = stepDocking(s, 1 / 60, p, steer(s), auto);
    seconds += 1 / 60;
  }
  return { s, seconds };
}

describe('docking', () => {
  it('auto-land always lands on the pad, on every world', () => {
    for (const [world, g] of Object.entries(GRAVITIES)) {
      const { s } = fly(g, () => null, true);
      expect(s.outcome, world).toBe('landed');
      expect(Math.hypot(s.x, s.z), world).toBeLessThan(0.3);
    }
  });

  it('steering for the center by hand lands too', () => {
    for (const [world, g] of Object.entries(GRAVITIES)) expect(fly(g, () => ({ x: 0, z: 0 })).s.outcome, world).toBe('landed');
  });

  it('without steering, the wind blows you off the pad on Earth', () => {
    expect(fly(GRAVITIES.earth, () => null).s.outcome).toBe('missed');
  });

  it('steering away misses', () => {
    expect(fly(GRAVITIES.moon, () => ({ x: 3, z: 0 })).s.outcome).toBe('missed');
  });

  it('is harder where gravity is stronger: faster descent (less time) and stronger gusts', () => {
    const [moon, earth] = [dockingParams(GRAVITIES.moon), dockingParams(GRAVITIES.earth)];
    expect(earth.descent).toBeGreaterThan(moon.descent);
    expect(earth.gust).toBeGreaterThan(moon.gust);
    expect(fly(GRAVITIES.earth, () => null, true).seconds).toBeLessThan(fly(GRAVITIES.moon, () => null, true).seconds);
  });

  it('stops when it touches down', () => {
    const { s } = fly(GRAVITIES.mars, () => null, true);
    expect(s.alt).toBe(0);
    expect(stepDocking(s, 1, dockingParams(3.7), { x: 2, z: 2 }, false)).toBe(s);
  });
});
