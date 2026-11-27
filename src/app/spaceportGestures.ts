// Hand input inside the launch preview (owner, 2026-11-20/21). Input logic only: no DOM. The view supplies the
// on-screen targets (only fully visible ones), main.ts supplies the engine's stable pose and pointer per detection
// and the preview applies the outcome through the same actions as its buttons.
//
//   👆 point → dwell on a target → the target is ARMED (highlighted, the ring on the target fills).
//   👍 held  → the armed target's action happens exactly once; another one needs the 👍 released (seen) first.
//   ✊        → cancels the armed target (and any 👍 progress) once the fist (thumb in) lasts longer than the grace.
//   hand gone → the same as ✊ once the hand has been missing longer than the focus grace.
//   ✋ held 1 s → home view (once per palm: the palm must drop before it can happen again).
//
// Timing is the existing picker's (PICKER: 450 ms dwell, 200 ms grace, 120 ms boundary grace, 250 ms gap, 100 ms
// step cap) and Guided's HoldConfirm (500 ms 👍 with the release rule). Detection thresholds are untouched.
import type { Pose } from '../gestures/perception';
import { PICKER } from './destinationPicker';
import { HoldConfirm } from './guidedSession';

/** ✋ held this long (observed time) returns to the home view (owner, 2026-11-20). */
export const HOME_HOLD_MS = 1000;

export interface GestureRect { left: number; top: number; right: number; bottom: number }
export interface GestureTarget { id: string; rect: GestureRect }
export interface GestureInput {
  t: number;
  /** The engine's stable pose (not the raw one). */
  pose: Pose | null;
  /** The engine's pointer, normalized to the viewport (set only for 👆). */
  pointer: { x: number; y: number } | null;
  thumbsUp: boolean;
  /** A controlling hand was observed in this detection. */
  hand: boolean;
}
export interface GestureOutcome { act?: string; home?: true; cancelled?: true }

/** A forgiving edge around each target, in px (its own rect keeps the touch-target minimum). */
const HIT_PAD = 8;
/** The focused target is kept while the pointer stays this far outside it (neighbours don't steal it on jitter). */
const STICKY_PAD = 22;

const inside = (p: { x: number; y: number }, r: GestureRect, pad: number) =>
  p.x >= r.left - pad && p.x <= r.right + pad && p.y >= r.top - pad && p.y <= r.bottom + pad;

export class SpaceportGestures {
  /** The target under a 👆 that is gathering dwell. */
  focus: string | null = null;
  /** The target a completed dwell armed: what 👍 acts on. */
  armed: string | null = null;
  /** Where the 👆 points, in px (null without a usable pointer): the cursor dot. */
  cursor: { x: number; y: number } | null = null;
  private focusMs = 0;
  private lostMs = 0;
  private outsideMs = 0;
  private outside = false;
  private handMissingMs = 0;
  private palmMs = 0;
  private palmFired = false;
  private fistSeen = false;
  private fistMs = 0;
  private lastT: number | null = null;
  private readonly hold = new HoldConfirm();
  /** The last hand seen showed 👍 (kept through dropouts: it may still be up). */
  private lastHandThumb = false;
  private thumbSeen = false;

  /** Dwell toward arming the focused target, 0..1 (1 while it is armed). */
  get dwellProgress() {
    if (this.focus && this.focus === this.armed) return 1;
    return this.focus ? Math.min(1, this.focusMs / PICKER.selectMs) : 0;
  }
  /** The 👍 hold toward the armed action (0 while a release is owed). */
  get confirmProgress() { return this.hold.waitingRelease ? 0 : this.hold.progress; }
  /** A 👍 is up and owes a release before anything else can happen. */
  get waitingRelease() { return this.hold.waitingRelease && this.thumbSeen; }
  /**
   * What the hand should do next, for the one hint line: lower the thumb (a release is owed), hold 👍 (a target is
   * armed), or point at a control (nothing armed). Only meaningful while a hand is seen.
   */
  get hint(): 'release' | 'hold' | 'point' {
    return this.waitingRelease ? 'release' : this.armed ? 'hold' : 'point';
  }
  /** ✋ toward home, 0..1. */
  get homeProgress() { return this.palmFired ? 0 : Math.min(1, this.palmMs / HOME_HOLD_MS); }

  /**
   * The preview opened or closed, or its content changed under the hand: nothing armed, no charge. A 👍 that may
   * still be up (the last hand seen showed it) owes a release that must be seen before it can act.
   */
  reset() {
    this.clearFocus(); this.armed = null; this.cursor = null; this.lastT = null;
    this.handMissingMs = 0; this.palmMs = 0; this.palmFired = false; this.fistSeen = false; this.fistMs = 0;
    this.hold.interrupt();
    if (this.lastHandThumb) this.hold.requireObservedRelease();
    this.thumbSeen = false;
  }

  private clearFocus() { this.focus = null; this.focusMs = 0; this.lostMs = 0; this.outsideMs = 0; this.outside = false; }
  private disarm() {
    this.armed = null; this.hold.interrupt();
    if (this.lastHandThumb) this.hold.requireObservedRelease();
  }

