import { baseById } from '../data/bases';
import type { Lang } from '../data/bodies';
import type { Intent } from '../intents';
import { departureById } from '../travel/booking';
import { bodyOf, DESTINATIONS, destinationById } from '../travel/destinations';
import { parseSouvenir } from '../travel/souvenir';
import { TravelStore } from '../travel/store';
import { t } from '../ui/i18n';
import { button, h, type Draft, type ScreenContext, type ShellFiles } from './dom';
import { ShellNav, type Screen } from './nav';
import { book, draftWorld, newDraft } from './screens/booking';
import { destination, destinations } from './screens/destinations';
import { hub } from './screens/hub';
import { souvenirScreen } from './screens/pass';
import { passport } from './screens/passport';
import { drawPostcard, postcardFile } from './postcard';
import { trip } from './screens/trip';
import { route } from './screens/format';
import { st, stf } from './strings';
import './shell.css';

// The AstroLife 2126 shell (?flags=astrolife, docs/decisions.md entry 21): a travel app over the live
// scene. It makes its own DOM, so visitors without the flag get none of it. While it is open it is a
// modal layer: the scene's shortcuts stand down (input/shortcutOwnership.ts sees an aria-modal
// dialog), the explorer's UI is hidden, and the host stops hand tracking. Everything the explorer
// does goes through the host, as Intents or its few methods.

export interface ShellHost {
  lang(): Lang;
  emit(intent: Intent): void;
  /** The shell takes the screen (true), or hands it to the explorer (false). */
  cover(open: boolean): void;
  /** Whether the explorer can be left for the shell now: not during a launch, a flight or Build mode. */
  canLeave(): boolean;
  /** Where bookings are kept: the app's guarded localStorage (null when it's blocked). */
  readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** The world behind the shell (a body id): the camera flies there. */
  show(bodyId: string): void;
  /** Boards a journey: the explorer at `from` with `to` chosen, the clock at `at` (fiction) until the journey ends. */
  journey(j: { from: string; to: string; at: number }): void;
  /** A short message over the explorer. */
  flash(text: string): void;
  /** A copy of the scene as the next frame draws it (for a postcard). */
  capture(): Promise<HTMLCanvasElement>;
  readonly files: ShellFiles;
}

const SCREENS: { [K in Screen['name']]: (ctx: ScreenContext, screen: Extract<Screen, { name: K }>) => HTMLElement } = {
  hub,
  destinations,
  destination: (ctx, screen) => destination(ctx, screen.id),
  book: (ctx, screen) => book(ctx, screen.step),
  trip: (ctx, screen) => trip(ctx, screen.ref, screen.fresh),
  souvenir: (ctx, screen) => souvenirScreen(ctx, screen.souvenir),
  passport,
};

type Tab = 'hub' | 'destinations' | 'passport';
const TABS: readonly Tab[] = ['hub', 'destinations', 'passport'];
const TAB_LABEL = { hub: 'nav.home', destinations: 'nav.destinations', passport: 'nav.passport' } as const;
/** Which tab a screen belongs to. */
const TAB: Record<Screen['name'], Tab> = {
  hub: 'hub', trip: 'hub', souvenir: 'hub', destinations: 'destinations', destination: 'destinations', book: 'destinations', passport: 'passport',
};

export class Shell {
  private readonly nav = new ShellNav();
  private readonly root = h('div', { id: 'shell', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'shell-title', hidden: '' });
  private readonly screen = h('div', { class: 'shell-screen' });
  private readonly language = button('', () => {
    this.host.emit({ type: 'toggleLanguage' });
    this.render();
  }, 'small');
  private readonly tabs = h('nav', { class: 'shell-tabs' });
  private readonly notice = h('p', { class: 'shell-notice' });
  /** In the explorer's header: back to the shell. */
  private readonly toHub = h('button', { id: 'to-hub', type: 'button', hidden: '' });
  /** In the explorer's header during a journey: which one, where it stands, and that it is a simulation. */
  private readonly banner = h('p', { id: 'journey-banner', role: 'status', hidden: '' });
  /** Bookings, on this device only (decision 21). */
  private readonly store: TravelStore;
  private draft: Draft | null = null;
  /** The booking being flown in the explorer, and how far along it is. */
  private journey: { ref: string; phase: 'ready' | 'flying' | 'arrived' } | null = null;
  /** A journey just completed: AstroLife opens on it next. */
  private arrived: string | null = null;
  /** Bumped when something a screen shows changes without a new screen (a booking step). */
  private version = 0;
  private shown = false;
  private focusPending = false;
  private last = '';

