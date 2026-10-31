import type { BuildKind } from './sim/buildRules';
// Every input source (keyboard, mouse, gestures) emits Intents.
// The scene and UI only ever react to Intents — never to raw input.

export type Intent =
  | { type: 'rotate'; dx: number; dy: number } // radians
  | { type: 'zoom'; factor: number } // >1 zooms out, <1 zooms in
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'nextMoon' } // M: planet → its moons → back
  | { type: 'select'; bodyId?: string } // no id → the focused body
  | { type: 'dismiss'; what?: 'info' } // Esc: the topmost panel; 'info': the info card itself (its ✕, a swipe)
  | { type: 'togglePause' }
  | { type: 'timeScale'; factor: number }
  | { type: 'timeDial'; delta: number } // 🤙 tilt: move the time slider by this much (−1 … 1 is the whole slider)
  | { type: 'setTimeSpeed'; position: number } // the time slider: −1 … 1, 0 = stopped
  | { type: 'reverseTime' }
  | { type: 'timeNow' }
  | { type: 'timeJump'; ms: number; rate?: number } // e.g. the comet's next visit, at a watchable speed
  | { type: 'toggleDebug' }
  | { type: 'toggleLanguage' }
  | { type: 'photo' } // hide the UI, snapshot the scene, save or share it
  | { type: 'toggleWatermark' }
  | { type: 'toggleTrueScale' } // T: real relative sizes, no overview boost
  | { type: 'sharePhoto' } // the last photo, via the system share sheet (phones)
  | { type: 'savePhoto' } // the last photo, as a download
  | { type: 'toggleWeightPanel'; open?: boolean } // no `open` = toggle
  | { type: 'setWeight'; kg: number | null } // null = cleared
  | { type: 'enterBase'; baseId?: string } // V: fly down to a base (no id: the focused body's)
  | { type: 'chooseDestination'; baseId: string } // where the rocket will go
  | { type: 'launch' } // start the countdown by itself (the button)
  | { type: 'countdown'; n: 3 | 2 | 1 } // the hand counting down: 3, 2, 1 fingers
  | { type: 'steer'; x: number; y: number } // docking: where to steer, −1 … 1 across the screen (y: down)
  | { type: 'toggleAutoLand' } // A: the rocket lands itself
  | { type: 'togglePassport'; open?: boolean } // J: the stamps for the bases you've visited
  | { type: 'cycleSteerSensitivity' } // S: how far the hand moves to steer a landing (low → normal → high)
  | { type: 'toggleHelp' } // ?: the keyboard shortcuts line (desktop)
  | { type: 'restartTracking' } // 🖐: start the camera and hand tracking again after a stop or failure
  | { type: 'togglePreview' } // C, or a tap on it: the camera preview, shown or tucked away
  | { type: 'toggleMenu'; open?: boolean } // ☰ on phones: the footer's settings
  | { type: 'toggleTimeBar'; open?: boolean } // compact screens: the time pill ⇄ the full time bar
  | { type: 'toggleHorizon' } // O at a showcase base: the horizon view, standing on the ground
  | { type: 'goldenHour' } // 🌅: to the next local sunset at this base, in the horizon view
  // Build mode (?flags=build): K in and out, the palette, grab / move / drop, turn, remove, undo / redo.
  | { type: 'toggleBuild' }
  | { type: 'buildPick'; kind: BuildKind }
  | { type: 'buildCursor'; x: number; y: number } // where you point on the screen, 0–1
  | { type: 'buildGrab' } // at the cursor: pick up the module there, or a new one of the chosen kind
  | { type: 'buildDrop' }
  | { type: 'buildTurn'; dir: 1 | -1 }
  | { type: 'buildDelete' }
  | { type: 'buildUndo' }
  | { type: 'buildRedo' }
  | { type: 'buildReset' }
  | { type: 'dismissBuildHint' }; // the first-time touch hint in Build mode: got it

type Listener = (intent: Intent) => void;

export function createIntentBus() {
  const listeners = new Set<Listener>();
  return {
    emit(intent: Intent) {
      for (const l of listeners) l(intent);
    },
    on(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type IntentBus = ReturnType<typeof createIntentBus>;
