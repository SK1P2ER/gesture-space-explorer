import type { Config } from '../config';
import type { Intent } from '../intents';
import { OneEuroFilter } from '../tracking/oneEuro';
import type { Hand } from '../tracking/types';
import { observeHand, type HandObs, type Pose, type Vec2 } from './perception';

// Tracked hands over time → Intents. Pure: no DOM, no Three.js, no clock —
// time comes in with each frame, picking is injected. That makes every
// behavior here replayable in tests.

export interface EngineFrame {
  t: number; // ms
  aspect: number; // video width / height
  hands: Hand[];
}

/** Returns the id of the body under a screen point ([0,1] × [0,1]), if any. */
export type Picker = (screen: Vec2) => string | null;

export type Action = 'rotate' | 'zoom' | 'swipe' | 'point' | 'pause' | 'time' | null;

export interface EngineUi {
  pose: Pose | null; // stable pose of the controlling hand; null = no hand in control
  action: Action;
  pointer: Vec2 | null; // screen-space pointer while pointing
  hoverId: string | null;
  progress: number; // 0..1 — dwell to select, ✌️ hold to switch, or fist hold to pause
}

type Cfg = Config['gestures'];
type SmoothCfg = Config['smoothing'];

/**
 * Holds (✌️, ✊, point-dwell) accumulate *observed* time: each frame adds at
 * most this much. A detection stall (first GPU frame, a background tab) then
 * can't complete a hold the user never saw progress on.
 */
const MAX_STEP_MS = 100;

class Smoother2 {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;
  constructor(cfg: SmoothCfg) {
    this.fx = new OneEuroFilter(cfg.minCutoff, cfg.beta);
    this.fy = new OneEuroFilter(cfg.minCutoff, cfg.beta);
  }
  filter(v: Vec2, t: number): Vec2 {
    return { x: this.fx.filter(v.x, t), y: this.fy.filter(v.y, t) };
  }
}

export class GestureEngine {
  ui: EngineUi = { pose: null, action: null, pointer: null, hoverId: null, progress: 0 };
  /** Raw (un-debounced) observation of the controlling hand, for debug logging. */
  lastObs: HandObs | null = null;

  // Controlling hand identity (MediaPipe gives no stable ids).
  private controller: { center: Vec2; lastSeen: number; rawPose: Pose } | null = null;

  // Pose debounce.
  private stablePose: Pose | null = null;
  private candidate: Pose | null = null;
  private candidateCount = 0;

  // Frame timing.
  private lastFrameT: number | null = null;
  private step = 0; // observed ms since the previous frame, capped at MAX_STEP_MS

  // Per-pose state, reset whenever the stable pose changes.
  private smoother: Smoother2 | null = null;
  private last: Vec2 | null = null;
  private swipeHistory: { t: number; x: number; y: number }[] = [];
  private vStart: Vec2 | null = null; // where this ✌️ began
  private vHoldCancelled = false; // the hand moved: this ✌️ is a swipe, not a hold
  private vFired = false; // one ✌️ = one switch
  private held = 0; // ms of eligible hold for the current ✌️ / ✊
  private dwell: { id: string; elapsed: number; lastHit: number; fired: boolean } | null = null;
  private fistFired = false;

  // Survives pose changes, so re-forming ✌️ quickly can't switch twice.
  private switchCooldownUntil = 0;

  // Two-hand time control.
  private spread: number | null = null;
  private twoHandActive = false;

  constructor(
    private readonly cfg: Cfg,
    private readonly smoothing: SmoothCfg,
    private readonly pick: Picker,
  ) {}

  /** Forget everything (e.g. tracking stopped): no hand in control, nothing on screen. */
  reset() {
    this.controller = null;
    this.lastObs = null;
    this.lastFrameT = null;
    this.twoHandActive = false;
    this.setPose(null);
    this.ui = { pose: null, action: null, pointer: null, hoverId: null, progress: 0 };
  }