  constructor(private readonly host: ShellHost) {
    this.store = new TravelStore(host.storage, (n) => crypto.getRandomValues(new Uint8Array(n)));
    const bar = h('header', { class: 'shell-bar' }, h('p', { class: 'shell-brand' }, 'AstroLife ', h('b', {}, '2126')), this.language);
    this.root.append(h('section', { id: 'shell-panel', class: 'shell-panel' }, bar, this.tabs, this.screen, h('footer', { class: 'shell-foot' }, this.notice)));
    document.body.append(this.root);
    document.querySelector('header.hud.top h1')!.after(this.toHub, this.banner);
    this.toHub.addEventListener('click', () => this.open());
    // Esc goes back a screen. The scene never sees it while the shell is open (aria-modal).
    addEventListener('keydown', (e) => {
      if (!this.shown || e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      this.back();
    });
    // A souvenir link pasted into this tab (only the # changes, so the page doesn't reload).
    addEventListener('hashchange', () => {
      if (!parseSouvenir(location.hash)) return;
      if (this.shown) this.showSouvenir();
      else this.open();
    });
  }

  get isOpen() {
    return this.shown;
  }

  /** Takes the screen: at a journey just completed, at the souvenir pass the address holds, or at the hub. */
  open() {
    if (this.shown || !this.host.canLeave()) return;
    this.shown = true;
    this.nav.go({ name: 'hub' });
    this.host.cover(true);
    if (this.arrived) {
      this.nav.start({ name: 'trip', ref: this.arrived });
      this.arrived = null;
      this.changed();
    } else if (!this.showSouvenir()) this.changed();
  }

  // ---- a journey in the explorer (main.ts reports the mission's lift-offs and landings) ----

  /** A lift-off: if it's the journey's own (spaceport → destination), the booking departs. */
  liftedOff(from: string, to: string) {
    const b = this.journeyBooking();
    if (!b || b.from !== from || b.to !== to) return;
    this.store.apply(b.ref, 'depart', Date.now());
    this.journey!.phase = 'flying';
    this.version++;
  }

  /** A landing: at the departed journey's destination, the booking completes, once, and its stamp is earned. */
  landed(baseId: string) {
    const b = this.journeyBooking();
    if (!b || this.journey!.phase !== 'flying' || b.to !== baseId) return;
    const result = this.store.apply(b.ref, 'arrive', Date.now());
    this.journey!.phase = 'arrived';
    this.version++;
    if (!result.ok || !result.changed) return;
    this.arrived = b.ref;
    const to = baseById(b.to).name[this.host.lang()];
    // After the explorer's own touchdown and first-visit messages.
    setTimeout(() => this.host.flash(stf('journey.stamped', this.host.lang(), { to })), 3200);
  }

  /** The visitor left the journey for free roam (the host has put their clock back). */
  journeyEnded() {
    this.journey = null;
    this.version++;
  }

  private journeyBooking() {
    return this.journey ? this.store.find(this.journey.ref) : null;
  }

  /** The souvenir pass in the address's "#", if there is a valid one (travel/souvenir.ts). */
  private showSouvenir(): boolean {
    const souvenir = parseSouvenir(location.hash);
    if (!souvenir) return false;
    this.nav.start({ name: 'souvenir', souvenir });
    this.changed();
    return true;
  }

  /** Hands the screen to the explorer. */
  close() {
    if (!this.shown) return;
    this.shown = false;
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur(); // Space / Enter go to the scene again
    this.host.cover(false);
    this.render();
  }

  /** Called every frame: rebuilds only when something it shows has changed. */
  render() {
    const lang = this.host.lang();
    const leave = this.host.canLeave();
    const key = JSON.stringify([this.shown, lang, this.nav.current, leave, this.version, this.journey]);
    if (key === this.last) return;
    this.last = key;
    this.toHub.hidden = this.shown || !leave;
    this.toHub.textContent = '✦ AstroLife';
    this.toHub.setAttribute('aria-label', st('toHub', lang));
    const flying = this.journeyBooking();
    this.banner.hidden = this.shown || !flying;
    if (flying && !this.shown) {
      const to = baseById(flying.to).name[lang];
      const vars = { ref: flying.ref, to, route: route(flying, lang), launch: t('launch', lang) };
      this.banner.replaceChildren(h('span', { class: 'al-sim' }, st('journey.sim', lang)), ' ', stf(`journey.${this.journey!.phase}`, lang, vars));
    }
    this.root.hidden = !this.shown;
    if (!this.shown) return;
    this.language.textContent = `🌐 ${t('language', lang)}`;
    this.notice.textContent = st('simNotice', lang);
    this.tabs.setAttribute('aria-label', st('shell.sections', lang));
    const current = this.nav.current;
    this.tabs.replaceChildren(...TABS.map((name) => {
      const tab = button(st(TAB_LABEL[name], lang), () => this.go({ name }), 'tab');
      if (name === TAB[current.name]) tab.setAttribute('aria-current', 'page');
      return tab;
    }));
    const ctx: ScreenContext = {
      lang, store: this.store, draft: this.draft, files: this.host.files,
      go: (screen) => this.go(screen),
      back: () => this.back(),
      explore: (baseId) => this.explore(baseId),
      book: (to) => {
        // 128 random bits. (Not randomUUID: it exists only in secure contexts, and a dev server reached over plain HTTP isn't one.)
        const attempt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
        this.draft = newDraft(to, this.store.traveller, attempt);
        this.go({ name: 'book', step: 'traveller' });
      },
      confirmed: (ref) => {
        this.draft = null;
        this.nav.start({ name: 'trip', ref, fresh: true });
        this.changed();
      },
      postcard: async (ref) => {
        const b = this.store.find(ref)!;
        return postcardFile(drawPostcard(await this.host.capture(), b, lang), b, this.host.files.png);
      },
      forget: () => {
        this.store.forget();
        this.draft = null;
        this.journey = this.arrived = null;
        this.nav.start({ name: 'hub' });
        this.changed();
      },
      begin: (ref) => {
        const b = this.store.find(ref);
        if (!b || (b.status !== 'checkedIn' && b.status !== 'inJourney')) return;
        this.journey = { ref, phase: 'ready' };
        this.close();
        this.host.journey({ from: b.from, to: b.to, at: departureById(b.departure)!.at });
      },
      refresh: () => {
        this.version++;
        this.render();
      },
    };
    this.screen.replaceChildren(SCREENS[current.name](ctx, current as never));
    if (this.focusPending) {
      this.focusPending = false;
      this.screen.querySelector<HTMLElement>('#shell-title')?.focus();
    }
  }

  private go(screen: Screen) {
    this.nav.go(screen);
    this.changed();
  }

  private back() {
    if (this.nav.back()) this.changed();
  }

  private explore(baseId?: string) {
    this.close();
    if (baseId) this.host.emit({ type: 'enterBase', baseId });
  }

  /** The world a screen shows behind it: the place it's about, otherwise the featured destination's. */
  private worldFor(screen: Screen): string {
    if (screen.name === 'destination' && destinationById(screen.id)) return bodyOf(destinationById(screen.id)!);
    if (screen.name === 'book') return draftWorld(this.draft) ?? 'mars';
    if (screen.name === 'souvenir') return baseById(departureById(screen.souvenir.flight)!.to).body;
    const booking = screen.name === 'trip' ? this.store.find(screen.ref) : null;
    return booking ? baseById(booking.to).body : bodyOf(DESTINATIONS.find((x) => x.bookable)!);
  }

  /** A new screen: its world behind it, rendered now, its heading focused. */
  private changed() {
    // Leaving a souvenir: its "#" goes from the address, so a reload doesn't bring it back.
    if (this.nav.current.name !== 'souvenir' && parseSouvenir(location.hash)) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    this.host.show(this.worldFor(this.nav.current));
    this.focusPending = true;
    this.render();
  }
}
