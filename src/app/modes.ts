import type { Intent } from '../intents';

// The app's modes and how it moves between them. Intents are interpreted per
// mode: each mode accepts a set of intent types and ignores the rest. Pure, so
// transitions can be tested without a browser.
//
//   SolarView ⇄ Focus → BaseView → Launch → Travel → Docking → BaseView
//
// Until bases exist (v2.0 step 1), only SolarView (the Sun, the overview) and
// Focus (any other body) are reachable, and both accept every intent.

export type Mode = 'solarView' | 'focus' | 'baseView' | 'launch' | 'travel' | 'docking' | 'build';

/** Where each mode may go next. */
export const TRANSITIONS: Record<Mode, readonly Mode[]> = {
  solarView: ['focus'],
  focus: ['solarView', 'focus', 'baseView'],
  baseView: ['focus', 'solarView', 'launch', 'build'],
  launch: ['travel', 'baseView'], // lift-off, or abort during the countdown
  travel: ['docking'],
  docking: ['baseView'], // landed (by hand or auto-land)
  build: ['baseView'], // done building (?flags=build)
};

export const INTENT_TYPES = [
  'rotate', 'zoom', 'next', 'prev', 'nextMoon', 'select', 'dismiss',
  'togglePause', 'timeScale', 'timeDial', 'setTimeSpeed', 'reverseTime', 'timeNow', 'timeJump',
  'toggleDebug', 'toggleLanguage', 'photo', 'toggleWatermark', 'toggleTrueScale', 'sharePhoto', 'savePhoto',
  'toggleWeightPanel', 'setWeight', 'enterBase', 'chooseDestination', 'launch', 'countdown', 'steer', 'toggleAutoLand', 'togglePassport', 'cycleSteerSensitivity',
  'toggleHelp', 'togglePreview', 'restartTracking', 'toggleMenu', 'toggleTimeBar', 'toggleHorizon', 'goldenHour',
  'toggleBuild', 'buildPick', 'buildCursor', 'buildGrab', 'buildDrop', 'buildTurn', 'buildDelete', 'buildUndo', 'buildRedo', 'buildReset', 'dismissBuildHint',
] as const satisfies readonly Intent['type'][];

// Every intent type is listed above (a compile error otherwise).
type Unlisted = Exclude<Intent['type'], (typeof INTENT_TYPES)[number]>;
const allListed: [Unlisted] extends [never] ? true : false = true;
void allListed;

type IntentType = Intent['type'];

/** Settings, panels, photos and time: fine in any mode. */
const ANYWHERE: readonly IntentType[] = [
  'togglePause', 'timeScale', 'timeDial', 'setTimeSpeed', 'reverseTime', 'timeNow',
  'toggleDebug', 'toggleLanguage', 'photo', 'toggleWatermark', 'toggleTrueScale', 'sharePhoto', 'savePhoto',
  'toggleWeightPanel', 'setWeight', 'dismiss', 'toggleAutoLand', 'togglePassport', 'cycleSteerSensitivity',
  'toggleHelp', 'togglePreview', 'restartTracking', 'toggleMenu', 'toggleTimeBar',
];

/** What each mode responds to. Navigation is off while a rocket is on its way. */
export const ACCEPTS: Record<Mode, ReadonlySet<IntentType>> = {
  solarView: new Set(INTENT_TYPES),
  focus: new Set(INTENT_TYPES),
  // ← → pick the destination, Enter (select) launches, pointing at a body flies to its base.
  baseView: new Set([...ANYWHERE, 'rotate', 'zoom', 'next', 'prev', 'nextMoon', 'select', 'enterBase', 'chooseDestination', 'launch', 'countdown', 'toggleHorizon', 'goldenHour', 'toggleBuild']),
  launch: new Set([...ANYWHERE, 'rotate', 'zoom', 'countdown']),
  // Enter (select) skips ahead to the approach.
  travel: new Set([...ANYWHERE, 'select']),
  // Hand, mouse, or the arrow keys (next/prev/zoom) steer; Enter (select) hands over to auto-land.
  // ✌️ swipes (next/prev) and ← → choose from the palette; the pinch grabs (buildGrab), it doesn't zoom.
  build: new Set([
    ...ANYWHERE, 'rotate', 'zoom', 'next', 'prev', 'select', 'toggleBuild',
    'buildPick', 'buildCursor', 'buildGrab', 'buildDrop', 'buildTurn', 'buildDelete', 'buildUndo', 'buildRedo', 'buildReset', 'dismissBuildHint',
  ]),
  docking: new Set([
    ...ANYWHERE.filter((t) => !t.startsWith('time') && t !== 'togglePause' && t !== 'reverseTime' && t !== 'setTimeSpeed'),
    'steer', 'next', 'prev', 'zoom', 'select',
  ]),
};

/** Looking at the Sun is the overview; anything else is Focus. */
export const modeForFocus = (bodyIndex: number): Mode => (bodyIndex === 0 ? 'solarView' : 'focus');

export class ModeMachine {
  private current: Mode = 'solarView';
  private readonly listeners = new Set<(to: Mode, from: Mode) => void>();

  get mode() {
    return this.current;
  }

  canGo(to: Mode) {
    return to === this.current || TRANSITIONS[this.current].includes(to);
  }

  /** Moves to `to` if allowed; returns whether it did. Staying put is always allowed. */
  go(to: Mode): boolean {
    if (to === this.current) return true;
    if (!TRANSITIONS[this.current].includes(to)) return false;
    const from = this.current;
    this.current = to;
    for (const l of this.listeners) l(to, from);
    return true;
  }

  accepts(intent: Intent) {
    return ACCEPTS[this.current].has(intent.type);
  }

  onChange(listener: (to: Mode, from: Mode) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