  update(frame: EngineFrame): Intent[] {
    const { t, aspect } = frame;
    const prevPinch = this.controller?.rawPose === 'pinch';
    this.step = this.lastFrameT === null ? 0 : Math.min(Math.max(t - this.lastFrameT, 0), MAX_STEP_MS);
    this.lastFrameT = t;

    const observed = frame.hands
      .map((hand) => ({ hand, obs: observeHand(hand, aspect, this.cfg) }))
      .filter(({ obs }) => obs.palm >= this.cfg.minPalmSize);

    const primaryIdx = this.choosePrimary(observed.map((o) => o.obs), t);
    if (primaryIdx < 0) {
      this.lastObs = null;
      // Keep the pose through a short dropout, but not the motion reference:
      // the hand may reappear elsewhere and must not jerk the camera.
      this.resetMotion();
      if (!this.controller) this.setPose(null);
      this.ui = { ...this.ui, action: null, pointer: null, hoverId: null, progress: 0 };
      return [];
    }

    // Re-observe the controlling hand with pinch hysteresis.
    const primary = observeHand(observed[primaryIdx].hand, aspect, this.cfg, prevPinch);
    this.controller = { center: primary.center, lastSeen: t, rawPose: primary.pose };
    this.lastObs = primary;

    // A second hand counts only if it looks like the same person's other hand.
    const secondary = observed
      .filter((_, i) => i !== primaryIdx)
      .map((o) => o.obs)
      .filter((o) => o.palm > primary.palm * 0.6 && o.palm < primary.palm * 1.6)
      .sort((a, b) => b.palm - a.palm)[0];

    // Two-hand time control: both hands pinching. Entering or leaving it
    // restarts motion tracking, so single-hand zoom never sees a stale position.
    const twoHand = !!secondary && primary.pose === 'pinch' && secondary.pose === 'pinch';
    if (twoHand !== this.twoHandActive) {
      this.twoHandActive = twoHand;
      this.resetMotion();
    }
    if (twoHand) return this.twoHand(primary, secondary, aspect);

    this.debounce(primary.pose);
    return this.single(primary, aspect, t);
  }

  // ----------------------------------------------------------- hands ----

