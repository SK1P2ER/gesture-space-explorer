import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

it('reuses date formatters across frames while keeping dates, languages and time zones current', async () => {
  vi.resetModules();
  const NativeFormatter = Intl.DateTimeFormat;
  const constructor = vi.spyOn(Intl, 'DateTimeFormat');
  const { dateLabel } = await import('../src/ui/timeFormat');
  const before = Date.UTC(2026, 0, 1, 14, 59), after = before + 60000;
  for (const lang of ['en', 'ja', 'my'] as const) {
    const first = dateLabel(before, 1, lang, 'Asia/Tokyo');
    const calls = constructor.mock.calls.length;
    for (let frame = 0; frame < 60; frame++) expect(dateLabel(before, 1, lang, 'Asia/Tokyo')).toBe(first);
    expect(constructor.mock.calls.length).toBe(calls);
    expect(dateLabel(after, 1, lang, 'Asia/Tokyo')).not.toBe(first);
    expect(dateLabel(before, 1, lang, 'America/New_York')).not.toBe(first);
  }
  expect(dateLabel(after, 1, 'en', 'Asia/Tokyo')).toBe(new NativeFormatter('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  }).format(after));
  expect(() => dateLabel(before, 1, 'en', 'invalid/timezone')).toThrow(RangeError);
});

it('keeps distinct date-only, time-of-day and month formats', async () => {
  const { dateLabel, monthLabel } = await import('../src/ui/timeFormat');
  const time = Date.UTC(2026, 10, 10, 3, 4);
  for (const lang of ['en', 'ja', 'my'] as const) {
    const slow = dateLabel(time, 1, lang, 'UTC');
    const fast = dateLabel(time, 86400000, lang, 'UTC');
    expect(fast).not.toBe(slow);
    expect(slow).toBe(dateLabel(time, 1, lang, 'UTC'));
    expect(monthLabel(time, lang, 'UTC')).not.toBe(monthLabel(Date.UTC(2026, 11, 10), lang, 'UTC'));
  }
});

it('reuses numeric formatters without mixing language, precision or Myanmar digits', async () => {
  const constructor = vi.spyOn(Intl, 'NumberFormat');
  const { numberFormat } = await import('../src/ui/i18n');
  const first = numberFormat('my', { maximumFractionDigits: 0 });
  const calls = constructor.mock.calls.length;
  expect(first.format(123)).toBe('၁၂၃');
  for (let frame = 0; frame < 60; frame++) numberFormat('my', { maximumFractionDigits: 0 }).format(frame);
  expect(constructor.mock.calls.length).toBe(calls);
  expect(numberFormat('en', { maximumFractionDigits: 0 }).format(123)).toBe('123');
  expect(numberFormat('my', { maximumFractionDigits: 1 }).format(1.5)).toBe('၁.၅');
});
