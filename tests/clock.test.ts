import { describe, expect, it } from 'vitest';
import {
  DAY,
  describeRate,
  MAX_RATE,
  MAX_TIME,
  positionToRate,
  rateToPosition,
  SimClock,
  WEEK,
  YEAR,
} from '../src/sim/clock';

describe('time slider scale', () => {
  it('is stopped at the center, real time just off it, one year per second at the ends', () => {
    expect(positionToRate(0)).toBe(0);
    expect(positionToRate(0.02)).toBe(0);
    expect(positionToRate(0.0401)).toBeCloseTo(1, 0);
    expect(positionToRate(1)).toBeCloseTo(MAX_RATE);
    expect(positionToRate(-1)).toBeCloseTo(-MAX_RATE);
  });

  it('runs backwards left of center, symmetrically', () => {
    expect(positionToRate(-0.6)).toBeCloseTo(-positionToRate(0.6));
  });

  it('round-trips between speed and position', () => {
    for (const rate of [1, 60, DAY, WEEK, -DAY, -YEAR, 12_345]) expect(positionToRate(rateToPosition(rate))).toBeCloseTo(rate, 3);
  });

  it('gets faster all the way to the right', () => {
    const rates = Array.from({ length: 50 }, (_, i) => positionToRate(0.05 + (i / 49) * 0.95));
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1]);
  });
});

describe('SimClock', () => {
  const start = Date.UTC(2026, 9, 23, 12);

  it('starts at the given time, running at a week per second', () => {
    const c = new SimClock(start);
    expect(c.rate).toBe(WEEK);
    c.advance(1);
    expect(c.time - start).toBe(WEEK * 1000);
  });

  it('pausing stops time but keeps the speed', () => {
    const c = new SimClock(start);
    c.togglePause();
    c.advance(5);
    expect(c.time).toBe(start);
    c.togglePause();
    expect(c.effectiveRate).toBe(WEEK);
  });

  it('moving the slider resumes a paused clock', () => {
    const c = new SimClock(start);
    c.togglePause();
    c.setPosition(-0.7);
    expect(c.paused).toBe(false);
    expect(c.rate).toBeLessThan(0);
  });

  it('[ ] scale the speed and keep its direction; starting from stopped goes to 1 day/s', () => {
    const c = new SimClock(start, -DAY);
    c.scale(2);
    expect(c.rate).toBe(-2 * DAY);
    c.scale(1e12);
    expect(c.rate).toBe(-MAX_RATE);
    const stopped = new SimClock(start, 0);
    stopped.scale(0.5);
    expect(stopped.rate).toBe(0);
    stopped.scale(2);
    expect(stopped.rate).toBe(DAY);
  });

  it('B reverses', () => {
    const c = new SimClock(start);
    c.reverse();
    expect(c.rate).toBe(-WEEK);
  });

  it('stops at the edge of the supported dates', () => {
    const c = new SimClock(MAX_TIME - 1000, YEAR);
    expect(c.advance(1)).toBe(true);
    expect(c.time).toBe(MAX_TIME);
    expect(c.rate).toBe(0);
  });

  it('nudges (the dial) through stopped into rewind', () => {
    const c = new SimClock(start, DAY);
    c.nudge(-2 * rateToPosition(DAY));
    expect(c.rate).toBeCloseTo(-DAY, 0);
  });
});

describe('describeRate', () => {
  it('picks a readable unit', () => {
    expect(describeRate(WEEK)).toEqual({ kind: 'rate', sign: 1, unit: 'week', value: 1 });
    expect(describeRate(-DAY)).toEqual({ kind: 'rate', sign: -1, unit: 'day', value: 1 });
    expect(describeRate(3.5 * DAY)).toEqual({ kind: 'rate', sign: 1, unit: 'day', value: 3.5 });
    expect(describeRate(YEAR)).toEqual({ kind: 'rate', sign: 1, unit: 'year', value: 1 });
    expect(describeRate(45 * 60)).toEqual({ kind: 'rate', sign: 1, unit: 'minute', value: 45 });
  });

  it('names real time and stopped', () => {
    expect(describeRate(1)).toEqual({ kind: 'realtime', sign: 1 });
    expect(describeRate(0)).toEqual({ kind: 'stopped' });
  });
});
