import type { Config } from '../config';
import type { Intent } from '../intents';
import { OneEuroFilter } from '../tracking/oneEuro';
import type { Hand } from '../tracking/types';
import type { EngineFrame, EngineUi } from './engine';
import type { HandObs } from './perception';

// Gestures added in v1.2, layered on top of the original engine:
//   🤘 rock (index + pinky up)  → hold to take a photo
//   🤙 shaka (pinky + thumb)    → time dial: tilt the hand to change the speed
//
// Both are finger shapes the original engine classifies as `none` (it has no
// behavior for them), and this module only acts while the engine's settled
// pose is `none`. So a new gesture can never trigger an old one, and an old
// one can never trigger a new one. perception.ts and engine.ts are unchanged:
// this reads the engine's own view of the controlling hand. Pure, like the
// engine: time comes in with each frame.

export type ExtraShape = 'rock' | 'shaka';

/** Which v1.2 shape a hand makes, if any. The thumb is ignored, as in the engine. */
export function extraShape(o: HandObs): ExtraShape | null {
  const f = o.fingers;
  if (f.index && f.pinky && !f.middle && !f.ring) return 'rock';
  if (f.pinky && !f.index && !f.middle && !f.ring) return 'shaka';
  return null;
}

/**
 * How far the hand is tilted, in radians: 0 = fingers straight up, positive =
 * top of the hand toward the user's right as they see themselves (the view is
 * mirrored). Measured the same way for both hands, so "right = faster" holds
 * for either.
 */
export function handTilt(hand: Hand, aspect: number): number {
  const [wx, wy] = hand.landmarks[0];
  const [mx, my] = hand.landmarks[9]; // middle-finger knuckle
  const dx = ((1 - mx) - (1 - wx)) * aspect;
  const dy = my - wy;
  return Math.atan2(dx, -dy);
}

export type ExtraAction = 'photo' | 'dial' | null;

export interface ExtraUi {
  action: ExtraAction;
  /** 0..1 — photo hold, or the dial settling before it engages. */
  progress: number;
  /** The dial is live: tilting changes the speed. */
  dialActive: boolean;
}

/** The engine's view of the frame this module builds on. */
export interface EngineView {
  lastObs: HandObs | null;
  ui: EngineUi;
}

type Cfg = Config['gestures'];
type SmoothCfg = Config['smoothing'];

const MAX_STEP_MS = 100; // same rule as the engine: holds count observed time only

export class ExtraGestures {
  ui: ExtraUi = { action: null, progress: 0, dialActive: false };

  private shape: ExtraShape | null = null; // debounced
  private candidate: ExtraShape | null = null;
  private candidateCount = 0;
  private lastT: number | null = null;

  // 🤘
  private held = 0;
  private photoFired = false;
  /** No photo before this time: set while 🤙 is up and for a moment after (🤙/🤘 can be confused). */
  private photoBlockedUntil = -Infinity;

  // 🤙
  private settled = 0; // ms the shaka has been held before the dial engages
  private dialActive = false;
  private tiltFilter: OneEuroFilter;
  private rawTilt: number | null = null; // unwrapped
  private lastTilt: number | null = null; // smoothed, at the previous frame

  constructor(
    private readonly cfg: Cfg,
    smoothing: SmoothCfg,
  ) {
    this.tiltFilter = new OneEuroFilter(smoothing.minCutoff, smoothing.beta);
  }

  reset() {
    this.lastT = null;
    this.setShape(null, 0);
    this.ui = { action: null, progress: 0, dialActive: false };
  }

  update(frame: Pick<EngineFrame, 't' | 'aspect' | 'hands'>, engine: EngineView): Intent[] {
    const { t } = frame;
    const step = this.lastT === null ? 0 : Math.min(Math.max(t - this.lastT, 0), MAX_STEP_MS);
    this.lastT = t;

    // Only while the original engine has nothing to do with this hand.
    const obs = engine.ui.pose === 'none' ? engine.lastObs : null;
    this.debounce(obs ? extraShape(obs) : null, t);

    const out: Intent[] = [];
    const ui: ExtraUi = { action: null, progress: 0, dialActive: false };

    if (this.shape === 'shaka') {
      this.photoBlockedUntil = Infinity; // for as long as the shaka is up; set to now + block when it ends
      ui.action = 'dial';
      const hand = obs && controllingHand(frame.hands, obs);
      if (hand) this.trackTilt(handTilt(hand, frame.aspect), t);
      if (!this.dialActive) {
        // Engage only once the pose has settled, so forming it doesn't change the speed.
        this.settled += step;
        ui.progress = Math.min(1, this.settled / this.cfg.dialSettleMs);
        if (this.settled >= this.cfg.dialSettleMs && this.lastTilt !== null) this.dialActive = true;
      } else if (hand && this.lastTilt !== null) {
        const tilt = this.tiltFilter.filter(this.rawTilt!, t);
        const delta = tilt - this.lastTilt;
        this.lastTilt = tilt;
        if (Math.abs(delta) > 1e-4) out.push({ type: 'timeDial', delta: delta / ((this.cfg.dialDegPerHalf * Math.PI) / 180) });
      }
      ui.dialActive = this.dialActive;
    } else if (this.shape === 'rock') {
      ui.action = 'photo';
      if (!this.photoFired && t >= this.photoBlockedUntil) {
        this.held += step;
        ui.progress = Math.min(1, this.held / this.cfg.photoHoldMs);
        if (this.held >= this.cfg.photoHoldMs) {
          out.push({ type: 'photo' });
          this.photoFired = true; // one photo per 🤘; lower the hand to take another
          ui.progress = 0;
        }
      }
    }
    this.ui = ui;
    return out;
  }

  private trackTilt(raw: number, t: number) {
    // Unwrap, so turning past ±180° doesn't jump a full turn.
    if (this.rawTilt !== null) raw += Math.round((this.rawTilt - raw) / (2 * Math.PI)) * 2 * Math.PI;
    this.rawTilt = raw;
    if (!this.dialActive) this.lastTilt = this.tiltFilter.filter(raw, t); // keep the filter warm while settling
  }

  private debounce(raw: ExtraShape | null, t: number) {
    if (raw === this.shape) {
      this.candidate = null;
      this.candidateCount = 0;
      return;
    }
    this.candidateCount = raw === this.candidate ? this.candidateCount + 1 : 1;
    this.candidate = raw;
    if (this.candidateCount >= this.cfg.poseConfirmFrames) this.setShape(raw, t);
  }

  private setShape(shape: ExtraShape | null, t: number) {
    if (this.shape === 'shaka' && shape !== 'shaka') this.photoBlockedUntil = t + this.cfg.dialPhotoBlockMs;
    this.shape = shape;
    this.candidate = null;
    this.candidateCount = 0;
    this.held = 0;
    this.photoFired = false;
    this.settled = 0;
    this.dialActive = false;
    this.rawTilt = null;
    this.lastTilt = null;
    this.tiltFilter.reset();
  }
}

/** The raw hand the engine is following (its observation's palm center is that hand's middle knuckle). */
function controllingHand(hands: Hand[], obs: HandObs): Hand | null {
  return hands.find((h) => Math.abs(1 - h.landmarks[9][0] - obs.center.x) < 1e-9 && Math.abs(h.landmarks[9][1] - obs.center.y) < 1e-9) ?? null;
}
