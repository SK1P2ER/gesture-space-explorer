import { baseById } from '../../data/bases';
import { AVATARS, departureById, type Booking } from '../../travel/booking';
import { souvenirOf } from '../../travel/souvenir';
import { button, h, title, type ScreenContext } from '../dom';
import { st, stf } from '../strings';
import { fare, flight, route, when } from './format';
import { hub } from './hub';
import { passCard } from './pass';

/**
 * A booking: its reference, what was booked, where it stands. Confirmed, it can be checked in (a
 * second press does nothing: TravelStore.apply); from then on it shows its boarding pass.
 * Cancelling takes two presses.
 */
export function trip(ctx: ScreenContext, ref: string, fresh = false) {
  const { lang, store } = ctx;
  const b = store.find(ref);
  if (!b) return hub(ctx); // forgotten meanwhile (?reset in another tab)
  const fact = (label: string, value: Node | string) => [h('dt', {}, label), h('dd', {}, value)];
  // Checked in or later, the boarding pass shows the booking; before, the details do.
  const pass = b.status !== 'confirmed' && b.status !== 'cancelled';
  return h('div', {},
    button(`← ${st('back', lang)}`, () => ctx.back(), 'small'),
    fresh && b.status === 'confirmed' ? h('p', { class: 'al-success al-space', role: 'status' }, `✓ ${st('trip.confirmed', lang)}`) : null,
    h('p', { class: 'al-kicker al-space' }, st('trip.ref', lang)),
    h('p', { class: 'al-ref', 'data-ref': b.ref }, b.ref),
    title(st('trip.title', lang)),
    h('dl', { class: 'al-facts' },
      ...(pass ? [] : [
        ...fact(st('trip.traveller', lang), `${AVATARS[b.traveller.avatar]} ${b.traveller.name}`),
        ...fact(st('trip.route', lang), route(b, lang)),
        ...fact(st('trip.flight', lang), flight(b.departure, lang)),
        ...fact(st('book.cabin', lang), st(`cabin.${b.cabin}`, lang)),
      ]),
      ...fact(st('book.fare', lang), fare(b.cabin, lang)),
      ...fact(st('trip.status', lang), h('span', { class: `al-status ${b.status}` }, st(`status.${b.status}`, lang))),
    ),
    store.persisted ? null : h('p', { class: 'al-error' }, st('trip.notSaved', lang)),
    b.status === 'completed' ? h('p', { class: 'al-success al-stamp', 'data-stamp': b.to }, `✦ ${st('journey.complete', lang)}`) : null,
    b.status === 'completed' ? postcard(ctx, b) : null,
    b.status === 'confirmed' ? checkIn(ctx, b) : null,
    b.status === 'checkedIn' || b.status === 'inJourney' ? board(ctx, b) : null,
    pass ? passCard(souvenirOf(b), lang) : null,
    b.status === 'confirmed' || b.status === 'checkedIn' ? cancel(ctx, b) : null,
  );
}

/** A postcard of the journey: made on request, shown, then saved or shared (where the device can share files). */
function postcard(ctx: ScreenContext, b: Booking) {
  const { lang } = ctx;
  const place = baseById(b.to).name[lang];
  const box = h('div', { class: 'al-postcard' });
  const make = button(st('postcard.make', lang), async () => {
    make.disabled = true;
    try {
      const file = await ctx.postcard(b.ref);
      const url = URL.createObjectURL(file);
      const img = h('img', { src: url, alt: stf('postcard.alt', lang, { place }), width: '1600', height: '1000' });
      img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true }); // Save and Share use the file itself
      const actions = h('div', { class: 'al-actions' }, button(st('postcard.save', lang), () => ctx.files.download(file, file.name), 'primary'));
      if (ctx.files.canShare(file)) actions.append(button(st('postcard.share', lang), () => void navigator.share({ files: [file], title: 'AstroLife 2126' }).catch(() => {})));
      box.replaceChildren(img, actions);
    } catch (e) {
      console.error('[postcard]', e);
      make.disabled = false;
    }
  }, 'primary');
  box.append(h('div', { class: 'al-actions' }, make));
  return box;
}

/** Begin (or, after a reload mid-flight, resume) the journey: the explorer at the spaceport, the clock at the departure. */
function board(ctx: ScreenContext, b: Booking) {
  const { lang } = ctx;
  const departs = when(departureById(b.departure)!.at, lang);
  return h('div', {},
    h('div', { class: 'al-actions' }, button(st(b.status === 'inJourney' ? 'journey.resume' : 'journey.begin', lang), () => ctx.begin(b.ref), 'primary')),
    h('p', { class: 'al-hint' }, stf('journey.beginHint', lang, { date: departs })));
}

function checkIn(ctx: ScreenContext, b: Booking) {
  const { lang } = ctx;
  const go = button(st('pass.checkIn', lang), () => {
    go.disabled = true;
    ctx.store.apply(b.ref, 'checkIn', Date.now());
    ctx.refresh();
  }, 'primary');
  return h('div', {}, h('div', { class: 'al-actions' }, go), h('p', { class: 'al-hint' }, st('pass.checkInHint', lang)));
}

/** "Cancel booking", then "Press again to confirm" with a way out. */
function cancel(ctx: ScreenContext, b: Booking) {
  const { lang } = ctx;
  const row = h('div', { class: 'al-actions al-cancel' });
  const ask = () => row.replaceChildren(button(st('trip.cancel', lang), sure, 'secondary', { 'data-action': 'cancel' }));
  const sure = () => {
    const yes = button(st('trip.cancelSure', lang), () => {
      ctx.store.apply(b.ref, 'cancel', Date.now());
      ctx.refresh();
    }, 'danger', { 'data-action': 'cancel-sure' });
    row.replaceChildren(yes, button(st('trip.keep', lang), () => {
      ask();
      row.querySelector('button')?.focus();
    }, 'link'));
    yes.focus();
  };
  ask();
  return row;
}
