import { baseById } from '../../data/bases';
import { BODIES, type Lang } from '../../data/bodies';
import { routeKm } from '../../sim/route';
import { bodyOf, DESTINATIONS, destinationById, journeyTime, roundKm, SPACEPORT, type Destination } from '../../travel/destinations';
import { numberFormat, t } from '../../ui/i18n';
import { button, h, title, type ScreenContext } from '../dom';
import { st, stf } from '../strings';

const EARTH_G = 9.80665;
const body = (d: Destination) => BODIES.find((b) => b.id === bodyOf(d))!;
const spaceport = (lang: Lang) => baseById(SPACEPORT).name[lang];

/** "9 days by fusion liner", with its "fictional" tag. */
export function journeyLine(d: Destination, lang: Lang) {
  const { unit, n } = journeyTime(d.hours);
  return h('span', { class: 'al-meta' },
    stf('journeyBy', lang, { time: stf(unit, lang, { n: numberFormat(lang).format(n) }) }), ' ',
    h('span', { class: 'al-tag' }, st('fictional', lang)));
}

/** A destination as a card: where, what it's like, how long, whether it can be booked. */
export function destinationCard(ctx: ScreenContext, d: Destination, heading: 'h3' | 'h4' = 'h3') {
  const { lang } = ctx;
  const base = baseById(d.base);
  return h('article', { class: 'al-card', 'data-destination': d.base },
    h('p', { class: 'al-kicker' }, body(d).name[lang]),
    h(heading, {}, base.name[lang]),
    h('p', {}, d.tagline[lang]),
    journeyLine(d, lang),
    h('p', { class: `al-badge${d.bookable ? ' open' : ''}` }, st(d.bookable ? 'dest.bookable' : 'dest.exploreOnly', lang)),
    h('div', { class: 'al-actions' },
      button(st('dest.details', lang), () => ctx.go({ name: 'destination', id: d.base }), 'secondary', { 'aria-label': `${st('dest.details', lang)}: ${base.name[lang]}` }),
      button(st('dest.explore', lang), () => ctx.explore(d.base), 'link', { 'aria-label': `${st('dest.explore', lang)}: ${base.name[lang]}` })),
  );
}

export function destinations(ctx: ScreenContext) {
  const { lang } = ctx;
  return h('div', {},
    title(st('nav.destinations', lang)),
    h('p', { class: 'al-lead' }, stf('dest.lead', lang, { spaceport: spaceport(lang) })),
    h('div', { class: 'al-list' }, ...DESTINATIONS.map((d) => destinationCard(ctx, d))),
  );
}

export function destination(ctx: ScreenContext, id: string) {
  const { lang } = ctx;
  const d = destinationById(id);
  if (!d) return destinations(ctx); // not a destination (cannot happen from the UI)
  const base = baseById(d.base);
  const b = body(d);
  const fact = (label: string, value: Node | string) => [h('dt', {}, label), h('dd', {}, value)];
  const km = roundKm(routeKm('earth', b.id, Date.now()));
  return h('div', {},
    button(`← ${st('back', lang)}`, () => ctx.back(), 'small'),
    h('p', { class: 'al-kicker al-space' }, b.name[lang]),
    title(base.name[lang]),
    h('p', { class: 'al-lead' }, d.tagline[lang]),
    h('p', {}, base.blurb[lang]),
    h('dl', { class: 'al-facts' },
      ...fact(stf('dest.journey', lang, { spaceport: spaceport(lang) }), journeyLine(d, lang)),
      ...fact(st('dest.distance', lang), h('span', { class: 'al-meta' }, `${numberFormat(lang).format(km)} km `, h('span', { class: 'al-tag real' }, st('dest.real', lang)))),
      ...fact(t('gravityHere', lang), `${numberFormat(lang, { maximumFractionDigits: 2 }).format(b.gravity / EARTH_G)} g`),
    ),
    h('p', { class: `al-badge${d.bookable ? ' open' : ''}` }, st(d.bookable ? 'dest.bookable' : 'dest.exploreOnly', lang)),
    ...bookOrExplore(ctx, d),
  );
}

/** A bookable destination is booked here, unless a journey is already under way (one at a time). */
function bookOrExplore(ctx: ScreenContext, d: Destination) {
  const { lang } = ctx;
  const explore = (kind: 'primary' | 'link') => button(st('dest.explore', lang), () => ctx.explore(d.base), kind);
  if (!d.bookable) return [h('div', { class: 'al-actions' }, explore('primary'))];
  const active = ctx.store.active();
  if (active) {
    return [
      h('p', { class: 'al-hint' }, st('book.active', lang)),
      h('div', { class: 'al-actions' }, button(st('trip.view', lang), () => ctx.go({ name: 'trip', ref: active.ref }), 'primary'), explore('link')),
    ];
  }
  return [h('div', { class: 'al-actions' }, button(st('dest.book', lang), () => ctx.book(d.base), 'primary'), explore('link'))];
}
