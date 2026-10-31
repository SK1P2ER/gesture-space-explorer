import { config } from '../config';
import type { GestureEngine } from '../gestures/engine';
import type { ExtraGestures } from '../gestures/extras';
import type { Intent, IntentBus } from '../intents';
import { cameraErrorCode, startCamera, type CameraHandle } from '../tracking/camera';
import type { HandTracker } from '../tracking/handTracker';
import type { HandFrame } from '../tracking/types';
import type { DebugOverlay } from '../ui/debugOverlay';
import type { GestureHud } from '../ui/gestureHud';
import type { StringKey } from '../ui/i18n';
import type { Recorder } from '../ui/recorder';
import type { AppState } from './state';

export interface TrackingDeps {
  state: AppState;
  bus: IntentBus;
  gestures: GestureEngine;
  extras: ExtraGestures;
  overlay: DebugOverlay;
  recorder: Recorder;
  gestureHud: GestureHud;
  /** More gestures layered on the same observation (the launch countdown). */
  more: (t: number) => Intent[];
  /** Which of the engine's intents to pass on (Build mode drops its pinch-zoom: the pinch grabs there). */
  keep?: (intent: Intent) => boolean;
  /** The app's mode, stored with each recorded frame (so landings can be replayed). */
  frameMode: () => string;
  /** On-screen confirmation for a discrete gesture event (after it's applied), if any. */
  gestureMessage: (intent: Intent) => string | null;
}

const sessions = new WeakMap<HTMLVideoElement, TrackingSession>();
let nextSessionId = 0;

/** Owns one camera/detector lifetime, including resources that arrive after cancellation. */
export class TrackingSession {
  readonly id = ++nextSessionId;
  readonly ready: Promise<void>;
  private readonly controller = new AbortController();
  private stopped = false;
  private camera: CameraHandle | null = null;
  private tracker: HandTracker | null = null;
  private stopLoop: (() => void) | null = null;
  private readonly onPageHide = () => this.dispose();

  constructor(private readonly video: HTMLVideoElement, private readonly deps: TrackingDeps) {
    sessions.get(video)?.dispose();
    sessions.set(video, this);
    deps.state.status = { kind: 'loading', progress: 0 };
    window.addEventListener('pagehide', this.onPageHide);
    this.ready = this.initialize();
  }

  get cancelled() {
    return this.stopped;
  }

  private current() {
    return !this.stopped && sessions.get(this.video) === this;
  }

  dispose(reason: StringKey = 'err.disconnected') {
    if (this.stopped) return;
    this.stopped = true; // invalidate callbacks before releasing anything
    window.removeEventListener('pagehide', this.onPageHide);
    for (const release of [
      () => this.stopLoop?.(),
      () => this.controller.abort(),
      () => this.camera?.dispose(),
      () => this.tracker?.dispose(),
    ]) {
      try { release(); } catch (e) { console.error('[tracking] cleanup', e); }
    }
    this.stopLoop = this.camera = this.tracker = null;
    if (sessions.get(this.video) === this) {
      sessions.delete(this.video);
      this.deps.gestures.reset();
      this.deps.extras.reset();
      this.deps.state.status = { kind: 'keyboard', reason };
    }
  }

