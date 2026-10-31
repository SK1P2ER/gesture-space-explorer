import { baseById } from '../../data/bases';
import { BODIES } from '../../data/bodies';
import { AVATARS, CABIN_ORDER, cleanName, departuresTo, LAUNCH_WINDOW, NAME_MAX, nameError, type AvatarId, type CabinId } from '../../travel/booking';
import { bodyOf, destinationById, journeyTime } from '../../travel/destinations';
import { LOCALE, numberFormat } from '../../ui/i18n';
import { button, h, title, type Draft, type ScreenContext } from '../dom';
import { st, stf, type ShellKey } from '../strings';
import { destination } from './destinations';
import { fare, flight, route, when } from './format';

// Booking, in three steps (decision 21: the MVP books Cape → Jezero). Each step is a form: Enter
// continues, radio groups take the arrow keys, and an error is tied to its field for screen readers.
// What's chosen lives in the draft, so switching language keeps it.

type Step = 'traveller' | 'trip' | 'review';

function head(ctx: ScreenContext, n: number, heading: ShellKey) {
  return [
    button(`← ${st('back', ctx.lang)}`, () => ctx.back(), 'small'),
    h('p', { class: 'al-kicker al-space' }, stf('book.step', ctx.lang, { n: String(n) })),
    title(st(heading, ctx.lang)),
  ];
}

/** A radio choice drawn as a card. */
function option(name: string, value: string, checked: boolean, onPick: () => void, ...body: (Node | string)[]) {
  const radio = h('input', { type: 'radio', name, value });
  radio.checked = checked;
  radio.addEventListener('change', onPick);
  return h('label', { class: 'al-option' }, radio, h('span', { class: 'al-option-body' }, ...body));
}

function form(onSubmit: () => void, ...children: (Node | null)[]) {
  const el = h('form', { novalidate: '' }, ...children);
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    onSubmit();
  });
  return el;
}

function travellerStep(ctx: ScreenContext, draft: Draft) {
  const { lang } = ctx;
  const input = h('input', {
    id: 'al-name', name: 'name', type: 'text', autocomplete: 'nickname', spellcheck: 'false', maxlength: String(NAME_MAX * 3),
    'aria-describedby': 'al-name-hint al-name-error',
  });
  input.value = draft.name;
  const error = h('p', { id: 'al-name-error', class: 'al-error', 'aria-live': 'polite', hidden: '' });
  input.addEventListener('input', () => {
    draft.name = input.value;
    error.hidden = true;
    input.removeAttribute('aria-invalid');
  });
  const avatars = (Object.keys(AVATARS) as AvatarId[]).map((id, i) => {
    const radio = h('input', { type: 'radio', name: 'avatar', value: id, 'aria-label': stf('book.avatarN', lang, { n: String(i + 1) }) });
    radio.checked = draft.avatar === id;
    radio.addEventListener('change', () => (draft.avatar = id));
    return h('label', { class: 'al-avatar' }, radio, h('span', { 'aria-hidden': 'true' }, AVATARS[id]));
  });
  return h('div', {}, ...head(ctx, 1, 'book.traveller'), form(() => {
    const problem = nameError(cleanName(draft.name));
    if (!problem) return ctx.go({ name: 'book', step: 'trip' });
    error.textContent = stf(`err.${problem}`, lang, { max: String(NAME_MAX) });
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  },
  h('label', { class: 'al-label', for: 'al-name' }, st('book.name', lang)),
  input,
  h('p', { id: 'al-name-hint', class: 'al-hint' }, st('book.nameHint', lang)),
  error,
  h('fieldset', { class: 'al-fieldset' }, h('legend', { class: 'al-label' }, st('book.avatar', lang)), h('div', { class: 'al-avatars' }, ...avatars)),
  h('div', { class: 'al-actions' }, h('button', { type: 'submit', class: 'al-btn primary' }, st('book.next', lang))),
  ));
}

