import { describe, expect, it } from 'vitest';
import { BASES } from '../src/data/bases';
import { LANGS } from '../src/data/bodies';
import { routeKm } from '../src/sim/route';
import { bodyOf, DESTINATIONS, destinationById, journeyTime, roundKm, SPACEPORT } from '../src/travel/destinations';

describe('AstroLife destinations', () => {
  it('are real bases, never the spaceport, each listed once', () => {
    const ids = DESTINATIONS.map((d) => d.base);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(BASES.some((b) => b.id === id), id).toBe(true);
      expect(id).not.toBe(SPACEPORT);
    }
    expect(BASES.some((b) => b.id === SPACEPORT)).toBe(true);
  });

  it('book only Cape → Jezero in the MVP (decision 21)', () => {
    expect(DESTINATIONS.filter((d) => d.bookable).map((d) => d.base)).toEqual(['jezero']);
  });

  it('take longer the farther out they are (fiction, but not nonsense)', () => {
    const order = ['tranquility', 'jezero', 'conamara', 'kraken'].map((id) => destinationById(id)!.hours);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // …and so does the real distance today, measured the same way the shell shows it.
    const now = Date.UTC(2126, 2, 14);
    const km = ['tranquility', 'jezero', 'conamara', 'kraken'].map((id) => routeKm('earth', bodyOf(destinationById(id)!), now));
    expect(km[0]).toBeLessThan(km[1]);
    expect(km[2]).toBeLessThan(km[3]);
  });

  it('have a tagline in every language', () => {
    for (const d of DESTINATIONS) for (const lang of LANGS) expect(d.tagline[lang].trim(), `${d.base}.${lang}`).not.toBe('');
  });

  it('show hours for short trips and whole days (rounded up) for long ones', () => {
    expect(journeyTime(18)).toEqual({ unit: 'hours', n: 18 });
    expect(journeyTime(47.5)).toEqual({ unit: 'hours', n: 48 });
    expect(journeyTime(9 * 24)).toEqual({ unit: 'days', n: 9 });
    expect(journeyTime(9 * 24 + 1)).toEqual({ unit: 'days', n: 10 });
  });

  it('round real distances to three significant figures', () => {
    expect(roundKm(384_399)).toBe(384_000);
    expect(roundKm(227_412_345)).toBe(227_000_000);
    expect(roundKm(42)).toBe(42);
    expect(roundKm(0)).toBe(0);
  });

  it('is unknown for anything that is not a destination', () => {
    expect(destinationById('cape')).toBeNull();
    expect(destinationById('nowhere')).toBeNull();
  });
});
