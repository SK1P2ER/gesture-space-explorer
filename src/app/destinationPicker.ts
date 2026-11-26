// Opt-in 3D destination picker (?flags=picker3d): the input logic only. No DOM, no THREE: the view supplies the
// on-screen targets, main.ts supplies the engine's stable pose and pointer per detection and applies the outcome
// through the app's existing actions (chooseDestination / launch, or Guided's own choose and confirm).
//
// Mapping inside the picker: 👆 (the engine's stable 'point' pose and its pointer) focuses a destination, and a
// briefly stable focus selects it (a preview: it never confirms or launches). ✋ does not select. 👍 held confirms,
// through Guided's HoldConfirm (same 500 ms, release requirement and gap rule); in Guided, Guided confirms itself.
import { BASES } from '../data/bases';
import type { Pose, Vec2 } from '../gestures/perception';
import type { Intent } from '../intents';
import { HoldConfirm } from './guidedSession';

export const PICKER = {
  /** Observed 👆 time on one target before it is selected. */
  selectMs: 450,
  /** Two observations further apart than this are not continuous (as HoldConfirm and the countdown). */
  maxGapMs: 250,
  /** One observation adds at most this much focus time. */
  stepCapMs: 100,
  /** A focus survives this much observed time without a usable 👆 (jitter, a missed frame). */
  graceMs: 200,
  /** A brief coordinate excursion outside every target pauses dwell; it never earns selection time. */
  boundaryGraceMs: 120,
  /** Ignore small cursor movement in CSS pixels, while keeping deliberate moves responsive. */
  pointerDeadZonePx: 4,
  pointerDirectPx: 20,
  /** Keep feedback through a brief missed detection without counting its time toward selection. */
  pointerGraceMs: 140,
  /** Room under each target for its label button. */
  labelPx: 48,
  minRadiusPx: 20,
  maxRadiusPx: 36,
  /** Forgiving pick radius around a target (never under 44 px, the touch-target minimum). */
  hitPx: (r: number) => Math.max(r * 1.5, 44),
  /** The current focus is kept while the 👆 stays this close: neighbours don't steal it on jitter. */
  stickyPx: (r: number) => Math.max(r * 2.2, 66),
  /** The selected (or confirming) planet is drawn this much larger. Visual only: hit targets are the layout's. */
  selectedScale: 1.12,
  /** Seconds the emphasis takes to grow or shrink (none under reduced motion). */
  emphasisSeconds: 0.16,
};

/** The drawn scale of a planet this frame, easing toward 1 or PICKER.selectedScale; never an input of the hit targets. */
export function orbDrawScale(selected: boolean, current: number, dt: number, reducedMotion: boolean) {
  const target = selected ? PICKER.selectedScale : 1;
  if (reducedMotion) return target;
  const step = (dt / PICKER.emphasisSeconds) * (PICKER.selectedScale - 1);
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step);
}

export interface PickerTarget { baseId: string; x: number; y: number; r: number }
export interface PickerInput {
  t: number;
  /** The engine's stable pose (not the raw one). */
  pose: Pose | null;
  /** The engine's pointer, normalized to the screen (set only for 👆). */
  pointer: { x: number; y: number } | null;
  thumbsUp: boolean;
  /** A controlling hand was observed in this detection. */
  hand: boolean;
}
export interface PickerContext {
  /** The flag is on and the picker owns destination input now (base view, no pending offer, not mid-launch). */
  active: boolean;
  /** The destination the mission (or Guided) currently has selected: the source of truth, never kept here. */
  selected: string | null;
  /** Outside Guided the picker's 👍 hold confirms; in Guided, Guided's own 👍 does. */
  confirmByGesture: boolean;
}
export interface PickerAction { select?: string; confirm?: true }

/**
 * Outside Guided: the picker's outcome as the app's existing intents, exactly what a destination button
 * (chooseDestination) and the Launch button (launch) send. The mission, and any gate in front of it, decides.
 */
export function pickerIntents(a: PickerAction): Intent[] {
  const out: Intent[] = [];
  if (a.select) out.push({ type: 'chooseDestination', baseId: a.select });
  if (a.confirm) out.push({ type: 'launch' });
  return out;
}

/** Every destination the picker can show from a base, one object per base, identified by base id. */
export function pickerDestinations(currentBaseId: string | null) {
  return BASES.filter((b) => b.id !== currentBaseId).map((b) => ({ baseId: b.id, bodyId: b.body }));
}

