import { describe, expect, it } from 'vitest';
import { placeSummary } from '../src/ui/placeSummary';
import { t, type StringKey } from '../src/ui/i18n';
import { LANGS } from '../src/data/bodies';

describe('compact place card summary', () => {
  it('takes the first sentence in each script', () => {
    expect(placeSummary('The high bay houses vehicle assembly. The rollout road connects it.')).toBe('The high bay houses vehicle assembly.');
    expect(placeSummary('運用道路を見渡す管制棟。建物の周囲に庭園があります。')).toBe('運用道路を見渡す管制棟。');
    expect(placeSummary('ကြည့်ရှုရာနေရာဖြစ်သည်။ သစ်ပင် ရှိပါသည်။')).toBe('ကြည့်ရှုရာနေရာဖြစ်သည်။');
  });
  it('does not cut at a decimal point or inside a number', () => {
    expect(placeSummary('A 32.5-metre zone. Clear of buildings.')).toBe('A 32.5-metre zone.');
  });
  it('a one-sentence text is its own summary', () => {
    expect(placeSummary('大型の機体を組み立て、搬出路で発射台へ移動させます。')).toBe('大型の機体を組み立て、搬出路で発射台へ移動させます。');
  });
  it('every shipped place description has a summary that starts it (nothing rewritten)', () => {
    for (const id of ['assembly', 'control', 'pad', 'landing']) for (const lang of LANGS) {
      const full = t(`sp.${id}Info` as StringKey, lang);
      const summary = placeSummary(full);
      expect(summary.length).toBeGreaterThan(0);
      expect(full.startsWith(summary)).toBe(true);
    }
  });
});
