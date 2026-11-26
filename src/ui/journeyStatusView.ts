import type { Lang } from '../data/bodies';
import { BODIES } from '../data/bodies';
import { BASES } from '../data/bases';
import type { JourneyPhase } from '../app/journeyStatus';
import { JOURNEY_ROUTE } from '../app/journeyStatus';
import { t, tf } from './i18n';
import './journeyStatus.css';

const baseName = (id: string, lang: Lang) => BASES.find((b) => b.id === id)!.name[lang];
const bodyName = (baseId: string, lang: Lang) => BODIES.find((b) => b.id === BASES.find((x) => x.id === baseId)!.body)!.name[lang];

/** The departure place as said in "Launching from …" (the base name without "Spaceport"). */
const DEPARTURE_PLACE: Record<Lang, string> = { en: 'Tanegashima', my: 'Tanegashima', ja: '種子島' };

/** "Tanegashima → Jezero Dome": the route, shown with the flight and preparation (not at departure or arrival). */
export function journeyRoute(lang: Lang) {
  return tf('journey.route', lang, { from: DEPARTURE_PLACE[lang], to: baseName(JOURNEY_ROUTE.to, lang) });
}
const SHOWS_ROUTE: readonly JourneyPhase[] = ['transit', 'preparing', 'failed'];

/** Where the arrival card sits: beside the base panel (desk), above the phone's bottom sheet, or on the right (landscape). */
export type JourneyLayout = 'desk' | 'phone' | 'land';
export const journeyLayout = (w: number, h: number): JourneyLayout => h <= 500 && w > h ? 'land' : w <= 640 ? 'phone' : 'desk';

/** The words for a phase (also the announcement). */
export function journeyText(phase: JourneyPhase, lang: Lang) {
  const to = JOURNEY_ROUTE.to;
  switch (phase) {
    case 'departing': return tf('journey.departing', lang, { from: DEPARTURE_PLACE[lang] });
    case 'transit': return tf('journey.transit', lang, { body: bodyName(to, lang) });
    case 'preparing': return `${tf('journey.preparing', lang, { name: baseName(to, lang) })}…`;
    case 'failed': return tf('journey.failed', lang, { name: baseName(to, lang) });
    case 'arrived': return tf('journey.arrived', lang, { name: baseName(to, lang) });
  }
}

/**
 * The journey status pill (departure, transit, preparing, a recoverable failure with Try again) and the arrival card
 * (heading, one primary action). One polite live region announces each phase once. During a mission launch the pill
 * moves into the open launch dialog (the top layer), above its dock and clear of Skip / Close.
 */
export class JourneyStatusView {
  readonly pill = document.createElement('div');
  private readonly pillText = document.createElement('span');
  private readonly pillRoute = document.createElement('span');
  readonly retry = document.createElement('button');
  readonly card = document.createElement('section');
  private readonly cardStatus = document.createElement('p');
  private readonly cardHeading = document.createElement('h2');
  private readonly cardPlanet = document.createElement('p');
  readonly explore = document.createElement('button');
  private readonly live = document.createElement('p');
  private shown: JourneyPhase | null = null;
  private lang: Lang | null = null;
  private resize: ResizeObserver | null = null;
  /** performance.now() when the current phase was first shown (visual transitions only). */
  shownAt = 0;

