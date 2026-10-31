import { describe, expect, it } from 'vitest';
import { boardClock, journeyOngoing, restoreClock } from '../src/app/journey';
import { DAY, SimClock, WEEK } from '../src/sim/clock';

const J = { from: 'cape', to: 'jezero' };

describe('an AstroLife journey in the explorer', () => {
  it('goes on at the spaceport, on the way, and at the destination', () => {
    expect(journeyOngoing('baseView', 'cape', J)).toBe(true);
    for (const mode of ['launch', 'travel', 'docking'] as const) expect(journeyOngoing(mode, null, J)).toBe(true);
    expect(journeyOngoing('baseView', 'jezero', J)).toBe(true); // arrived, looking around
  });

  it('ends in free roam: a body, the overview, another base', () => {
    expect(journeyOngoing('focus', null, J)).toBe(false);
    expect(journeyOngoing('solarView', null, J)).toBe(false);
    expect(journeyOngoing('baseView', 'tranquility', J)).toBe(false); // flew somewhere else instead
  });

  it('boards at the departure time with the clock running, and leaves the clock as the visitor had it', () => {
    const now = Date.UTC(2026, 9, 30, 12);
    const clock = new SimClock(now, WEEK);
    clock.paused = true;
    const departure = Date.UTC(2127, 2, 6, 9);
    const saved = boardClock(clock, departure);
    expect([clock.time, clock.paused]).toEqual([departure, false]);
    clock.setRate(1); // the base slows it to real time
    clock.advance(3600);
    restoreClock(clock, saved);
    expect([clock.time, clock.rate, clock.paused]).toEqual([now, WEEK, true]);
  });

  it('restores a reversed or fast clock too', () => {
    const clock = new SimClock(0, -DAY);
    const saved = boardClock(clock, Date.UTC(2127, 2, 6));
    restoreClock(clock, saved);
    expect([clock.time, clock.rate, clock.paused]).toEqual([0, -DAY, false]);
  });
});
