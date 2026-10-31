import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { BODIES } from '../src/data/bodies';
import { lightSeconds } from '../src/data/ephemeris';
import { gravityRatio, MAX_KG, MIN_KG, parseWeight, weightOn } from '../src/data/weight';
import { keyToIntent } from '../src/input/keyboard';
import { lightTimeLabel } from '../src/ui/timeFormat';
import { kgLabel } from '../src/ui/weightPanel';

const body = (id: string) => BODIES.find((b) => b.id === id)!;
const at = (iso: string) => Date.parse(iso);

describe('surface gravity (NASA fact sheets)', () => {
  it('has a value for every body, in m/s²', () => {
    const g = Object.fromEntries(BODIES.map((b) => [b.id, b.gravity]));
    expect(g).toEqual({
      sun: 274, mercury: 3.7, venus: 8.9, earth: 9.8, moon: 1.62, mars: 3.7,
      jupiter: 23.1, io: 1.796, europa: 1.315, ganymede: 1.428, callisto: 1.236,
      saturn: 9, titan: 1.354, uranus: 8.7, neptune: 11, pluto: 0.62, halley: 0.0005,
    });
  });

  it('Saturn, despite its size, pulls about as hard as Earth', () => {
    expect(gravityRatio(body('saturn').gravity)).toBeCloseTo(0.92, 2);
  });
});

describe('weightOn', () => {
  it('reads the same on Earth as you typed', () => {
    expect(weightOn(70, body('earth').gravity)).toBe(70);
  });

  it('scales with surface gravity', () => {
    expect(weightOn(70, body('mars').gravity)).toBeCloseTo(26.43, 2);
    expect(weightOn(70, body('jupiter').gravity)).toBeCloseTo(165, 1);
    expect(weightOn(70, body('sun').gravity)).toBeCloseTo(1957.1, 1);
    // Mercury and Mars have the same surface gravity, though Mars is twice as massive.
    expect(weightOn(70, body('mercury').gravity)).toBe(weightOn(70, body('mars').gravity));
  });
});

describe('parseWeight', () => {
  it('accepts plain numbers, a decimal point or comma', () => {
    expect(parseWeight('70')).toBe(70);
    expect(parseWeight(' 70.5 ')).toBe(70.5);
    expect(parseWeight('70,5')).toBe(70.5);
  });

  it('accepts full-width (Japanese IME) and Myanmar digits', () => {
    expect(parseWeight('７０．５')).toBe(70.5);
    expect(parseWeight('၆၅')).toBe(65);
  });

  it(`rejects anything that isn't a weight from ${MIN_KG} to ${MAX_KG} kg`, () => {
    for (const text of ['', ' ', 'abc', '0', '0.5', '501', '-5', '1e2', '70kg', '7 0', '70.123', 'NaN', 'Infinity']) {
      expect(parseWeight(text), JSON.stringify(text)).toBeNull();
    }
    expect(parseWeight('1')).toBe(1);
    expect(parseWeight('500')).toBe(500);
  });
});

describe('kgLabel', () => {
  it('shows one decimal below 100 kg and whole kilograms above', () => {
    expect(kgLabel(26.4286, 'en')).toBe('26.4 kg');
    expect(kgLabel(70, 'en')).toBe('70 kg');
    expect(kgLabel(1957.14, 'en')).toBe('1,957 kg');
    expect(kgLabel(26.4286, 'ja')).toBe('26.4 kg');
  });

  it('uses Myanmar digits in Burmese', () => {
    expect(kgLabel(26.4286, 'my')).toBe('၂၆.၄ kg');
  });
});

describe('light travel time from the Sun', () => {
  it('reads like "8 min 19 s", or hours and minutes from an hour up', () => {
    expect(lightTimeLabel(499.004784, 'en')).toBe('8 min 19 s');
    expect(lightTimeLabel(193, 'en')).toBe('3 min 13 s');
    expect(lightTimeLabel(4 * 3600 + 10 * 60 + 20, 'en')).toBe('4 h 10 min');
    expect(lightTimeLabel(3599.6, 'en')).toBe('1 h 0 min'); // rounds into the next format, not "60 min 0 s"
    expect(lightTimeLabel(499, 'ja')).toBe('8分19秒');
    expect(lightTimeLabel(4 * 3600 + 10 * 60, 'ja')).toBe('4時間10分');
    expect(lightTimeLabel(499, 'my')).toBe('၈ မိနစ် ၁၉ စက္ကန့်');
  });

  it('follows the date: Earth is ~17 s closer in light time in January than in July', () => {
    const jan = lightSeconds(body('earth').orbit!, at('2026-01-03T00:00Z'));
    const jul = lightSeconds(body('earth').orbit!, at('2026-07-06T00:00Z'));
    expect(lightTimeLabel(jan, 'en')).toBe('8 min 11 s'); // perihelion, 0.983 AU
    expect(lightTimeLabel(jul, 'en')).toBe('8 min 27 s'); // aphelion, 1.017 AU
  });

  it('takes hours to reach the outer planets', () => {
    expect(lightTimeLabel(lightSeconds(body('jupiter').orbit!, at('2026-10-23T00:00Z')), 'en')).toMatch(/^4\d min/);
    expect(lightTimeLabel(lightSeconds(body('neptune').orbit!, at('2026-10-23T00:00Z')), 'en')).toMatch(/^4 h \d+ min$/);
  });
});

describe('weight panel key', () => {
  it('G toggles the panel', () => {
    expect(keyToIntent('g', config.keyboard)).toEqual({ type: 'toggleWeightPanel' });
    expect(keyToIntent('G', config.keyboard)).toEqual({ type: 'toggleWeightPanel' });
  });
});
