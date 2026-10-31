import { baseById } from '../../data/bases';
import { departureById } from '../../travel/booking';
import { DESTINATIONS, SPACEPORT } from '../../travel/destinations';
import { button, h, title, type ScreenContext } from '../dom';
import { st } from '../strings';
import { journeyLine } from './destinations';
import { route, when } from './format';

/** The hub: where AstroLife opens. The journey under way if there is one, else the featured journey. */
export function hub(ctx: ScreenContext) {
  const { lang } = ctx;
  const active = ctx.store.active();
  const featured = DESTINATIONS.find((d) => d.bookable)!;
  const card = active
    ? h('article', { class: 'al-card featured', 'data-booking': active.ref },
      h('p', { class: 'al-kicker' }, `${st('trip.title', lang)} · ${active.ref}`),
      h('h3', {}, route(active, lang)),
      h('p', {}, `${active.departure} · ${when(departureById(active.departure)!.at, lang)}`),
      h('span', { class: `al-status ${active.status}` }, st(`status.${active.status}`, lang)),
      h('div', { class: 'al-actions' }, button(st('trip.view', lang), () => ctx.go({ name: 'trip', ref: active.ref }), 'primary')))
    : h('article', { class: 'al-card featured', 'data-destination': featured.base },
      h('p', { class: 'al-kicker' }, st('hub.featured', lang)),
      h('h3', {}, `${baseById(SPACEPORT).name[lang]} → ${baseById(featured.base).name[lang]}`),
      h('p', {}, featured.tagline[lang]),
      journeyLine(featured, lang),
      h('div', { class: 'al-actions' }, button(st('hub.seeJourney', lang), () => ctx.go({ name: 'destination', id: featured.base }), 'primary')));
  return h('div', {},
    h('p', { class: 'al-kicker' }, st('hub.kicker', lang)),
    title(st('hub.title', lang)),
    h('p', { class: 'al-lead' }, st('hub.lead', lang)),
    card,
    h('div', { class: 'al-actions' },
      button(st('hub.allDestinations', lang), () => ctx.go({ name: 'destinations' })),
      button(st('explore', lang), () => ctx.explore(), 'link')),
  );
}
