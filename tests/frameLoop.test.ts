import { describe, expect, it } from 'vitest';
import { frameSeconds } from '../src/app/frameLoop';

describe('animation frame step', () => {
  it('does not step backward when the first RAF timestamp precedes app initialization', () => {
    expect(frameSeconds(-300)).toBe(0);
    expect(frameSeconds(-0.5)).toBe(0);
  });

  it('keeps repeated timestamps still and preserves ordinary frame times', () => {
    expect(frameSeconds(0)).toBe(0);
    expect(frameSeconds(1000 / 60)).toBeCloseTo(1 / 60, 12);
    expect(frameSeconds(100)).toBe(0.1);
  });

  it('caps catch-up after a hidden tab or stalled frame', () => {
    expect(frameSeconds(101)).toBe(0.1);
    expect(frameSeconds(60_000)).toBe(0.1);
  });
});
