import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { seeded } from '../src/data/belts';
import { SHOOTING_STARS, ShootingStarTimer, sceneToEquatorial, skyDirection, skyUv } from '../src/data/sky';
import { PROFILES } from '../src/quality';

describe('sky orientation', () => {
  it('maps the scene to J2000 celestial coordinates', () => {
    // The March equinox (RA 0h) is the scene's +x, as for the planets; the celestial pole is tilted 23.4° from the scene's up.
    const equinox = sceneToEquatorial([1, 0, 0]);
    expect(equinox[0]).toBeCloseTo(1, 9);
    const pole = sceneToEquatorial(skyDirection(0, 90));
    expect(pole[2]).toBeCloseTo(1, 9);
    expect((Math.acos(skyDirection(0, 90)[1]) * 180) / Math.PI).toBeCloseTo(23.439, 2);
  });

  it('reads NASA’s map: RA 0h in the middle, increasing to the left, north at the top', () => {
    const [u0, v0] = skyUv(skyDirection(0, 0));
    expect(u0).toBeCloseTo(0.5, 9);
    expect(v0).toBeCloseTo(0.5, 9);
    const [u6] = skyUv(skyDirection(90, 0)); // RA 6h
    expect(u6).toBeCloseTo(0.25, 9);
    expect(skyUv(skyDirection(123, 60))[1]).toBeCloseTo(1 / 6, 9);
  });
});

describe('the star map texture', () => {
  it('ships at 2K (Low) and 4K (High)', () => {
    expect(PROFILES.low.skyTier).toBe('2k');
    expect(PROFILES.high.skyTier).toBe('4k');
    for (const tier of ['2k', '4k']) expect(existsSync(`public/textures/${tier}/sky.jpg`), tier).toBe(true);
  });

  // Read the 2K map once: grayscale, top row first.
  const map = sharp('public/textures/2k/sky.jpg').greyscale().raw().toBuffer({ resolveWithObject: true });
  const brightest = (data: Buffer, w: number, h: number, ra: number, dec: number, r: number) => {
    const [u, v] = skyUv(skyDirection(ra, dec));
    const [cx, cy] = [Math.round(u * w), Math.round(v * h)];
    let max = 0;
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) max = Math.max(max, data[((y + h) % h) * w + ((x + w) % w)]);
    return max;
  };
  const mean = (data: Buffer, w: number, h: number, ra: number, dec: number, r: number) => {
    const [u, v] = skyUv(skyDirection(ra, dec));
    const [cx, cy] = [Math.round(u * w), Math.round(v * h)];
    let sum = 0;
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) sum += data[((y + h) % h) * w + ((x + w) % w)];
    return sum / (2 * r + 1) ** 2;
  };

  it('has the brightest stars exactly where they are in the sky', async () => {
    const { data, info } = await map;
    const sorted = Uint8Array.from(data).sort();
    const top = sorted[Math.floor(sorted.length * 0.999)]; // the brightest 0.1% of pixels
    const stars: [string, number, number][] = [
      ['Sirius', 101.287, -16.716],
      ['Canopus', 95.988, -52.696],
      ['Vega', 279.235, 38.784],
      ['Arcturus', 213.915, 19.182],
      ['Betelgeuse', 88.793, 7.407],
      ['Rigel', 78.634, -8.202],
      ['Rigil Kentaurus', 219.902, -60.834],
    ];
    for (const [name, ra, dec] of stars) expect(brightest(data, info.width, info.height, ra, dec, 2), name).toBeGreaterThanOrEqual(top);
  });

  it('puts the Milky Way’s bright core toward Sagittarius, not the galactic pole', async () => {
    const { data, info } = await map;
    const core = mean(data, info.width, info.height, 266.405, -28.936, 6); // galactic center
    const pole = mean(data, info.width, info.height, 192.859, 27.128, 6); // north galactic pole
    expect(core).toBeGreaterThan(pole * 3);
  });
});

describe('shooting stars', () => {
  const run = (seconds: number, reducedMotion: boolean) => {
    const timer = new ShootingStarTimer(seeded(3));
    const events: ('start' | number | null)[] = [];
    for (let t = 0; t < seconds; t += 1 / 60) events.push(timer.update(1 / 60, reducedMotion));
    return events;
  };

  it('never happen with reduced motion', () => {
    expect(run(120, true).every((e) => e === null)).toBe(true);
  });

  it('come every 6–15 s and take under a second', () => {
    const events = run(120, false);
    const starts = events.flatMap((e, i) => (e === 'start' ? [i / 60] : []));
    expect(starts.length).toBeGreaterThanOrEqual(120 / (SHOOTING_STARS.gap[1] + SHOOTING_STARS.duration) - 1);
    expect(starts[0]).toBeGreaterThanOrEqual(SHOOTING_STARS.gap[0]);
    for (let k = 1; k < starts.length; k++) {
      const gap = starts[k] - starts[k - 1] - SHOOTING_STARS.duration;
      expect(gap).toBeGreaterThanOrEqual(SHOOTING_STARS.gap[0] - 0.05);
      expect(gap).toBeLessThanOrEqual(SHOOTING_STARS.gap[1] + 0.05);
    }
    const first = events.indexOf('start');
    const during = events.slice(first + 1, first + 1 + Math.floor(SHOOTING_STARS.duration * 60) - 1);
    expect(during.every((e) => typeof e === 'number' && e > 0 && e < 1)).toBe(true);
  });
});
