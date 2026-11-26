import type { P24CameraName } from '../scene/p24BlenderLook';
import type { Lang } from '../data/bodies';
import type { SpaceportPreview, SpaceportCamera } from '../scene/spaceportPreview';
import type { LandmarkId } from '../scene/spaceportCollision';
import { isShownPlace, shownPlaces } from '../scene/spaceportPlaces';
import { SpaceportGestures, type GestureInput, type GestureTarget } from '../app/spaceportGestures';
import { t, type StringKey } from './i18n';
import { placeSummary } from './placeSummary';
import './spaceportView.css';

/** Strings live in the shared table (src/ui/i18n.ts) under `sp.*`. */
const s = (key: string, lang: Lang) => t(`sp.${key}` as StringKey, lang);

const DURATION = 479 / 24;
/** Launch phases and the second each starts at; the same boundaries the phase label always used. */
export const PHASES = [
  { id: 'ready', at: 0 }, { id: 'arms', at: 3 }, { id: 'ignition', at: 6 }, { id: 'ascent', at: 9 },
] as const;
/**
 * A mission departure is brief: it starts a second before Ignition with the pad and rocket framed together, follows
 * the rocket once it really rises (≈9 s), and hands over to the flight this long after liftoff.
 */
export const DEPARTURE_FROM = 5;
export const DEPARTURE_FOLLOW_SECONDS = 5;
/** Reduced motion: one still of the pad (no camera moves), held this long, then a cut to the flight. */
export const DEPARTURE_STILL_MS = 1200;
export type PhaseId = typeof PHASES[number]['id'];
export const phaseAt = (time: number): PhaseId => [...PHASES].reverse().find(phase => time >= phase.at)!.id;

/** Camera views in the segmented control: 全景 = overview, 発射台 = the pad landmark camera, 追尾 = follow the launch. */
const VIEWS = [
  { camera: 'overview', label: 'view.overview' }, { camera: 'terminal', label: 'view.terminal' },
  { camera: 'deck', label: 'view.deck' }, { camera: 'pad', label: 'view.pad' }, { camera: 'launch', label: 'view.follow' },
] as const satisfies readonly { camera: SpaceportCamera; label: string }[];

