import type { Mode } from './modes';
import type { SimClock } from '../sim/clock';

// An AstroLife journey in the explorer (decision 23): boarding jumps the clock to the booked
// departure (fiction), and leaving the journey for free roam puts the clock back as it was. Pure,
// so the rules are tested without a browser; main.ts applies them each frame.

export interface Journey {
  /** The spaceport's base and the destination's. */
  from: string;
  to: string;
}

/** The clock as the visitor had it: restored when the journey ends. */
export interface SavedTime {
  time: number;
  rate: number;
  paused: boolean;
}

/**
 * Whether a journey is still going: at the spaceport before lift-off, on the way (launch, flight,
 * docking), or at the destination after landing. Anywhere else is free roam: the journey has ended.
 */
export function journeyOngoing(mode: Mode, baseHere: string | null, j: Journey): boolean {
  if (mode === 'launch' || mode === 'travel' || mode === 'docking') return true;
  return mode === 'baseView' && (baseHere === j.from || baseHere === j.to);
}

/** Boarding: the clock goes to the departure and runs, and what it was is returned to restore. */
export function boardClock(clock: SimClock, departure: number): SavedTime {
  const saved = { time: clock.time, rate: clock.rate, paused: clock.paused };
  clock.jumpTo(departure);
  clock.paused = false;
  return saved;
}

export function restoreClock(clock: SimClock, saved: SavedTime) {
  clock.jumpTo(saved.time);
  clock.setRate(saved.rate);
  clock.paused = saved.paused;
}