/** Targets in one row (or two) inside the free band; null when the band cannot hold them legibly. */
export function layoutTargets(baseIds: readonly string[], band: { left: number; top: number; right: number; bottom: number }): PickerTarget[] | null {
  const width = band.right - band.left, height = band.bottom - band.top;
  for (const rows of [1, 2]) {
    const cols = Math.ceil(baseIds.length / rows);
    const slot = width / cols, rowH = height / rows;
    // Room for the halo ring too (1.15 r), so it never reaches past the band.
    const r = Math.min(PICKER.maxRadiusPx, slot / 3, ((rowH - PICKER.labelPx) / 2 - 4) / 1.15);
    if (r < PICKER.minRadiusPx || slot < 2 * PICKER.hitPx(r) || (rows > 1 && rowH < 2 * PICKER.hitPx(r))) continue;
    return baseIds.map((baseId, i) => {
      const row = Math.floor(i / cols), col = i % cols;
      const inRow = Math.min(cols, baseIds.length - row * cols);
      const offset = (width - inRow * slot) / 2; // centre a short last row
      return { baseId, x: band.left + offset + slot * (col + 0.5), y: band.top + rowH * row + (rowH - PICKER.labelPx) / 2, r };
    });
  }
  return null;
}

export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * The picker's whole layout in one free band of the page: the card (selected destination, Confirm, All destinations)
 * always gets a place; the orbs take the room above it (portrait) or beside it (a short landscape band). The band that
 * gives the largest orbs wins (ties: the larger band). With no room for orbs the card still shows (the list remains).
 */
export function layoutPicker(ids: readonly string[], bands: readonly Rect[], card: { width: number; minWidth: number; height: number; preferBottom?: boolean }): { targets: PickerTarget[]; card: Rect } | null {
  const area = (r: Rect) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  // Candidate card slots: the bottom of a band, or its right-hand side.
  const slots: (Rect & { bottomSlot: boolean })[] = [];
  for (const b of bands) {
    const w = b.right - b.left, h = b.bottom - b.top;
    if (w < card.minWidth || h < 60) continue;
    const cw = Math.min(card.width, w), ch = Math.min(card.height, h);
    slots.push({ left: b.left + (w - cw) / 2, right: b.left + (w + cw) / 2, top: b.bottom - ch, bottom: b.bottom, bottomSlot: true });
    const sw = Math.min(card.width, Math.max(card.minWidth, w / 2));
    if (w - sw >= 120) slots.push({ left: b.right - sw, right: b.right, top: b.top + (h - ch) / 2, bottom: b.top + (h + ch) / 2, bottomSlot: false });
  }
  let best: { targets: PickerTarget[]; card: Rect; score: number; fits: boolean } | null = null;
  for (const { bottomSlot, ...slot } of slots) {
    const fits = slot.bottom - slot.top >= card.height - 0.5;
    // The orbs go into what is left of every band once the card's slot (and a margin) is taken out.
    const c = { left: slot.left - 8, top: slot.top - 8, right: slot.right + 8, bottom: slot.bottom + 8 };
    let targets: PickerTarget[] = [], room = 0;
    for (const b of bands) {
      const pieces = c.right <= b.left || c.left >= b.right || c.bottom <= b.top || c.top >= b.bottom ? [b]
        : [{ ...b, bottom: c.top }, { ...b, top: c.bottom }, { ...b, right: c.left }, { ...b, left: c.right }];
      for (const p of pieces) {
        const t = layoutTargets(ids, p);
        if (t && (t[0].r > (targets[0]?.r ?? 0) || (t[0].r === targets[0]?.r && area(p) > room))) { targets = t; room = area(p); }
      }
    }
    // A full-height card first, then the largest orbs, then the card closest to them (it reads as their card).
    let gap = 0;
    if (targets.length) {
      const box = { left: Math.min(...targets.map((t) => t.x - t.r)), right: Math.max(...targets.map((t) => t.x + t.r)), top: Math.min(...targets.map((t) => t.y - t.r)), bottom: Math.max(...targets.map((t) => t.y + t.r + PICKER.labelPx)) };
      gap = Math.max(0, slot.top - box.bottom, box.top - slot.bottom) + Math.max(0, slot.left - box.right, box.left - slot.right);
    }
    // The screen flow's card sits in one stable place, the bottom of the free area, when it fits there with the orbs
    // (after a whole card, before larger orbs).
    const stable = card.preferBottom && bottomSlot && targets.length > 0 ? 5e5 : 0;
    const score = (fits ? 1e6 : 0) + stable + (targets[0]?.r ?? 0) * 1e3 - gap + room / 1e7;
    if (!best || score > best.score) best = { targets, card: slot, score, fits };
  }
  return best ? { targets: best.targets, card: best.card } : null;
}

