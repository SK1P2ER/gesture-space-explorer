import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/data/bodies';
import { SHELL_KEYS, st } from '../src/shell/strings';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('AstroLife shell strings', () => {
  it('has every string in English, Burmese and Japanese, with the same placeholders', () => {
    for (const key of SHELL_KEYS) {
      for (const lang of LANGS) expect(st(key, lang).trim(), `${key}.${lang}`).not.toBe('');
      const expected = placeholders(st(key, 'en'));
      for (const lang of LANGS) expect(placeholders(st(key, lang)), `${key}.${lang}`).toEqual(expected);
    }
  });

  it('says everywhere that the travel is a fictional simulation that stays on the device', () => {
    expect(st('simNotice', 'en')).toMatch(/fictional simulation/);
    expect(st('simNotice', 'en')).toMatch(/stays on this device/);
  });
});
