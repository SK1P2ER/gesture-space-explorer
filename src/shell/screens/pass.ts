import { baseById } from '../../data/bases';
import type { Lang } from '../../data/bodies';
import { AVATARS, departureById } from '../../travel/booking';
import { SPACEPORT } from '../../travel/destinations';
import { souvenirLink, type Souvenir } from '../../travel/souvenir';
import { button, h, title, type ScreenContext } from '../dom';
import { qrSvg } from '../qr';
import { st, stf } from '../strings';
import { route, when } from './format';

// The boarding pass, the same for a booking on this device and for a souvenir opened from a link:
// whatever the link held goes into these fixed fields as text (textContent), and the route and the
// date come from the timetable via the flight number, never from the link.

/** This app's address (origin and path), for souvenir links. */
const appUrl = () => `${location.origin}${location.pathname}`;

export function passCard(s: Souvenir, lang: Lang, souvenir = false) {
  const departure = departureById(s.flight)!;
  const field = (label: string, value: string, cls = '') => h('div', { class: `al-pass-field ${cls}` }, h('span', {}, label), h('strong', {}, value));
  const link = souvenirLink(appUrl(), s);
  return h('article', { class: 'al-pass', 'data-ref': s.ref, 'aria-label': st('pass.title', lang) },
    h('header', { class: 'al-pass-head' }, h('span', {}, 'AstroLife 2126'), h('span', {}, souvenir ? st('souvenir.kicker', lang) : st('pass.title', lang))),
    h('p', { class: 'al-pass-route' }, route({ from: SPACEPORT, to: departure.to }, lang)),
    h('div', { class: 'al-pass-grid' },
      field(st('book.name', lang), `${AVATARS[s.avatar]} ${s.nick}`, 'wide'),
      field(st('trip.flight', lang), s.flight),
      field(st('book.cabin', lang), st(`cabin.${s.cabin}`, lang)),
      field(st('pass.date', lang), when(departure.at, lang), 'wide'),
      field(st('trip.ref', lang), s.ref)),
    h('figure', { class: 'al-pass-qr' }, qrSvg(link, st('pass.qr', lang)), h('figcaption', {}, st('pass.qrNote', lang))),
    souvenir ? null : copyLink(link, lang),
  );
}

/** Copies the souvenir link; where the clipboard is refused, shows it selected to copy by hand. */
function copyLink(link: string, lang: Lang) {
  const row = h('div', { class: 'al-actions' });
  const copy = button(st('pass.copy', lang), async () => {
    try {
      await navigator.clipboard.writeText(link);
      copy.textContent = `✓ ${st('pass.copied', lang)}`;
    } catch {
      const field = h('input', { class: 'al-link', readonly: '', 'aria-label': st('pass.copy', lang) });
      field.value = link;
      row.replaceChildren(field);
      field.select();
    }
  });
  row.append(copy);
  return row;
}

/** A souvenir pass opened from its link: a keepsake, shown as such. */
export function souvenirScreen(ctx: ScreenContext, s: Souvenir) {
  const { lang } = ctx;
  const to = baseById(departureById(s.flight)!.to).name[lang];
  return h('div', {},
    h('p', { class: 'al-kicker' }, st('souvenir.kicker', lang)),
    title(stf('souvenir.title', lang, { nick: s.nick, to })),
    h('p', { class: 'al-lead' }, st('souvenir.note', lang)),
    passCard(s, lang, true),
    h('div', { class: 'al-actions' }, button(st('souvenir.start', lang), () => ctx.go({ name: 'hub' }), 'primary')),
  );
}
