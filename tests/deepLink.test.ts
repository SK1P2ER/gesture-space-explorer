import { describe, expect, it } from 'vitest';
import { linkSearch, parseDeepLink, type LinkCatalog } from '../src/app/deepLink';
import { BASES } from '../src/data/bases';
import { BODIES } from '../src/data/bodies';
import { LAYOUTS } from '../src/scene/baseKit/showcases';
import { MAX_TIME, MIN_TIME } from '../src/sim/clock';

const catalog: LinkCatalog = {
  bodies: BODIES.map((b) => b.id),
  bases: BASES.map((b) => ({ id: b.id, body: b.body })),
  horizon: Object.keys(LAYOUTS),
  range: [MIN_TIME, MAX_TIME],
};
const parse = (search: string) => parseDeepLink(search, catalog);

describe('deep links: what a URL opens', () => {
  it('a body, a base (and so its body), the horizon view, a language', () => {
    expect(parse('?body=saturn')).toEqual({ body: 'saturn' });
    expect(parse('?base=jezero')).toEqual({ base: 'jezero', body: 'mars' });
    expect(parse('?base=tranquility')).toEqual({ base: 'tranquility', body: 'moon' });
    expect(parse('?base=jezero&view=horizon&lang=ja')).toEqual({ base: 'jezero', body: 'mars', view: 'horizon', lang: 'ja' });
    expect(parse('?BODY=Saturn')).toEqual({}); // parameter names are exact…
    expect(parse('?body=Saturn')).toEqual({ body: 'saturn' }); // …ids aren't case-sensitive
  });

  it('a date opens at that day (UTC midnight) or that exact time', () => {
    expect(parse('?date=2061-07-28')).toEqual({ time: Date.UTC(2061, 6, 28) });
    expect(parse('?date=2024-04-08T18:18Z')).toEqual({ time: Date.UTC(2024, 3, 8, 18, 18) });
    expect(parse('?date=2024-04-08T20:18:00%2B02:00')).toEqual({ time: Date.UTC(2024, 3, 8, 18, 18) });
  });

  it('ignores anything unknown or invalid, never failing', () => {
    for (const search of ['', '?', '?body=pluto2', '?base=atlantis', '?view=horizon', '?base=cape&view=horizon', // Cape has no horizon view
      '?date=2061-02-30', '?date=2061-13-01', '?date=28.07.2061', '?date=2061-07-28T12:00', '?date=0999-12-31', '?date=3001-01-01',
      '?lang=fr', '?lang=', '?body=', '?%E0%A4%A=1']) {
      const link = parse(search);
      expect(link.view, search).toBeUndefined();
      if (search.includes('base=cape')) expect(link).toEqual({ base: 'cape', body: 'earth' });
      else expect(link, search).toEqual({});
    }
  });

  it('a base wins over a body that disagrees with it', () => {
    expect(parse('?body=saturn&base=jezero')).toEqual({ base: 'jezero', body: 'mars' });
  });
});

describe('deep links: the address for what is on screen', () => {
  const view = { body: 'sun', base: null, horizon: false, lang: 'en' as const };

  it('the overview in English is the bare address', () => {
    expect(linkSearch('', view, false)).toBe('');
    expect(linkSearch('?body=mars&lang=ja', view, false)).toBe('');
  });

  it('names the body, or the base and its view, and a language other than English', () => {
    expect(linkSearch('', { ...view, body: 'saturn' }, false)).toBe('?body=saturn');
    expect(linkSearch('', { ...view, body: 'mars', base: 'jezero' }, false)).toBe('?base=jezero');
    expect(linkSearch('', { ...view, body: 'mars', base: 'jezero', horizon: true, lang: 'my' }, false)).toBe('?base=jezero&view=horizon&lang=my');
  });

  it('keeps every other parameter, and the date only while that moment is still shown', () => {
    expect(linkSearch('?flags=build&debug&body=mars', { ...view, body: 'earth' }, false)).toBe('?flags=build&debug&body=earth'); // as typed
    expect(linkSearch('?debug', view, false)).toBe('?debug'); // nothing to add: untouched
    expect(linkSearch('?date=2061-07-28&body=halley', { ...view, body: 'halley' }, true)).toBe('?date=2061-07-28&body=halley');
    expect(linkSearch('?date=2061-07-28&body=halley', { ...view, body: 'halley' }, false)).toBe('?body=halley');
  });

  it('round-trips: the address for a view opens that view', () => {
    const views = [
      { ...view, body: 'jupiter' },
      { ...view, body: 'mars', base: 'jezero', horizon: true, lang: 'ja' as const },
      { ...view, body: 'moon', base: 'tranquility' },
    ];
    for (const v of views) {
      const link = parse(linkSearch('', v, false));
      expect(link.body === undefined ? 'sun' : link.body).toBe(v.body);
      expect(link.base ?? null).toBe(v.base);
      expect(link.view === 'horizon').toBe(v.horizon);
      expect(link.lang ?? 'en').toBe(v.lang);
    }
  });
});
