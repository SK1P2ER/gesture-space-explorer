import type { Lang } from '../data/bodies';
import type { SteerSensitivity } from '../gestures/steer';
import type { SkyReport } from '../app/baseSky';
import type { Intent } from '../intents';
import { skyFacts } from './basePanel';
import { t, tf, type StringKey } from './i18n';
import { dt } from './designStrings';
import './missionOverlay.css';
import type { landingTelemetry } from '../sim/landingTelemetry';
import { clockLabel } from '../sim/localSky';
import { TIME_PRESETS, type TimePreset } from '../app/timePresets';
import { dateLabel } from './timeFormat';
import { LANDMARK_IDS, type LandmarkId } from '../app/jezeroLandmarks';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export interface OverlayView {
  /** The countdown number, during Launch. */
  count: number | null;
  /** Counting by hand: say how. */
  byHand: boolean;
  /** Where the rocket is going, during Travel. */
  flyingTo: string | null;
  /** Docking: height left (1 at the start, 0 on the pad) and whether auto-land is on. */
  docking: { altitude: number; auto: boolean; sensitivity: SteerSensitivity; telemetry?:ReturnType<typeof landingTelemetry> } | null;
  /** The horizon view: the sky's numbers, and the way back up. */
  horizon: SkyReport | null;
  /** Exploring a base on foot (the horizon view): its name and world, how many looks so far, and whether a hand drives. */
  explore?: { base: string; body: string; looks: number; hand: boolean; time?: ExploreTime | null; landmarks?: ExploreLandmarks | null } | null;
}

/** The Explore Landmarks list's state (Jezero): the framed landmark, and whether Back to overview has a pose to return to. */
export interface ExploreLandmarks { selected: LandmarkId | null; canReturn: boolean }

/** The Explore time group's state (Jezero): the active preset, Restore's original time, Golden Hour available. */
export interface ExploreTime { preset: TimePreset | null; restore: number | null; golden: boolean }

const PRESET_ICON: Record<TimePreset, string> = { day: '☀️', golden: '🌅', night: '🌙' };
const PRESET_LABEL: Record<TimePreset, StringKey> = { day: 'preset.day', golden: 'preset.golden', night: 'preset.night' };
const LANDMARK_NAME: Record<LandmarkId, StringKey> = { habitat: 'landmark.habitat', pad: 'landmark.pad', dish: 'landmark.dish' };
const LANDMARK_INFO: Record<LandmarkId, StringKey> = { habitat: 'landmark.habitatInfo', pad: 'landmark.padInfo', dish: 'landmark.dishInfo' };
/** Phones (portrait and short landscape, the card's own breakpoints): the Landmarks list starts folded. */
const COMPACT = '(max-width: 640px), (orientation: landscape) and (max-height: 500px)';

type LookInput = 'touch' | 'mouse' | 'keyboard' | 'hand';
const LOOK_HINT_SEEN = 'gse.exploreLookHintSeen';
const LOOK_HINT_MS = 8000;
const hintSeen = () => { try { return sessionStorage.getItem(LOOK_HINT_SEEN) === '1'; } catch { return false; } };
const markHintSeen = () => { try { sessionStorage.setItem(LOOK_HINT_SEEN, '1'); } catch { /* storage unavailable */ } };

/** Mission phase controls: countdown, flight skip, and the compact landing deck. */
export class MissionOverlay {
  private readonly root = $('#mission-overlay');
  private last = '';
  private meter: HTMLElement | null = null;
  private altitudeValue: HTMLElement | null = null;
  private autoButton: HTMLButtonElement | null = null;
  private sensitivityButton: HTMLButtonElement | null = null;
  private lastAltitude = -1;
  private lastAuto: boolean | null = null;
  private lastSensitivity: SteerSensitivity | null = null;
  private telemetry: HTMLElement | null = null;
  private alignment: HTMLElement | null = null;

