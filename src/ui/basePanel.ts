import { BASES, type Base } from '../data/bases';
import { BODIES, type Lang } from '../data/bodies';
import type { Intent } from '../intents';
import type { SkyReport } from '../app/baseSky';
import { LAYOUTS } from '../scene/baseKit/showcases';
import { clockLabel } from '../sim/localSky';
import { t, tf, type StringKey } from './i18n';
import { dt } from './designStrings';
import './basePanel.css';

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
  private selection: HTMLElement | null = null;
  private tab: 'overview' | 'travel' = 'overview';
  private baseId: string | null = null;
  private overview: HTMLElement | null = null;
  private travel: HTMLElement | null = null;
  private tabs: HTMLButtonElement[] = [];
  private overviewDetails: HTMLElement | null = null;
  private handle: HTMLButtonElement | null = null;
  private collapsed = false;
  private readonly compact = typeof matchMedia === 'function' ? matchMedia('(max-width: 640px), (max-height: 500px)') : null;

  constructor(private readonly emit: (intent: Intent) => void) {
    this.compact?.addEventListener('change', () => {
      if (!this.compact!.matches) this.setCollapsed(false);
    });
  }

  /** @param destination where the rocket will go, if chosen */
  render(base: Base | null, lang: Lang, destination: string | null, sky: SkyReport | null = null, canBuild = false, cameraControls?: HTMLElement) {
    // Only a different base, language or set of controls rebuilds the panel. The sky (by the local
    // minute) and the chosen destination update in place, so focus, scroll and taps survive them.
    const k = `${base?.id}|${lang}|${canBuild}|${!!cameraControls}`;
    if (k !== this.last) {
      if (base?.id !== this.baseId) {
        this.baseId = base?.id ?? null;
        this.tab = 'overview';
        this.collapsed = !!this.compact?.matches;
      }
      this.last = k;
      this.lastSky = '\u0000';
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
      const changed = this.lastDestination !== undefined;
      this.lastDestination = destination;
      for (const { id, button } of this.destinations) button.setAttribute('aria-pressed', String(id === destination));
      this.launch!.disabled = !destination;
      const target = BASES.find((b) => b.id === destination);
      this.selection!.replaceChildren(
        el('span', dt(target ? 'readyToLaunch' : 'chooseDestination', lang), 'selection-label'),
        ...(target ? [el('strong', target.name[lang])] : []),
      );
      if (changed && target) {
        this.showTab('travel', true);
        this.setCollapsed(false);
      }
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
    const handle = this.handle = el('button', '', 'base-sheet-handle') as HTMLButtonElement;
    handle.type = 'button';
    handle.setAttribute('aria-label', base.name[lang]);
    handle.setAttribute('aria-controls', 'base-content');
    handle.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    const head = el('div', '', 'base-heading');
    const title = el('h2', base.name[lang]);
    title.id = 'base-title';
    head.append(
      el('p', dt('flightDeck', lang), 'base-eyebrow'), title,
      el('p', `${tf('baseOn', lang, { body: body.name[lang] })} · ${t(`theme.${base.theme}` as StringKey, lang)}`, 'kind'),
    );
    this.root.setAttribute('aria-labelledby', 'base-title');
    const tablist = el('div', '', 'base-tabs');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', base.name[lang]);
    this.tabs = (['overview', 'travel'] as const).map((tab, index) => {
      const button = el('button', dt(tab, lang), 'base-tab') as HTMLButtonElement;
      button.type = 'button';
      button.id = `base-tab-${tab}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', `base-${tab}`);
      button.addEventListener('click', () => this.showTab(tab, true));
      button.addEventListener('keydown', (event) => {
        const key = event.key;
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
        event.preventDefault();
        const next = key === 'Home' ? 0 : key === 'End' ? 1 : 1 - index;
        this.showTab(next === 0 ? 'overview' : 'travel', true);
        this.tabs[next].focus();
      });
      return button;
    });
    tablist.append(...this.tabs);
    const overview = this.overview = el('section', '', 'base-overview');
    overview.id = 'base-overview';
    overview.setAttribute('role', 'tabpanel');
    overview.setAttribute('aria-labelledby', 'base-tab-overview');
    const actions = el('div', '', 'base-view-actions');
    actions.append(
      ...(LAYOUTS[base.id] ? [this.horizonButton(lang), this.goldenButton(lang)] : []),
      ...(LAYOUTS[base.id] && canBuild ? [this.buildButton(lang)] : []),
    );
    const details = this.overviewDetails = el('div', '', 'base-details');
    details.id = 'base-details';
    details.append(el('p', base.blurb[lang], 'base-description'), facts);
    overview.append(details, actions, ...(cameraControls ? [cameraControls] : []));
    const travel = this.travel = el('section', '', 'base-travel');
    travel.id = 'base-travel';
    travel.setAttribute('role', 'tabpanel');
    travel.setAttribute('aria-labelledby', 'base-tab-travel');
    travel.append(...this.launchControls(base, lang));
    const content = el('div', '', 'base-content');
    content.id = 'base-content';
    content.append(tablist, overview, travel);
    this.root.replaceChildren(
      handle, head, leave, content,
    );
    this.showTab(this.tab);
    this.setCollapsed(this.collapsed);
  }

  private showTab(tab: 'overview' | 'travel', expand = false) {
    this.tab = tab;
    if (expand) this.setCollapsed(false);
    this.tabs.forEach((button, index) => {
      const selected = index === (tab === 'overview' ? 0 : 1);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    if (this.overview) this.overview.hidden = this.overview.inert = tab !== 'overview';
    if (this.travel) this.travel.hidden = this.travel.inert = tab !== 'travel' || this.collapsed;
    this.handle?.setAttribute('aria-controls', tab === 'overview' ? 'base-details' : 'base-travel');
  }

  private setCollapsed(collapsed: boolean) {
    this.collapsed = collapsed && !!this.compact?.matches;
    this.root.setAttribute('data-collapsed', String(this.collapsed));
    if (this.overviewDetails) this.overviewDetails.hidden = this.overviewDetails.inert = this.collapsed;
    if (this.travel) this.travel.hidden = this.travel.inert = this.tab !== 'travel' || this.collapsed;
    this.handle?.setAttribute('aria-expanded', String(!this.collapsed));
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
    this.selection = el('div', '', 'base-selection');
    this.selection.setAttribute('aria-live', 'polite');
    return [el('p', t('flyTo', lang), 'kind'), list, this.selection, launch, el('p', t('launchHint', lang), 'hint')];
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
