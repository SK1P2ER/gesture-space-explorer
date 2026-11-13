import type { Mode } from '../app/modes';
import type { Lang } from '../data/bodies';
import type { Intent } from '../intents';
import { dt } from './designStrings';

/** An unobstructed scene, with a persistent, keyboard-accessible way back. */
export class CleanView {
  private readonly button = document.createElement('button');
  private enabled = false;
  private lang: Lang = 'en';

  constructor(private readonly emit: (intent: Intent) => void, private readonly changed: (active: boolean) => void) {
    this.button.id = 'clean-view';
    this.button.type = 'button';
    this.button.addEventListener('click', () => {
      this.set(!this.enabled);
      this.button.blur();
    });
    document.body.append(this.button);
    addEventListener('keydown', (event) => {
      if (!this.enabled || event.key !== 'Escape' || event.defaultPrevented || event.isComposing || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.set(false);
      this.button.focus();
    }, { capture: true });
    this.render();
  }

  get active() { return this.enabled; }

  update(lang: Lang, mode: Mode) {
    const busy = mode === 'launch' || mode === 'travel' || mode === 'docking' || mode === 'build';
    if (busy && this.enabled) this.set(false);
    if (this.button.hidden !== busy) this.button.hidden = busy;
    if (lang !== this.lang) { this.lang = lang; this.render(); }
  }

  private set(active: boolean) {
    if (active === this.enabled) return;
    this.enabled = active;
    if (active) this.emit({ type: 'toggleMenu', open: false });
    document.body.classList.toggle('clean-view', active);
    this.changed(active);
    this.render();
  }

  private render() {
    this.button.textContent = `${this.enabled ? '↩' : '⛶'} ${dt(this.enabled ? 'exitCinematic' : 'cinematic', this.lang)}`;
    this.button.setAttribute('aria-pressed', String(this.enabled));
    this.button.title = this.enabled ? `${dt('exitCinematic', this.lang)} · Esc` : dt('cinematic', this.lang);
  }
}
