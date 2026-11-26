// Jezero Dome — time presets (Day, Golden Hour, Night) and the reversible near-sunset preview. Pure: no DOM, no
// clock of its own. The times themselves come from timePresets.ts.
//
// Contract
// - A session starts with the first preset the user picks in Explore (Day, Golden Hour or Night), or when the base
//   panel's near-sunset action SUCCEEDED (the goldenHour intent got through and actually moved the simulation clock;
//   the caller compares clock.time before and after it). Unavailable sunset (the existing "no sunset" message), a
//   blocked intent or a base without a showcase start nothing.
// - The original simulation time is saved ONCE per session, with the base it belongs to. Further presets or
//   near-sunset jumps move the clock again but never overwrite it: Day → Golden Hour → Night → Restore returns to
//   exactly the time before the first one.
// - The ACTIVE preset is the one last applied, shown while the clock is still within PRESET_DRIFT_MS of the preset's
//   time (simulation time: running on at real time keeps the label for half an hour; a fast clock drops it sooner).
//   Restore stays offered for the whole session, whatever the active label says.
// - While a session is active the Explore time controls offer "Restore previous time". Restoring returns the clock to
//   the exact saved time and ends the session; it does not leave Explore (the horizon view stays open).
// - Presets and Restore only jump the clock (clock.jumpTo): camera pose, pause and playback speed are kept.
// - Stale restores are impossible: the session is discarded (nothing offered) when
//   · the user changes the time by hand: timeNow, timeJump (Now, date jumps, deep-link times, a resumed journey's time).
//     Speed, direction and pause (setTimeSpeed, timeScale, timeDial, reverseTime, togglePause) do NOT discard it:
//     they don't choose a different moment, and restore still means "the time before the first preset";
//   · Explore ends (the horizon view closes, by Return to orbit, Esc / O, or anything else) or the base changes.
//   A language change keeps it. It is never persisted, so a later session (reload) never sees a restore.

import type { TimePreset } from './timePresets';

export interface SunsetPreviewState {
  /** The simulation time (ms) before the first preset / near-sunset jump of this session. */
  original: number;
  /** The base the session belongs to. */
  baseId: string;
  /** The preset last applied, and the time it jumped to. */
  preset: TimePreset | null;
  presetTime: number | null;
}

/** Intents that pick a different moment by hand (they discard a session). Speed / pause changes are not among them. */
export const MANUAL_TIME_INTENTS: readonly string[] = ['timeNow', 'timeJump'];
/** The active-preset label holds while the clock is within this much simulation time of the preset's time. */
export const PRESET_DRIFT_MS = 30 * 60e3;

export class SunsetPreview {
  private current: SunsetPreviewState | null = null;

  get active() { return this.current !== null; }
  get state(): Readonly<SunsetPreviewState> | null { return this.current; }

  /** The preset to show as active at simulation time `now` (null: none, or the clock has drifted away from it). */
  activePreset(now: number): TimePreset | null {
    const c = this.current;
    if (!c || c.preset === null || c.presetTime === null) return null;
    return Math.abs(now - c.presetTime) <= PRESET_DRIFT_MS ? c.preset : null;
  }

  /**
   * A preset was applied: the clock went from `before` to `after`. Starts a session (saving `before` as the original)
   * unless one is already active at the same base, then records the preset as active.
   */
  presetApplied(preset: TimePreset, before: number, after: number, baseId: string | null): boolean {
    if (baseId === null) return this.active;
    if (this.current && this.current.baseId !== baseId) this.current = null;
    this.current ??= { original: before, baseId, preset: null, presetTime: null };
    this.current.preset = preset;
    this.current.presetTime = after;
    return true;
  }

  /**
   * A near-sunset action (the base panel's) finished. `before` / `after`: the simulation time just before and after it.
   * Starts a session when the clock moved (keeping the first original if one is already active at the same base) and
   * marks Golden Hour active. Returns whether a session is active afterwards.
   */
  sunsetApplied(before: number, after: number, baseId: string | null): boolean {
    if (baseId === null) return this.active;
    if (this.current && this.current.baseId !== baseId) this.current = null;
    if (after === before) return this.active; // nothing happened (no sunset soon, blocked): no new session
    return this.presetApplied('golden', before, after, baseId);
  }

  /** An intent was handled: a manual time change discards the session. */
  intent(type: string) {
    if (MANUAL_TIME_INTENTS.includes(type)) this.current = null;
  }

  /** Per frame: the session lives only while Explore (the horizon view) is open at its base. */
  sync(exploring: boolean, baseId: string | null) {
    if (this.current && (!exploring || baseId !== this.current.baseId)) this.current = null;
  }

  /** Restore: the time to jump back to (null when no session); ends the session. */
  restore(): number | null {
    const original = this.current?.original ?? null;
    this.current = null;
    return original;
  }

  discard() { this.current = null; }
}