const svg = (path: string, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICON = {
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5v.5"/>'),
  play: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  replay: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>', 22),
};

/** Hidden bold and regular copies of a label, to keep its box at the wider of both weights (filled by `prepare`). */
function reserves(label: string) {
  return ['spaceport-reserve', 'spaceport-reserve spaceport-reserve-regular'].map(className => {
    const copy = document.createElement('span'); copy.dataset.label = label; copy.className = className; copy.setAttribute('aria-hidden', 'true');
    return copy;
  });
}

function button(ui: string, className = ''): HTMLButtonElement {
  const element = document.createElement('button'); element.type = 'button'; element.dataset.ui = ui;
  if (className) element.className = className;
  return element;
}

/**
 * Launch preview, Direction A "cinematic dock" (owner, 2026-11-20): the 3D stage fills the dialog; a floating top
 * bar holds the title, help, reset and close; one dock at the bottom holds the timeline with phase markers, the
 * primary play button, the segmented camera views and the place chips; a place opens a card over the scene.
 * Three.js loaders and the authored model load only after opening.
 */
export class SpaceportView {
  private readonly dialog = document.createElement('dialog');
  private readonly stage = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly controls = document.createElement('div');
  private readonly play = button('spaceport-play', 'spaceport-play');
  private readonly playIcon = document.createElement('span');
  private readonly playLabel = document.createElement('span');
  private readonly timeline = document.createElement('input');
  private readonly phase = document.createElement('span');
  private readonly phaseTime = document.createElement('span');
  private readonly phaseLive = document.createElement('span');
  /** "Sequence complete": shown briefly, and announced once, when playback reaches the end (not when scrubbed there). */
  private readonly completeStatus = document.createElement('p');
  /** The completion announcer (hidden): the visible message moves into the dock in short landscape. */
  private readonly completeLive = document.createElement('span');
  private completeUntil = 0;
  /** The preview's run-to-the-end count already shown (only playback reaching the end counts, never a seek). */
  private seenCompletions = 0;
  /** Scrubbing: a pointer drag on the timeline, or keyboard/assistive steps until a short pause after the last one. */
  private scrubPointer = false;
  private scrubKeyUntil = 0;
  private lastScrub = false;
  private lastHint = '';
  private readonly markers = new Map<PhaseId, HTMLButtonElement>();
  private readonly retry = button('spaceport-retry');
  private readonly skip = button('spaceport-skip');
  private readonly about = document.createElement('section');
  private readonly aboutToggle = button('spaceport-help', 'spaceport-icon');
  private readonly lightingToggle = button('spaceport-lighting', 'spaceport-lighting');
  private lightingMode: 'day' | 'sunset' | 'night' = 'day';
  private readonly reset = button('spaceport-reset', 'spaceport-icon');
  private readonly close_ = button('spaceport-close', 'spaceport-close');
  private readonly inspection = document.createElement('section');
  private readonly report = document.createElement('output');
  private lastReport = 0;
  private readonly views = new Map<SpaceportCamera, HTMLButtonElement>();
  private readonly landmarks = document.createElement('div');
  private readonly boarding = button('spaceport-boarding', 'spaceport-chip');
  private viewer: SpaceportPreview | null = null;
  private abort: AbortController | null = null;
  private lang: Lang = 'en';
  private low = true;
  private reduced = false;
  private lastPhase = '';
  private lastPlaying: boolean | null = null;
  private lastView = '';
  private launch: { complete: () => void; cancel: () => void } | null = null;
  private launchTimeout: ReturnType<typeof setTimeout> | null = null;
  // Hand mode (item 2): 👆 dwell arms a target (ring on the target), 👍 acts once, ✊ cancels, ✋ 1 s goes home.
  private readonly hand = new SpaceportGestures();
  private readonly handLayer = document.createElement('div');
  private readonly zonePrev = button('spaceport-gesture-prev', 'spaceport-zone spaceport-zone-prev');
  private readonly zoneNext = button('spaceport-gesture-next', 'spaceport-zone spaceport-zone-next');
  private readonly ring = document.createElement('div');
  private readonly dot = document.createElement('div');
  private readonly coach = document.createElement('p');
  private readonly coachLive = document.createElement('span');
  private readonly bubble = document.createElement('p');
  private readonly notice = document.createElement('p');
  private readonly homeRing = document.createElement('div');
  private readonly targets = new Map<string, HTMLElement>();
  private heading: HTMLElement | null = null;
  private topColumn: HTMLElement | null = null;
  // Details panel (Item 3): the full place description with room to read, opened from the compact card in short
  // landscape. While it is open the rest of the preview is inert and only its close button is a gesture target.
  private readonly details = document.createElement('section');
  private readonly detailsTitle = document.createElement('h3');
  private readonly detailsText = document.createElement('p');
  private readonly detailsClose = button('spaceport-details-close', 'spaceport-details-close');
  private detailsOpener: HTMLElement | null = null;
  private onClosed: (() => void) | null = null;
  private marked: HTMLElement | null = null;
  private handSeenAt = -Infinity;
  /** The hand layer stays up this long after the last detection with a hand (tests may lengthen it for slow captures). */
  handVisibleMs = 1500;
  private noticeUntil = 0;
  private pulseUntil = 0;
  private pulsed: HTMLElement | null = null;

  constructor() {
    this.dialog.id = 'spaceport-view';
    this.dialog.dataset.ui = 'spaceport-dialog';
    this.dialog.setAttribute('aria-labelledby', 'spaceport-title');
    this.dialog.dataset.sceneShortcuts = 'off';

    this.stage.className = 'spaceport-stage';
    this.stage.setAttribute('aria-label', '3D spaceport');
    this.status.className = 'spaceport-status';
    this.status.setAttribute('role', 'status');
    this.retry.dataset.label = 'retry'; this.retry.hidden = true; this.retry.className = 'spaceport-retry';
    // Retry hides itself, so focus waits on the status message (announced) and then goes to Play, or back to Retry.
    this.retry.addEventListener('click', () => {
      this.status.tabIndex = -1; this.status.focus();
      void this.load().then(() => {
        // Hiding the status on success moves focus from it to <body>: either means focus is still waiting on Retry.
        const waiting = document.activeElement === this.status || document.activeElement === document.body;
        if (this.active && waiting) (this.retry.hidden ? this.play : this.retry).focus();
      });
    });

    // Top bar: title · (skip) · help · reset · close
    const header = document.createElement('div'); header.className = 'spaceport-heading';
    const title = document.createElement('h2'); title.id = 'spaceport-title'; title.dataset.ui = 'spaceport-title';
    this.skip.id = 'spaceport-skip-launch'; this.skip.hidden = true;
    this.skip.addEventListener('click', () => this.finishLaunch(true));
    this.aboutToggle.innerHTML = ICON.help; this.aboutToggle.setAttribute('aria-expanded', 'false'); this.aboutToggle.setAttribute('aria-controls', 'spaceport-about');
    this.aboutToggle.addEventListener('click', () => this.setAbout(this.about.hidden !== false));
    this.lightingToggle.dataset.mode = 'day';
    this.lightingToggle.addEventListener('click', () => {
      const next = this.lightingMode === 'day' ? 'sunset' : this.lightingMode === 'sunset' ? 'night' : 'day';
      this.setLightingMode(next);
    });
    this.reset.id = 'spaceport-reset'; this.reset.innerHTML = ICON.reset;
    this.reset.addEventListener('click', () => { this.viewer?.resetView(this.reduced); this.timeline.max = String(DURATION); this.clearInspection(); });
    const closeLabel = document.createElement('span'); closeLabel.dataset.label = 'close'; closeLabel.className = 'spaceport-close-label';
    this.close_.innerHTML = ICON.close; this.close_.append(closeLabel);
    this.close_.addEventListener('click', () => this.close());
    header.append(title, this.skip, this.lightingToggle, this.aboutToggle, this.reset, this.close_);

    // Help panel: the drag/zoom hint, the parked-vehicle note, performance and credits (moved out of the dock)
    this.about.id = 'spaceport-about'; this.about.dataset.ui = 'spaceport-about'; this.about.className = 'spaceport-about'; this.about.hidden = true;
    const hint = document.createElement('p'); hint.className = 'spaceport-hint'; hint.dataset.label = 'hint';
    const parked = document.createElement('p'); parked.className = 'spaceport-parked spaceport-hint'; parked.dataset.label = 'parked';
    const performance = document.createElement('details'); performance.className = 'spaceport-performance';
    const summary = document.createElement('summary'); summary.dataset.label = 'performance';
    const save = button('spaceport-save-report'); save.dataset.label = 'saveReport';
    save.addEventListener('click', () => {
      if (!this.viewer) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(this.viewer.performanceReport(), null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'spaceport-performance.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    performance.append(summary, this.report, save);
    const credits = document.createElement('p'); credits.className = 'spaceport-credits';
    // Attribute the creator without asserting a license for the unresolved inherited M01 content.
    const link = document.createElement('a'); link.dataset.label = 'credits'; link.href = `${import.meta.env.BASE_URL}spaceport/NOTICE.txt`; link.target = '_blank'; link.rel = 'noopener';
    credits.append('Space Line spaceport by SK1P2ER · ', link);
    this.about.append(hint, parked, performance, credits);

    // Place card over the scene
    this.inspection.id = 'spaceport-inspection'; this.inspection.dataset.ui = 'spaceport-place-card'; this.inspection.hidden = true;
    this.inspection.setAttribute('aria-live', 'polite');

    // Dock row 1: timeline with phase markers
    this.controls.className = 'spaceport-controls spaceport-dock'; this.controls.dataset.ui = 'spaceport-dock';
    const transport = document.createElement('div'); transport.className = 'spaceport-transport';
    const track = document.createElement('div'); track.className = 'spaceport-track';
    this.timeline.type = 'range'; this.timeline.min = '0'; this.timeline.max = String(DURATION); this.timeline.step = '0.01'; this.timeline.value = '0';
    this.timeline.id = 'spaceport-timeline'; this.timeline.dataset.ui = 'spaceport-timeline';
    this.timeline.addEventListener('input', () => {
      if (!this.viewer) return;
      this.viewer.playing = false;
      this.viewer.seek(Number(this.timeline.value));
      if (!this.scrubPointer) this.scrubKeyUntil = globalThis.performance.now() + 800; // keyboard / assistive tech step
    });
    this.timeline.addEventListener('pointerdown', () => {
      this.scrubPointer = true;
      const end = () => { this.scrubPointer = false; removeEventListener('pointerup', end); removeEventListener('pointercancel', end); };
      addEventListener('pointerup', end); addEventListener('pointercancel', end);
    });
    this.timeline.addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) this.scrubKeyUntil = globalThis.performance.now() + 800;
    });
    this.timeline.addEventListener('blur', () => { this.scrubKeyUntil = 0; });
    const markers = document.createElement('div'); markers.className = 'spaceport-markers';
    for (const phase of PHASES) {
      const marker = button('spaceport-phase-marker', 'spaceport-marker'); marker.dataset.phase = phase.id;
      marker.style.setProperty('--at', String(phase.at / DURATION));
      // The label and hidden bold and regular copies share one grid cell, so the active (bold) state never changes the
      // size (in Burmese the regular weight can be the wider one).
      const label = document.createElement('span'); label.dataset.label = `phase.${phase.id}`; label.className = 'spaceport-marker-label';
      marker.append(label, ...reserves(`phase.${phase.id}`));
      // The final marker also holds the completion message in its own (reserved) cell: short landscape shows it there,
      // in the dock, instead of over the rocket.
      if (phase.id === 'ascent') { const done = document.createElement('span'); done.className = 'spaceport-marker-done'; done.dataset.label = 'complete'; done.setAttribute('aria-hidden', 'true'); marker.append(done); }
      marker.addEventListener('click', () => { if (!this.viewer) return; this.viewer.playing = false; this.scrubKeyUntil = 0; this.viewer.seek(phase.at); this.timeline.value = String(phase.at); });
      markers.append(marker); this.markers.set(phase.id, marker);
    }
    track.append(this.timeline, markers);
    // Phase readout: every phase name stacked in one grid cell (only the current one shows), so its size is the
    // longest name's in this language and never changes; the scrub time has a fixed slot too.
    this.phase.className = 'spaceport-phase'; this.phase.dataset.ui = 'spaceport-phase';
    const names = document.createElement('span'); names.className = 'spaceport-phase-names'; names.setAttribute('aria-hidden', 'true');
    for (const phase of PHASES) {
      const name = document.createElement('span'); name.dataset.label = `phase.${phase.id}`; name.dataset.for = phase.id;
      names.append(name);
    }
    this.phaseTime.className = 'spaceport-phase-time'; this.phaseTime.setAttribute('aria-hidden', 'true');
    // The phase announcer sits outside the readout, which phones and short landscape hide: there it still speaks.
    this.phaseLive.className = 'spaceport-sr'; this.phaseLive.id = 'spaceport-phase-live'; this.phaseLive.setAttribute('role', 'status');
    this.phase.append(names, this.phaseTime);
    this.completeStatus.className = 'spaceport-complete'; this.completeStatus.dataset.ui = 'spaceport-complete';
    this.completeStatus.setAttribute('aria-hidden', 'true'); this.completeStatus.dataset.shown = 'false';
    this.completeLive.className = 'spaceport-sr'; this.completeLive.id = 'spaceport-complete-live'; this.completeLive.setAttribute('role', 'status');
    transport.append(track, this.phase);

    // Dock row 2: play · segmented views · place chips
    this.play.id = 'spaceport-play';
    this.playIcon.className = 'spaceport-play-icon'; this.playLabel.className = 'spaceport-play-label';
    // Every play label shares one grid cell (only the current one shows), so ▶ keeps one width for play, pause,
    // resume and replay and the views and chips beside it never move.
    for (const state of ['play', 'pause', 'resume', 'replay']) {
      const label = document.createElement('span'); label.dataset.label = state; label.dataset.for = state;
      this.playLabel.append(label);
    }
    this.play.append(this.playIcon, this.playLabel);
    this.play.addEventListener('click', () => {
      if (!this.viewer) return;
      if (this.viewer.playing) this.viewer.playing = false;
      else { this.clearInspection(); this.viewer.play({ reduced: this.reduced, preserveView: this.viewer.activePreset === 'terminal' || this.viewer.activePreset === 'boarding' }); }
    });
    const cameras = document.createElement('div'); cameras.className = 'spaceport-cameras'; cameras.setAttribute('role', 'group');
    for (const view of VIEWS) {
      // The label and hidden bold and regular copies share one grid cell: selecting a view (bold) never changes the row's
      // widths, whichever weight is wider in this language.
      const element = button('spaceport-view', 'spaceport-view'); element.dataset.view = view.camera;
      const label = document.createElement('span'); label.dataset.label = view.label;
      element.append(label, ...reserves(view.label));
      element.addEventListener('click', () => { this.clearInspection(); this.viewer?.setView(view.camera, { reduced: this.reduced }); this.timeline.max = String(DURATION); });
      cameras.append(element); this.views.set(view.camera, element);
    }
    this.landmarks.className = 'spaceport-landmarks'; this.landmarks.setAttribute('role', 'group');
    this.boarding.dataset.label = 'view.boarding';
    this.boarding.hidden = true;
    this.boarding.setAttribute('aria-pressed', 'false');
    this.boarding.addEventListener('click', () => {
      const viewer = this.viewer;
      if (!viewer) return;
      this.clearInspection();
      viewer.setView(viewer.activePreset === 'boarding' ? 'terminal' : 'boarding', { reduced: this.reduced });
    });
    for (const id of shownPlaces()) {
      const element = button('spaceport-place', 'spaceport-chip'); element.dataset.label = id; element.dataset.landmark = id;
      element.addEventListener('click', () => (element.getAttribute('aria-pressed') === 'true' ? this.clearInspection() : this.inspect(id)));
      this.landmarks.append(element);
    }
    const row = document.createElement('div'); row.className = 'spaceport-dock-row';
    row.append(this.play, cameras, this.landmarks);
    this.controls.append(transport, row);

    // Top bar, help panel and place card stack in one column, so a two-line title can never cover the card.
    const top = document.createElement('div'); top.className = 'spaceport-top';
    top.append(header, this.about, this.inspection);

    // Hand layer: tall Previous/Next side zones (they step through the places), the ring drawn on the target being
    // dwelled on, a small cursor dot, the coach line, the 👍 prompt, ✊/✋ notices and the ✋ home ring.
    this.handLayer.className = 'spaceport-hand';
    for (const [zone, dir] of [[this.zonePrev, -1], [this.zoneNext, 1]] as const) {
      zone.innerHTML = dir < 0 ? svg('<path d="M15 5l-7 7 7 7"/>', 40) : svg('<path d="M9 5l7 7-7 7"/>', 40);
      const label = document.createElement('span'); label.className = 'spaceport-zone-label';
      label.dataset.label = dir < 0 ? 'gesture.prev' : 'gesture.next';
      const place = document.createElement('span'); place.className = 'spaceport-zone-place';
      zone.append(label, place);
      zone.addEventListener('click', () => this.stepPlace(dir));
    }
    this.ring.className = 'spaceport-ring'; this.ring.setAttribute('aria-hidden', 'true');
    this.ring.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="2" y="2" width="96" height="96" rx="14" pathLength="100"/><rect class="spaceport-ring-hold" x="7" y="7" width="86" height="86" rx="10" pathLength="100"/></svg>';
    this.dot.className = 'spaceport-cursor'; this.dot.setAttribute('aria-hidden', 'true');
    this.coach.className = 'spaceport-coach'; this.coach.dataset.ui = 'spaceport-coach';
    this.coachLive.className = 'spaceport-sr'; this.coachLive.setAttribute('role', 'status');
    this.bubble.className = 'spaceport-thumb'; this.bubble.textContent = '👍'; this.bubble.setAttribute('aria-hidden', 'true');
    this.notice.className = 'spaceport-notice'; this.notice.setAttribute('role', 'status');
    this.homeRing.className = 'spaceport-home'; this.homeRing.setAttribute('aria-hidden', 'true');
    this.handLayer.append(this.zonePrev, this.zoneNext, this.ring, this.bubble, this.dot, this.notice, this.homeRing);
    top.insertBefore(this.coach, this.about); // in the top column: under the bar, never over the title or the card
    this.dialog.dataset.hand = 'off';

    this.details.id = 'spaceport-details'; this.details.className = 'spaceport-details'; this.details.dataset.ui = 'spaceport-details-panel';
    this.details.setAttribute('role', 'dialog'); this.details.setAttribute('aria-modal', 'true'); this.details.setAttribute('aria-labelledby', 'spaceport-details-title');
    this.details.hidden = true;
    this.detailsTitle.id = 'spaceport-details-title';
    const closeText = document.createElement('span'); closeText.dataset.label = 'closeCard';
    this.detailsClose.innerHTML = ICON.close; this.detailsClose.append(closeText);
    this.detailsClose.addEventListener('click', () => this.closeDetails());
    const detailsHead = document.createElement('div'); detailsHead.className = 'spaceport-details-head';
    detailsHead.append(this.detailsTitle, this.detailsClose);
    this.details.append(detailsHead, this.detailsText);
    // Escape closes the panel only (not the preview), and focus goes back to Details.
    this.details.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeDetails(); }
    });
    this.topColumn = top;
    this.dialog.append(this.stage, this.status, this.retry, top, this.controls, this.completeStatus, this.details, this.handLayer, this.phaseLive, this.completeLive);
    // The free band between the top bar and the dock: the top column stops above the dock (a long card scrolls
    // instead of sliding under it) and the side zones sit inside the band, never under the dock (short landscape).
    this.heading = header;
    new ResizeObserver(() => this.layoutBands()).observe(this.controls);
    new ResizeObserver(() => this.layoutBands()).observe(title); // the bar itself may be display: contents (landscape)
    addEventListener('resize', () => this.layoutBands());
    this.dialog.addEventListener('close', () => {
      if (this.dialog.open) return; // Ignore a queued close event from a preceding presentation.
      if (this.launch) this.finishLaunch(false);
      else { this.release(); this.endSession(); } // Escape (or the dialog closing by itself) ends the preview too
    });
    this.dialog.addEventListener('cancel', event => {
      if (!this.details.hidden) { event.preventDefault(); this.closeDetails(); return; } // Back / Escape: the panel first
      if (this.launch) { event.preventDefault(); this.finishLaunch(false); }
      else this.release();
    });
    document.body.append(this.dialog);
  }

  get active() { return this.dialog.open; }
  get preview() { return this.viewer; }
  get missionLaunch() { return this.launch !== null; }
  /** How the current mission departure was started: a played shot, or reduced motion's still (null: none). */
  get departureMotion() { return this.launch ? this.launchMotion : null; }
  private launchMotion: 'full' | 'reduced' = 'full';
  private departureHold: ReturnType<typeof setTimeout> | null = null;
  /** The open launch preview owns hand input (a mission launch only plays: it takes none). */
  get ownsHand() { return this.active && this.launch === null && this.viewer !== null; }

  /** One hand detection while the preview owns input; the outcome goes through the same actions as the buttons. */
  observeHand(input: GestureInput) {
    if (!this.ownsHand) { this.hand.reset(); return; }
    this.dialog.dataset.tracking = 'on'; // the camera is running: the hint area keeps its place from now on
    // Show the hand layer before measuring: after a pause its side zones are hidden, and a target measured hidden
    // would drop the focus the hand is still holding.
    if (input.hand) { this.handSeenAt = performance.now(); this.dialog.dataset.hand = 'on'; this.layoutBands(); }
    const outcome = this.hand.observe(input, this.gestureTargets(), { width: innerWidth, height: innerHeight });
    if (outcome.act) {
      const element = this.targets.get(outcome.act);
      if (element) { element.click(); this.pulsed = element; this.pulseUntil = performance.now() + 450; }
    }
    if (outcome.home) {
      this.viewer?.resetView(this.reduced); this.timeline.max = String(DURATION); this.clearInspection();
      this.showNotice(`✋ ${s('gesture.home', this.lang)}`);
    }
    if (outcome.cancelled) this.showNotice(`✊ ${s('gesture.cancel', this.lang)}`);
  }

  /** The camera stopped: nothing stays armed or charged (a 👍 that may still be up owes a seen release). */
  trackingStopped() { this.hand.reset(); this.handSeenAt = -Infinity; this.dialog.dataset.tracking = 'off'; this.renderHand(performance.now()); }

  private showNotice(text: string) { this.notice.textContent = text; this.noticeUntil = performance.now() + 1200; }

  /** Previous/Next side zones: step through the shown places (and open each one's card). */
  private stepPlace(dir: 1 | -1) {
    const places = shownPlaces();
    if (!places.length) return;
    const current = this.controls.querySelector<HTMLElement>('[data-landmark][aria-pressed="true"]')?.dataset.landmark as LandmarkId | undefined;
    const index = current ? places.indexOf(current) : -1;
    const next = index < 0 ? (dir > 0 ? 0 : places.length - 1) : (index + dir + places.length) % places.length;
    this.inspect(places[next]);
  }

  /** Gesture targets: enabled controls that are fully visible now (a chip scrolled partly out is not a target). */
  private gestureTargets(): GestureTarget[] {
    this.targets.clear();
    const list: GestureTarget[] = [];
    const kinds = ['spaceport-view', 'spaceport-place', 'spaceport-play', 'spaceport-phase-marker', 'spaceport-reset', 'spaceport-close', 'spaceport-place-card-close', 'spaceport-place-details', 'spaceport-details-close', 'spaceport-gesture-prev', 'spaceport-gesture-next'];
    for (const element of this.dialog.querySelectorAll<HTMLButtonElement>(kinds.map(kind => `[data-ui="${kind}"]`).join(','))) {
      if (element.disabled || element.closest('[hidden]') || element.closest('[inert]')) continue; // inert: under the details panel
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height || box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight) continue;
      const scroller = element.closest('.spaceport-landmarks')?.getBoundingClientRect();
      if (scroller && (box.left < scroller.left - 0.5 || box.right > scroller.right + 0.5)) continue;
      const id = [element.dataset.ui, element.dataset.view ?? element.dataset.landmark ?? element.dataset.phase ?? ''].join(':');
      this.targets.set(id, element);
      list.push({ id, rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } });
    }
    return list;
  }

  /** Draws the hand state: ring on the dwelled/armed target, cursor dot, 👍 prompt, notices, ✋ home ring. */
  private renderHand(now: number) {
    const on = this.ownsHand && now - this.handSeenAt < this.handVisibleMs;
    this.dialog.dataset.hand = on ? 'on' : 'off';
    const id = on ? this.hand.armed ?? this.hand.focus : null;
    const element = id ? this.targets.get(id) ?? null : null;
    if (this.marked && this.marked !== element) delete this.marked.dataset.gesture;
    this.marked = element;
    const pulsing = now < this.pulseUntil && this.pulsed;
    if (this.pulsed && !pulsing) { delete this.pulsed.dataset.gesturePulse; this.pulsed = null; }
    else if (pulsing && this.pulsed && this.pulsed.dataset.gesturePulse !== 'on') this.pulsed.dataset.gesturePulse = 'on'; // once: one pulse
    if (element) {
      const armed = this.hand.armed === id;
      element.dataset.gesture = armed ? (this.hand.confirmProgress > 0 ? 'confirm' : 'armed') : 'focus';
      const box = element.getBoundingClientRect();
      Object.assign(this.ring.style, { left: `${box.left - 6}px`, top: `${box.top - 6}px`, width: `${box.width + 12}px`, height: `${box.height + 12}px` });
      // The ring shows the dwell only: complete and steady while the target is armed, also once the 👆 has turned into a
      // 👍 (the pointer, and with it the focus, is gone by then). The 👍 hold is drawn separately.
      this.ring.style.setProperty('--progress', (armed ? 1 : this.hand.dwellProgress).toFixed(3));
      this.ring.dataset.state = armed ? 'armed' : 'dwell';
      // The 👍 hold: the 👍 prompt fills (desktop, portrait); in short landscape the inner ring on the target fills instead.
      const hold = (armed ? this.hand.confirmProgress : 0).toFixed(3);
      this.bubble.style.setProperty('--hold', hold); this.ring.style.setProperty('--hold', hold);
      this.ring.hidden = false;
      this.bubble.hidden = !armed || this.hand.waitingRelease;
      Object.assign(this.bubble.style, { left: `${box.left + box.width / 2}px`, top: `${box.top - 10}px` });
    } else { this.ring.hidden = true; this.bubble.hidden = true; }
    const cursor = on ? this.hand.cursor : null;
    this.dot.hidden = !cursor;
    if (cursor) this.dot.style.transform = `translate(${cursor.x}px, ${cursor.y}px)`;
    this.notice.hidden = !on || now > this.noticeUntil;
    // The hint: what to do next (cleared with the hand: tracking lost, camera stopped or the preview closed).
    const hint = on ? this.hand.hint : '';
    if (hint !== this.lastHint) {
      this.lastHint = hint; this.coach.dataset.hint = hint;
      this.coachLive.textContent = hint ? s(hint === 'point' ? 'gesture.coach' : `gesture.${hint}`, this.lang) : '';
    }
    const home = on ? this.hand.homeProgress : 0;
    this.homeRing.hidden = home <= 0;
    this.homeRing.style.setProperty('--progress', home.toFixed(3));
  }

  render(lang: Lang, low: boolean, reducedMotion: boolean) {
    this.lang = lang; this.low = low; this.reduced = reducedMotion;
    this.dialog.dataset.motion = reducedMotion ? 'reduce' : 'full';
  }

  private setAbout(open: boolean) {
    this.about.hidden = !open; this.aboutToggle.setAttribute('aria-expanded', String(open));
  }

  private prepare(destination?: string) {
    this.timeline.max = String(DURATION); this.clearInspection(); this.setAbout(false);
    this.dialog.dataset.purpose = destination ? 'mission' : 'preview';
    this.dialog.lang = this.lang;
    this.dialog.querySelector('h2')!.textContent = destination ? `${s('departure', this.lang)} · ${destination}` : s('title', this.lang);
    for (const element of this.dialog.querySelectorAll<HTMLElement>('[data-label]')) element.textContent = s(element.dataset.label!, this.lang);
    this.boarding.textContent = s('view.boarding', this.lang);
    this.landmarks.scrollLeft = 0;
    const closeText = s(destination ? 'cancel' : 'close', this.lang);
    this.dialog.querySelector<HTMLElement>('[data-label="close"]')!.textContent = closeText;
    this.close_.setAttribute('aria-label', closeText);
    this.dialog.querySelector<HTMLElement>('[data-label="hint"]')!.textContent = s(destination ? 'missionHint' : 'hint', this.lang);
    this.reset.setAttribute('aria-label', s('reset', this.lang)); this.reset.title = s('reset', this.lang);
    this.aboutToggle.setAttribute('aria-label', s('help', this.lang)); this.aboutToggle.title = s('help', this.lang);
    for (const [phase, marker] of this.markers) marker.setAttribute('aria-label', `${s(`phase.${phase}`, this.lang)} · ${PHASES.find(p => p.id === phase)!.at}s`);
    this.skip.textContent = s('skip', this.lang); this.skip.hidden = !destination;
    this.timeline.setAttribute('aria-label', s('timeline', this.lang));
    this.setPlay('play');
    // One hint area bound to the gesture state: every variant stacked in one grid cell (only the current one shows),
    // so the area keeps the size of the longest variant and nothing around it moves when the hint changes.
    const hints = document.createElement('span'); hints.className = 'spaceport-hints'; hints.setAttribute('aria-hidden', 'true');
    for (const [hint, key] of [['point', 'gesture.coach'], ['hold', 'gesture.hold'], ['release', 'gesture.release']] as const) {
      const line = document.createElement('span'); line.dataset.hint = hint; line.textContent = s(key, this.lang);
      hints.append(line);
    }
    const coachHome = document.createElement('span'); coachHome.className = 'spaceport-coach-home'; coachHome.textContent = s('gesture.homeHint', this.lang);
    this.coach.replaceChildren(hints, coachHome, this.coachLive);
    this.coach.dataset.hint = ''; this.lastHint = ''; this.coachLive.textContent = '';
    this.dialog.dataset.tracking = 'off';
    this.homeRing.textContent = '✋';
    this.zonePrev.setAttribute('aria-label', s('gesture.prev', this.lang)); this.zoneNext.setAttribute('aria-label', s('gesture.next', this.lang));
    this.hand.reset();
    this.dialog.showModal();
    this.layoutBands();
  }

  private blenderShot: P24CameraName | undefined;

  /** Opens the launch preview; `onClosed` runs once however it closes. */
  async open(onClosed?: () => void, blenderShot?: P24CameraName) {
    if (this.active) return;
    this.onClosed = onClosed ?? null;
    this.blenderShot = blenderShot;
    this.prepare();
    await this.load();
  }

  /** Hold the real mission's launch boundary until the authored animation ends or is skipped. */
  startLaunch(destination: string, complete: () => void, cancel: () => void): () => void {
    this.onClosed = null; // a mission takes over: the preview's hand-back (ground camera, focus) doesn't apply
    this.close();
    const launch = this.launch = { complete, cancel };
    this.launchMotion = this.reduced ? 'reduced' : 'full';
    this.blenderShot = undefined;
    this.prepare(destination);
    // A slow/blocked asset must not strand the selected mission. Skip is usable while loading.
    void this.load();
    return () => {
      if (this.launch !== launch) return;
      this.launch = null;
      this.dismiss();
    };
  }

  private inspect(id: LandmarkId) {
    if (!isShownPlace(id)) return; // hidden places (e.g. no landing pad yet) ignore taps on their area too
    this.viewer?.inspect(id, this.reduced);
    this.timeline.max = String(DURATION);
    const close = button('spaceport-place-card-close', 'spaceport-card-close'); close.innerHTML = ICON.close;
    close.setAttribute('aria-label', s('closeCard', this.lang));
    // The card's x removes itself: focus goes back to the place's chip (else it would drop to the page body).
    close.addEventListener('click', () => { this.clearInspection(); this.controls.querySelector<HTMLButtonElement>(`[data-landmark="${id}"]`)?.focus(); });
    const heading = document.createElement('h3'); heading.textContent = s(id, this.lang);
    // The full description (desktop, portrait); short landscape shows the first sentence and a Details action instead.
    const full = s(`${id}Info`, this.lang);
    const description = document.createElement('p'); description.className = 'spaceport-place-description'; description.dataset.ui = 'spaceport-place-description'; description.textContent = full;
    const summary = document.createElement('p'); summary.className = 'spaceport-place-summary'; summary.dataset.ui = 'spaceport-place-summary'; summary.textContent = placeSummary(full);
    const details = button('spaceport-place-details', 'spaceport-details-open'); details.textContent = s('details', this.lang);
    details.setAttribute('aria-haspopup', 'dialog'); details.setAttribute('aria-controls', 'spaceport-details');
    details.addEventListener('click', () => this.openDetails(details, id));
    this.closeDetails(false);
    this.inspection.replaceChildren(heading, details, close, description, summary); this.inspection.hidden = false;
    for (const element of this.controls.querySelectorAll<HTMLButtonElement>('[data-landmark]')) element.setAttribute('aria-pressed', String(element.dataset.landmark === id));
  }

  private openDetails(opener: HTMLElement, id: LandmarkId) {
    this.detailsTitle.textContent = s(id, this.lang);
    this.detailsText.textContent = s(`${id}Info`, this.lang);
    this.detailsClose.querySelector('[data-label]')!.textContent = s('closeCard', this.lang);
    this.details.hidden = false; this.dialog.dataset.details = 'open';
    for (const element of [this.stage, this.topColumn, this.controls]) if (element) element.inert = true;
    this.detailsOpener = opener;
    this.hand.reset(); // no pending confirmation carries into the panel; a 👍 still up owes a seen release
    this.detailsClose.focus();
  }

  private closeDetails(returnFocus = true) {
    if (this.details.hidden) return;
    this.details.hidden = true; delete this.dialog.dataset.details;
    for (const element of [this.stage, this.topColumn, this.controls]) if (element) element.inert = false;
    this.hand.reset(); // nothing pending carries back to the card either
    if (returnFocus && this.detailsOpener?.isConnected && !this.inspection.hidden) this.detailsOpener.focus();
    this.detailsOpener = null;
  }

  private showComplete() {
    const text = `✓ ${s('complete', this.lang)}`;
    this.completeStatus.textContent = text; this.completeLive.textContent = text;
    this.completeStatus.dataset.shown = 'true'; this.dialog.dataset.complete = 'true'; this.completeUntil = performance.now() + 3500;
  }
  private hideComplete() {
    this.completeStatus.dataset.shown = 'false'; this.completeStatus.textContent = ''; this.completeLive.textContent = '';
    delete this.dialog.dataset.complete;
  }

  private clearInspection() {
    this.closeDetails(false);
    this.inspection.hidden = true;
    for (const element of this.controls.querySelectorAll('[data-landmark]')) element.setAttribute('aria-pressed', 'false');
  }

  private setPlay(state: 'play' | 'pause' | 'resume' | 'replay') {
    this.playIcon.innerHTML = ICON[state === 'resume' ? 'play' : state];
    this.play.dataset.state = state;
  }

  private setLightingMode(mode: 'day' | 'sunset' | 'night') {
    this.lightingMode = mode;
    this.lightingToggle.dataset.mode = mode;
    const icon = mode === 'day' ? '☀' : mode === 'sunset' ? '🌅' : '🌙';
    const label = s(`light.${mode}`, this.lang);
    this.lightingToggle.textContent = `${icon} ${label}`;
    this.lightingToggle.setAttribute('aria-label', label);
    this.viewer?.setLighting(mode);
  }

  private async load() {
    this.release();
    const request = this.abort = new AbortController();
    const launch = this.launch;
    if (launch) this.launchTimeout = setTimeout(() => { if (this.launch === launch) this.finishLaunch(true); }, 20000);
    this.status.hidden = false;
    this.status.textContent = s('loading', this.lang);
    this.retry.hidden = true;
    for (const element of this.controls.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')) element.disabled = true;
    try {
      const { SpaceportPreview } = await import('../scene/spaceportPreview');
      if (request.signal.aborted || !this.active) return;
      this.viewer = new SpaceportPreview(this.stage, this.low, id => this.inspect(id));
      this.setLightingMode(this.lightingMode);
      this.layoutBands();
      await this.viewer.load(request.signal);
      if (request.signal.aborted || !this.active) return;
      if (this.launch) {
        this.viewer.controls.enabled = false;
        // The pad and rocket together until the rocket rises, then Follow (SpaceportPreview.presentDeparture).
        if (this.launchMotion === 'reduced') {
          this.viewer.presentDeparture({ from: DEPARTURE_FROM, reduced: true, play: false });
          const held = this.launch;
          this.departureHold = setTimeout(() => { this.departureHold = null; if (this.launch === held) this.finishLaunch(true); }, DEPARTURE_STILL_MS);
        } else this.viewer.presentDeparture({ from: DEPARTURE_FROM });
        if (request.signal.aborted || !this.active) return;
      } else if (this.blenderShot) {
        this.viewer.showBlenderReview(this.blenderShot);
      }
      this.status.hidden = true;
      for (const element of this.controls.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')) element.disabled = false;
      if (this.launch) { this.timeline.disabled = true; for (const marker of this.markers.values()) marker.disabled = true; }
      this.clearLaunchTimeout();
    } catch (error) {
      if (request.signal.aborted || !this.active) return;
      this.viewer?.dispose(); this.viewer = null;
      if (this.launch) {
        console.warn('Spaceport launch presentation unavailable; continuing flight', error);
        this.finishLaunch(true);
        return;
      }
      this.status.textContent = s('failed', this.lang);
      this.retry.hidden = false;
      console.warn('Spaceport preview unavailable', error);
    }
  }

  update(dt: number, reducedMotion = this.reduced) {
    this.reduced = reducedMotion;
    // Reduced motion switched on during a played departure: cut to the flight (a still departure keeps its hold).
    if (this.launch && reducedMotion && this.launchMotion !== 'reduced') { this.finishLaunch(true); return; }
    if (!this.active || !this.viewer) return;
    this.viewer.update(dt, this.reduced);
    const liftoff = this.viewer.liftoffAt;
    if (this.launch !== null && (this.viewer.time >= DURATION || (this.launchMotion === 'full' && liftoff !== null && this.viewer.time >= liftoff + DEPARTURE_FOLLOW_SECONDS))) { this.finishLaunch(true); return; }
    this.timeline.value = String(this.viewer.time);
    this.controls.style.setProperty('--progress', String(this.viewer.time / DURATION));
    const time = this.viewer.time;
    const phase = phaseAt(time);
    const scrubbing = this.scrubPointer || performance.now() < this.scrubKeyUntil;
    if (phase !== this.lastPhase || scrubbing !== this.lastScrub) {
      const index = PHASES.findIndex(p => p.id === phase);
      this.phase.dataset.phase = phase; this.phase.dataset.scrub = String(scrubbing);
      // Phase changes are announced during playback and marker jumps; scrubbing stays quiet for screen readers.
      if (phase !== this.lastPhase && !scrubbing) this.phaseLive.textContent = s(`phase.${phase}`, this.lang);
      for (const [id, marker] of this.markers) {
        const i = PHASES.findIndex(p => p.id === id);
        marker.setAttribute('aria-current', String(id === phase));
        marker.dataset.state = id === phase ? (scrubbing ? 'scrub' : 'current') : i < index ? 'past' : 'future';
      }
      this.lastPhase = phase; this.lastScrub = scrubbing;
    }
    if (scrubbing) this.phaseTime.textContent = `${time.toFixed(1)} s`;
    const playing = this.viewer.playing;
    // Completion: playback itself has just run to the end (the final frame and the camera stay; ▶ already says
    // Replay). A seek to the end, even during playback, is not a finish. The message shows briefly and is announced
    // once; seeking away from the end, or playing again, clears it.
    const atEnd = time >= DURATION - 0.01;
    if (!this.launch && this.viewer.completions !== this.seenCompletions) { this.seenCompletions = this.viewer.completions; this.showComplete(); }
    else if (this.completeStatus.dataset.shown === 'true' && (!atEnd || playing || performance.now() > this.completeUntil)) this.hideComplete();
    const label = playing ? 'pause' : this.launch ? 'resume' : atEnd ? 'replay' : 'play';
    if (playing !== this.lastPlaying || this.play.dataset.state !== label) { this.setPlay(label); this.lastPlaying = playing; }
    const activeView = this.viewer.activePreset ?? 'manual';
    if (activeView !== this.lastView) {
      for (const [view, element] of this.views) element.setAttribute('aria-pressed', String(view === activeView));
      this.boarding.setAttribute('aria-pressed', String(activeView === 'boarding'));
      this.dialog.dataset.camera = activeView;
      this.lastView = activeView;
    }
    const showBoarding = this.viewer.boardingAvailable && (activeView === 'terminal' || activeView === 'boarding');
    if (showBoarding && this.boarding.parentElement !== this.landmarks) {
      this.boarding.hidden = false;
      this.landmarks.prepend(this.boarding);
      this.landmarks.scrollLeft = 0;
    } else if (!showBoarding && this.boarding.parentElement) {
      const hadFocus = document.activeElement === this.boarding;
      this.boarding.hidden = true;
      this.boarding.remove();
      if (hadFocus) (this.views.get(activeView as SpaceportCamera) ?? this.play).focus();
    }
    this.renderHand(performance.now());
    if (this.dialog.dataset.hand === 'on') {
      const places = shownPlaces(), current = this.controls.querySelector<HTMLElement>('[data-landmark][aria-pressed="true"]')?.dataset.landmark as LandmarkId | undefined;
      const index = current ? places.indexOf(current) : -1, n = places.length;
      const prev = places[index < 0 ? n - 1 : (index - 1 + n) % n], next = places[index < 0 ? 0 : (index + 1) % n];
      const prevName = this.zonePrev.querySelector('.spaceport-zone-place')!, nextName = this.zoneNext.querySelector('.spaceport-zone-place')!;
      if (prev && prevName.textContent !== s(prev, this.lang)) prevName.textContent = s(prev, this.lang);
      if (next && nextName.textContent !== s(next, this.lang)) nextName.textContent = s(next, this.lang);
    }
    if (!this.about.hidden && performance.now() - this.lastReport > 500) {
      this.lastReport = performance.now(); const report = this.viewer.performanceReport();
      this.report.textContent = `${report.fps.toFixed(0)} FPS · p95 ${report.frameP95Ms.toFixed(1)} ms · ${report.drawCalls} calls · ~${(report.estimatedGpuBytes / 1048576).toFixed(1)} MiB geometry/textures`;
    }
  }

  private finishLaunch(continueFlight: boolean) {
    const launch = this.launch;
    if (!launch) return;
    this.launch = null;
    this.dismiss();
    if (continueFlight) launch.complete();
    else launch.cancel();
  }
  close() {
    if (this.launch) this.finishLaunch(false);
    else this.dismiss();
  }
  /** Publishes the band between the top bar and the dock as CSS variables (px from the top and from the bottom). */
  private layoutBands() {
    if (!this.dialog.open || !this.heading) return;
    const dock = this.controls.getBoundingClientRect();
    const bars = [...this.heading.children].map(element => element.getBoundingClientRect()).filter(box => box.height > 0);
    const top = Math.round(Math.max(0, ...bars.map(box => box.bottom))), bottom = Math.round(innerHeight - (dock.height ? dock.top : innerHeight));
    this.dialog.style.setProperty('--sp-band-top', `${top}px`);
    this.dialog.style.setProperty('--sp-band-bottom', `${bottom}px`);
    this.viewer?.setBands(top, bottom); // the Overview frames the campus between the bar and the dock
  }
  private dismiss() { if (this.active) this.dialog.close(); this.release(); this.endSession(); }
  /** Once per preview: hand the screen back (ground camera, focus to the opener). A late load can't call it again. */
  private endSession() { const done = this.onClosed; this.onClosed = null; done?.(); }
  private clearLaunchTimeout() {
    if (this.launchTimeout !== null) clearTimeout(this.launchTimeout);
    this.launchTimeout = null;
  }
  private release() {
    this.clearLaunchTimeout();
    if (this.departureHold !== null) clearTimeout(this.departureHold);
    this.departureHold = null;
    this.abort?.abort(); this.abort = null;
    this.viewer?.dispose(); this.viewer = null;
    this.lastPhase = this.lastView = ''; this.lastPlaying = null; this.lastScrub = false; this.scrubPointer = false; this.scrubKeyUntil = 0;
    this.boarding.hidden = true;
    this.boarding.remove();
    this.lastHint = ''; this.coach.dataset.hint = ''; this.coachLive.textContent = ''; this.dialog.dataset.tracking = 'off';
    this.hideComplete(); this.seenCompletions = 0; this.phaseLive.textContent = '';
    // Closing (or reloading) the preview leaves nothing armed or charged behind.
    this.hand.reset(); this.handSeenAt = -Infinity; this.dialog.dataset.hand = 'off';
    if (this.marked) { delete this.marked.dataset.gesture; this.marked = null; }
    if (this.pulsed) { delete this.pulsed.dataset.gesturePulse; this.pulsed = null; }
    this.closeDetails(false);
  }
  dispose() { this.close(); this.dialog.remove(); }
}
