import type { Fingers } from './perception';
import type { Intent } from '../intents';

// The launch countdown: hold up 3 fingers, then 2, then 1 (index, then middle,
// then ring; the thumb doesn't count). Each count must be held still for a
// moment, and they must come in order, each within a few seconds of the last.
// Layered on the hand observation like gestures/extras.ts; the engine is unchanged.

export const COUNTDOWN = { holdMs: 250, stepTimeoutMs: 4000 };

/** 3, 2 or 1 raised fingers counted from the index side; 0 for anything else. */
export function fingerCount(f: Fingers | null): 0 | 1 | 2 | 3 {
  if (!f || f.pinky) return 0;
  if (f.index && f.middle && f.ring) return 3;
  if (f.index && f.middle && !f.ring) return 2;
  if (f.index && !f.middle && !f.ring) return 1;
  return 0;
}

export class CountdownGesture {
  private expect: 3 | 2 | 1 = 3;
  private held: { n: number; since: number; used: boolean } | null = null;
  private lastStep = -Infinity;

  /** @returns a countdown intent the moment a count is held long enough, in order. */
  update(t: number, fingers: Fingers | null): Intent[] {
    if (this.expect !== 3 && t - this.lastStep > COUNTDOWN.stepTimeoutMs) this.expect = 3; // too slow: start over
    const n = fingerCount(fingers);
    if (!this.held || this.held.n !== n) this.held = { n, since: t, used: false };
    if (n === 0 || this.held.used || n !== this.expect || t - this.held.since < COUNTDOWN.holdMs) return [];
    this.held.used = true;
    this.lastStep = t;
    const step = this.expect;
    this.expect = step === 1 ? 3 : ((step - 1) as 2 | 1);
    return [{ type: 'countdown', n: step }];
  }

  reset() {
    this.expect = 3;
    this.held = null;
  }
}