  private async initialize() {
    const { video, deps, controller } = this;
    // Start both loads together; handle detector rejection immediately even while camera permission is pending.
    const trackerPromise = import('../tracking/handTracker').then(async ({ createHandTracker }) => {
      if (!this.current()) return null;
      const tracker = await createHandTracker(config.tracking, (p) => {
        if (this.current() && deps.state.status.kind === 'loading') deps.state.status = { kind: 'loading', progress: p };
      }, controller.signal);
      if (!this.current()) {
        tracker.dispose();
        return null;
      }
      this.tracker = tracker;
      return tracker;
    }).catch((e) => {
      if (this.current()) {
        console.error('[tracker]', e);
        this.dispose('err.tracker');
      }
      return null;
    });

    try {
      const camera = await startCamera(video, config.camera, () => this.dispose('err.disconnected'), controller.signal);
      if (!this.current()) {
        camera.dispose();
        return;
      }
      this.camera = camera;
    } catch (e) {
      if (this.current()) this.dispose(`err.${cameraErrorCode(e)}`);
      return;
    }

    const tracker = await trackerPromise;
    if (!this.current()) return;
    if (!this.camera.isLive()) {
      this.dispose('err.disconnected');
      return;
    }
    if (!tracker) return;
    try {
      const aspect = video.videoWidth / video.videoHeight || 4 / 3;
      deps.overlay.delegate = tracker.delegate;
      deps.overlay.show(aspect);
      const stop = tracker.run(video, (frame, ms) => this.onFrame(frame, ms, aspect), (e) => {
        if (!this.current()) return;
        console.error('[tracker] detection keeps failing; switching to keyboard mode', e);
        this.dispose('err.tracking-stopped');
      });
      // A tracker can fail synchronously inside run(), before it returns its stop handle.
      if (!this.current()) { stop(); return; }
      this.stopLoop = stop;
      deps.state.status = { kind: 'tracking', delegate: tracker.delegate };
    } catch (e) {
      if (this.current()) {
        console.error('[tracker]', e);
        this.dispose('err.tracker');
      }
    }
  }

  private onFrame(frame: HandFrame, detectMs: number, aspect: number) {
    if (!this.current()) return;
    if (!this.camera?.isLive()) { this.dispose('err.disconnected'); return; }
    const { bus, gestures, extras, overlay, recorder, gestureHud, gestureMessage, more, frameMode, keep } = this.deps;
    overlay.onFrame(frame, detectMs);
    recorder.push(frame, frameMode());
    const intents = gestures.update({ t: frame.t, aspect, hands: frame.hands }).filter((i) => keep?.(i) ?? true);
    intents.push(...extras.update({ t: frame.t, aspect, hands: frame.hands }, gestures));
    intents.push(...more(frame.t));
    for (const intent of intents) {
      if (!this.current()) return;
      bus.emit(intent);
      if (!this.current()) return;
      const message = gestureMessage(intent);
      if (message) gestureHud.flash(message);
    }
    if (!this.current()) return;
    const { pose, action, progress } = gestures.ui;
    overlay.gestureInfo = pose ? `${pose} → ${action ?? '—'}${progress ? ` ${Math.round(progress * 100)}%` : ''}` : '—';
    if (overlay.enabled) logGestureFrame(gestures, extras, intents);
  }
}

/** Starts immediately and returns a handle so even pending startup can be disposed. */
export function startTracking(deps: TrackingDeps): TrackingSession {
  return new TrackingSession(document.querySelector<HTMLVideoElement>('#preview video')!, deps);
}

/** Debug mode (?debug=1 or D): one console line per tracked frame. */
function logGestureFrame(engine: GestureEngine, extras: ExtraGestures, intents: Intent[]) {
  const o = engine.lastObs;
  if (!o) {
    console.log('[gesture] no hand in control');
    return;
  }
  const f = o.fingers;
  const bit = (b: boolean) => (b ? '1' : '0');
  console.log(
    `[gesture] raw=${o.pose.padEnd(5)} stable=${(engine.ui.pose ?? '—').padEnd(5)} ` +
      `fingers T${bit(f.thumb)} I${bit(f.index)} M${bit(f.middle)} R${bit(f.ring)} P${bit(f.pinky)} ` +
      `ratios=${o.ratios.map((r) => r.toFixed(2)).join('/')} (ext>${config.gestures.extendedRatio}) ` +
      `pinch=${o.pinchRatio.toFixed(2)} action=${engine.ui.action ?? '—'} ` +
      `progress=${Math.round(engine.ui.progress * 100)}% extra=${extras.ui.action ?? '—'}${extras.ui.dialActive ? '(live)' : ''} ` +
      (intents.length ? ` → ${intents.map((i) => i.type).join(',')}` : ''),
  );
}
