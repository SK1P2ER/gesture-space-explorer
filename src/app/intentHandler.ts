import type { Build } from './build';
import { SENSITIVITY_ORDER } from '../gestures/steer';
import { BODIES, LANGS } from '../data/bodies';
import type { Intent } from '../intents';
import { nextInSystem, step } from '../navigation';
import type { CameraRig } from '../scene/cameraRig';
import type { SimClock } from '../sim/clock';
import type { DebugOverlay } from '../ui/debugOverlay';
import type { GestureHud } from '../ui/gestureHud';
import { tf } from '../ui/i18n';
import type { Mission } from './mission';
import type { ModeMachine } from './modes';
import type { PhotoFlow } from './photoFlow';
import { KEYS, writeFlag, writeWeight, writeSensitivity } from './settings';
import type { AppState } from './state';

export interface HandlerDeps {
  /** Temporary camera ownership: consume cancellation or release before Mission acts. */
  beforeMission?: (intent: Intent) => boolean;
  state: AppState;
  modes: ModeMachine;
  rig: CameraRig;
  clock: SimClock;
  overlay: DebugOverlay;
  gestureHud: GestureHud;
  photo: PhotoFlow;
  mission: Mission;
  build: Build;
  /** Focus a body (flies the camera there and sets the mode). */
  setFocus: (index: number) => void;
}

/** What each Intent does, in the current mode. Intents the mode doesn't accept are ignored. */
export function createIntentHandler({ state, modes, rig, clock, overlay, gestureHud, photo, mission, build, setFocus, beforeMission }: HandlerDeps) {
  return (intent: Intent) => {
    if (!modes.accepts(intent)) return;
    if (beforeMission?.(intent)) return;
    if (mission.handle(intent)) return; // what bases, rockets and landings make of it
    if (build.handle(intent)) return; // and base building
    switch (intent.type) {
      case 'rotate': rig.rotate(intent.dx, intent.dy); break;
      case 'zoom': rig.zoom(intent.factor); break;
      case 'next': setFocus(step(BODIES, state.focus, 1)); break;
      case 'prev': setFocus(step(BODIES, state.focus, -1)); break;
      case 'nextMoon': {
        const target = nextInSystem(BODIES, state.focus);
        if (target === null) gestureHud.flash(tf('noMoons', state.lang, { name: BODIES[state.focus].name[state.lang] }));
        else setFocus(target);
        break;
      }
      case 'select': {
        const index = intent.bodyId ? BODIES.findIndex((b) => b.id === intent.bodyId) : state.focus;
        if (index < 0) break;
        if (index !== state.focus) setFocus(index);
        state.selected = BODIES[index];
        break;
      }
      case 'dismiss':
        // Esc closes the weight panel first, then the info card; the card's own ✕ (or a swipe) just the card.
        if (state.menuOpen && intent.what !== 'info') state.menuOpen = false;
        else if (state.passportOpen && intent.what !== 'info') state.passportOpen = false;
        else if (state.weightOpen && intent.what !== 'info') state.weightOpen = false;
        else state.selected = null;
        break;
      case 'togglePause': clock.togglePause(); break;
      case 'timeScale': clock.scale(intent.factor); break;
      case 'timeDial': clock.nudge(intent.delta); break;
      case 'setTimeSpeed': clock.setPosition(intent.position); break;
      case 'reverseTime': clock.reverse(); break;
      case 'timeNow': clock.jumpTo(Date.now()); break;
      case 'timeJump':
        clock.jumpTo(intent.ms);
        if (intent.rate !== undefined) clock.setRate(intent.rate);
        break;
      case 'toggleDebug': overlay.setDebug(!overlay.enabled); break;
      case 'toggleLanguage': state.lang = LANGS[(LANGS.indexOf(state.lang) + 1) % LANGS.length]; break;
      case 'photo': photo.take(); break;
      case 'toggleWatermark':
        state.watermark = !state.watermark;
        writeFlag(KEYS.watermark, state.watermark);
        break;
      case 'toggleTrueScale':
        state.trueScale = !state.trueScale;
        writeFlag(KEYS.trueScale, state.trueScale);
        break;
      case 'toggleAutoLand':
        state.autoLand = !state.autoLand;
        writeFlag(KEYS.autoLand, state.autoLand);
        break;
      case 'sharePhoto': photo.share(); break;
      case 'savePhoto': photo.save(); break;
      case 'toggleWeightPanel': state.weightOpen = intent.open ?? !state.weightOpen; break;
      case 'cycleSteerSensitivity': {
        const i = SENSITIVITY_ORDER.indexOf(state.steerSensitivity);
        state.steerSensitivity = SENSITIVITY_ORDER[(i + 1) % SENSITIVITY_ORDER.length];
        writeSensitivity(state.steerSensitivity);
        break;
      }
      case 'toggleHelp':
        state.helpOpen = !state.helpOpen;
        writeFlag(KEYS.help, state.helpOpen);
        break;
      case 'togglePreview':
        state.previewHidden = !state.previewHidden;
        writeFlag(KEYS.previewHidden, state.previewHidden);
        break;
      case 'toggleMenu': state.menuOpen = intent.open ?? !state.menuOpen; break;
      case 'toggleTimeBar': state.timeBarOpen = intent.open ?? !state.timeBarOpen; break;
      case 'togglePassport': state.passportOpen = intent.open ?? !state.passportOpen; break;
      case 'setWeight':
        state.weightKg = intent.kg;
        writeWeight(intent.kg);
        break;
      case 'enterBase': break; // the mission handles it where there's a base
      case 'toggleHorizon': case 'goldenHour': break; // the mission handles them at a showcase base
      case 'toggleBuild': case 'buildPick': case 'buildCursor': case 'buildGrab': case 'buildDrop':
      case 'buildTurn': case 'buildDelete': case 'buildUndo': case 'buildRedo': case 'buildReset':
        break; // Build mode (app/build.ts)
      case 'dismissBuildHint':
        state.buildHintSeen = true;
        writeFlag(KEYS.buildHint, true);
        break;
    }
  };
}
