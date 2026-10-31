import { baseById } from '../../data/bases';
import type { Lang } from '../../data/bodies';
import { CABINS, departureById, type Booking, type CabinId } from '../../travel/booking';
import { LOCALE, numberFormat } from '../../ui/i18n';
import { h } from '../dom';
import { st, stf } from '../strings';

// How bookings read on screen, the same everywhere: dates in UTC (a timetable has one clock),
// fares in credits, and made-up numbers tagged as such.

/** A 2126 departure time, in UTC. */
export const when = (ms: number, lang: Lang) =>
  `${new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(ms)} UTC`;

/** "AL212 · 14 Mar 2126, 09:00 UTC" */
export const flight = (id: string, lang: Lang) => `${id} · ${when(departureById(id)!.at, lang)}`;

export const route = (b: Pick<Booking, 'from' | 'to'>, lang: Lang) => `${baseById(b.from).name[lang]} → ${baseById(b.to).name[lang]}`;

/** A tag saying a number is made up. */
export const fictional = (lang: Lang) => h('span', { class: 'al-tag' }, st('fictional', lang));

/** "9,600 credits" with its "fictional" tag. */
export const fare = (cabin: CabinId, lang: Lang) =>
  h('span', { class: 'al-meta' }, stf('fare', lang, { n: numberFormat(lang).format(CABINS[cabin].fare) }), ' ', fictional(lang));