  /** The explore view, built once per entry and language and updated in place (focus and the open sky list stay). */
  private explore: { lang: Lang; base: string; body: string; facts: HTMLElement; hint: HTMLElement; live: HTMLElement; looks: number; hintUntil: number; hintKind: LookInput | null; landmarks: boolean } | null = null;
  private measuredAt = 0;
  /** The time group's live parts (built with the explore card). */
  private timeUi: { clock: HTMLElement; current: HTMLElement; buttons: Map<TimePreset, HTMLButtonElement>; restore: HTMLButtonElement; live: HTMLElement; key: string } | null = null;
  /** The Landmarks list's live parts (Jezero; built with the explore card). `selected` undefined: not rendered yet. */
  private landmarkUi: { toggle: HTMLButtonElement; panel: HTMLElement; current: HTMLElement; buttons: Map<LandmarkId, HTMLButtonElement>;
    detail: HTMLElement; name: HTMLElement; info: HTMLElement; back: HTMLButtonElement; live: HTMLElement; key: string;
    selected: LandmarkId | null | undefined; lastSelected: LandmarkId | null; overviewAsked: boolean } | null = null;
  /** The Landmarks list open for this visit (null: the viewport's default); a language rebuild keeps it. */
  private landmarksOpen: boolean | null = null;
  /** A preset was chosen / Restore pressed (main.ts jumps the clock). */
  onPreset: ((preset: TimePreset) => void) | null = null;
  onRestore: (() => void) | null = null;
  /** A pointer is down, or when one last went down or up (focus from a press does not scroll the card). */
  private pointerAt = -Infinity;
  private pointerDown = false;
  /** The last way the person gave input (the look-around hint's words). */
  private lastInput: LookInput = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';

