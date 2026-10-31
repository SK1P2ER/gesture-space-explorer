import { baseById } from '../../data/bases';
import { BODIES } from '../../data/bodies';
import { AVATARS } from '../../travel/booking';
import { DESTINATIONS } from '../../travel/destinations';
import { arrivalAt, stamps } from '../../travel/memories';
import { LOCALE, numberFormat } from '../../ui/i18n';
import { button, h, title, type ScreenContext } from '../dom';
import { st, stf } from '../strings';

/**
 * The passport: one stamp per completed journey (a completed booking is the only way to get one),
 * and the way to forget everything AstroLife keeps on this device.
 */
export function passport(ctx: ScreenContext) {
  const { lang, store } = ctx;
  const earned = stamps(store.bookings);
  const traveller = store.traveller;
  const places = new Set(earned.map((b) => b.to)).size;
  const date = new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'medium', timeZone: 'UTC' });
  const n = numberFormat(lang);
  return h('div', {},
    h('p', { class: 'al-kicker' }, st('passport.kicker', lang)),
    title(traveller ? `${AVATARS[traveller.avatar]} ${traveller.name}` : st('passport.title', lang)),
    h('p', { class: 'al-lead' }, stf('passport.count', lang, { n: n.format(places), total: n.format(DESTINATIONS.length) })),
    earned.length
      ? h('ul', { class: 'al-stamps' }, ...earned.map((b) => {
        const open = button(baseById(b.to).name[lang], () => ctx.go({ name: 'trip', ref: b.ref }), 'link');
        return h('li', { class: 'al-stamp-card', 'data-stamp': b.to },
          h('span', { class: 'al-stamp-mark', 'aria-hidden': 'true' }, '✦'),
          open,
          h('span', {}, BODIES.find((x) => x.id === baseById(b.to).body)!.name[lang]),
          h('span', {}, stf('passport.arrived', lang, { date: date.format(arrivalAt(b)) })),
          h('span', { class: 'al-tag' }, b.ref));
      }))
      : h('p', { class: 'al-card al-empty' }, st('passport.empty', lang)),
    h('p', { class: 'al-hint al-space' }, st('passport.forgetNote', lang)),
    forget(ctx),
  );
}

/** Two presses: everything AstroLife keeps on this device goes. */
function forget(ctx: ScreenContext) {
  const { lang } = ctx;
  const row = h('div', { class: 'al-actions' });
  const ask = () => row.replaceChildren(button(st('passport.forget', lang), sure, 'secondary', { 'data-action': 'forget' }));
  const sure = () => {
    const yes = button(st('passport.forgetSure', lang), () => ctx.forget(), 'danger', { 'data-action': 'forget-sure' });
    row.replaceChildren(yes, button(st('trip.keep', lang), () => {
      ask();
      row.querySelector('button')?.focus();
    }, 'link'));
    yes.focus();
  };
  ask();
  return row;
}
