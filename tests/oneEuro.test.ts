import { describe, expect, it } from 'vitest';
import { OneEuroFilter } from '../src/tracking/oneEuro';

// Deterministic pseudo-noise so the test never flakes.
const noise = (i: number) => Math.sin(i * 12.9898) * 0.01;

describe('OneEuroFilter', () => {
  it('returns the first value unchanged', () => {
    expect(new OneEuroFilter().filter(0.5, 0)).toBe(0.5);
  });

  it('reduces jitter on a still hand', () => {
    const f = new OneEuroFilter(1.0, 0.0);
    let rawVar = 0;
    let outVar = 0;
    for (let i = 0; i < 300; i++) {
      const raw = 0.5 + noise(i);
      const out = f.filter(raw, i * 33);
      if (i > 30) {
        rawVar += (raw - 0.5) ** 2;
        outVar += (out - 0.5) ** 2;
      }
    }
    expect(outVar).toBeLessThan(rawVar * 0.25);
  });

  it('follows a fast move with low lag when beta > 0', () => {
    const slow = new OneEuroFilter(1.0, 0);
    const fast = new OneEuroFilter(1.0, 5);
    let a = 0;
    let b = 0;
    for (let i = 0; i < 10; i++) {
      const x = i * 0.05; // fast linear motion
      a = slow.filter(x, i * 33);
      b = fast.filter(x, i * 33);
    }
    expect(Math.abs(0.45 - b)).toBeLessThan(Math.abs(0.45 - a));
  });

  it('starts fresh after reset', () => {
    const f = new OneEuroFilter();
    f.filter(0, 0);
    f.filter(0, 33);
    f.reset();
    expect(f.filter(1, 66)).toBe(1);
  });
});
