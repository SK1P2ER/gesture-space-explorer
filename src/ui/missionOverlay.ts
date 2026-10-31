import type { Lang } from '../data/bodies';
import type { SteerSensitivity } from '../gestures/steer';
import type { SkyReport } from '../app/baseSky';
import type { Intent } from '../intents';
import { skyFacts } from './basePanel';
import { t, tf } from './i18n';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export interface OverlayView {
  /** The countdown number, during Launch. */
  count: number | null;
  /** Counting by hand: say how. */
  byHand: boolean;
  /** Where the rocket is going, during Travel. */
  flyingTo: string | null;
  /** Docking: height left (1 at the start, 0 on the pad) and whether auto-land is on. */
  docking: { altitude: number; auto: boolean; sensitivity: SteerSensitivity } | null;
  /** The horizon view: the sky's numbers, and the way back up. */
  horizon: SkyReport | null;
}

/** Center of the screen: the big countdown, and "Flying to …" with Skip during the trip. */
export class MissionOverlay {
  private readonly root = $('#mission-overlay');
  private last = '';

  constructor(private readonly emit: (intent: Intent) => void) {}

  render(v: OverlayView, lang: Lang) {
    const key = JSON.stringify([{ ...v, horizon: v.horizon && skyFacts(v.horizon, lang).map((e) => e.textContent).join('|') }, lang]);
    if (key === this.last) return;
    this.last = key;
    this.root.hidden = v.count === null && v.flyingTo === null && v.docking === null && v.horizon === null;
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
      this.root.classList.add('horizon');
      return;
    }
    this.root.classList.remove('horizon');
    if (v.docking) {
      const meter = el('div', '', 'altitude');
      meter.setAttribute('role', 'meter');
      meter.setAttribute('aria-label', t('altitude', lang));
      meter.setAttribute('aria-valuenow', String(Math.round(v.docking.altitude * 100)));
      meter.append(el('span', '', 'fill'));
      (meter.firstChild as HTMLElement).style.width = `${Math.round(v.docking.altitude * 100)}%`;
      const auto = el('button', `${t('autoLand', lang)}: ${t(v.docking.auto ? 'on' : 'off', lang)}`, 'chip') as HTMLButtonElement;
      auto.type = 'button';
      auto.setAttribute('aria-pressed', String(v.docking.auto));
      auto.addEventListener('click', () => this.emit({ type: 'toggleAutoLand' }));
      const sens = el('button', `✋ ${t('steerSensitivity', lang)}: ${t(`sens.${v.docking.sensitivity}`, lang)}`, 'chip') as HTMLButtonElement;
      sens.type = 'button';
      sens.addEventListener('click', () => this.emit({ type: 'cycleSteerSensitivity' }));
      const buttons = el('div', '', 'buttons');
      buttons.append(auto, sens);
      this.root.replaceChildren(meter, el('p', t('dockHint', lang), 'hint'), buttons);
      return;
    }
    const skip = el('button', t('skip', lang), 'chip') as HTMLButtonElement;
    skip.type = 'button';
    skip.addEventListener('click', () => this.emit({ type: 'select' }));
    this.root.replaceChildren(el('p', `🚀 ${tf('flyingTo', lang, { name: v.flyingTo! })}`, 'flying'), skip);
  }
}
