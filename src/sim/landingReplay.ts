import type { Config } from '../config';
import { GestureEngine } from '../gestures/engine';
import { steerFromPalm, type SteerSensitivity } from '../gestures/steer';
import type { Recording } from '../ui/recorder';
import { dockingParams, startDocking, STEER_RANGE, stepDocking, type DockingState } from './docking';

// Replays a recorded landing (?debug, R) through the same steps the app takes:
// the gesture engine observes each frame, the palm steers, the docking sim steps.
// So a real recording can become a test, or show where steering goes wrong.

export interface LandingContext {
  baseId: string;
  /** Surface gravity there, m/s². */
  gravity: number;
  sensitivity: SteerSensitivity;
  autoLand: boolean;
  /** The descent's starting height, pad radii. */
  startAlt: number;
}

export interface LandingReplay {
  /** Every attempt in the recording, in order. */
  attempts: { outcome: DockingState['outcome']; seconds: number; offCenter: number }[];
  /** The steering the hand gave, per docking frame (for plotting). */
  steer: { t: number; x: number; y: number }[];
}

/**
 * Frames recorded while landing (tagged mode 'docking') are replayed; anything
 * else just advances the gesture engine. Needs a recording with `landing` context.
 */
export function replayLanding(rec: Recording, cfg: Pick<Config, 'gestures' | 'smoothing'>, aspect = 4 / 3): LandingReplay {
  const ctx = rec.landing;
  if (!ctx) throw new Error('This recording has no landing in it (record with R during a landing, in ?debug).');
  const engine = new GestureEngine(cfg.gestures, cfg.smoothing, () => null);
  const params = dockingParams(ctx.gravity);
  const out: LandingReplay = { attempts: [], steer: [] };
  let s: DockingState | null = null;
  let lastT: number | null = null;
  for (const frame of rec.frames) {
    engine.update({ t: frame.t, aspect, hands: frame.hands });
    const docking = frame.mode === 'docking';
    if (!docking) {
      s = null;
      lastT = null;
      continue;
    }
    s ??= startDocking(ctx.startAlt);
    const dt = lastT === null ? 0 : (frame.t - lastT) / 1000;
    lastT = frame.t;
    const center = engine.lastObs?.center;
    const steer = center ? steerFromPalm(center, ctx.sensitivity) : null;
    if (steer) out.steer.push({ t: frame.t, ...steer });
    if (dt > 0 && !s.outcome) {
      s = stepDocking(s, dt, params, steer && { x: steer.x * STEER_RANGE, z: steer.y * STEER_RANGE }, ctx.autoLand);
      if (s.outcome) {
        out.attempts.push({ outcome: s.outcome, seconds: s.t, offCenter: Math.hypot(s.x, s.z) });
        s = startDocking(ctx.startAlt); // the app starts over after a miss (and a landing ends the recording's landing)
        if (out.attempts.at(-1)!.outcome === 'landed') s = { ...s, outcome: 'landed' };
      }
    }
  }
  return out;
}
