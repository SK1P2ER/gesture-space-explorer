import type { Lang } from '../data/bodies';
import type { Action, EngineUi } from '../gestures/engine';
import type { ExtraAction, ExtraUi } from '../gestures/extras';

const LABELS: Record<Exclude<Action, null>, Record<Lang, string>> = {
  rotate: { en: '✋ Rotate', my: '✋ လှည့်', ja: '✋ 回転' },
  zoom: { en: '🤏 Zoom', my: '🤏 Zoom', ja: '🤏 ズーム' },
  swipe: { en: '✌️ V detected — hold for next · swipe ← →', my: '✌️ V — ငြိမ်ထား = နောက် · ← → ဝှေ့', ja: '✌️ V — キープで次へ · ← → スワイプ' },
  point: { en: '☝️ Point & hold', my: '☝️ ထိုးပြီး ငြိမ်ထား', ja: '☝️ 指さしてキープ' },
  pause: { en: '✊ Hold to pause', my: '✊ ဆုပ်ထား = ရပ်', ja: '✊ キープで一時停止' },
  time: { en: '🤏🤏 Time speed', my: '🤏🤏 အချိန်အမြန်နှုန်း', ja: '🤏🤏 時間の速さ' },
};

// v1.2 gestures (gestures/extras.ts).
const EXTRA_LABELS: Record<Exclude<ExtraAction, null>, Record<Lang, string>> = {
  photo: { en: '🤘 Hold for a photo', my: '🤘 ဓာတ်ပုံရိုက်ရန် ငြိမ်ထား', ja: '🤘 キープで撮影' },
  dial: { en: '🤙 Time dial — tilt ← →', my: '🤙 အချိန် dial — ← → စောင်းပါ', ja: '🤙 タイムダイヤル — 左右に傾ける' },
};

const RING_CIRCUMFERENCE = 2 * Math.PI * 16;
const FLASH_MS = 1200;

/** On-screen feedback for gestures: current action chip, pointer, progress rings, event flash. */
export class GestureHud {
  private chip = document.querySelector<HTMLElement>('#gesture')!;
  private pointer = document.querySelector<HTMLElement>('#pointer')!;
  private ring = document.querySelector<SVGCircleElement>('#pointer .progress')!;
  private holdRing = document.querySelector<HTMLElement>('#gesture .hold')!;
  private label = document.querySelector<HTMLElement>('#gesture .label')!;
  private flashEl = document.querySelector<HTMLElement>('#gesture-flash')!;
  private flashTimer = 0;

  render(ui: EngineUi, extra: ExtraUi, lang: Lang) {
    this.chip.hidden = ui.action === null && extra.action === null;
    if (ui.action) this.label.textContent = LABELS[ui.action][lang];
    else if (extra.action) this.label.textContent = EXTRA_LABELS[extra.action][lang];
    const progress = ui.action ? ui.progress : extra.progress;
    // The ring shows hold progress; for the dial, the moment before it goes live.
    const holding = (ui.action === 'pause' || ui.action === 'swipe' || !!extra.action) && progress > 0 && progress < 1;
    this.chip.classList.toggle('busy', holding);
    this.holdRing.style.setProperty('--p', String(holding ? progress : 0));

    this.pointer.hidden = !ui.pointer;
    if (ui.pointer) {
      this.pointer.style.transform = `translate(${ui.pointer.x * innerWidth}px, ${ui.pointer.y * innerHeight}px)`;
      this.pointer.classList.toggle('hover', ui.hoverId !== null);
      this.ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - ui.progress));
    }
  }

  /** Briefly confirm that a gesture did something, e.g. "✌️ detected → switching to Mars". */
  flash(text: string) {
    this.flashEl.textContent = text;
    this.flashEl.hidden = false;
    this.flashEl.classList.remove('show');
    void this.flashEl.offsetWidth; // restart the animation
    this.flashEl.classList.add('show');
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => (this.flashEl.hidden = true), FLASH_MS);
  }
}
