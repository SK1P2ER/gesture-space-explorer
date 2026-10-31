import type { Lang } from '../data/bodies';
import type { SimClock } from '../sim/clock';
import { speedLabel } from './timeFormat';

/**
 * The on-screen dial while the 🤙 time dial is live: a needle over an arc
 * (left = rewind, top = stopped, right = forward) and the speed in big type.
 */
export class TimeDialOverlay {
  private el = document.querySelector<HTMLElement>('#time-dial')!;
  private needle = this.el.querySelector<SVGLineElement>('.needle')!;
  private label = this.el.querySelector<HTMLElement>('.label')!;
  private hideTimer = 0;
  private shown = false;

  render(active: boolean, clock: SimClock, lang: Lang) {
    if (active) {
      clearTimeout(this.hideTimer);
      this.hideTimer = 0;
      this.shown = true;
      this.el.hidden = false;
      this.el.classList.add('on');
      // −1 … 1 on the slider → −90° … 90° on the dial.
      this.needle.style.transform = `rotate(${(clock.position * 90).toFixed(1)}deg)`;
      this.label.textContent = speedLabel(clock.rate, clock.paused, lang);
    } else if (this.shown && !this.hideTimer) {
      this.el.classList.remove('on'); // fades out
      this.hideTimer = window.setTimeout(() => {
        this.shown = false;
        this.hideTimer = 0;
        this.el.hidden = true;
      }, 400);
    }
  }
}
