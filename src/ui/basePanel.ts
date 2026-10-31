import { BASES, type Base } from '../data/bases';
import { BODIES, type Lang } from '../data/bodies';
import type { Intent } from '../intents';
import type { SkyReport } from '../app/baseSky';
import { LAYOUTS } from '../scene/baseKit/showcases';
import { clockLabel } from '../sim/localSky';
import { t, tf, type StringKey } from './i18n';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** The panel for the base you're at (BaseView): what it is, where to fly, and Launch. Its buttons go out as Intents. */
export class BasePanel {
  private readonly root = $('#base-panel');
  private last = '';
  private lastSky = '';
  private lastDestination: string | null | undefined;
  private facts: HTMLElement | null = null;
  private destinations: { id: string; button: HTMLButtonElement }[] = [];
  private launch: HTMLButtonElement | null = null;

  constructor(private readonly emit: (intent: Intent) => void) {}

  /** @param destination where the rocket will go, if chosen */
  render(base: Base | null, lang: Lang, destination: string | null, sky: SkyReport | null = null, canBuild = false, cameraControls?: HTMLElement) {
    // Only a different base, language or set of controls rebuilds the panel. The sky (by the local
    // minute) and the chosen destination update in place, so focus, scroll and taps survive them.
    const k = `${base?.id}|${lang}|${canBuild}|${!!cameraControls}`;
    if (k !== this.last) {
      this.last = k;
      this.lastSky = '';
      this.lastDestination = undefined;
      this.root.hidden = !base;
      if (base) this.rebuild(base, lang, canBuild, cameraControls);
      else {
        this.facts = this.launch = null;
        this.destinations = [];
      }
    }
    if (!base) return;
    const skyKey = sky ? `${clockLabel(sky.day.hours)}|${sky.up.map((u) => `${u.id}${Math.round(u.elevation)}${u.approximate ? '~' : ''}`).join()}` : '';
    if (skyKey !== this.lastSky) {
      this.lastSky = skyKey;
      const body = BODIES.find((b) => b.id === base.body)!;
      this.facts!.replaceChildren(el('dt', t('gravityHere', lang)), el('dd', `${body.gravity} m/s²`), ...(sky ? skyFacts(sky, lang) : []));
    }
    if (destination !== this.lastDestination) {
      this.lastDestination = destination;
      for (const { id, button } of this.destinations) button.setAttribute('aria-pressed', String(id === destination));
      this.launch!.disabled = !destination;
    }
  }

  private rebuild(base: Base, lang: Lang, canBuild: boolean, cameraControls?: HTMLElement) {
    const body = BODIES.find((b) => b.id === base.body)!;
    const leave = el('button', '×', 'close') as HTMLButtonElement;
    leave.type = 'button';
    leave.setAttribute('aria-label', t('leaveBase', lang));
    leave.addEventListener('click', () => this.emit({ type: 'dismiss' }));
    // The panel is a polite live region; the ticking clock shouldn't be read out every minute.
    const facts = this.facts = document.createElement('dl');
    facts.setAttribute('aria-live', 'off');
    this.root.replaceChildren(
      el('h2', `🏠 ${base.name[lang]}`),
      el('p', `${tf('baseOn', lang, { body: body.name[lang] })} · ${t(`theme.${base.theme}` as StringKey, lang)}`, 'kind'),
      leave,
      ...(cameraControls ? [cameraControls] : []),
      el('p', base.blurb[lang]),
      facts,
      ...(LAYOUTS[base.id] ? [this.horizonButton(lang), this.goldenButton(lang)] : []),
      ...(LAYOUTS[base.id] && canBuild ? [this.buildButton(lang)] : []),
      ...this.launchControls(base, lang),
    );
  }

  private goldenButton(lang: Lang) {
    const b = el('button', `🌅 ${t('goldenHour', lang)}`, 'chip golden') as HTMLButtonElement;
    b.type = 'button';
    b.addEventListener('click', () => this.emit({ type: 'goldenHour' }));
    return b;
  }

  private horizonButton(lang: Lang) {
    const b = el('button', `🌄 ${t('horizonView', lang)}`, 'chip horizon') as HTMLButtonElement;
    b.type = 'button';
    b.addEventListener('click', () => this.emit({ type: 'toggleHorizon' }));
    return b;
  }

  private buildButton(lang: Lang) {
    const b = el('button', `🛠 ${t('build', lang)}`, 'chip build') as HTMLButtonElement;
    b.type = 'button';
    b.addEventListener('click', () => this.emit({ type: 'toggleBuild' }));
    return b;
  }

  /** Where to fly (one button per base), and the launch button; render() sets which is chosen. */
  private launchControls(base: Base, lang: Lang): Node[] {
    const list = el('div', '', 'destinations');
    this.destinations = [];
    for (const other of BASES.filter((b) => b.id !== base.id)) {
      const b = el('button', other.name[lang], 'chip') as HTMLButtonElement;
      b.type = 'button';
      b.addEventListener('click', () => this.emit({ type: 'chooseDestination', baseId: other.id }));
      this.destinations.push({ id: other.id, button: b });
      list.append(b);
    }
    const launch = this.launch = el('button', `🚀 ${t('launch', lang)}`, 'chip launch') as HTMLButtonElement;
    launch.type = 'button';
    launch.addEventListener('click', () => this.emit({ type: 'launch' }));
    return [el('p', t('flyTo', lang), 'kind'), list, launch, el('p', t('launchHint', lang), 'hint')];
  }
}

/** Local solar time, sunrise and sunset, and what else is up in the sky. */
export function skyFacts(sky: SkyReport, lang: Lang): HTMLElement[] {
  const { day, up } = sky;
  const sunLine = day.polar
    ? t(day.polar === 'day' ? 'polarDay' : 'polarNight', lang)
    : tf('sunriseSunset', lang, { rise: clockLabel(day.sunrise!), set: clockLabel(day.sunset!) });
  const rows = [el('dt', t('localTime', lang)), el('dd', clockLabel(day.hours)), el('dt', '☀️'), el('dd', sunLine)];
  if (up.length || sky.local.objects.length) {
    const item = (u: SkyReport['up'][number]) => tf('skyItem', lang, { name: u.name[lang], deg: String(Math.round(u.elevation)) }) + (u.approximate ? ` (${t('approximate', lang)})` : '');
    const list = up.length ? up.map(item).join(' · ') : '—';
    rows.push(el('dt', t('inTheSky', lang)), el('dd', list));
  }
  return rows;
}

function el(tag: string, text: string, cls?: string) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
