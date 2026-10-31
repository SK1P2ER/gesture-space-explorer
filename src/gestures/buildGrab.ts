import type { Intent } from '../intents';
import type { Vec2 } from './perception';

// Build mode (v2.1): pinch and hold to grab a module (or take a new one from the
// palette) where you pinch, move with the pinch held, open the fingers to put it
// down. A layer on top of the gesture engine's observation; the engine itself is
// unchanged. Its pinch-to-zoom is ignored in Build mode (main.ts), so the two
// can't both act on one pinch.

export const BUILD_GRAB = {
  /** Hold the pinch this long before it grabs: a pinch made in passing does nothing. */
  holdMs: 300,
  /** A pinch lost for less than this (tracking flicker) doesn't drop what you hold. */
  dropAfterMs: 120,
};

export class BuildGrab {
  private since: number | null = null;
  private holding = false;
  private lostAt: number | null = null;

  /**
   * @param t frame time, ms
   * @param pinch where the pinch is (screen, 0–1, mirrored like the preview), or null when not pinching
   */
  update(t: number, pinch: Vec2 | null): Intent[] {
    if (!pinch) {
      if (!this.holding) {
        this.since = null;
        return [];
      }
      this.lostAt ??= t;
      if (t - this.lostAt < BUILD_GRAB.dropAfterMs) return [];
      this.reset();
      return [{ type: 'buildDrop' }];
    }
    this.lostAt = null;
    if (this.holding) return [{ type: 'buildCursor', x: pinch.x, y: pinch.y }];
    this.since ??= t;
    if (t - this.since < BUILD_GRAB.holdMs) return [];
    this.holding = true;
    return [{ type: 'buildCursor', x: pinch.x, y: pinch.y }, { type: 'buildGrab' }];
  }

  reset() {
    this.since = null;
    this.holding = false;
    this.lostAt = null;
  }
}