/** What an orb shows: the body's own texture once the app has it (a loaded image, or its procedural fallback after a failed load); until then a body-specific fallback. */
export function orbLook(baseState: 'loading' | 'ready' | 'fallback'): 'texture' | 'fallback' {
  return baseState === 'loading' ? 'fallback' : 'texture';
}

/**
 * A sphere off the axis of a perspective view projects stretched along the radial direction by 1/cos θ. Squeezing it
 * by cos θ along the axis that is perpendicular to the view ray, in the radial plane, keeps it round on screen.
 * Input: the sphere's centre in camera space (looking down −z). Output: that axis (camera space, unit) and the scale.
 */
export function ellipseCompensation(x: number, y: number, z: number): { axis: [number, number, number]; scale: number } {
  const len = Math.hypot(x, y, z) || 1;
  const d = [x / len, y / len, z / len];
  const cos = Math.min(1, Math.max(0, -d[2]));
  const rl = Math.hypot(x, y);
  if (rl < 1e-9) return { axis: [1, 0, 0], scale: 1 };
  const e = [x / rl, y / rl, 0];
  const ed = e[0] * d[0] + e[1] * d[1];
  const t = [e[0] - ed * d[0], e[1] - ed * d[1], -ed * d[2]];
  const tl = Math.hypot(t[0], t[1], t[2]) || 1;
  return { axis: [t[0] / tl, t[1] / tl, t[2] / tl], scale: cos };
}

export class DestinationPicker {
  hover: string | null = null;
  private focusMs = 0;
  private lostMs = 0;
  private outsideMs = 0;
  private outside = false;
  private fired = false;
  private lastT: number | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private pointerSample: { position: Vec2; t: number } | null = null;
  private readonly hold = new HoldConfirm();
  /** The last detection showed a 👍 (what the "release first" message and the hold fill are about). */
  private thumbSeen = false;
  /** The selection the last active detection saw (undefined: none seen yet). */
  private lastSelected: string | null | undefined = undefined;
  /** The last hand seen showed 👍 (kept through dropouts, standing down and camera stops: it may still be up). */
  private lastHandThumb = false;

  get focusProgress() { return this.hover ? Math.min(1, this.focusMs / PICKER.selectMs) : 0; }
  /** The 👍 hold toward the current action (0 while a release is owed: that 👍 is not making progress). */
  get confirmProgress() { return this.hold.waitingRelease ? 0 : this.hold.progress; }
  /** A 👍 is up and owes a release (a hold that already confirmed, or one carried over a screen change). */
  get waitingRelease() { return this.hold.waitingRelease && this.thumbSeen; }

  /** Normalized position shared by the picker HUD and its hit testing. */
  cursorAt(now: number, width: number, height: number): Vec2 | null {
    const sample = this.pointerSample;
    if (!sample || width !== this.viewportWidth || height !== this.viewportHeight || now - sample.t > PICKER.pointerGraceMs) return null;
    return { x: sample.position.x / width, y: sample.position.y / height };
  }

  /**
   * The destination flow changed screen: the focus restarts, and a 👍 held across the change owes a release before it
   * can complete the next screen's action. Not tied to any animation or timer: a tap or reduced motion change nothing.
   */
  screenChanged() { this.clearFocus(); this.pointerSample = null; this.lastT = null; this.hold.requireRelease(); }

  /** Forget everything, including a 👍 still owed a release (a new page state that owes nothing). */
  reset() { this.clearFocus(); this.pointerSample = null; this.lastT = null; this.hold.reset(); this.lastSelected = undefined; this.lastHandThumb = false; }
  /**
   * Not the picker's turn now (a launch it confirmed, another mode, a pending offer): no focus, no progress. A 👍 that
   * already confirmed stays owed a release, so coming back while it is still held confirms nothing.
   */
  standDown() { this.clearFocus(); this.pointerSample = null; this.lastT = null; this.hold.interrupt(); this.thumbSeen = false; }
  /** The camera stopped or the hand was lost for good: progress is cancelled; a 👍 still owed a release stays owed. */
  trackingLost() { this.standDown(); }

  private clearFocus() { this.hover = null; this.focusMs = 0; this.lostMs = 0; this.outsideMs = 0; this.outside = false; this.fired = false; }
  /**
   * Another destination is selected. If the last hand seen showed 👍, that 👍 may still be up and was for the previous
   * one: it owes a release that must be seen (the hand without 👍; no hand seen is not one), then a full hold.
   */
  private selectionChanged() { this.hold.interrupt(); if (this.lastHandThumb) this.hold.requireObservedRelease(); }

