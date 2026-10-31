// Immersive mode: after a few seconds without input (touch, mouse, keys or a
// hand gesture), the UI fades out so the sky has the whole screen; any input
// brings it back. Pure: the caller reports input and asks each frame.

export const IDLE_MS = 3000;

export interface IdleContext {
  /** Something must stay on screen: a mission HUD (Launch, Travel, Docking), an open panel or menu. */
  pinned: boolean;
}

export class IdleTracker {
  private lastInput: number;

  constructor(now: number, private readonly idleMs = IDLE_MS) {
    this.lastInput = now;
  }

  /** Any input at all. */
  input(now: number) {
    this.lastInput = now;
  }

  /** Whether the UI should be faded now. While pinned, the idle clock keeps restarting. */
  immersive(now: number, ctx: IdleContext): boolean {
    if (ctx.pinned) {
      this.lastInput = now;
      return false;
    }
    return now - this.lastInput >= this.idleMs;
  }
}