  private choosePrimary(observed: HandObs[], t: number): number {
    if (this.controller) {
      let best = -1;
      let bestD = 0.25; // max jump between frames, normalized
      observed.forEach((o, i) => {
        const d = Math.hypot(o.center.x - this.controller!.center.x, o.center.y - this.controller!.center.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) return best;
      if (t - this.controller.lastSeen <= this.cfg.handLostMs) return -1; // briefly lost: hold
      this.controller = null;
    }
    // A new hand takes control: it must not inherit the old hand's pose or timers.
    this.setPose(null);
    // Nobody in control: the largest (closest) hand takes it.
    let best = -1;
    observed.forEach((o, i) => {
      if (best < 0 || o.palm > observed[best].palm) best = i;
    });
    return best;
  }

  private debounce(raw: Pose) {
    if (raw === this.stablePose) {
      this.candidate = null;
      this.candidateCount = 0;
      return;
    }
    this.candidateCount = raw === this.candidate ? this.candidateCount + 1 : 1;
    this.candidate = raw;
    // The very first pose after "no hand" is accepted at once.
    if (this.candidateCount >= this.cfg.poseConfirmFrames || this.stablePose === null) this.setPose(raw);
  }

  private setPose(pose: Pose | null) {
    if (pose === this.stablePose) return;
    this.stablePose = pose;
    this.candidate = null;
    this.candidateCount = 0;
    this.resetMotion();
    this.vHoldCancelled = false;
    this.vFired = false;
    this.held = 0;
    this.dwell = null;
    this.fistFired = false;
  }

  /** Forget positional references (filters, last position, swipe path); keep pose and holds. */
  private resetMotion() {
    this.smoother = null;
    this.last = null;
    this.swipeHistory = [];
    this.vStart = null;
    this.spread = null;
  }

  // ------------------------------------------------------- behaviors ----

  private single(o: HandObs, aspect: number, t: number): Intent[] {
    const pose = this.stablePose;
    const ui: EngineUi = { pose, action: null, pointer: null, hoverId: null, progress: 0 };
    const out: Intent[] = [];

    switch (pose) {
      case 'palm': {
        const p = this.smoothed(o.center, t);
        if (this.last) {
          out.push({
            type: 'rotate',
            dx: -(p.x - this.last.x) * this.cfg.rotateGain,
            dy: -(p.y - this.last.y) * this.cfg.rotateGain,
          });
        }
        this.last = p;
        ui.action = 'rotate';
        break;
      }

      case 'pinch': {
        const p = this.smoothed(o.pinchPoint, t);
        if (this.last) out.push({ type: 'zoom', factor: Math.exp((p.y - this.last.y) * this.cfg.zoomGain) });
        this.last = p;
        ui.action = 'zoom';
        break;
      }

      case 'v': {
        // ✌️ switches planets, exactly once per gesture:
        //   swipe sideways → next / prev immediately
        //   hold still for vHoldMs → next
        ui.action = 'swipe';
        if (this.vFired) break; // drop the ✌️ to switch again
        if (t < this.switchCooldownUntil) {
          this.held = 0; // the hold only counts once switching is allowed again
          break;
        }

        // Distances in palm sizes, so they mean the same near or far from the camera.
        const palms = (a: Vec2, b: Vec2) => ({ dx: ((b.x - a.x) * aspect) / o.palm, dy: (b.y - a.y) / o.palm });

        this.swipeHistory.push({ t, x: o.center.x, y: o.center.y });
        while (this.swipeHistory.length && t - this.swipeHistory[0].t > this.cfg.swipeWindowMs) this.swipeHistory.shift();
        const swipe = palms(this.swipeHistory[0], o.center);
        if (Math.abs(swipe.dx) >= this.cfg.swipeDistance && Math.abs(swipe.dx) > 2 * Math.abs(swipe.dy)) {
          out.push({ type: swipe.dx > 0 ? 'next' : 'prev' });
          this.fireSwitch(t);
          break;
        }

        this.vStart ??= o.center;
        const moved = palms(this.vStart, o.center);
        if (Math.hypot(moved.dx, moved.dy) > this.cfg.vHoldMaxMove) this.vHoldCancelled = true;
        if (!this.vHoldCancelled) {
          this.held += this.step;
          ui.progress = Math.min(1, this.held / this.cfg.vHoldMs);
          if (ui.progress >= 1) {
            out.push({ type: 'next' });
            this.fireSwitch(t);
            ui.progress = 0;
          }
        }
        break;
      }

      case 'point': {
        const tip = this.smoothed(o.indexTip, t);
        const m = this.cfg.pointerMargin;
        const pointer = { x: clamp01((tip.x - m) / (1 - 2 * m)), y: clamp01((tip.y - m) / (1 - 2 * m)) };
        const hit = this.pick(pointer);
        if (hit) {
          if (this.dwell?.id !== hit) this.dwell = { id: hit, elapsed: 0, lastHit: t, fired: false };
          else this.dwell.elapsed += this.step;
          this.dwell.lastHit = t;
        } else if (this.dwell && t - this.dwell.lastHit > this.cfg.hoverGraceMs) {
          this.dwell = null;
        } else if (this.dwell) {
          this.dwell.elapsed += this.step; // within the jitter grace period: keep counting
        }
        if (this.dwell && !this.dwell.fired) {
          ui.progress = Math.min(1, this.dwell.elapsed / this.cfg.dwellMs);
          if (ui.progress >= 1) {
            out.push({ type: 'select', bodyId: this.dwell.id });
            this.dwell.fired = true; // re-arms when the target changes
          }
        }
        ui.action = 'point';
        ui.pointer = pointer;
        ui.hoverId = this.dwell?.id ?? null;
        break;
      }

      case 'fist': {
        if (!this.fistFired) {
          this.held += this.step;
          ui.progress = Math.min(1, this.held / this.cfg.fistHoldMs);
          if (this.held >= this.cfg.fistHoldMs) {
            out.push({ type: 'togglePause' });
            this.fistFired = true; // re-arms only after the fist opens
          }
        }
        ui.action = 'pause';
        break;
      }
    }

    this.ui = ui;
    return out;
  }

  private twoHand(a: HandObs, b: HandObs, aspect: number): Intent[] {
    this.setPose('pinch');
    const d = Math.hypot((a.pinchPoint.x - b.pinchPoint.x) * aspect, a.pinchPoint.y - b.pinchPoint.y);
    const out: Intent[] = [];
    if (this.spread !== null && d > 0 && this.spread > 0) {
      const factor = (d / this.spread) ** this.cfg.timeGain;
      if (Math.abs(factor - 1) > 1e-3) out.push({ type: 'timeScale', factor });
    }
    this.spread = d;
    this.ui = { pose: 'pinch', action: 'time', pointer: null, hoverId: null, progress: 0 };
    return out;
  }

  private fireSwitch(t: number) {
    this.vFired = true;
    this.switchCooldownUntil = t + this.cfg.switchCooldownMs;
    this.swipeHistory = [];
  }

  private smoothed(v: Vec2, t: number): Vec2 {
    this.smoother ??= new Smoother2(this.smoothing);
    return this.smoother.filter(v, t);
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