  private observePointer(i: PickerInput): Vec2 | null {
    const previous = this.pointerSample;
    const recent = previous && i.t >= previous.t && i.t - previous.t <= PICKER.pointerGraceMs;
    if (!i.hand) {
      if (!recent) this.pointerSample = null;
      return null;
    }
    if (i.pose !== 'point' || !i.pointer || !Number.isFinite(i.pointer.x) || !Number.isFinite(i.pointer.y)) {
      this.pointerSample = null;
      return null;
    }

    const raw = { x: i.pointer.x * this.viewportWidth, y: i.pointer.y * this.viewportHeight };
    let position = raw;
    if (recent) {
      const dx = raw.x - previous.position.x;
      const dy = raw.y - previous.position.y;
      const distance = Math.hypot(dx, dy);
      const blend = Math.max(0, Math.min(1, (distance - PICKER.pointerDeadZonePx) / (PICKER.pointerDirectPx - PICKER.pointerDeadZonePx)));
      position = { x: previous.position.x + dx * blend, y: previous.position.y + dy * blend };
    }
    this.pointerSample = { position, t: i.t };
    return position;
  }

  /** One detection. Returns what to do: select a destination (a preview) and/or confirm the selected one. */
  observe(i: PickerInput, targets: readonly PickerTarget[], view: { width: number; height: number }, ctx: PickerContext): PickerAction {
    if (!ctx.active) { this.standDown(); return {}; }
    if (view.width !== this.viewportWidth || view.height !== this.viewportHeight) {
      this.viewportWidth = view.width;
      this.viewportHeight = view.height;
      this.pointerSample = null;
      this.clearFocus();
    }
    // Every way of choosing (a tap, a key, the list, 👆) ends in ctx.selected, read here before any 👍 counts: a change
    // since the last detection, by whatever route, is never completed by the 👍 held for the previous destination.
    // The same destination chosen again is no change.
    if (this.lastSelected !== undefined && ctx.selected !== this.lastSelected) this.selectionChanged();
    this.lastSelected = ctx.selected;
    this.thumbSeen = i.hand && i.thumbsUp;
    if (i.hand) this.lastHandThumb = i.thumbsUp;
    const gap = this.lastT === null ? 0 : i.t - this.lastT;
    this.lastT = i.t;
    const continuous = gap >= 0 && gap <= PICKER.maxGapMs;
    const step = continuous ? Math.min(gap, PICKER.stepCapMs) : 0;
    const out: PickerAction = {};

    // Focus: 👆 only. Any other pose, or no pointer, is "no usable pointer" (✋ never focuses or selects).
    const px = this.observePointer(i);
    if (px) {
      const dist = (t: PickerTarget) => Math.hypot(px.x - t.x, px.y - t.y);
      const current = this.hover ? targets.find((t) => t.baseId === this.hover) : undefined;
      if (!current || dist(current) > PICKER.stickyPx(current.r)) {
        let best: PickerTarget | null = null;
        for (const t of targets) if (dist(t) <= PICKER.hitPx(t.r) && (!best || dist(t) < dist(best))) best = t;
        if (best) {
          if (best.baseId !== this.hover) { this.clearFocus(); this.hover = best.baseId; }
        } else if (current && continuous) {
          this.outside = true;
          this.outsideMs += gap;
          if (this.outsideMs >= PICKER.boundaryGraceMs) this.clearFocus();
        } else this.clearFocus();
      } else if (continuous) {
        // The return observation spans an excursion or a missed detection, so it earns no dwell time.
        if (!this.outside) this.focusMs += step;
        this.outside = false; this.outsideMs = 0;
      }
      else this.focusMs = 0; // a gap is not focus time: start again on this observation
      this.lostMs = 0;
      if (this.hover && !this.outside && !this.fired && this.focusMs >= PICKER.selectMs) {
        this.fired = true; // once per focus: it re-arms when the focus changes
        if (ctx.selected !== this.hover) out.select = this.hover;
      }
    } else if (this.hover) {
      this.outside = true;
      this.lostMs += step;
      this.focusMs = 0;
      if (!continuous || this.lostMs > PICKER.graceMs) this.clearFocus();
    }

    // A 👆 selection made by this detection is a change too: the same detection's 👍 cannot confirm what it selects.
    if (out.select) { this.selectionChanged(); this.lastSelected = out.select; }

    // Confirmation: a 👍 hold with a destination selected, outside Guided only.
    const present = ctx.confirmByGesture && ctx.selected !== null && i.hand && i.thumbsUp;
    if (this.hold.update(i.t, present, i.hand && !i.thumbsUp)) {
      this.hold.requireObservedRelease();
      out.confirm = true;
    }
    return out;
  }
}
