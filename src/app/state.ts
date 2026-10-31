import { readLevels } from './build';
import type { SteerSensitivity } from '../gestures/steer';
import type { Passport } from '../sim/passport';
import type { Body, Lang } from '../data/bodies';
import { autoStartTier, currentDevice, initialQualitySetting, type Quality, type QualitySetting } from '../quality';
import type { TrackingStatus } from '../ui/hud';
import { KEYS, readFlag, readPassport, readSensitivity, readWeight, storage } from './settings';

/** Everything the app shows that isn't the scene or the clock. Changed only by intent handling. */
export interface AppState {
  /** The tier in effect: the user's fixed choice, or what Auto picked. */
  quality: Quality;
  /** What the Quality button is set to (Auto picks Low or High per device). */
  qualitySetting: QualitySetting;
  /** Index into BODIES; 0 = the Sun (the overview). */
  focus: number;
  selected: Body | null;
  lang: Lang;
  status: TrackingStatus;
  watermark: boolean;
  trueScale: boolean;
  /** Docking: the rocket lands itself (accessibility). */
  autoLand: boolean;
  /** Bases visited (first-visit dates). */
  passport: Passport;
  passportOpen: boolean;
  /** Landing: how far the hand moves to steer. */
  steerSensitivity: SteerSensitivity;
  /** Desktop: the keyboard shortcuts line, behind the ? button. */
  helpOpen: boolean;
  /** The camera preview tucked away (a tap brings it back). */
  previewHidden: boolean;
  /** Phones: the ☰ footer menu. */
  menuOpen: boolean;
  /** Compact screens: the full time bar instead of the pill. */
  timeBarOpen: boolean;
  /** Base levels earned by building (kept once earned). */
  baseLevels: Record<string, 1 | 2 | 3>;
  /** The first-time touch hint in Build mode has been dismissed. */
  buildHintSeen: boolean;
  weightKg: number | null;
  weightOpen: boolean;
}

export function createState(): AppState {
  const device = currentDevice();
  const qualitySetting = initialQualitySetting(device, storage);
  return {
    // Auto: Low on phones/tablets, High elsewhere, until main's AutoTier applies what this device learned.
    quality: qualitySetting === 'auto' ? autoStartTier(device) : qualitySetting,
    qualitySetting,
    focus: 0,
    selected: null,
    lang: 'en',
    status: { kind: 'loading', progress: 0 },
    watermark: readFlag(KEYS.watermark, true),
    trueScale: readFlag(KEYS.trueScale, false),
    autoLand: readFlag(KEYS.autoLand, false),
    passport: readPassport(),
    passportOpen: false,
    steerSensitivity: readSensitivity(),
    helpOpen: readFlag(KEYS.help, false),
    previewHidden: readFlag(KEYS.previewHidden, false),
    menuOpen: false,
    timeBarOpen: false,
    baseLevels: readLevels(),
    buildHintSeen: readFlag(KEYS.buildHint, false),
    weightKg: readWeight(),
    weightOpen: false,
  };
}
