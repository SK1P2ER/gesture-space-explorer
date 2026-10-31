import type { Lang } from '../data/bodies';
import type { Intent } from '../intents';
import type { SimClock } from '../sim/clock';
import { t } from './i18n';
import { COMPACT_QUERY } from './layout';
import { dateLabel, speedLabel } from './timeFormat';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** The full time bar folds back into the pill after this long without a touch. */
export const TIME_BAR_COLLAPSE_MS = 4000;

/**
 * Date, Now, pause and the speed slider. On compact screens it's a small pill
 * (date · speed, and pause) until tapped open. Everything it does goes out as Intents.
 */
export class TimeBar {
  private date = $('#timebar .date');
  private now = $<HTMLButtonElement>('#timebar .now');
  private pause = $<HTMLButtonElement>('#timebar .pause');
  private slider = $<HTMLInputElement>('#timebar .speed');
  private rate = $('#timebar .rate');
  private root = $('#timebar');
  private pill = $<HTMLButtonElement>('#timebar .pill');
  private pillText = $('#timebar .pill-text');
  private pillPause = $<HTMLButtonElement>('#timebar .pill-pause');
  private compact = matchMedia(COMPACT_QUERY);
  /** When the open bar was last touched (it folds back after a while). */
  private touched = 0;
  private dragging = false;
  private last = '';

  constructor(private readonly emit: (intent: Intent) => void) {
    this.pill.addEventListener('click', () => {
      this.touched = performance.now();
      emit({ type: 'toggleTimeBar', open: true });
      this.pill.blur();
    });
    this.pillPause.addEventListener('click', () => {
      emit({ type: 'togglePause' });
      this.pillPause.blur();
    });
    for (const type of ['pointerdown', 'input', 'focusin'] as const) this.root.addEventListener(type, () => (this.touched = performance.now()));
    // On narrow screens the bar sits just above the footer, whose height depends on the language.
    const footer = $('footer.hud');
    const root = document.documentElement;
    new ResizeObserver(() => root.style.setProperty('--footer-h', `${footer.offsetHeight}px`)).observe(footer);
    this.slider.addEventListener('input', () => {
      this.dragging = true;
      emit({ type: 'setTimeSpeed', position: Number(this.slider.value) / 1000 });
    });
    this.slider.addEventListener('change', () => {
      this.dragging = false;
      this.slider.blur(); // arrow keys go back to switching planets
    });
    this.now.addEventListener('click', () => {
      emit({ type: 'timeNow' });
      this.now.blur();
    });
    this.pause.addEventListener('click', () => {
      emit({ type: 'togglePause' });
      this.pause.blur();
    });
  }

  render(clock: SimClock, lang: Lang, open: boolean, now = performance.now()) {
    const compact = this.compact.matches;
    if (open && compact && !this.dragging && now - this.touched > TIME_BAR_COLLAPSE_MS) this.emit({ type: 'toggleTimeBar', open: false });
    const collapsed = compact && !open;
    if (this.root.classList.contains('collapsed') !== collapsed) {
      this.root.classList.toggle('collapsed', collapsed);
      this.pill.setAttribute('aria-expanded', String(!collapsed));
    }
    const date = dateLabel(clock.time, clock.effectiveRate, lang);
    const rate = speedLabel(clock.rate, clock.paused, lang);
    const position = Math.round(clock.position * 1000);
    const key = `${date}|${rate}|${position}|${clock.paused}|${lang}|${collapsed}`;
    if (key === this.last) return;
    this.last = key;
    this.date.textContent = date;
    this.rate.textContent = rate;
    this.now.textContent = t('now', lang);
    this.pause.textContent = clock.paused ? '▶' : '⏸';
    this.pillText.textContent = `📅 ${date} · ${rate}`;
    this.pill.setAttribute('aria-label', `${t('showTimeControls', lang)}: ${date}, ${rate}`);
    this.pillPause.textContent = this.pause.textContent;
    this.pillPause.setAttribute('aria-label', t(clock.paused ? 'resumeTime' : 'pauseTime', lang));
    this.pause.setAttribute('aria-label', t(clock.paused ? 'resumeTime' : 'pauseTime', lang));
    this.slider.setAttribute('aria-label', t('timeSpeed', lang));
    this.slider.setAttribute('aria-valuetext', rate);
    if (!this.dragging) this.slider.value = String(position);
  }
}
