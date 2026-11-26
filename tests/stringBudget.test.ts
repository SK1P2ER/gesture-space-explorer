import { describe, expect, it } from 'vitest';
import { STRING_KEYS, t, type StringKey } from '../src/ui/i18n';
import { LANGS } from '../src/data/bodies';

/**
 * Length budget for strings that sit in fixed-size targets (owner, 2026-11-20: "all strings in the single string
 * table, with the length check"). Lengths are grapheme clusters, so a Burmese stacked syllable counts as what it
 * draws. The budget is an early warning only. The real check is the browser screenshot suite, which fails when a
 * labelled [data-ui] element overflows at 1440×900 or 390×844. Over budget: tell the owner, don't shorten.
 */
const BUDGET: [RegExp, number][] = [
  [/^sp\.view\./, 16],          // segmented control, three per row at 390 px
  [/^sp\.phase\./, 22],         // timeline marker, a quarter of the dock at 390 px (wraps to two lines)
  [/^sp\.gesture\.(prev|next|cancel|home)$/, 16],
  [/^sp\.(details|closeCard)$/, 16],        // compact place card / details panel buttons (short landscape)
  [/^sp\.complete$/, 40],                   // the completion status above the dock (wraps on a phone)
  [/^sp\.(assembly|control|pad|landing)$/, 28], // place chip (scrolls sideways on a phone)
  [/^sp\.(play|pause|resume|replay)$/, 36],
  [/^sp\.(title|entry)$/, 44],
  [/^sp\.(gesture\.coach|gesture\.homeHint|gesture\.hold|gesture\.release|kiosk\.prompt|noCamera)$/, 64],
];
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const length = (text: string) => [...segmenter.segment(text)].length;

describe('string length budget', () => {
  const budgeted = STRING_KEYS.flatMap(key => {
    const budget = BUDGET.find(([pattern]) => pattern.test(key))?.[1];
    return budget ? LANGS.map(lang => [key, lang, budget] as const) : [];
  });
  it('covers the spaceport targets', () => expect(budgeted.length).toBeGreaterThan(40));
  it.each(budgeted)('%s (%s) ≤ %i graphemes', (key, lang, budget) => {
    expect(length(t(key as StringKey, lang))).toBeLessThanOrEqual(budget);
  });
});
