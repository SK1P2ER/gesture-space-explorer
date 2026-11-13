import type { Mode } from '../app/modes';
import type { AppState } from '../app/state';
import type { Intent } from '../intents';
import type { CameraRig } from '../scene/cameraRig';
import { t } from './i18n';
import { IdleTracker } from './idle';
import { COMPACT_QUERY, insetsFor } from './layout';
import { dt } from './designStrings';
import './settings.css';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** Panels that cover the scene: the camera centers the focused body in what they leave free. */
const COVERING = ['#info', '#base-panel', '#build-panel', '#mission-hud', '#weight-panel', '#timebar', '#cinematic-panel', '#footer-menu', '#mission-overlay.is-landing .mission-actions'];
/** Open reading panels and overlays own the UI until dismissed, even without input. */
const IDLE_BLOCKERS = ['#info', '#base-panel', '#build-panel', '#mission-hud', '#mission-overlay', '#passport-panel', '#weight-panel', '#photo-toast'];
/** How often the panels' rects are measured (the rig eases between). */
const MEASURE_MS = 200;

/**
 * The app's chrome around the scene, on every screen size: the settings drawer,
 * keyboard help, the camera preview's show / tuck, immersive
 * mode (the UI fades when nothing happens) and keeping the focused body clear of
 * the panels. Everything it does goes out as Intents; it only renders state.
 */
export class ChromeUi {
  /** Immersive mode is for phones and tablets; on a desktop the UI stays while you read. */
  private readonly touchy = matchMedia(`${COMPACT_QUERY}, (pointer: coarse)`);
  private readonly menuButton = $<HTMLButtonElement>('#menu');
  private readonly menu = $('#footer-menu');
  private readonly menuClose = $<HTMLButtonElement>('#settings-close');
  private readonly help = $('#help');
  private readonly helpButton = $<HTMLButtonElement>('#help-toggle');
  private readonly language = $<HTMLButtonElement>('#language');
  private readonly preview = $('#preview');
  private readonly previewButton = $<HTMLButtonElement>('#preview .preview-toggle');
  private readonly idle = new IdleTracker(performance.now());
  private readonly idleBlockers = [...IDLE_BLOCKERS, '#cinematic-panel'].map((selector) => $(selector));
  private lastMeasure = -Infinity;
  private last = '';
  private menuShown = false;