  constructor(private readonly emit: (intent: Intent) => void) {
    // Passive observers (they only note the input kind for the hint's words; nothing is handled or prevented).
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', (e) => { this.lastInput = e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'mouse'; this.pointerAt = performance.now(); this.pointerDown = true; }, { capture: true, passive: true });
      const released = () => { this.pointerAt = performance.now(); this.pointerDown = false; };
      window.addEventListener('pointerup', released, { capture: true, passive: true });
      window.addEventListener('pointercancel', released, { capture: true, passive: true });
      window.addEventListener('keydown', (e) => { if (!e.ctrlKey && !e.metaKey && !e.altKey) this.lastInput = 'keyboard'; }, { capture: true, passive: true });
    }
    // Focus moving in the scrolling card (Tab, Shift+Tab, focus() from a switch or AT): the browser only brings the
    // control to the scrollport's edge, which in short landscape is under the sticky bar; bring it out below the bar.
    this.root.addEventListener('focusin', (e) => {
      // Not for a press: moving the card between pointerdown and click would put the tap on another control.
      if (!this.explore || !(e.target instanceof HTMLElement) || this.pointerDown || performance.now() - this.pointerAt < 300) return;
      const el = e.target;
      this.reveal(el);
      requestAnimationFrame(() => { if (document.activeElement === el) this.reveal(el); }); // after any scroll of the browser's own
    });
    // A focused control owns its keys (shortcutOwnership): on the explore card Esc and O still go back to orbit.
    this.root.addEventListener('keydown', (e) => {
      if (!this.explore || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key === 'Escape' || e.key === 'o' || e.key === 'O') { e.preventDefault(); this.emit({ type: 'toggleHorizon' }); }
    });
  }

  render(v: OverlayView, lang: Lang, guided = false) {
    if (v.count === null && v.horizon && v.explore) { this.renderExplore(v.horizon, v.explore, lang); return; }
    if (this.explore) {
      this.explore = null; this.timeUi = null; this.landmarkUi = null; this.landmarksOpen = null; this.last = ''; this.root.classList.remove('explore', 'has-restore'); this.root.removeAttribute('aria-labelledby'); delete this.root.dataset.hint;
      document.documentElement.style.removeProperty('--explore-bottom');
      // Focus does not stay on a control of the closed card (it would keep the scene's keys, O and Esc, from working).
      if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
    }
    // Altitude, Auto-land and sensitivity update the existing controls. A moving
    // meter must never replace the button being tapped or holding keyboard focus.
    const key = JSON.stringify([{ ...v, docking: v.docking !== null, horizon: v.horizon && skyFacts(v.horizon, lang).map((e) => e.textContent).join('|') }, lang, guided]);
    if (key === this.last) { this.updateDocking(v.docking, lang); return; }
    this.last = key;
    this.root.hidden = v.count === null && v.flyingTo === null && v.docking === null && v.horizon === null;
    this.root.classList.toggle('is-countdown', v.count !== null);
    this.root.classList.toggle('is-landing', v.count === null && v.horizon === null && v.docking !== null);
    this.root.classList.toggle('is-flight', v.count === null && v.horizon === null && v.docking === null && v.flyingTo !== null);
    this.root.classList.toggle('horizon', v.count === null && v.horizon !== null);
    this.root.setAttribute('aria-live', v.count !== null ? 'assertive' : v.docking !== null ? 'off' : 'polite');
    this.meter = this.altitudeValue = this.autoButton = this.sensitivityButton = null;
    this.telemetry = this.alignment = null;
    this.lastAltitude = -1;
    this.lastAuto = this.lastSensitivity = null;
    if (this.root.hidden) return;
    const el = (tag: string, text: string, cls: string) => {
      const e = document.createElement(tag);
      e.textContent = text;
      e.className = cls;
      return e;
    };
    if (v.count !== null) {
      this.root.replaceChildren(el('div', String(v.count), 'count'), el('p', t(v.byHand ? 'countdownByHand' : 'countdownAbort', lang), 'hint'));
      return;
    }
    if (v.horizon) {
      const facts = document.createElement('dl');
      facts.className = 'sky';
      facts.append(...skyFacts(v.horizon, lang));
      const back = el('button', `⬆ ${t('leaveHorizon', lang)}`, 'chip') as HTMLButtonElement;
      back.type = 'button';
      back.addEventListener('click', () => this.emit({ type: 'toggleHorizon' }));
      this.root.replaceChildren(facts, el('p', t('horizonHint', lang), 'hint'), back);
      return;
    }
    if (v.docking) {
      const deck = el('div', '', 'mission-actions mission-card');
      deck.setAttribute('role', 'region');
      deck.setAttribute('aria-label', dt('landing', lang));
      const heading = el('h2', dt('landing', lang), 'mission-title landing-heading');
      const label = el('div', '', 'altitude-label');
      this.altitudeValue = el('span', '', 'altitude-value');
      this.altitudeValue.setAttribute('aria-hidden', 'true');
      label.append(el('span', t('altitude', lang), ''), this.altitudeValue);
      const meter = this.meter = el('div', '', 'altitude');
      meter.setAttribute('role', 'meter');
      meter.setAttribute('aria-label', t('altitude', lang));
      meter.setAttribute('aria-valuemin', '0');
      meter.setAttribute('aria-valuemax', '100');
      meter.setAttribute('aria-live', 'off');
      meter.append(el('span', '', 'fill'));
      const auto = this.autoButton = el('button', '', 'chip auto-land') as HTMLButtonElement;
      auto.type = 'button';
      auto.addEventListener('click', () => this.emit({ type: 'toggleAutoLand' }));
      const sens = this.sensitivityButton = el('button', '', 'chip steering') as HTMLButtonElement;
      sens.type = 'button';
      sens.addEventListener('click', () => this.emit({ type: 'cycleSteerSensitivity' }));
      const buttons = el('div', '', 'buttons');
      buttons.append(auto);
      if(!guided)buttons.append(sens);
      this.telemetry = el('p','','landing-telemetry');
      this.alignment = el('p','','landing-alignment');this.alignment.setAttribute('role','status');
      this.alignment.setAttribute('aria-live', 'polite');
      this.alignment.setAttribute('aria-atomic', 'true');
      const help = el('details', '', 'landing-help');
      help.setAttribute('data-scene-shortcuts', 'off');
      const helpContent = el('div', '', 'landing-help-content');
      helpContent.setAttribute('aria-live', 'off');
      if(guided)helpContent.append(sens);
      helpContent.append(this.telemetry, el('p', t('dockHint', lang), 'hint'));
      help.append(el('summary', dt('landingHelp', lang), 'landing-help-toggle'), helpContent);
      deck.append(heading, label, meter, this.alignment, buttons, help);
      this.root.replaceChildren(deck);
      this.updateDocking(v.docking, lang);
      return;
    }
    const skip = el('button', t('skip', lang), 'chip skip') as HTMLButtonElement;
    skip.type = 'button';
    skip.addEventListener('click', () => this.emit({ type: 'select' }));
    const flight = el('div', '', 'mission-card flight-card');
    flight.append(el('p', `🚀 ${tf('flyingTo', lang, { name: v.flyingTo! })}`, 'flying'), skip);
    this.root.replaceChildren(flight);
  }

  private updateDocking(view: OverlayView['docking'], lang: Lang) {
    if (!view || !this.meter || !this.autoButton || !this.sensitivityButton) return;
    if(view.telemetry&&this.telemetry&&this.alignment) {
      const labels={en:['Descent','Pad offset','pad radii/s','pad radii'],my:['ဆင်းနှုန်း','စင်အလယ်မှ အကွာအဝေး','စင်အချင်းဝက်/စက္ကန့်','စင်အချင်းဝက်'],ja:['降下速度','パッド中心からの距離','パッド半径/秒','パッド半径']}[lang];
      const info=`${labels[0]} ${view.telemetry.descent.toFixed(2)} ${labels[2]} · ${labels[1]} ${view.telemetry.offset.toFixed(2)} ${labels[3]}`;
      if(this.telemetry.textContent!==info)this.telemetry.textContent=info;
      const states={aligned:{en:'✓ Aligned with pad',my:'✓ ဆင်းသက်စင်နှင့် ချိန်ညှိပြီး',ja:'✓ パッドに整列'},correct:{en:'↔ Correct your position',my:'↔ စင်အလယ်သို့ ပြန်ချိန်ပါ',ja:'↔ 位置を修正してください'},touchdown:{en:'✓ Touchdown',my:'✓ ဆင်းသက်ပြီး',ja:'✓ 着陸完了'},missed:{en:'↻ Missed pad · retrying',my:'↻ စင်လွဲသွားပါသည် · ပြန်စမ်းနေပါသည်',ja:'↻ パッド外・再試行'}};
      this.alignment.dataset.alignment=view.telemetry.alignment;
      const message=states[view.telemetry.alignment][lang];
      if(this.alignment.textContent!==message)this.alignment.textContent=message;
    }
    const percent = Math.round(Math.max(0, Math.min(1, view.altitude)) * 100);
    if (percent !== this.lastAltitude) {
      this.lastAltitude = percent;
      this.meter.setAttribute('aria-valuenow', String(percent));
      (this.meter.firstChild as HTMLElement).style.width = `${percent}%`;
      this.altitudeValue!.textContent = `${percent}%`;
    }
    if (view.auto !== this.lastAuto) {
      this.lastAuto = view.auto;
      this.autoButton.textContent = `${t('autoLand', lang)}: ${t(view.auto ? 'on' : 'off', lang)}`;
      this.autoButton.setAttribute('aria-pressed', String(view.auto));
    }
    if (view.sensitivity !== this.lastSensitivity) {
      this.lastSensitivity = view.sensitivity;
      this.sensitivityButton.textContent = `✋ ${t('steerSensitivity', lang)}: ${t(`sens.${view.sensitivity}`, lang)}`;
    }
  }

  /**
   * Exploring on foot: a slim edge card with the place ("Jezero Dome · Mars") and a persistent Return to orbit, a
   * brief look-around hint in the words of the last input (first entry of the session; gone after the first look or
   * after LOOK_HINT_MS), the near-sunset action with what it does said before it is used, and the sky facts folded.
   */
  private renderExplore(sky: SkyReport, x: NonNullable<OverlayView['explore']>, lang: Lang, now = performance.now()) {
    let e = this.explore;
    if (!e || e.lang !== lang || e.base !== x.base || e.body !== x.body || e.landmarks !== !!x.landmarks) {
      const entering = !e;
      const keepOpen = this.root.querySelector<HTMLDetailsElement>('.explore-sky')?.open ?? false;
      const active = document.activeElement;
      const hadFocus = active instanceof HTMLElement && this.root.contains(active) ? active.id : '';
      const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => { const n = document.createElement(tag); n.className = cls; if (text) n.textContent = text; return n; };
      const bar = mk('div', 'explore-bar');
      const title = mk('h2', 'explore-title'); title.id = 'explore-title';
      title.append(mk('span', 'explore-base', x.base), mk('span', 'explore-body', ` · ${x.body}`));
      const back = mk('button', 'chip explore-return', `⬆ ${t('returnOrbit', lang)}`);
      back.type = 'button'; back.id = 'return-orbit'; back.dataset.ui = 'return-orbit';
      back.addEventListener('click', () => this.emit({ type: 'toggleHorizon' }));
      bar.append(title, back);
      const hint = mk('p', 'explore-hint'); hint.id = 'explore-hint'; hint.hidden = true;
      // Local time, the Day / Golden Hour / Night presets and Restore: one group (main.ts jumps the clock; the scene's
      // lighting follows the time). Golden Hour is the way into the near-sunset preview (same ids as before).
      const time = mk('section', 'explore-time'); time.id = 'explore-time'; time.dataset.ui = 'explore-time';
      time.setAttribute('role', 'group'); time.setAttribute('aria-labelledby', 'explore-time-label');
      const head = mk('p', 'explore-time-head');
      const label = mk('span', 'explore-time-label', t('localTime', lang)); label.id = 'explore-time-label';
      const clock = mk('span', 'explore-local'); clock.id = 'explore-local';
      const current = mk('span', 'explore-active'); current.id = 'explore-active';
      // Short landscape with Restore beside the clock: the long label steps out of sight and this short one stays
      // (aria-hidden: the group is named by the long label).
      const short = mk('span', 'explore-time-short', t('localTimeShort', lang)); short.setAttribute('aria-hidden', 'true');
      head.append(label, short, clock, current);
      const presets = mk('div', 'explore-presets');
      const note = mk('span', 'explore-golden-note', t('presetNote', lang)); note.id = 'horizon-sunset-note';
      const buttons = new Map<TimePreset, HTMLButtonElement>();
      for (const id of TIME_PRESETS) {
        // The icon in its own span (a dark disc behind it when pressed); the text stays "<icon> <name>".
        const b = mk('button', 'chip explore-preset');
        b.append(mk('span', 'preset-icon', PRESET_ICON[id]), ` ${t(PRESET_LABEL[id], lang)}`);
        b.type = 'button'; b.dataset.preset = id; b.dataset.ui = `preset:${id}`; b.id = id === 'golden' ? 'horizon-sunset' : `preset-${id}`;
        b.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-describedby', id === 'golden' ? `${note.id} explore-golden-desc` : note.id);
        b.tabIndex = id === 'day' ? 0 : -1;
        b.addEventListener('click', () => this.onPreset?.(id));
        buttons.set(id, b); presets.append(b);
      }
      // Arrows move between the presets (one tab stop); Enter / Space apply one.
      presets.addEventListener('keydown', (ev) => {
        const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
        if (!keys.includes(ev.key)) return;
        const list = [...buttons.values()];
        const i = Math.max(0, list.indexOf(document.activeElement as HTMLButtonElement));
        const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? list.length - 1
          : (i + (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 1) + list.length) % list.length;
        ev.preventDefault(); ev.stopPropagation();
        for (const [k, b] of list.entries()) b.tabIndex = k === next ? 0 : -1;
        list[next].focus();
      });
      const goldenDesc = mk('span', 'explore-sr', t('goldenHourNote', lang)); goldenDesc.id = 'explore-golden-desc';
      const restore = mk('button', 'restore-time'); restore.type = 'button'; restore.id = 'restore-time'; restore.dataset.ui = 'restore-time'; restore.hidden = true;
      // A drawn icon, not a ↺ character: Burmese fonts draw ↺ like a letter.
      restore.innerHTML = '<svg class="restore-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M2.6 2.2v3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      restore.append(mk('span', 'restore-label', t('restoreTime', lang)));
      restore.addEventListener('click', () => this.onRestore?.());
      const timeLive = mk('p', 'explore-sr'); timeLive.id = 'explore-time-live'; timeLive.setAttribute('role', 'status'); timeLive.setAttribute('aria-live', 'polite');
      time.append(head, presets, note, goldenDesc, restore, timeLive);
      const details = mk('details', 'explore-sky'); details.open = keepOpen;
      const facts = mk('dl', 'sky');
      details.append(mk('summary', '', t('horizonSky', lang)), facts);
      const live = mk('p', 'explore-sr'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
      const landmarks = x.landmarks ? this.buildLandmarks(lang, mk) : null;
      if (!landmarks) this.landmarkUi = null;
      this.root.replaceChildren(bar, hint, time, ...(landmarks ? [landmarks] : []), details, live);
      this.timeUi = { clock, current, buttons, restore, live: timeLive, key: '' };
      this.root.setAttribute('aria-labelledby', title.id);
      this.root.setAttribute('aria-live', 'off');
      this.root.classList.add('horizon', 'explore');
      for (const c of ['is-countdown', 'is-landing', 'is-flight']) this.root.classList.remove(c);
      this.root.hidden = false; this.measuredAt = 0;
      this.meter = this.altitudeValue = this.autoButton = this.sensitivityButton = this.telemetry = this.alignment = null;
      const show = entering ? !hintSeen() : e!.hintUntil > now;
      e = this.explore = { lang, base: x.base, body: x.body, facts, hint, live, looks: entering ? x.looks : e!.looks,
        hintUntil: show ? (entering ? now + LOOK_HINT_MS : e!.hintUntil) : 0, hintKind: null, landmarks: !!x.landmarks };
      if (show && entering) markHintSeen(); // once a session: re-entry does not show it again
      if (hadFocus) document.getElementById(hadFocus)?.focus({ preventScroll: true }); // a language change keeps focus
    }
    const rows = skyFacts(sky, lang);
    const factsKey = rows.map((n) => n.textContent).join('|');
    if (e.facts.dataset.key !== factsKey) { e.facts.replaceChildren(...rows); e.facts.dataset.key = factsKey; }
    this.renderTime(sky, x.time ?? null, lang);
    if (x.landmarks) this.renderLandmarks(x.landmarks, lang);
    // Gone after the first look (a drag, wheel, key or hand move the view took) or its time.
    if (x.looks !== e.looks) { e.looks = x.looks; e.hintUntil = 0; }
    const kind: LookInput = x.hand ? 'hand' : this.lastInput;
    const showHint = e.hintUntil > now;
    if (showHint && kind !== e.hintKind) {
      e.hintKind = kind;
      e.hint.textContent = t(`horizonLook.${kind}` as StringKey, lang);
      if (!e.live.textContent) e.live.textContent = e.hint.textContent; // announced once
    }
    // Where the card ends, for toasts to sit below it (re-measured a few times a second: it wraps and the hint goes).
    if (now - this.measuredAt > 250) {
      this.measuredAt = now;
      const bottom = `${Math.ceil(this.root.getBoundingClientRect().bottom)}px`;
      if (document.documentElement.style.getPropertyValue('--explore-bottom') !== bottom) document.documentElement.style.setProperty('--explore-bottom', bottom);
    }
    if (e.hint.hidden === showHint) {
      e.hint.hidden = !showHint;
      if (showHint) this.root.dataset.hint = kind; else delete this.root.dataset.hint;
    }
  }

  /**
   * The Landmarks disclosure (Jezero): a toggle (folded on phones), the three landmarks as pressed-state buttons, the
   * framed one's name and line, and Back to overview (camera only; Return to orbit stays the way out). Esc inside the
   * open list folds it and stays in Explore.
   */
  private buildLandmarks(lang: Lang, mk: <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => HTMLElementTagNameMap[K]) {
    const prev = this.landmarkUi;
    const section = mk('section', 'explore-landmarks'); section.dataset.ui = 'explore-landmarks-group';
    const row = mk('div', 'explore-landmarks-row');
    const toggle = mk('button', 'landmarks-toggle'); toggle.type = 'button'; toggle.id = 'explore-landmarks'; toggle.dataset.ui = 'explore-landmarks';
    toggle.setAttribute('aria-controls', 'explore-landmark-list');
    const label = mk('span', 'landmarks-label', t('landmark.title', lang)); label.id = 'explore-landmarks-label';
    const current = mk('span', 'landmarks-current');
    const words = mk('span', 'landmarks-text'); words.append(label, current);
    toggle.append(words);
    const back = mk('button', 'landmark-overview'); back.type = 'button'; back.id = 'landmark-overview'; back.dataset.ui = 'landmark-overview'; back.hidden = true;
    // A drawn "whole view" frame (four corners), not a character: back to the wide Explore view, not to orbit.
    back.innerHTML = '<svg class="overview-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    back.append(mk('span', 'landmark-overview-label', t('landmark.overview', lang)));
    back.addEventListener('click', () => { if (this.landmarkUi) this.landmarkUi.overviewAsked = true; this.emit({ type: 'landmarkOverview' }); });
    row.append(toggle, back);
    const panel = mk('div', 'explore-landmark-list'); panel.id = 'explore-landmark-list';
    panel.setAttribute('role', 'group'); panel.setAttribute('aria-labelledby', label.id);
    const list = mk('div', 'landmark-buttons');
    const buttons = new Map<LandmarkId, HTMLButtonElement>();
    for (const id of LANDMARK_IDS) {
      const b = mk('button', 'explore-landmark', t(LANDMARK_NAME[id], lang));
      b.type = 'button'; b.id = `landmark-${id}`; b.dataset.landmark = id; b.dataset.ui = `landmark:${id}`;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => this.emit({ type: 'frameLandmark', id }));
      buttons.set(id, b); list.append(b);
    }
    const detail = mk('p', 'landmark-detail'); detail.id = 'landmark-detail'; detail.hidden = true;
    const name = mk('strong', 'landmark-name'); const info = mk('span', 'landmark-info');
    detail.append(name, info);
    panel.append(list, detail);
    const live = mk('p', 'explore-sr'); live.id = 'landmark-live'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
    section.append(row, panel, live);
    const setOpen = (open: boolean) => {
      this.landmarksOpen = open;
      toggle.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
      section.classList.toggle('is-open', open);
    };
    setOpen(this.landmarksOpen ?? !(typeof matchMedia === 'function' && matchMedia(COMPACT).matches));
    toggle.addEventListener('click', () => {
      setOpen(!this.landmarksOpen);
      if (this.landmarksOpen) this.reveal(section); // short landscape scrolls the card
    });
    // Esc in the open list (or on its toggle) folds it, focus on the toggle, and stays in Explore: handled here so
    // neither the card's Esc (back to orbit) nor the scene's sees it.
    section.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || !this.landmarksOpen) return;
      if (!(ev.target instanceof Node) || !(panel.contains(ev.target) || ev.target === toggle)) return;
      ev.preventDefault(); ev.stopPropagation();
      setOpen(false); toggle.focus();
    });
    this.landmarkUi = { toggle, panel, current, buttons, detail, name, info, back, live, key: '',
      selected: undefined, lastSelected: prev?.lastSelected ?? null, overviewAsked: false };
    return section;
  }

  /**
   * Scrolls the card (short landscape: it scrolls under a sticky bar) so `el` is in view below the bar, choosing the
   * nearest position where no control is cut by the bar's edge (half a preset row under the bar reads as broken); an
   * `el` taller than the view is shown from its top. `last`: the range ends there instead; `fallback` false: when the
   * range cannot be shown whole nothing scrolls (and false is returned).
   */
  private reveal(el: HTMLElement, last: HTMLElement = el, fallback = true): boolean {
    const card = this.root, bar = card.querySelector<HTMLElement>('.explore-bar');
    if (!bar || bar.contains(el) || typeof getComputedStyle !== 'function' || card.scrollHeight <= card.clientHeight + 1 || getComputedStyle(bar).position !== 'sticky') return true;
    const box = card.getBoundingClientRect(), port = box.top + card.clientTop, now = card.scrollTop;
    const edge = bar.getBoundingClientRect().bottom - port; // the stuck bar's bottom, from the scrollport's top
    const max = card.scrollHeight - card.clientHeight;
    const y = (n: Element) => { const r = n.getBoundingClientRect(); return { top: r.top - port + now, bottom: r.bottom - port + now }; };
    const target = { top: y(el).top, bottom: Math.max(y(el).bottom, y(last).bottom) };
    const controls = [...card.querySelectorAll<HTMLElement>('button, summary')].filter((n) => n !== bar && !bar.contains(n) && n.getClientRects().length).map(y);
    const ok = (s: number) => s >= 0 && s <= max && target.top >= s + edge && target.bottom <= s + card.clientHeight
      && !controls.some((c) => c.top < s + edge - 1 && c.bottom > s + edge + 1);
    const candidates = [0, max, ...controls.map((c) => c.top - edge), target.top - edge].map((s) => Math.round(Math.max(0, Math.min(max, s))));
    const valid = candidates.filter(ok).sort((a, b) => Math.abs(a - now) - Math.abs(b - now));
    if (!valid.length && !fallback) return false;
    const to = valid[0] ?? Math.max(0, Math.min(max, Math.round(target.top - edge)));
    if (Math.abs(to - now) > 1) card.scrollTop = to;
    return valid.length > 0;
  }

  /** The framed landmark (pressed, named, its line), Back to overview, and one polite announcement per change. */
  private renderLandmarks(lm: ExploreLandmarks, lang: Lang) {
    const u = this.landmarkUi;
    if (!u) return;
    const key = JSON.stringify([lm.selected, lm.canReturn, lang]);
    if (key === u.key) return;
    u.key = key;
    const first = u.selected === undefined; // just built (entry or a language change): nothing to announce
    const before = u.selected ?? null;
    const sel = lm.selected;
    for (const [id, b] of u.buttons) b.setAttribute('aria-pressed', String(id === sel));
    u.detail.hidden = sel === null;
    u.name.textContent = sel ? t(LANDMARK_NAME[sel], lang) : '';
    u.info.textContent = sel ? t(LANDMARK_INFO[sel], lang) : '';
    u.current.textContent = sel ? t(LANDMARK_NAME[sel], lang) : '';
    if (sel) u.lastSelected = sel;
    if (u.back.hidden === lm.canReturn) {
      // Back to overview going with focus on it: focus to the landmark that was framed (list open), else the toggle.
      if (!lm.canReturn && document.activeElement === u.back) {
        const to = u.lastSelected && !u.panel.hidden ? u.buttons.get(u.lastSelected) : null;
        (to ?? u.toggle).focus();
      }
      u.back.hidden = !lm.canReturn;
    }
    if (!first && sel !== before) {
      const text = sel ? `${tf('landmark.viewing', lang, { name: t(LANDMARK_NAME[sel], lang) })} · ${t(LANDMARK_INFO[sel], lang)}`
        : u.overviewAsked ? t('landmark.overviewShown', lang) : '';
      if (text) { u.live.textContent = ''; requestAnimationFrame(() => { u.live.textContent = text; }); }
      // Short landscape scrolls the card: the Landmarks row (Back to overview), the list and the line come into its
      // view, from the top when they do not all fit.
      // When that is too tall, the chosen button and its line, if they fit together.
      if (sel && !u.panel.hidden) {
        const section = u.toggle.closest('section') ?? u.detail;
        if (!this.reveal(section, section, false) && !this.reveal(u.buttons.get(sel)!, u.detail, false)) this.reveal(section);
      }
    }
    if (sel === null) u.overviewAsked = false;
    u.selected = sel;
  }

  /** The time group: local time, which preset is active (pressed + named), Golden Hour availability, Restore. */
  private renderTime(sky: SkyReport, time: ExploreTime | null, lang: Lang) {
    const u = this.timeUi;
    if (!u) return;
    const local = clockLabel(sky.day.hours);
    const active = time?.preset ?? null;
    const key = JSON.stringify([local, active, time?.restore ?? null, time?.golden ?? true, lang]);
    if (key === u.key) return;
    u.key = key;
    u.clock.textContent = local;
    u.current.textContent = active ? `· ${t(PRESET_LABEL[active], lang)}` : '';
    for (const [id, b] of u.buttons) {
      b.setAttribute('aria-pressed', String(id === active));
      if (id === 'golden') { if (time && !time.golden) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled'); }
    }
    const offer = time?.restore ?? null;
    if (u.restore.hidden !== (offer === null)) {
      // Focus on Restore as it goes stays in the group (the active preset, else the first one).
      if (offer === null && document.activeElement === u.restore) (u.buttons.get(active ?? 'day') ?? u.buttons.get('day'))!.focus();
      u.restore.hidden = offer === null;
    }
    if (offer !== null) u.restore.setAttribute('aria-label', tf('restoreTimeLabel', lang, { date: dateLabel(offer, 0, lang) }));
    this.root.classList.toggle('has-restore', offer !== null);
  }

  /** One polite announcement in the time group (a preset applied, the time restored). */
  announceTime(text: string) {
    const live = this.timeUi?.live;
    if (!live) return;
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = text; });
  }

  /** The time group's first preset, or the active one (focus after Restore). */
  focusPreset(id: TimePreset | null = null) { this.timeUi?.buttons.get(id ?? 'day')?.focus(); }
}
