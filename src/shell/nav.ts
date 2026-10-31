import type { Souvenir } from '../travel/souvenir';

// Where the AstroLife shell is (?flags=astrolife, decision 21): a stack of screens, the hub at the
// bottom. Pure, so it can be tested without a browser; shell.ts renders whatever is on top.

export type Screen =
  | { name: 'hub' }
  | { name: 'destinations' }
  | { name: 'destination'; id: string }
  | { name: 'passport' }
  /** Booking, in three steps: who, which departure and cabin, then check and confirm. */
  | { name: 'book'; step: 'traveller' | 'trip' | 'review' }
  /** A booking. `fresh`: it was just confirmed. */
  | { name: 'trip'; ref: string; fresh?: boolean }
  /** A souvenir boarding pass, opened from its link (travel/souvenir.ts): checked, never trusted further. */
  | { name: 'souvenir'; souvenir: Souvenir };

const HUB: Screen = { name: 'hub' };
const same = (a: Screen, b: Screen) => JSON.stringify(a) === JSON.stringify(b);

export class ShellNav {
  private stack: Screen[] = [HUB];

  get current(): Screen {
    return this.stack[this.stack.length - 1];
  }

  /** Opens a screen on top. The hub, or the screen already shown, doesn't stack again. */
  go(screen: Screen) {
    if (screen.name === 'hub') this.stack = [HUB];
    else if (!same(screen, this.current)) this.stack.push(screen);
  }

  /** Opens a screen with only the hub behind it: after a booking is confirmed, Back mustn't return to the confirm step. */
  start(screen: Screen) {
    this.stack = screen.name === 'hub' ? [HUB] : [HUB, screen];
  }

  /** Back one screen (Esc, ←). Returns false at the hub, which has nothing behind it. */
  back(): boolean {
    if (this.stack.length === 1) return false;
    this.stack.pop();
    return true;
  }
}
