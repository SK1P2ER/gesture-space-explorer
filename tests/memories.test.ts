import { describe, expect, it } from 'vitest';
import { createBooking, departureById, type Booking } from '../src/travel/booking';
import { arrivalAt, stamps, wrapLines } from '../src/travel/memories';

const base = createBooking({ attempt: 'attempt-0001', traveller: { name: 'Ada', avatar: 'a1' }, to: 'jezero', departure: 'AL216', cabin: 'pod' }, 'AL-00001', 10);
const as = (over: Partial<Booking>): Booking => ({ ...base, ...over });

describe('journey stamps', () => {
  it('are completed bookings only: nothing booked, checked in, flying or cancelled counts', () => {
    const all = (['confirmed', 'checkedIn', 'inJourney', 'cancelled', 'completed'] as const).map((status, i) => as({ ref: `AL-0000${i}`, status }));
    expect(stamps(all).map((b) => b.status)).toEqual(['completed']);
  });

  it('come in the order the journeys arrived', () => {
    const late = as({ ref: 'AL-LATE0', status: 'completed', departure: 'AL220' });
    const early = as({ ref: 'AL-EARLY', status: 'completed', departure: 'AL212' });
    expect(stamps([late, early]).map((b) => b.ref)).toEqual(['AL-EARLY', 'AL-LATE0']);
  });

  it('arrive after the liner’s crossing: Jezero, 9 days after departure (fiction)', () => {
    expect(arrivalAt(base) - departureById('AL216')!.at).toBe(9 * 24 * 3_600_000);
  });
});

describe('postcard lines', () => {
  const width = (s: string) => Array.from(s).length; // one unit per character

  it('break at spaces, within the width', () => {
    expect(wrapLines('Greetings from Jezero Dome', 14, width)).toEqual(['Greetings from', 'Jezero Dome']);
  });

  it('break a word wider than a line by character (Burmese and Japanese have few spaces)', () => {
    expect(wrapLines('ジェゼロ・ドームからこんにちは', 6, width)).toEqual(['ジェゼロ・ド', 'ームからこん', 'にちは']);
  });

  it('stop at the line limit with an ellipsis that fits', () => {
    // one two | three | four five | six seven → two lines, the second marked as cut short
    const lines = wrapLines('one two three four five six seven', 9, width, 2);
    expect(lines).toEqual(['one two', 'three…']);
    for (const l of lines) expect(width(l)).toBeLessThanOrEqual(9);
  });

  it('give nothing for nothing', () => {
    expect(wrapLines('', 10, width)).toEqual([]);
  });
});
