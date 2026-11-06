// ?flags= features. Code that only a flagged feature uses loads only with its flag (v2.5): visitors
// never download it. Without the flag, a stand-in does what the real object does until that feature
// is used: nothing.
import * as THREE from 'three';
import type { MarsCinematicDirector } from '../scene/marsCinematicDirector';
import type { CinematicControls } from '../ui/cinematicControls';
import type { BuildPanel } from '../ui/buildPanel';
import type { BuildGrab } from '../gestures/buildGrab';

export const parseFlags = (search: string): ReadonlySet<string> =>
  new Set((new URLSearchParams(search).get('flags') ?? '').split(',').filter(Boolean));

/** Whether any flag needs code that is loaded lazily (operations needs none). */
export const needsFlaggedCode = (flags: ReadonlySet<string>) => flags.has('cinematic') || flags.has('build') || flags.has('astrolife');

/** The flagged modules (null for each flag that is off). The import() calls stay literal so Vite splits them. */
export const loadFlaggedCode = (flags: ReadonlySet<string>) => Promise.all([
  flags.has('cinematic') ? Promise.all([import('../scene/marsCinematicDirector'), import('../ui/cinematicControls')]) : null,
  flags.has('build') ? Promise.all([import('../ui/buildPanel'), import('../gestures/buildGrab')]) : null,
  flags.has('astrolife') ? import('../shell/shell') : null,
]);

export const NO_FLAGGED_CODE: Awaited<ReturnType<typeof loadFlaggedCode>> = [null, null, null];

export type Director = Pick<MarsCinematicDirector, 'active' | 'animating' | 'selected' | 'eye' | 'validate' | 'start' | 'update' | 'cancel' | 'dispose'>;
/** Never started, so never active: what the real director is without ?flags=cinematic. */
export const idleDirector: Director = {
  active: false, animating: false, selected: null, eye: new THREE.Vector3(),
  validate() {}, start: () => false, update: () => false, cancel() {}, dispose() {},
};

/** Without the flag the panel is never shown (cinematicAvailable), so it needn't exist. */
export const idleCinematicControls = (): Pick<CinematicControls, 'root' | 'render' | 'dispose'> =>
  ({ root: document.createElement('details'), render() {}, dispose() {} });

/** Without ?flags=build, Build mode can't start: its panel stays hidden and nothing is ever grabbed. */
export const idleBuildPanel: Pick<BuildPanel, 'render'> = { render() {} };
export const idleBuildGrab: Pick<BuildGrab, 'update' | 'reset'> = { update: () => [], reset() {} };