  constructor(onExplore: () => void, onRetry: () => void) {
    this.pill.id = 'journey-status'; this.pill.dataset.ui = 'journey-status'; this.pill.hidden = true; this.pill.tabIndex = -1;
    this.pillText.className = 'journey-text';
    this.pillRoute.className = 'journey-route'; this.pillRoute.dataset.ui = 'journey-route';
    this.retry.type = 'button'; this.retry.id = 'journey-retry'; this.retry.className = 'journey-retry'; this.retry.hidden = true;
    this.retry.addEventListener('click', () => { onRetry(); this.pill.focus(); });
    this.pill.append(this.pillRoute, this.pillText, this.retry);
    this.card.id = 'journey-arrival'; this.card.dataset.ui = 'journey-arrival'; this.card.hidden = true;
    this.cardHeading.id = 'journey-arrival-title';
    this.cardPlanet.className = 'journey-planet'; this.cardPlanet.id = 'journey-arrival-planet';
    // Leads with the place, then the world it is on: "Jezero Dome", "Mars".
    this.card.setAttribute('aria-labelledby', `${this.cardHeading.id} ${this.cardPlanet.id}`);
    this.cardStatus.className = 'journey-arrived';
    this.explore.type = 'button'; this.explore.id = 'journey-explore'; this.explore.className = 'journey-explore';
    this.explore.addEventListener('click', () => onExplore());
    this.card.append(this.cardStatus, this.cardHeading, this.cardPlanet, this.explore);
    this.live.id = 'journey-live'; this.live.className = 'journey-sr'; this.live.setAttribute('role', 'status'); this.live.setAttribute('aria-live', 'polite');
    document.body.append(this.pill, this.card, this.live);
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => this.measure());
      this.resize.observe(this.pill); this.resize.observe(this.card);
    }
    addEventListener('resize', this.measure);
  }

  /**
   * The edges of what is shown, for the toast and the mission overlay (CSS --journey-bottom: below it; --journey-above:
   * the distance from the viewport bottom to its top, for the phone's toast above a low card).
   */
  private readonly measure = () => {
    const el = !this.card.hidden ? this.card : !this.pill.hidden && this.pill.parentElement === document.body ? this.pill : null;
    const root = document.documentElement;
    if (!el) { root.style.removeProperty('--journey-bottom'); root.style.removeProperty('--journey-above'); return; }
    const r = el.getBoundingClientRect();
    root.style.setProperty('--journey-bottom', `${Math.ceil(r.bottom)}px`);
    root.style.setProperty('--journey-above', `${Math.ceil(innerHeight - r.top)}px`);
  };

  /** The arrival card's box while it shows (null otherwise): for the camera to keep the destination clear of it. */
  cardRect(): DOMRect | null {
    return this.card.hidden || !this.card.getClientRects().length ? null : this.card.getBoundingClientRect();
  }

  /**
   * @param host the open mission launch dialog, if any (the pill moves into it)
   * @param focusFree may the arrival take focus (no dialog, menu or panel open)?
   */
  render(phase: JourneyPhase | null, lang: Lang, host: HTMLElement | null, focusFree: boolean, now = performance.now()) {
    const pillHost = host ?? document.body;
    if (this.pill.parentElement !== pillHost) {
      pillHost.append(this.pill);
      if (host) for (const k of ['left', 'top', 'maxWidth'] as const) this.pill.style[k] = ''; // the dialog's own placement
    }
    const changed = phase !== this.shown || lang !== this.lang;
    if (!changed) { if (now - this.placedAt > 200) this.place(now); return; }
    const phaseChanged = phase !== this.shown;
    this.shown = phase; this.lang = lang;
    if (phaseChanged) this.shownAt = now;
    document.body.classList.toggle('journey-on', phase !== null);
    document.body.dataset.journey = phase ?? '';
    if (!phase) delete document.body.dataset.journey;
    const text = phase ? journeyText(phase, lang) : '';
    const arrived = phase === 'arrived';
    this.pill.hidden = !phase || arrived;
    this.pill.dataset.phase = phase ?? '';
    this.pill.lang = lang; this.card.lang = lang;
    this.pillText.textContent = text;
    const route = !!phase && SHOWS_ROUTE.includes(phase);
    this.pillRoute.hidden = !route;
    this.pillRoute.textContent = route ? journeyRoute(lang) : '';
    this.retry.hidden = phase !== 'failed';
    this.retry.textContent = t('sp.retry', lang);
    const to = JOURNEY_ROUTE.to;
    this.cardStatus.textContent = `✓ ${t('journey.arrivalBadge', lang)}`;
    this.cardHeading.textContent = baseName(to, lang);
    this.cardPlanet.textContent = bodyName(to, lang);
    this.explore.textContent = tf('journey.explore', lang, { name: baseName(to, lang) });
    const wasHidden = this.card.hidden;
    this.card.hidden = !arrived;
    if (phaseChanged) this.live.textContent = text; // once per phase change; a language change re-labels silently
    // Try again hides itself and leaves focus on the status; a new failure puts it back on Try again.
    if (phaseChanged && phase === 'failed' && focusFree && (document.activeElement === this.pill || document.activeElement === document.body)) this.retry.focus();
    if (arrived && wasHidden && focusFree) this.explore.focus({ preventScroll: true });
    if (!arrived && document.activeElement === this.explore) (document.activeElement as HTMLElement).blur();
    this.place(now);
  }

  private placedAt = 0;
  /**
   * Keeps what is shown (outside the launch dialog) clear of the HUD, re-checked every 200 ms (panels open, fold, wrap).
   * The arrival card leaves the destination in view: on phones it sits low, just above the bottom sheet, footer and
   * camera preview; on short landscape screens it takes the right-hand column (the world stays on the left); on
   * desktops it sits between the left HUD and the base panel. The status pill (and any layout without room) sits
   * centred below the header and any top card it would cross, left of a side base panel.
   * body[data-journey-layout] says which layout the card uses.
   */
  private place(now: number) {
    this.placedAt = now;
    const el = !this.card.hidden ? this.card : !this.pill.hidden && this.pill.parentElement === document.body ? this.pill : null;
    if (el === this.card) document.body.dataset.journeyLayout = journeyLayout(innerWidth, innerHeight);
    else delete document.body.dataset.journeyLayout;
    if (!el) { this.measure(); return; }
    const visible = (q: string) => [...document.querySelectorAll<HTMLElement>(q)].filter((e) => !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden').map((e) => e.getBoundingClientRect());
    const gap = 10, W = innerWidth, H = innerHeight;
    const above = visible('header.hud.top, #mission-hud, #clean-view, #timebar').filter((r) => r.top < H / 2);
    /** Puts the element's centre between left and left + width; its box. */
    const across = (left: number, width: number) => {
      el.style.left = `${left + width / 2}px`; el.style.maxWidth = `${width}px`;
      if (el === this.card) el.style.width = `${width}px`;
      return el.getBoundingClientRect();
    };
    const below = (x0: number, x1: number) => {
      let top = 12;
      for (const r of above) if (r.left < x1 && x0 < r.right) top = Math.max(top, r.bottom + gap);
      return top;
    };
    const done = (top: number) => { el.style.top = `${Math.round(top)}px`; this.measure(); };
    const inset = (side: 'sal' | 'sar') => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--${side}`)) || 0;
    if (el === this.card) {
      const layout = journeyLayout(W, H);
      if (layout === 'land') {
        const right = W - 16 - inset('sar'), width = Math.min(380, W / 2 - 24), left = right - width;
        const box = across(left, width), top = below(left, right);
        // Above a folded panel in the same column; beside an open one (the fallback below).
        const blocked = visible('#base-panel').some((r) => r.left < right && left < r.right && r.top < top + box.height + 6 && top < r.bottom);
        if (!blocked && top + box.height <= H - 8) return done(top);
      } else if (layout === 'phone') {
        const left = 16 + inset('sal'), width = W - left - 16 - inset('sar');
        const box = across(left, width);
        let bottom = H - 12;
        for (const r of visible('#base-panel, footer.hud, #preview')) if (r.top > H / 2) bottom = Math.min(bottom, r.top - gap);
        const top = bottom - box.height;
        if (top >= below(left, left + width)) return done(top);
      }
    }
    let right = W - 16;
    for (const r of visible('#base-panel')) if (r.width < W * 0.9 && r.left > W / 2) right = Math.min(right, r.left - gap);
    /** Centred in [left, right], below every top card it would cross. */
    const fit = (left: number) => {
      const width = Math.min(el === this.card ? 420 : 460, right - left);
      const box = across(left, right - left), center = left + (right - left) / 2;
      el.style.maxWidth = `${width}px`; if (el === this.card) el.style.width = `${width}px`;
      const w = Math.min(box.width, width), top = below(center - w / 2, center + w / 2);
      return { top, bottom: top + el.getBoundingClientRect().height };
    };
    let best = fit(16);
    // Short screens (landscape phones): beside the left-hand mission HUD rather than under it, when that sits higher.
    const hud = visible('#mission-hud')[0];
    if (best.bottom > H * 0.75 && hud) {
      const beside = fit(hud.right + gap);
      if (right - hud.right - gap >= 260 && beside.bottom < best.bottom) best = beside; else best = fit(16);
    }
    done(best.top);
  }

  dispose() {
    this.resize?.disconnect();
    removeEventListener('resize', this.measure);
    this.pill.remove(); this.card.remove(); this.live.remove();
    document.body.classList.remove('journey-on');
    document.documentElement.style.removeProperty('--journey-bottom');
    document.documentElement.style.removeProperty('--journey-above');
    delete document.body.dataset.journeyLayout;
  }
}
