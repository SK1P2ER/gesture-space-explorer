import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { keyToIntent } from '../src/input/keyboard';
import { governSpin } from '../src/planets/spin';
import { DAY, WEEK, YEAR } from '../src/sim/clock';
import { dateLabel, speedLabel } from '../src/ui/timeFormat';

describe('speed and date labels', () => {
  it('reads like "+1 week/s", "−1 day/s", "⏸"', () => {
    expect(speedLabel(WEEK, false, 'en')).toBe('+1 week/s');
    expect(speedLabel(-DAY, false, 'en')).toBe('−1 day/s');
    expect(speedLabel(3.5 * DAY, false, 'en')).toBe('+3.5 days/s');
    expect(speedLabel(YEAR, false, 'en')).toBe('+1 year/s');
    expect(speedLabel(0, false, 'en')).toBe('⏸');
    expect(speedLabel(WEEK, true, 'en')).toBe('⏸');
    expect(speedLabel(1, false, 'en')).toBe('+1× (real time)');
  });

  it('is translated', () => {
    expect(speedLabel(WEEK, false, 'ja')).toBe('+1週間/秒');
    expect(speedLabel(-2 * DAY, false, 'ja')).toBe('−2日/秒');
    expect(speedLabel(DAY, false, 'my')).toBe('+၁ ရက်/စက္ကန့်');
  });

  it('shows Burmese dates and Myanmar digits even without Burmese locale data (Chrome)', () => {
    const t = Date.UTC(2026, 9, 23, 14, 5);
    // Matches CLDR's my-MM output, which Safari and Firefox would give.
    expect(dateLabel(t, WEEK, 'my', 'UTC')).toBe('၂၀၂၆ အောက် ၂၃');
    expect(dateLabel(t, 60, 'my', 'UTC')).toBe('၂၀၂၆ အောက် ၂၃ ၁၄:၀၅');
    expect(dateLabel(Date.UTC(1000, 0, 1, 0, 0), 60, 'my', 'UTC')).toBe('၁၀၀၀ ဇန် ၁ ၀၀:၀၀');
    expect(speedLabel(3.5 * DAY, false, 'my')).toBe('+၃.၅ ရက်/စက္ကန့်');
    expect(speedLabel(1, false, 'my')).toBe('+၁× (အချိန်အမှန်)');
  });

  it('shows the time of day only when time moves slowly enough to read it', () => {
    const t = Date.UTC(2026, 9, 23, 14, 5);
    expect(dateLabel(t, WEEK, 'en', 'UTC')).toBe('Oct 23, 2026');
    expect(dateLabel(t, 60, 'en', 'UTC')).toBe('Oct 23, 2026, 02:05 PM');
    expect(dateLabel(t, WEEK, 'ja', 'UTC')).toBe('2026年10月23日');
  });
});

describe('governSpin', () => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  it('shows the real angle when the planet turns slowly', () => {
    let shown = governSpin(null, 1, 0, 0);
    let exact = 1;
    for (let i = 0; i < 120; i++) {
      exact += rad(10) / 60; // 10°/s, under the cap
      shown = governSpin(shown, exact, 10, 1 / 60);
    }
    expect(Math.abs(wrap(shown - exact))).toBeLessThan(1e-6);
  });

  it('caps fast spins to a steady turn in the right direction', () => {
    let shown = 0;
    for (let i = 0; i < 60; i++) shown = governSpin(shown, Math.random() * 6, -5000, 1 / 60); // e.g. retrograde, very fast
    expect(wrap(shown)).toBeCloseTo(-rad(36), 5); // one second at the 36°/s cap
  });

  it('eases back onto the real angle after fast-forwarding', () => {
    let shown = 0;
    const exact = 2.5;
    for (let i = 0; i < 90; i++) shown = governSpin(shown, exact, 0, 1 / 60);
    expect(Math.abs(wrap(shown - exact))).toBeLessThan(0.01);
  });
});

describe('time keys', () => {
  const k = (key: string) => keyToIntent(key, config.keyboard);
  it('B reverses, N jumps to now', () => {
    expect(k('b')).toEqual({ type: 'reverseTime' });
    expect(k('N')).toEqual({ type: 'timeNow' });
  });
});
