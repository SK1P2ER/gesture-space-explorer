import { describe, expect, it } from 'vitest';
import { BASES } from '../src/data/bases';
import { BODIES } from '../src/data/bodies';
import { atLocalHour, localHours, presetTimes, sunElevation, type PresetSite } from '../src/app/timePresets';
import { GOLDEN_ELEVATION } from '../src/sim/localSky';

const jezero = BASES.find((b) => b.id === 'jezero')!;
const SITE: PresetSite = { body: BODIES.find((b) => b.id === jezero.body)!, lat: jezero.lat, lon: jezero.lon };
const SOL = 88_775_244; // Mars solar day, ms
const hoursAway = (a: number, b: number) => Math.abs(((a - b + 36) % 24) - 12);

describe('Jezero time presets', () => {
  // Anchors across a Mars year and at different local times of day.
  const anchors = [Date.UTC(2026, 10, 26, 0), Date.UTC(2026, 10, 26, 9, 30), Date.UTC(2027, 3, 1, 18), Date.UTC(2028, 0, 15, 5)];

  for (const anchor of anchors) {
    it(`Day / Golden Hour / Night for ${new Date(anchor).toISOString()}: noon, the existing sunset time, then midnight`, () => {
      const t = presetTimes(SITE, anchor);
      expect(t.golden).not.toBeNull();
      expect(hoursAway(localHours(SITE, t.day), 12) * 60).toBeLessThan(1); // within a local minute of 12:00
      expect(Math.abs(t.day - anchor)).toBeLessThanOrEqual(SOL / 2 + 60e3); // the sol containing the anchor
      expect(sunElevation(SITE, t.day)).toBeGreaterThan(45); // high Sun
      expect(Math.abs(sunElevation(SITE, t.golden!) - GOLDEN_ELEVATION)).toBeLessThan(0.05); // ≈ 6°, setting
      expect(sunElevation(SITE, t.golden! + 600e3)).toBeLessThan(GOLDEN_ELEVATION);
      expect(t.golden!).toBeGreaterThan(t.day);
      expect(t.golden! - t.day).toBeLessThan(SOL / 2);
      expect(t.night).toBeGreaterThan(t.golden!);
      expect(hoursAway(localHours(SITE, t.night!), 0) * 60).toBeLessThan(1);
      expect(sunElevation(SITE, t.night!)).toBeLessThan(-18); // dark
    });
  }

  it('deterministic: the same anchor gives the same times, and any moment of the same sol gives the same Day', () => {
    const a = presetTimes(SITE, anchors[0]);
    expect(presetTimes(SITE, anchors[0])).toEqual(a);
    expect(Math.abs(presetTimes(SITE, a.day + 3 * 3600e3).day - a.day)).toBeLessThan(2000);
    expect(Math.abs(presetTimes(SITE, a.day - 3 * 3600e3).day - a.day)).toBeLessThan(2000);
  });

  it('atLocalHour finds the nearest time or the next one', () => {
    const noon = atLocalHour(SITE, anchors[0], 12);
    const next = atLocalHour(SITE, noon + 1000 * 60, 12, 1);
    expect(Math.abs(next - noon - SOL)).toBeLessThan(120e3); // a solar day varies by tens of seconds
  });
});
