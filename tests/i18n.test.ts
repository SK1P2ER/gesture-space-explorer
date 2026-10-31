import { describe, expect, it } from 'vitest';
import { BODIES, LANGS } from '../src/data/bodies';
import { STRING_KEYS, t, tf } from '../src/ui/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  it('has every UI string in English, Burmese and Japanese, with the same placeholders', () => {
    for (const key of STRING_KEYS) {
      for (const lang of LANGS) expect(t(key, lang).trim(), `${key}.${lang}`).not.toBe('');
      const expected = placeholders(t(key, 'en'));
      for (const lang of LANGS) expect(placeholders(t(key, lang)), `${key}.${lang}`).toEqual(expected);
    }
  });

  it('has every planet name, fact and blurb in all three languages', () => {
    for (const b of BODIES) {
      for (const lang of LANGS) {
        for (const text of [b.name[lang], b.facts.day[lang], b.facts.year[lang], b.blurb[lang]]) {
          expect(text.trim(), `${b.id}.${lang}`).not.toBe('');
        }
      }
    }
  });

  it('fills placeholders', () => {
    expect(tf('flash.select', 'ja', { name: '土星' })).toBe('☝️ 選択 → 土星');
  });

  it('cycles English → Burmese → Japanese', () => {
    expect(LANGS).toEqual(['en', 'my', 'ja']);
  });
});
