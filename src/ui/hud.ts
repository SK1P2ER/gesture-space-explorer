import { baseOn } from '../data/bases';
import { BODIES, moonsOf, type Body, type Lang } from '../data/bodies';
import { length, LIGHT_SECONDS_PER_AU, lightSeconds, nextPerihelion, sunCentered } from '../data/ephemeris';
import { weightOn } from '../data/weight';
import type { Intent } from '../intents';
import type { Quality, QualitySetting } from '../quality';
import type { TextureStatus } from '../scene/solarSystem';
import { t, tf, type StringKey } from './i18n';
import { kindLabel } from './kind';
import { lightTimeLabel, monthLabel } from './timeFormat';
import { kgLabel } from './weightPanel';

export type TrackingStatus =
  | { kind: 'loading'; progress: number }
  | { kind: 'tracking'; delegate: string }
  | { kind: 'keyboard'; reason: StringKey };

/** Whether trying again could help: not without HTTPS or a camera API, which a retry can't change. */
export function canRestartTracking(status: TrackingStatus): boolean {
  return status.kind === 'keyboard' && status.reason !== 'err.insecure' && status.reason !== 'err.unsupported';
}

export interface HudState {
  lang: Lang;
  focused: Body;
  selected: Body | null;
  status: TrackingStatus;
  textures: TextureStatus;
  /** The tier in effect… */
  quality: Quality;
  /** …and what the Quality button is set to (Auto shows the tier it picked). */
  qualitySetting: QualitySetting;
  watermark: boolean;
  trueScale: boolean;
  /** Kg on Earth, if the user entered it. */
  weightKg: number | null;
  /** The shown date, for the light travel time. */
  timeMs: number;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export class Hud {
  private status = $('#status');
  private handControl = $<HTMLButtonElement>('#hand-control');
  private loading = $('#loading');
  private focus = $('#focus');
  private help = $('#help');
  private info = $('#info');
  private creditsLink = $<HTMLAnchorElement>('#credits-link');
  private qualityButton = $<HTMLButtonElement>('#quality');
  private photoButton = $<HTMLButtonElement>('#photo');
  private watermarkButton = $<HTMLButtonElement>('#watermark');
  private trueScaleButton = $<HTMLButtonElement>('#true-scale');
  private lightCell: HTMLElement | null = null;
  /** Whose card is shown: a different body's card opens expanded (on phones it can be collapsed). */
  private cardFor: string | null = null;
  /** The orbit the light time is measured on: the body's own, or its planet's for a moon. */
  private lightOrbit: Body['orbit'] = undefined;
  private last = '';

  constructor(private readonly emit: (intent: Intent) => void) {
    this.handControl.addEventListener('click', () => {
      this.emit({ type: 'restartTracking' });
      this.handControl.blur(); // keep Space / Enter for the scene
    });
  }

  render(s: HudState) {
    // Cheap change detection: the HUD is re-rendered every frame by main.
    const visit = s.selected?.comet ? nextPerihelion(s.selected.comet, s.timeMs) : 0;
    const key = JSON.stringify([s.lang, s.focused.id, s.selected?.id, s.status, s.textures, s.quality, s.qualitySetting, s.watermark, s.trueScale, s.weightKg, visit]);
    if (key !== this.last) {
      this.last = key;
      this.rebuild(s);
    }
    // The light time follows the date, so it's updated in place rather than re-announced with the card.
    if (this.lightCell && s.selected && (this.lightOrbit || s.selected.comet)) {
      const seconds = this.lightOrbit ? lightSeconds(this.lightOrbit, s.timeMs) : length(sunCentered(s.selected, s.timeMs)) * LIGHT_SECONDS_PER_AU;
      const text = lightTimeLabel(seconds, s.lang);
      if (this.lightCell.textContent !== text) this.lightCell.textContent = text;
    }
  }

  private rebuild(s: HudState) {

    document.documentElement.lang = s.lang;

    this.status.dataset.kind = s.status.kind;
    this.status.textContent =
      s.status.kind === 'loading'
        ? `${t('loading', s.lang)} ${Math.round(s.status.progress * 100)}%`
        : s.status.kind === 'tracking'
          ? `✋ ${t('tracking', s.lang)} (${s.status.delegate})`
          : `⌨️ ${t('keyboardOnly', s.lang)} — ${t(s.status.reason, s.lang)}`;
    // After any stop (a failure, a disconnect, back/forward navigation): start again without a reload.
    this.handControl.hidden = !canRestartTracking(s.status);
    this.handControl.textContent = `🖐 ${t('handControlStart', s.lang)}`;

    // Never blocks anything: bodies show their base color until their images arrive.
    const { loaded, total, hd } = s.textures;
    this.loading.hidden = loaded === total && !hd;
    this.loading.textContent =
      loaded < total ? `${t('loadingTextures', s.lang)} ${loaded}/${total}` : t('loadingHd', s.lang);

    this.focus.textContent = s.focused.name[s.lang];
    this.help.textContent = t('help', s.lang);
    this.creditsLink.textContent = t('credits', s.lang);
    const tier = t(s.quality === 'ultra' ? 'qualityUltra' : s.quality === 'high' ? 'qualityHigh' : 'qualityLow', s.lang);
    this.qualityButton.textContent = `${t('quality', s.lang)}: ${s.qualitySetting === 'auto' ? `${t('qualityAuto', s.lang)} (${tier})` : tier}`;
    this.qualityButton.setAttribute('aria-pressed', String(s.quality !== 'low'));
    this.photoButton.textContent = `📷 ${t('photo', s.lang)}`;
    this.watermarkButton.textContent = `${t('watermark', s.lang)}: ${t(s.watermark ? 'on' : 'off', s.lang)}`;
    this.watermarkButton.setAttribute('aria-pressed', String(s.watermark));
    this.trueScaleButton.textContent = `${t('trueScale', s.lang)}: ${t(s.trueScale ? 'on' : 'off', s.lang)}`;
    this.trueScaleButton.setAttribute('aria-pressed', String(s.trueScale));

    this.lightCell = null;
    if (!s.selected) {
      this.info.hidden = true;
      this.cardFor = null;
      return;
    }
    if (s.selected.id !== this.cardFor) this.info.classList.remove('collapsed');
    this.cardFor = s.selected.id;
    const b = s.selected;
    const parent = b.parent ? BODIES.find((p) => p.id === b.parent)! : null;
    this.info.hidden = false;
    const facts = el(
      'dl',
      ...row(t('diameter', s.lang), `${b.facts.diameterKm.toLocaleString('en-US')} km`),
      ...row(t('day', s.lang), b.facts.day[s.lang]),
      ...(parent
        ? row(tf('orbitsIn', s.lang, { parent: parent.name[s.lang] }), b.facts.year[s.lang])
        : [...row(t('year', s.lang), b.facts.year[s.lang]), ...row(t('moons', s.lang), b.facts.moons)]),
    );
    this.lightOrbit = b.orbit ?? parent?.orbit;
    if (this.lightOrbit || b.comet) {
      this.lightCell = el('dd');
      this.lightCell.setAttribute('aria-live', 'off'); // changes with the date; not worth announcing
      facts.append(el('dt', t('lightFromSun', s.lang)), this.lightCell);
    }
    facts.append(...row(`⚖️ ${t('yourWeight', s.lang)}`, s.weightKg === null ? this.enterWeightButton(s.lang) : kgLabel(weightOn(s.weightKg, b.gravity), s.lang)));
    if (b.comet) {
      // A month before perihelion, at a day per second: the tail grows and swings round the Sun in about a minute.
      const perihelion = nextPerihelion(b.comet, s.timeMs);
      const button = el('button', tf('nextVisit', s.lang, { date: monthLabel(perihelion, s.lang) })) as HTMLButtonElement;
      button.type = 'button';
      button.className = 'chip visit';
      button.addEventListener('click', () => this.emit({ type: 'timeJump', ms: perihelion - 30 * 86_400_000, rate: 86_400 }));
      facts.append(el('dt', ''), el('dd', button));
    }
    // Handle (phones), title, moon buttons (right under the title, so they stay when the sheet is collapsed), details.
    const kind = kindLabel(b, s.lang);
    const head = el('header', el('h2', b.name[s.lang]), ...(kind ? [withClass(el('p', kind), 'kind')] : []), this.closeButton(s.lang));
    const base = baseOn(b.id);
    if (base) {
      const visit = el('button', `🏠 ${tf('visitBase', s.lang, { name: base.name[s.lang] })}`) as HTMLButtonElement;
      visit.type = 'button';
      visit.className = 'chip visit-base';
      visit.addEventListener('click', () => this.emit({ type: 'enterBase', baseId: base.id }));
      facts.append(el('dt', ''), el('dd', visit));
    }
    const moons = moonsOf(b.id);
    const moonRow = moons.length ? [withClass(el('div', withClass(el('span', t('visitMoons', s.lang)), 'label'), ...moons.map((m) => this.visitButton(m, s.lang))), 'moons')] : [];
    this.info.replaceChildren(this.sheetHandle(s.lang), withClass(head, 'card-head'), ...moonRow, withClass(el('div', el('p', b.blurb[s.lang]), facts), 'details'));
  }

  /** The bottom sheet's grip (phones only, see ui/sheet.ts): tap to collapse or expand. */
  private sheetHandle(lang: Lang) {
    const handle = el('button') as HTMLButtonElement;
    handle.type = 'button';
    handle.className = 'sheet-handle';
    handle.setAttribute('aria-label', t('sheet.toggle', lang));
    handle.setAttribute('aria-expanded', String(!this.info.classList.contains('collapsed')));
    return handle;
  }

  private closeButton(lang: Lang) {
    const close = el('button', '×') as HTMLButtonElement;
    close.type = 'button';
    close.className = 'close';
    close.setAttribute('aria-label', t('close', lang));
    close.addEventListener('click', () => this.emit({ type: 'dismiss', what: 'info' }));
    return close;
  }

  /** A moon's name as a button: flies there and shows its card. */
  private visitButton(moon: Body, lang: Lang) {
    const button = el('button', moon.name[lang]) as HTMLButtonElement;
    button.type = 'button';
    button.className = 'chip';
    button.addEventListener('click', () => this.emit({ type: 'select', bodyId: moon.id }));
    return button;
  }

  private enterWeightButton(lang: Lang) {
    const button = el('button', t('enterWeight', lang)) as HTMLButtonElement;
    button.type = 'button';
    button.className = 'chip';
    button.addEventListener('click', () => this.emit({ type: 'toggleWeightPanel', open: true }));
    return button;
  }
}

function el(tag: string, ...children: (string | Node)[]) {
  const node = document.createElement(tag);
  node.append(...children);
  return node;
}

const row = (label: string, value: string | Node) => [el('dt', label), el('dd', value)];

function withClass<T extends HTMLElement>(node: T, className: string): T {
  node.className = className;
  return node;
}