function tripStep(ctx: ScreenContext, draft: Draft) {
  const { lang } = ctx;
  const world = BODIES.find((b) => b.id === bodyOf(destinationById(draft.to)!))!.name[lang];
  const departures = departuresTo(draft.to).map((d) => option('departure', d.id, draft.departure === d.id, () => (draft.departure = d.id),
    h('strong', {}, d.id), h('span', {}, when(d.at, lang))));
  const cabins = CABIN_ORDER.map((id) => option('cabin', id, draft.cabin === id, () => (draft.cabin = id),
    h('strong', {}, st(`cabin.${id}`, lang)), h('span', {}, stf(`cabin.${id}Text`, lang, { world })), fare(id, lang)));
  return h('div', {}, ...head(ctx, 2, 'book.trip'), form(() => ctx.go({ name: 'book', step: 'review' }),
    h('fieldset', { class: 'al-fieldset' }, h('legend', { class: 'al-label' }, st('book.departure', lang)),
      h('p', { class: 'al-hint al-window' }, stf('book.window', lang, {
        date: new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'long', timeZone: 'UTC' }).format(LAUNCH_WINDOW.at),
        days: numberFormat(lang).format(journeyTime(destinationById(draft.to)!.hours).n),
      })),
      h('div', { class: 'al-options' }, ...departures)),
    h('fieldset', { class: 'al-fieldset' }, h('legend', { class: 'al-label' }, st('book.cabin', lang)), h('div', { class: 'al-options' }, ...cabins)),
    h('div', { class: 'al-actions' }, h('button', { type: 'submit', class: 'al-btn primary' }, st('book.next', lang))),
  ));
}

function reviewStep(ctx: ScreenContext, draft: Draft) {
  const { lang } = ctx;
  const message = h('p', { class: 'al-error', 'aria-live': 'polite', hidden: '' });
  const confirm = h('button', { type: 'submit', class: 'al-btn primary' }, st('book.confirm', lang));
  const fact = (label: string, value: Node | string) => [h('dt', {}, label), h('dd', {}, value)];
  return h('div', {}, ...head(ctx, 3, 'book.review'),
    h('dl', { class: 'al-facts' },
      ...fact(st('trip.traveller', lang), `${AVATARS[draft.avatar]} ${cleanName(draft.name)}`),
      ...fact(st('trip.route', lang), route({ from: 'cape', to: draft.to }, lang)),
      ...fact(st('trip.flight', lang), flight(draft.departure, lang)),
      ...fact(st('book.cabin', lang), st(`cabin.${draft.cabin}`, lang)),
      ...fact(st('book.fare', lang), fare(draft.cabin, lang)),
    ),
    h('p', { class: 'al-hint' }, st('book.free', lang)),
    form(() => {
      confirm.disabled = true; // a second press finds the same attempt anyway (TravelStore.confirm)
      const r = ctx.store.confirm({ attempt: draft.attempt, traveller: { name: draft.name, avatar: draft.avatar }, to: draft.to, departure: draft.departure, cabin: draft.cabin }, Date.now());
      if (r.ok) return ctx.confirmed(r.booking.ref);
      message.textContent = st(r.error === 'active' ? 'book.active' : 'book.failed', lang);
      message.hidden = false;
      if (r.error !== 'active') confirm.disabled = false;
    }, message, h('div', { class: 'al-actions' }, confirm)),
  );
}

const STEPS: Record<Step, (ctx: ScreenContext, draft: Draft) => HTMLElement> = { traveller: travellerStep, trip: tripStep, review: reviewStep };

export function book(ctx: ScreenContext, step: Step) {
  // No draft (cannot happen from the UI): the bookable destination instead.
  return ctx.draft ? STEPS[step](ctx, ctx.draft) : destination(ctx, 'jezero');
}

/** A new draft for a destination: the last traveller, the first departure, a window cabin. */
export function newDraft(to: string, last: { name: string; avatar: AvatarId } | null, attempt: string): Draft {
  return { attempt, to, name: last?.name ?? '', avatar: last?.avatar ?? 'a1', departure: departuresTo(to)[0].id, cabin: 'window' satisfies CabinId };
}

/** The base a booking screen is about, for the world behind it. */
export const draftWorld = (draft: Draft | null) => (draft ? baseById(draft.to).body : null);
