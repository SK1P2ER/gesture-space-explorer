// Simulation time: the date the planets are shown at, and how fast it runs.
// Pure: real time comes in through advance().

export const SECOND = 1;
export const MINUTE = 60;
export const HOUR = 3_600;
export const DAY = 86_400;
export const WEEK = 7 * DAY;
export const MONTH = 30.436875 * DAY; // average Gregorian month
export const YEAR = 365.25 * DAY;

/** Fastest speed, in simulated seconds per real second. */
export const MAX_RATE = YEAR;
/** Planet positions come from data valid 1800–2050; further out it's an ever rougher extrapolation. */
export const MIN_TIME = Date.UTC(1000, 0, 1);
export const MAX_TIME = Date.UTC(3000, 11, 31, 23, 59, 59);

/** Slider positions within this distance of the center mean "stopped". */
const DEAD_ZONE = 0.04;

/**
 * Slider position (−1 … 1) → speed (simulated seconds per real second).
 * The center is stopped; from there each side runs on a log scale from real
 * time (1 s/s) to one year per second; left of center runs backwards.
 */
export function positionToRate(position: number): number {
  const p = Math.max(-1, Math.min(1, position));
  if (Math.abs(p) < DEAD_ZONE) return 0;
  const f = (Math.abs(p) - DEAD_ZONE) / (1 - DEAD_ZONE);
  return Math.sign(p) * 10 ** (f * Math.log10(MAX_RATE));
}

export function rateToPosition(rate: number): number {
  if (rate === 0) return 0;
  const mag = Math.min(Math.max(Math.abs(rate), 1), MAX_RATE);
  return Math.sign(rate) * (DEAD_ZONE + (1 - DEAD_ZONE) * (Math.log10(mag) / Math.log10(MAX_RATE)));
}

export class SimClock {
  /** Simulated time, ms since the Unix epoch (UTC). */
  time: number;
  /** Simulated seconds per real second; negative runs backwards, 0 is stopped. */
  rate: number;
  /** Space / ✊ / ⏸: stops the clock but keeps the speed for when it resumes. */
  paused = false;

  constructor(now: number, rate = WEEK) {
    this.time = clampTime(now);
    this.rate = rate;
  }

  /** Speed actually applied right now. */
  get effectiveRate() {
    return this.paused ? 0 : this.rate;
  }

  get position() {
    return rateToPosition(this.rate);
  }

  /**
   * Moves time on by `realSeconds` of real time.
   * @returns true if it hit the edge of the supported dates (and stopped there).
   */
  advance(realSeconds: number): boolean {
    const next = this.time + this.effectiveRate * realSeconds * 1000;
    this.time = clampTime(next);
    if (this.time !== next) {
      this.rate = 0;
      return true;
    }
    return false;
  }

  /** Slider / dial: set the speed by position. Moving it also resumes a paused clock. */
  setPosition(position: number) {
    this.rate = positionToRate(position);
    this.paused = false;
  }

  /** Run at this speed (simulated seconds per real second, within ±MAX_RATE); resumes a paused clock. */
  setRate(rate: number) {
    this.rate = Math.sign(rate) * Math.min(Math.abs(rate), MAX_RATE);
    this.paused = false;
  }

  nudge(delta: number) {
    this.setPosition(Math.max(-1, Math.min(1, this.position + delta)));
  }

  /** [ / ] and the two-hand pinch: faster or slower, keeping the direction. */
  scale(factor: number) {
    if (this.rate === 0) {
      if (factor > 1) this.rate = DAY; // starting from stopped: a sensible first speed
      return;
    }
    this.rate = Math.sign(this.rate) * Math.min(Math.max(Math.abs(this.rate) * factor, 1), MAX_RATE);
  }

  reverse() {
    this.rate = -this.rate;
  }

  togglePause() {
    this.paused = !this.paused;
  }

  jumpTo(ms: number) {
    this.time = clampTime(ms);
  }
}

const clampTime = (ms: number) => Math.min(Math.max(ms, MIN_TIME), MAX_TIME);

export type SpeedUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

const UNITS: [SpeedUnit, number][] = [
  ['year', YEAR],
  ['month', MONTH],
  ['week', WEEK],
  ['day', DAY],
  ['hour', HOUR],
  ['minute', MINUTE],
  ['second', SECOND],
];

/**
 * A speed, broken down for display: "+1 week/s", "−3.5 days/s", real time, or stopped.
 * The value is rounded to what's shown (1 decimal under 10, whole numbers above).
 */
export function describeRate(rate: number):
  | { kind: 'stopped' }
  | { kind: 'realtime'; sign: 1 | -1 }
  | { kind: 'rate'; sign: 1 | -1; value: number; unit: SpeedUnit } {
  if (rate === 0) return { kind: 'stopped' };
  const sign = rate > 0 ? 1 : -1;
  const mag = Math.abs(rate);
  if (mag < 1.5) return { kind: 'realtime', sign };
  const [unit, size] = UNITS.find(([, s]) => mag >= s * 0.995) ?? ['second', SECOND];
  const v = mag / size;
  return { kind: 'rate', sign, unit, value: v < 10 ? Math.round(v * 10) / 10 : Math.round(v) };
}