  /** One detection against the targets that are fully visible now (view px). */
  observe(i: GestureInput, targets: readonly GestureTarget[], view: { width: number; height: number }): GestureOutcome {
    const out: GestureOutcome = {};
    const gap = this.lastT === null ? 0 : i.t - this.lastT;
    this.lastT = i.t;
    const continuous = gap >= 0 && gap <= PICKER.maxGapMs;
    const step = continuous ? Math.min(gap, PICKER.stepCapMs) : 0;
    this.thumbSeen = i.hand && i.thumbsUp;
    if (i.hand) this.lastHandThumb = i.thumbsUp;

    // A target that disappeared (the preview changed, a chip scrolled away) can't stay focused or armed.
    if (this.focus && !targets.some(t => t.id === this.focus)) this.clearFocus();
    if (this.armed && !targets.some(t => t.id === this.armed)) this.disarm();

    // Hand gone: an armed target is cancelled once the hand has been missing longer than the grace.
    if (!i.hand) {
      this.handMissingMs = continuous ? this.handMissingMs + step : PICKER.graceMs + 1;
      this.cursor = null;
      this.palmMs = 0; this.palmFired = false; this.fistSeen = false;
      if (this.handMissingMs > PICKER.graceMs) { this.clearFocus(); if (this.armed) this.disarm(); }
      this.hold.update(i.t, false, false); // no hand is not an observed release
      return out;
    }
    this.handMissingMs = 0;

    // ✊ (a fist without the thumb: the engine reports 👍 as a fist with thumbsUp) cancels the armed target and any 👍
    // progress, once per fist. A fist shorter than the existing focus grace is a transition (👆 → 👍 can pass through
    // one), not a cancel.
    if (i.pose === 'fist' && !i.thumbsUp) {
      this.fistMs = continuous ? this.fistMs + step : 0;
      if (this.fistMs > PICKER.graceMs) {
        if (!this.fistSeen && (this.armed || this.focus)) out.cancelled = true;
        this.fistSeen = true;
        this.clearFocus(); if (this.armed) this.disarm();
      }
    } else { this.fistMs = 0; this.fistSeen = false; }

    // ✋ held → home, once per palm.
    if (i.pose === 'palm') {
      this.palmMs = continuous ? this.palmMs + step : 0;
      if (!this.palmFired && this.palmMs >= HOME_HOLD_MS) {
        this.palmFired = true; out.home = true;
        this.clearFocus(); if (this.armed) this.disarm();
      }
    } else { this.palmMs = 0; this.palmFired = false; }

    // 👆 focus → dwell → armed.
    const px = i.pose === 'point' && i.pointer && Number.isFinite(i.pointer.x) && Number.isFinite(i.pointer.y)
      ? { x: i.pointer.x * view.width, y: i.pointer.y * view.height } : null;
    this.cursor = px;
    if (px) {
      const current = this.focus ? targets.find(t => t.id === this.focus) : undefined;
      if (!current || !inside(px, current.rect, STICKY_PAD)) {
        const hit = targets.find(t => inside(px, t.rect, HIT_PAD));
        if (hit) {
          if (hit.id !== this.focus) { this.clearFocus(); this.focus = hit.id; }
        } else if (current && continuous) {
          this.outside = true; this.outsideMs += gap;
          if (this.outsideMs >= PICKER.boundaryGraceMs) this.clearFocus();
        } else this.clearFocus();
      } else if (continuous) {
        if (!this.outside) this.focusMs += step; // the return observation can't add the excursion's time
        this.outside = false; this.outsideMs = 0;
      } else this.focusMs = 0;
      this.lostMs = 0;
      // Another target took the focus (held past the boundary grace, so jitter onto a neighbour doesn't count): the
      // armed one stands down. The new target must complete its own dwell before a fresh 👍 can confirm it.
      if (this.armed && this.focus && this.focus !== this.armed && !this.outside && this.focusMs >= PICKER.boundaryGraceMs) this.disarm();
      if (this.focus && !this.outside && this.focus !== this.armed && this.focusMs >= PICKER.selectMs) {
        // A new target is armed: a 👍 held for the previous one can't carry over.
        if (this.armed) this.disarm();
        this.armed = this.focus;
        this.hold.interrupt();
        if (this.lastHandThumb) this.hold.requireObservedRelease();
      }
    } else if (this.focus) {
      // The 👆 ended on another target (e.g. 👆 B → 👍): the armed one stands down even inside the boundary grace,
      // so the 👍 can't land on the target the user pointed away from.
      if (this.armed && this.focus !== this.armed && !this.outside) this.disarm();
      this.lostMs += step; this.focusMs = 0;
      if (!continuous || this.lostMs > PICKER.graceMs) this.clearFocus(); // the armed target stays: 👍 comes next
    }

    // 👍 held with a target armed: its action, exactly once until the 👍 is seen released.
    const present = this.armed !== null && i.thumbsUp;
    if (this.hold.update(i.t, present, !i.thumbsUp) && this.armed) {
      out.act = this.armed;
      this.hold.requireObservedRelease(); // the release must be seen: a hand leaving the frame is not one
    }
    return out;
  }
}
