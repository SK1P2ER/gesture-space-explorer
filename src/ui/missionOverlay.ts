import type { Lang } from '../data/bodies';
import type { SteerSensitivity } from '../gestures/steer';
import type { SkyReport } from '../app/baseSky';
import type { Intent } from '../intents';
import { skyFacts } from './basePanel';
import { t, tf } from './i18n';
import { dt } from './designStrings';
import './missionOverlay.css';
import type { landingTelemetry } from '../sim/landingTelemetry';

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
}

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

  constructor(private readonly emit: (intent: Intent) => void) {}

  render(v: OverlayView, lang: Lang, guided = false) {
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
}
