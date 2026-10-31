import { baseById } from '../data/bases';
import type { Lang } from '../data/bodies';

// AstroLife's destinations (decision 21): the existing bases, as places you can travel to in 2126.
// Every journey leaves from the Cape spaceport. Journey times are fiction, a 2126 fusion liner's
// timetable, not orbital mechanics; the shell labels them so. Pure, so it can be tested.

/** Where every journey leaves from. */
export const SPACEPORT = 'cape';

export interface Destination {
  /** The base you arrive at (data/bases.ts). */
  base: string;
  /** Hours from the spaceport on a 2126 liner (fictional). */
  hours: number;
  /** Open for booking. The MVP books only Cape → Jezero; the others can be explored. */
  bookable: boolean;
  tagline: Record<Lang, string>;
}

export const DESTINATIONS: readonly Destination[] = [
  {
    base: 'jezero',
    hours: 9 * 24,
    bookable: true,
    tagline: {
      en: 'Red-dust sunsets over an ancient river delta.',
      my: 'ရှေးဟောင်း မြစ်ဝကျွန်းပေါ်ပေါ်က နီရဲတဲ့ ဖုန်မှုန့် နေဝင်ချိန်တွေ။',
      ja: '古い川の三角州に沈む、赤い砂ぼこりの夕日。',
    },
  },
  {
    base: 'tranquility',
    hours: 18,
    bookable: false,
    tagline: {
      en: 'A weekend on the Sea of Tranquility, with Earth in the sky.',
      my: 'ကောင်းကင်မှာ ကမ္ဘာကို မြင်ရတဲ့ ငြိမ်သက်ခြင်းပင်လယ်ပြင်မှာ စနေ၊ တနင်္ဂနွေ။',
      ja: '空に地球が浮かぶ「静かの海」で過ごす週末。',
    },
  },
  {
    base: 'conamara',
    hours: 46 * 24,
    bookable: false,
    tagline: {
      en: 'Ice cliffs above a hidden ocean, under giant Jupiter.',
      my: 'ကြီးမားတဲ့ ကြာသပတေးအောက်၊ ဝှက်ထားတဲ့ သမုဒ္ဒရာအပေါ်က ရေခဲချောက်ကမ်းပါးတွေ။',
      ja: '巨大な木星の下、隠れた海の上にそびえる氷の崖。',
    },
  },
  {
    base: 'kraken',
    hours: 71 * 24,
    bookable: false,
    tagline: {
      en: 'Methane seas under an orange sky.',
      my: 'လိမ္မော်ရောင် ကောင်းကင်အောက်က မီသိန်း ပင်လယ်တွေ။',
      ja: 'オレンジ色の空の下に広がるメタンの海。',
    },
  },
];

export const destinationById = (base: string) => DESTINATIONS.find((d) => d.base === base) ?? null;

/** The body a destination is on (a moon or a planet). */
export const bodyOf = (d: Destination) => baseById(d.base).body;

/** A journey time to show: hours under two days, whole days after that (rounded up: you aren't there yet). */
export function journeyTime(hours: number): { unit: 'hours' | 'days'; n: number } {
  return hours < 48 ? { unit: 'hours', n: Math.ceil(hours) } : { unit: 'days', n: Math.ceil(hours / 24) };
}

/** A real distance, rounded to three significant figures: a planet moves more than that in a day. */
export function roundKm(km: number): number {
  if (km <= 0) return 0;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(km)) - 2);
  return Math.round(km / step) * step;
}
