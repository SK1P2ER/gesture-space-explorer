import type { Mode } from '../app/modes';
import type { AppState } from '../app/state';
import type { Intent } from '../intents';
import type { CameraRig } from '../scene/cameraRig';
import { t } from './i18n';
import { IdleTracker } from './idle';
import { COMPACT_QUERY, insetsFor } from './layout';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** Panels that cover the scene: the camera centers the focused body in what they leave free. */
const COVERING = ['#info', '#base-panel', '#build-panel', '#mission-hud', '#weight-panel', '#timebar', '#cinematic-panel', '#shell-panel'];
/** Open reading panels and overlays own the UI until dismissed, even without input. */
const IDLE_BLOCKERS = ['#info', '#base-panel', '#build-panel', '#mission-hud', '#mission-overlay', '#passport-panel', '#weight-panel', '#photo-toast'];
/** How often the panels' rects are measured (the rig eases between). */
const MEASURE_MS = 200;

/**
 * The app's chrome around the scene, on every screen size: the ☰ menu (phones),
 * the ? shortcuts line (desktop), the camera preview's show / tuck, immersive
 * mode (the UI fades when nothing happens) and keeping the focused body clear of
 * the panels. Everything it does goes out as Intents; it only renders state.
 */
export class ChromeUi {
  private readonly compact = matchMedia(COMPACT_QUERY);
  /** Immersive mode is for phones and tablets; on a desktop the UI stays while you read. */
  private readonly touchy = matchMedia(`${COMPACT_QUERY}, (pointer: coarse)`);
  private readonly menuButton = $<HTMLButtonElement>('#menu');
  private readonly menu = $('#footer-menu');
  private readonly help = $('#help');
  private readonly helpButton = $<HTMLButtonElement>('#help-toggle');
  private readonly language = $<HTMLButtonElement>('#language');
  private readonly preview = $('#preview');
  private readonly previewButton = $<HTMLButtonElement>('#preview .preview-toggle');
  private readonly idle = new IdleTracker(performance.now());
  // The camera-view panel exists only with ?flags=cinematic (main.ts loads it with its flag).
  private readonly idleBlockers = [...IDLE_BLOCKERS, '#cinematic-panel'].map((selector) => document.querySelector<HTMLElement>(selector)).filter((panel) => panel !== null);
  private lastMeasure = -Infinity;
  private last = '';

  constructor(emit: (intent: Intent) => void, private readonly rig: CameraRig, private readonly state: AppState) {
    this.menuButton.addEventListener('click', () => emit({ type: 'toggleMenu' }));
    // A choice in the menu closes it on phones (the setting's new value shows on the button next time).
    this.menu.addEventListener('click', (e) => {
      if (this.compact.matches && (e.target as HTMLElement).closest('button, a')) emit({ type: 'toggleMenu', open: false });
    });
    // A tap anywhere else closes it too.
    addEventListener('pointerdown', (e) => {
      if (this.state.menuOpen && !(e.target as HTMLElement).closest('#footer-menu, #menu')) emit({ type: 'toggleMenu', open: false });
    }, { capture: true });
    this.helpButton.addEventListener('click', () => emit({ type: 'toggleHelp' }));
    this.language.addEventListener('click', () => emit({ type: 'toggleLanguage' }));
    this.previewButton.addEventListener('click', () => emit({ type: 'togglePreview' }));
    for (const el of [this.menuButton, this.helpButton, this.language, this.previewButton]) el.addEventListener('click', () => el.blur()); // keep Space / Enter for the scene

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
    if (handPointing) this.idle.input(now);
    document.body.classList.toggle('immersive', this.idle.immersive(now, { pinned: !this.canIdleFade(mode) }));

    const key = JSON.stringify([s.lang, s.menuOpen, s.helpOpen, s.previewHidden]);
    if (key !== this.last) {
      this.last = key;
      document.body.classList.toggle('menu-open', s.menuOpen);
      this.menuButton.setAttribute('aria-expanded', String(s.menuOpen));
      this.menuButton.setAttribute('aria-label', t('menu', s.lang));
      this.help.hidden = !s.helpOpen;
      this.helpButton.setAttribute('aria-expanded', String(s.helpOpen));
      this.helpButton.setAttribute('aria-label', t('shortcuts', s.lang));
      this.helpButton.title = t('shortcuts', s.lang);
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