  constructor(private readonly emit: (intent: Intent) => void, private readonly rig: CameraRig, private readonly state: AppState) {
    const close = (restoreFocus: boolean) => {
      const inside = this.menu.contains(document.activeElement);
      emit({ type: 'toggleMenu', open: false });
      this.syncMenu(false);
      if (restoreFocus && inside) this.menuButton.focus({ preventScroll: true });
    };
    this.menuButton.addEventListener('click', () => {
      emit({ type: 'toggleMenu' });
      this.syncMenu(this.state.menuOpen);
    });
    this.menuClose.addEventListener('click', () => close(true));
    // Settings can be adjusted repeatedly. Opening a separate reading panel
    // releases the drawer; ordinary choices retain focus within it.
    this.menu.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('button, a');
      if (!target || !this.state.menuOpen) return;
      if (target.matches('#weight, #credits-link')) close(false);
      else target.focus({ preventScroll: true });
    });
    // A tap anywhere else closes it too.
    addEventListener('pointerdown', (e) => {
      if (this.state.menuOpen && !(e.target as HTMLElement).closest('#footer-menu, #menu')) close(false);
    }, { capture: true });
    addEventListener('keydown', (e) => {
      if (!this.state.menuOpen || e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      e.preventDefault();
      close(true);
    }, { capture: true });
    this.helpButton.addEventListener('click', () => emit({ type: 'toggleHelp' }));
    this.language.addEventListener('click', () => emit({ type: 'toggleLanguage' }));
    this.previewButton.addEventListener('click', () => emit({ type: 'togglePreview' }));
    this.previewButton.addEventListener('click', () => this.previewButton.blur()); // keep Space / Enter for the scene

    // Immersive mode wakes on any input at all.
    const wake = () => this.input();
    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) addEventListener(type, wake, { capture: true, passive: true });
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') wake();
    }, { capture: true, passive: true });
  }

  /** Something happened (a key, a touch, a gesture's intent): the UI comes back. */
  input() {
    this.idle.input(performance.now());
  }

  update(now: number, mode: Mode, handPointing: boolean) {
    const s = this.state;
    if (s.menuOpen && (mode === 'launch' || mode === 'travel' || mode === 'docking' || mode === 'build')) {
      this.emit({ type: 'toggleMenu', open: false });
    }
    if (handPointing) this.idle.input(now);
    document.body.classList.toggle('immersive', this.idle.immersive(now, { pinned: !this.canIdleFade(mode) }));

    const key = JSON.stringify([s.lang, s.menuOpen, s.helpOpen, s.previewHidden]);
    if (key !== this.last) {
      this.last = key;
      this.syncMenu(s.menuOpen);
      this.menuButton.textContent = `⚙ ${dt('settings', s.lang)}`;
      this.menuButton.setAttribute('aria-label', dt('settings', s.lang));
      $('#settings-title').textContent = dt('settings', s.lang);
      $('#scene-settings-label').textContent = dt('sceneSettings', s.lang);
      $('#settings-tools-label').textContent = dt('tools', s.lang);
      this.menuClose.setAttribute('aria-label', dt('close', s.lang));
      this.help.hidden = !s.helpOpen;
      this.helpButton.setAttribute('aria-expanded', String(s.helpOpen));
      this.helpButton.setAttribute('aria-label', t('shortcuts', s.lang));
      this.helpButton.title = t('shortcuts', s.lang);
      this.helpButton.textContent = `? ${t('shortcuts', s.lang)}`;
      this.language.textContent = `🌐 ${t('language', s.lang)}`;
      this.preview.classList.toggle('tucked', s.previewHidden);
      this.previewButton.textContent = s.previewHidden ? '📷' : '×';
      this.previewButton.setAttribute('aria-pressed', String(!s.previewHidden));
      this.previewButton.setAttribute('aria-label', t(s.previewHidden ? 'showPreview' : 'hidePreview', s.lang));
    }

    if (now - this.lastMeasure >= MEASURE_MS) {
      this.lastMeasure = now;
      // Temporary camera controls may retire on pagehide before the final frame.
      const rects = COVERING.flatMap((selector) => {
        const panel = document.querySelector<HTMLElement>(selector);
        return panel ? [panel.getBoundingClientRect()] : [];
      });
      this.rig.setInsets(insetsFor(innerWidth, innerHeight, rects));
    }
  }

  private syncMenu(open: boolean) {
    const changed = open !== this.menuShown;
    this.menuShown = open;
    document.body.classList.toggle('menu-open', open);
    this.menuButton.setAttribute('aria-expanded', String(open));
    const focused = this.menu.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    this.menu.hidden = !open;
    this.menu.inert = !open;
    if (changed && open) this.menuClose.focus({ preventScroll: true });
    else if (!open && focused) focused.blur();
  }

  /** Called after panel rendering so a newly opened panel clears fading in the same frame. */
  private canIdleFade(mode: Mode): boolean {
    const panelOpen = this.idleBlockers.some((panel) => !panel.hidden) || this.state.timeBarOpen;
    const modalOpen = document.querySelector('dialog[open]') !== null;
    const menuOpen = this.state.menuOpen;
    const missionActive = mode === 'build' || mode === 'launch' || mode === 'travel' || mode === 'docking';
    return this.touchy.matches && !panelOpen && !modalOpen && !menuOpen
      && !missionActive && !document.body.classList.contains('photo-mode');
  }
}
