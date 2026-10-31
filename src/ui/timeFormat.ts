import type { Lang } from '../data/bodies';
import { describeRate, HOUR } from '../sim/clock';
import { LOCALE, numberFormat, t, tf, type StringKey } from './i18n';

/** "+1 week/s", "−3.5 days/s", "+1× (real time)", or "⏸" when stopped or paused. */
export function speedLabel(rate: number, paused: boolean, lang: Lang): string {
  const d = describeRate(paused ? 0 : rate);
  if (d.kind === 'stopped') return '⏸';
  const sign = d.sign > 0 ? '+' : '−';
  if (d.kind === 'realtime') return sign + t('realTime', lang);
  const n = numberFormat(lang, { maximumFractionDigits: 1 }).format(d.value);
  return sign + tf(`unit.${d.unit}.${d.value === 1 ? 'one' : 'other'}` as StringKey, lang, { n });
}

/** The shown date, in the viewer's time zone; with the time of day when it changes slowly enough to read. */
export function dateLabel(timeMs: number, rate: number, lang: Lang, timeZone?: string): string {
  const withTime = Math.abs(rate) <= HOUR;
  if (lang === 'my') return burmeseDate(timeMs, withTime, timeZone);
  return new Intl.DateTimeFormat(LOCALE[lang], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone,
  }).format(timeMs);
}

// CLDR's abbreviated Burmese month names.
const MY_MONTHS = ['ဇန်', 'ဖေ', 'မတ်', 'ဧ', 'မေ', 'ဇွန်', 'ဇူ', 'ဩ', 'စက်', 'အောက်', 'နို', 'ဒီ'];

/**
 * CLDR's Burmese date ("y MMM d", then "HH:mm"), put together by hand: Chrome has no
 * Burmese locale data and would show an English date.
 */
function burmeseDate(timeMs: number, withTime: boolean, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(timeMs);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
  const n = numberFormat('my', { useGrouping: false });
  const date = `${n.format(part('year'))} ${MY_MONTHS[part('month') - 1]} ${n.format(part('day'))}`;
  if (!withTime) return date;
  const two = numberFormat('my', { minimumIntegerDigits: 2 });
  return `${date} ${two.format(part('hour'))}:${two.format(part('minute'))}`;
}

/** "Jul 2061", "2061年7月", "၂၀၆၁ ဇူ" (Burmese by hand, like dateLabel). */
export function monthLabel(timeMs: number, lang: Lang, timeZone?: string): string {
  if (lang === 'my') {
    const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', timeZone }).formatToParts(timeMs);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
    return `${numberFormat('my', { useGrouping: false }).format(part('year'))} ${MY_MONTHS[part('month') - 1]}`;
  }
  return new Intl.DateTimeFormat(LOCALE[lang], { year: 'numeric', month: 'short', timeZone }).format(timeMs);
}

/** A light travel time: "8 min 19 s", or "4 h 10 min" from an hour up. */
export function lightTimeLabel(seconds: number, lang: Lang): string {
  const n = numberFormat(lang);
  const total = Math.round(seconds);
  if (total < 3600) return tf('duration.minSec', lang, { m: n.format(Math.floor(total / 60)), s: n.format(total % 60) });
  const minutes = Math.round(seconds / 60);
  return tf('duration.hourMin', lang, { h: n.format(Math.floor(minutes / 60)), m: n.format(minutes % 60) });
}
