// Wiring and the frame loop. What the app does lives in src/app/: the mode
// machine (modes.ts), intent handling (intentHandler.ts), photos, tracking,
// debug tools, settings and the phone info sheet.
import * as THREE from 'three';
import { createIntentHandler } from './app/intentHandler';
import { Mission } from './app/mission';
import { setupDebugTools } from './app/debugTools';
import { setupInfoSheet } from './app/infoSheet';
import { modeForFocus, ModeMachine } from './app/modes';
import { PhotoFlow } from './app/photoFlow';
import { createState } from './app/state';
import { resetIfAsked, storage } from './app/settings';
import { startTracking, type TrackingDeps, type TrackingSession } from './app/tracking';
import { attachPageLifecycle } from './app/pageLifecycle';
import { runFrame, type FramePhases } from './app/frameLoop';
import { boardClock, journeyOngoing, restoreClock, type Journey, type SavedTime } from './app/journey';
import { config } from './config';
import { BODIES, reachFactor } from './data/bodies';
import { BASES, baseById } from './data/bases';
import { GestureEngine } from './gestures/engine';
import { ExtraGestures } from './gestures/extras';
import { attachKeyboardAndMouse } from './input/keyboard';
import { steerFromPalm } from './gestures/steer';
import { createIntentBus, type Intent } from './intents';
import { pickable } from './navigation';
import {
  AutoTier, autoStartTier, currentDevice, isMobile, nextQualitySetting, PROFILES, readAutoMemory, renderPixelRatio,
  ResolutionGovernor, saveQuality, UltraGuard, writeAutoMemory, type Quality, type QualitySetting,
} from './quality';
import { CameraRig } from './scene/cameraRig';
import type { CinematicContext, CinematicRequest, MarsCinematicDirector } from './scene/marsCinematicDirector';
import type { CinematicControls } from './ui/cinematicControls';
import { pickBody } from './scene/picking';
import { ScenePipeline } from './scene/postprocessing';
import { SolarSystem } from './scene/solarSystem';
import { MAX_TIME, MIN_TIME, SimClock } from './sim/clock';
import { linkSearch, parseDeepLink } from './app/deepLink';
import { CreditsDialog } from './ui/credits';
import { DebugOverlay } from './ui/debugOverlay';
import { GestureHud } from './ui/gestureHud';
import { Hud } from './ui/hud';
import { t, tf } from './ui/i18n';
import { PlanetLabels } from './ui/labels';
import { canShareFile, download, snapshot, toPng } from './ui/photo';
import { Recorder } from './ui/recorder';
import { TimeBar } from './ui/timeBar';
import { TimeDialOverlay } from './ui/timeDial';
import { WeightPanel } from './ui/weightPanel';
import { BasePanel } from './ui/basePanel';
import { MissionOverlay } from './ui/missionOverlay';
import { LAYOUTS, Showcases } from './scene/baseKit/showcases';
import { Build } from './app/build';
import type { BuildPanel } from './ui/buildPanel';
import type { BuildGrab } from './gestures/buildGrab';
import { CELL } from './sim/buildRules';
import { skyOver, type SkyReport } from './app/baseSky';
import { nextSetting } from './sim/localSky';
import { SKY_MOONS } from './data/skyMoons';
import { SkyLabels } from './ui/skyLabels';
import { ChromeUi } from './ui/chrome';
import { MissionHud, type MapView } from './ui/missionHud';
import { PassportPanel } from './ui/passportPanel';
import { CountdownGesture } from './gestures/countdown';

// ?reset (user tests): a first visit. Before anything reads what was saved (app/settings.ts).
const unreset = resetIfAsked(location.search, storage);
if (unreset !== null) history.replaceState(history.state, '', `${location.pathname}${unreset}${location.hash}`);
const state = createState();
const modes = new ModeMachine();

// ---------------------------------------------------------------- scene ----
const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
// v2.4 auto-quality: under the chosen tier's pixel-ratio cap, render resolution follows the frame
// rate (quality.ts ResolutionGovernor). Texture detail is chosen for the full ratio, so a step
// never loads or drops a texture.
const device = currentDevice();
const mobileDevice = isMobile(device);
const governor = new ResolutionGovernor();
// v2.4 Auto (quality.ts AutoTier): capable devices get High, weak ones stay on Low, learned per device.
const newAutoTier = () => new AutoTier(autoStartTier(device), readAutoMemory(storage), { version: __APP_VERSION__, now: Date.now, remember: (m) => writeAutoMemory(m, storage) });
let autoTier = state.qualitySetting === 'auto' ? newAutoTier() : null;
if (autoTier) state.quality = autoTier.tier; // what this device learned on an earlier visit
const fullPixelRatio = () => Math.min(devicePixelRatio, PROFILES[state.quality].pixelRatio);
const pixelRatio = () => renderPixelRatio(devicePixelRatio, PROFILES[state.quality].pixelRatio, governor.scale, mobileDevice);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(pixelRatio());
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = config.render.exposure;
// Shader error checks cost synchronous GPU-process round trips on each program's first use
// (~25 ms on the first bloom frame, measured). three.js recommends them for development only.
renderer.debug.checkShaderErrors = import.meta.env.DEV;

const system = new SolarSystem(BODIES, renderer, PROFILES[state.quality]);
// The shown date: starts now, at a week per second (see sim/clock.ts).
const clock = new SimClock(Date.now());
const rig = new CameraRig(innerWidth / innerHeight);
// The overview frames Neptune's orbit; anything farther out is a zoom-out away.
const outermost = BODIES.filter((b) => b.kind === 'planet').at(-1)!;
rig.setSystemRadius(outermost.orbitRadius + outermost.radius);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
rig.reducedMotion = system.shootingStars.reducedMotion = reducedMotion.matches; // fly-ins become cuts; no shooting stars
reducedMotion.addEventListener('change', (e) => (rig.reducedMotion = system.shootingStars.reducedMotion = e.matches));
focusCamera(0, true);
const pipeline = new ScenePipeline(renderer, system.scene, rig.camera, config.render);
pipeline.bloomEnabled = PROFILES[state.quality].bloom;
pipeline.setSamples(PROFILES[state.quality].msaa);
const ultraGuard = new UltraGuard();

function resize() {
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight, false);
  pipeline.setSize(innerWidth, innerHeight);
  rig.resize(innerWidth / innerHeight);
}
addEventListener('resize', resize);
resize();
canvas.addEventListener('webglcontextlost', () => system.suspendTextureUploads());
canvas.addEventListener('webglcontextrestored', () => system.reloadTextures());

/** Low: 1K→2K textures, no bloom, pixel ratio 1. High: 2K→4K textures, bloom, pixel ratio ≤ 2, 4× MSAA. Ultra (desktop): pixel ratio ≤ 3, 8× MSAA. */
let prewarmPending = false;
/** The Quality button (and Ultra giving way to High): a fixed tier, or Auto. */
function setQualitySetting(setting: QualitySetting) {
  state.qualitySetting = setting;
  saveQuality(setting, storage);
  autoTier = setting === 'auto' ? newAutoTier() : null;
  setQuality(autoTier ? autoTier.tier : (setting as Quality));
}
/** The tier in effect, from the setting or from Auto. */
function setQuality(quality: Quality) {
  state.quality = quality;
  pipeline.bloomEnabled = PROFILES[quality].bloom;
  pipeline.setSamples(PROFILES[quality].msaa);
  if (quality === 'ultra') ultraGuard.rearm();
  governor.reset(); // a new tier starts at its full resolution
  applyBaseLighting?.();
  resize();
  system.setTiers(PROFILES[quality]);
  system.setBeltCounts(PROFILES[quality]);
  system.setSkyTier(PROFILES[quality].skyTier);
  prewarmPending = true; // compile only after this frame replaces retired scene owners
}

// While the browser is idle after startup, compile the shaders the other quality needs, so switching
// never stalls. (Safari has no requestIdleCallback: a short delay instead.)
if ('requestIdleCallback' in window) requestIdleCallback(() => { prewarmPending = true; }, { timeout: 4000 });
else setTimeout(() => { prewarmPending = true; }, 1500);

/** Focus a body: fly there, in SolarView (the Sun) or Focus mode. */
function setFocus(index: number, instant = false) {
  state.focus = (index + BODIES.length) % BODIES.length;
  modes.go(modeForFocus(state.focus));
  focusCamera(state.focus, instant);
  if (state.selected) state.selected = BODIES[state.focus];
}

/** Fly to a close orbit view of a body; the Sun (index 0) means the overview. */
function focusCamera(index: number, instant = false) {
  const body = BODIES[index];
  // A comet's 11 km nucleus is a speck: frame its coma instead.
  const extent = body.kind === 'comet' ? 3 : body.radius * reachFactor(body);
  rig.focus(body.radius, extent, index === 0, instant);
}

// -------------------------------------------------------------- intents ----
const bus = createIntentBus();
const recorder = new Recorder();
const overlay = new DebugOverlay(config, recorder);
const hud = new Hud(bus.emit);
setupInfoSheet(bus);
const weightPanel = new WeightPanel(bus.emit);
const gestureHud = new GestureHud();
const gestures = new GestureEngine(config.gestures, config.smoothing, (p) =>
  pickBody(system.nodes, rig.camera, p, innerWidth, innerHeight, 40, mission.pickFilter() ?? pickable(BODIES[state.focus])),
);
const extras = new ExtraGestures(config.gestures, config.smoothing); // v1.2 gestures, layered on the engine
const photo = new PhotoFlow(
  canvas,
  // The overview (Sun focused) is "Solar System".
  () => (state.focus === 0 ? { id: 'solar-system', name: t('solarSystem', state.lang) } : { id: BODIES[state.focus].id, name: BODIES[state.focus].name[state.lang] }),
  () => state.watermark,
  () => state.lang,
);

// Dev builds only: a handle for poking at the scene from the console or test scripts.
if (import.meta.env.DEV) Object.assign(window, { __app: { renderer, system, pipeline, config, rig, clock, extras, modes, governor, get autoTier() { return autoTier; }, get mission() { return mission; }, get showcases() { return showcases; }, get build() { return build; }, bus } });
const labels = new PlanetLabels();

// Mouse hover → name label (only while not dragging).
let mouseHoverId: string | null = null;
canvas.addEventListener('pointermove', (e) => {
  mouseHoverId = e.buttons ? null : pickAt(e.clientX, e.clientY);
});
canvas.addEventListener('pointerleave', () => (mouseHoverId = null));
// Docking: the mouse steers (where it is on the screen).
canvas.addEventListener('pointermove', (e) => {
  if (modes.mode === 'docking' && e.pointerType === 'mouse') bus.emit({ type: 'steer', x: (e.clientX / innerWidth) * 2 - 1, y: (e.clientY / innerHeight) * 2 - 1 });
});


/** The body under the mouse or a tap (client pixels): planets, and the moons of the system in focus. */
function pickAt(x: number, y: number) {
  return pickBody(system.nodes, rig.camera, { x: x / innerWidth, y: y / innerHeight }, innerWidth, innerHeight, 12, mission.pickFilter() ?? pickable(BODIES[state.focus]));
}

const mission = new Mission({
  state, modes, rig, clock, bases: system.bases, scene: system.scene, setFocus,
  flash: (text) => gestureHud.flash(text),
  reducedMotion: () => reducedMotion.matches,
  goldenHour: (node) => {
    const ms = nextSetting(node.body.body, node.base.lat, node.base.lon, clock.time);
    return ms === null ? null : { ms, sun: skyOver(node, ms).local.sun };
  },
  rocketOptions: () => ({ engines: 5, textureSize: PROFILES[state.quality].kitTexture, quality: state.quality === 'low' ? 'low' : 'high' }),
  report: (message) => overlay.report(message),
  // AstroLife counts a booked journey's lift-off and landing (only with ?flags=astrolife).
  liftedOff: (from, to) => shell?.liftedOff(from, to),
  landed: (baseId) => shell?.landed(baseId),
});
const basePanel = new BasePanel(bus.emit);
const missionOverlay = new MissionOverlay(bus.emit);
const missionHud = new MissionHud();
const showcases = new Showcases(system.bases);
// v2.3: the base's own Sun; its shadow map is drawn only when something changes (BaseLighting).
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
const applyBaseLighting = () => {
  const q = state.quality;
  showcases.lighting = { shadows: q !== 'low', shadowSize: q === 'ultra' ? 4096 : 2048, envSize: q === 'ultra' ? 128 : 64 };
  showcases.textureSize = PROFILES[q].kitTexture;
  mission.baseShadows = q !== 'low';
};
applyBaseLighting();
showcases.rocketAt = (id) => {
  if (mission.base?.base.id !== id || !mission.rocketOnBaseLayer) return null;
  const g = mission.base.group;
  return g.worldToLocal(mission.rocket.getWorldPosition(new THREE.Vector3()));
};
const skies = new Map<string, SkyReport>();
const skyLabels = new SkyLabels();

// ------------------------------------------------------------ building (?flags=build) ----
const FLAGS = new Set((new URLSearchParams(location.search).get('flags') ?? '').split(',').filter(Boolean));
// Code that only a ?flags= feature uses loads only with its flag (v2.5): visitors never download it.
// Without the flag, a stand-in does what the real object does until that feature is used: nothing.
// (Without a flag nothing is awaited: startup runs straight through, as before.)
const [cinematicCode, buildCode, shellCode] = FLAGS.has('cinematic') || FLAGS.has('build') || FLAGS.has('astrolife') ? await Promise.all([
  FLAGS.has('cinematic') ? Promise.all([import('./scene/marsCinematicDirector'), import('./ui/cinematicControls')]) : null,
  FLAGS.has('build') ? Promise.all([import('./ui/buildPanel'), import('./gestures/buildGrab')]) : null,
  FLAGS.has('astrolife') ? import('./shell/shell') : null,
]) : [null, null, null];
type Director = Pick<MarsCinematicDirector, 'active' | 'animating' | 'selected' | 'eye' | 'validate' | 'start' | 'update' | 'cancel' | 'dispose'>;
/** Never started, so never active: what the real director is without ?flags=cinematic. */
const idleDirector: Director = {
  active: false, animating: false, selected: null, eye: new THREE.Vector3(),
  validate() {}, start: () => false, update: () => false, cancel() {}, dispose() {},
};
const cinematic: Director = cinematicCode ? new cinematicCode[0].MarsCinematicDirector(rig.camera) : idleDirector;
let cinematicRequest: CinematicRequest | null = null;
const cinematicContext = (): CinematicContext | null => {
  const base = mission.base, owner = showcases.get('jezero'), landing = showcases.landingAt('jezero');
  return base?.base.id === 'jezero' && modes.mode === 'baseView' && owner && landing
    ? { base, owner, landing, mode: modes.mode, horizon: !!mission.horizon, quality: state.quality } : null;
};
const cancelCinematic = () => { cinematicRequest = null; cinematic.cancel(); };
/** Without the flag the panel is never shown (cinematicAvailable), so it needn't exist. */
const noControls: Pick<CinematicControls, 'root' | 'render' | 'dispose'> = { root: document.createElement('details'), render() {}, dispose() {} };
const cinematicControls = cinematicCode ? new cinematicCode[1].CinematicControls((request) => {
  if (!FLAGS.has('cinematic') || !cinematicContext()) return;
  cancelCinematic();
  if (request === 'panorama') mission.goToGoldenHour();
  else if (mission.horizon) mission.exitHorizon();
  cinematicRequest = request;
}, cancelCinematic) : noControls;
mission.baseCamera = (dt) => {
  const owned = cinematic.update(dt, reducedMotion.matches, clock.paused, rig.viewInsets);
  if (owned && mission.horizon) mission.horizonEye.copy(cinematic.eye);
  return owned;
};
if (import.meta.env.DEV) Object.assign((window as unknown as { __app: object }).__app, { cinematic });
attachPageLifecycle({
  suspend: cancelCinematic,
  // Keep the controls/listeners, but resume in manual mode rather than restoring a stale camera lease.
  // TrackingSession stops on every pagehide; pageshow deliberately never reopens the camera.
  resume: cancelCinematic,
  dispose: () => { cancelCinematic(); cinematic.dispose(); cinematicControls.dispose(); },
});
showcases.operationsEnabled = FLAGS.has('operations');
showcases.operationsAt = (id) => {
  if ((mission.trip?.to.base.id === id && modes.mode === 'travel') ||
    (mission.base?.base.id === id && modes.mode === 'docking')) return 'landing';
  if (mission.base?.base.id !== id) return 'standby';
  return modes.mode === 'build' ? 'maintenance' : modes.mode === 'baseView' ? 'active' : 'standby';
};
const buildSite = () => (mission.base && LAYOUTS[mission.base.base.id] ? { id: mission.base.base.id, layout: LAYOUTS[mission.base.base.id] } : null);
const ray = new THREE.Raycaster();
/** A screen point (0–1) → the base's ground there, in base units (the curved ground, to within a hair). */
function groundAt(x: number, y: number): [number, number] | null {
  const b = mission.base;
  if (!b) return null;
  const g = b.group;
  g.updateWorldMatrix(true, false);
  ray.setFromCamera(new THREE.Vector2(x * 2 - 1, -(y * 2 - 1)), rig.camera);
  const inv = g.matrixWorld.clone().invert();
  const o = ray.ray.origin.clone().applyMatrix4(inv);
  const d = ray.ray.direction.clone().transformDirection(inv);
  const R = 1 / g.scale.x;
  let h = 0;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d.y) < 1e-6) return null;
    const s = (h - o.y) / d.y;
    if (s <= 0) return null;
    const [px, pz] = [o.x + d.x * s, o.z + d.z * s];
    h = Math.sqrt(Math.max(0, R * R - px * px - pz * pz)) - R; // the ground curves away
    if (k === 2) return [px, pz];
  }
  return null;
}
const build = new Build({
  state, modes, site: buildSite, groundAt,
  sol: () => (buildSite() ? skyOver(mission.base!, clock.time).sol : null),
  flash: (text) => gestureHud.flash(text),
  enabled: FLAGS.has('build'),
});
// Without ?flags=build, Build mode can't start: its panel stays hidden and nothing is ever grabbed.
const buildPanel: Pick<BuildPanel, 'render'> = buildCode ? new buildCode[0].BuildPanel(bus.emit) : { render() {} };
// The panel's size frames the Build camera. Observed rather than measured in the loop, where reading
// it straight after the panels' DOM writes forced a synchronous layout every frame.
let buildPanelSize = { width: 0, height: 0 };
new ResizeObserver(([entry]) => {
  const [box] = entry.borderBoxSize;
  buildPanelSize = { width: box.inlineSize, height: box.blockSize };
}).observe(document.querySelector('#build-panel')!);
const coarsePointer = matchMedia('(pointer: coarse)');
const buildGrab: Pick<BuildGrab, 'update' | 'reset'> = buildCode ? new buildCode[1].BuildGrab() : { update: () => [], reset() {} };
showcases.buildAt = (id) => {
  const site = buildSite();
  if (!site || site.id !== id) return null;
  const placed = build.placed(site.id, site.layout);
  const ghost = build.active ? build.ghost() : null;
  const preview = build.active ? build.preview() : null;
  return {
    placed, version: build.version,
    guides: build.active ? { layout: site.layout, placed, version: build.version, held: ghost?.item ?? null, cursor: build.cursor, ok: !preview?.blocked } : null,
  };
};
// The mouse in Build mode: hover shows what would go there; a click places it (a tap on a phone
// previews first, a second tap on the same cell places); press on a module and drag to move it.
const screen = (x: number, y: number) => ({ x: x / innerWidth, y: y / innerHeight });
const buildPointer = {
  down(x: number, y: number) {
    if (!build.active) return false;
    bus.emit({ type: 'buildCursor', ...screen(x, y) });
    if (!build.cursor || build.ghost()) return false; // empty ground: a drag pans, a click places (below)
    bus.emit({ type: 'buildGrab' });
    return true;
  },
  move: (x: number, y: number) => bus.emit({ type: 'buildCursor', ...screen(x, y) }),
  up: () => bus.emit({ type: 'buildDrop' }),
  click(x: number, y: number) {
    if (!build.active) return false;
    bus.emit({ type: 'buildCursor', ...screen(x, y) });
    const same = build.chosenBefore && build.cursor && build.chosenBefore[0] === build.cursor[0] && build.chosenBefore[1] === build.cursor[1];
    if (same && build.ghost()) {
      bus.emit({ type: 'buildGrab' });
      bus.emit({ type: 'buildDrop' });
    }
    return true;
  },
};
canvas.addEventListener('pointermove', (e) => {
  if (build.active && e.pointerType === 'mouse' && !e.buttons) bus.emit({ type: 'buildCursor', ...screen(e.clientX, e.clientY) });
});
const chrome = new ChromeUi(bus.emit, rig, state);
bus.on(() => chrome.input()); // any intent (a gesture too) wakes the UI
const passportPanel = new PassportPanel(bus.emit);
const countdownGesture = new CountdownGesture();
bus.on(createIntentHandler({ state, modes, rig, clock, overlay, gestureHud, photo, mission, build, setFocus,
  beforeMission: (intent) => {
    if (!cinematic.active && !cinematicRequest) return false;
    if (intent.type === 'dismiss' && (state.menuOpen || state.passportOpen || state.weightOpen)) return false;
    const release: readonly Intent['type'][] = ['rotate', 'zoom', 'dismiss', 'next', 'prev', 'nextMoon', 'select',
      'enterBase', 'chooseDestination', 'launch', 'countdown', 'toggleBuild', 'toggleHorizon', 'goldenHour',
      'toggleWeightPanel', 'toggleMenu', 'togglePassport', 'toggleHelp', 'toggleTimeBar', 'timeJump', 'timeNow'];
    if (!release.includes(intent.type)) return false;
    cancelCinematic();
    return intent.type === 'dismiss' && intent.what !== 'info';
  },
}));

for (const [id, intent] of [
  ['#photo', { type: 'photo' }],
  ['#watermark', { type: 'toggleWatermark' }],
  ['#true-scale', { type: 'toggleTrueScale' }],
  ['#weight', { type: 'toggleWeightPanel' }],
] as const) {
  document.querySelector<HTMLButtonElement>(id)!.addEventListener('click', (e) => {
    bus.emit(intent);
    (e.currentTarget as HTMLElement).blur(); // keep Space / Enter for the scene
  });
}
document.querySelector<HTMLButtonElement>('#quality')!.addEventListener('click', (e) => {
  setQualitySetting(nextQualitySetting(state.qualitySetting, mobileDevice));
  (e.currentTarget as HTMLElement).blur(); // keep Space / Enter for the scene
});

const timeBar = new TimeBar(bus.emit);
const timeDial = new TimeDialOverlay();
photo.toast.shareButton.addEventListener('click', () => bus.emit({ type: 'sharePhoto' }));
photo.toast.saveButton.addEventListener('click', () => bus.emit({ type: 'savePhoto' }));
attachKeyboardAndMouse(canvas, bus, config, pickAt, buildPointer);

const debugUrl = new URLSearchParams(location.search).has('debug');
document.querySelector('#version')!.textContent = `v${__APP_VERSION__}`;

const credits = new CreditsDialog();
document.querySelector('#credits-link')!.addEventListener('click', (e) => {
  e.preventDefault();
  credits.open(state.lang);
});

const debug = setupDebugTools(renderer, overlay, recorder, debugUrl, () => mission.lastLanding);

// ------------------------------------------------------------- tracking ----
/** On-screen confirmation for discrete gesture events (after the intent is applied). */
function gestureMessage(intent: Intent): string | null {
  const vars = { name: BODIES[state.focus].name[state.lang] };
  switch (intent.type) {
    case 'next':
    case 'prev':
      return tf('flash.switch', state.lang, vars);
    case 'select':
      return tf('flash.select', state.lang, vars);
    case 'togglePause':
      return tf(clock.paused ? 'flash.paused' : 'flash.resumed', state.lang, vars);
    default:
      return null;
  }
}
const trackingDeps: TrackingDeps = {
  state, bus, gestures, extras, overlay, recorder, gestureHud, gestureMessage,
  frameMode: () => modes.mode,
  // In Build mode the pinch grabs modules: the engine's pinch-zoom is dropped there.
  keep: (i) => !(modes.mode === 'build' && i.type === 'zoom'),
  // The launch countdown only listens at a base.
  more: (t) => {
    if (modes.mode === 'build') {
      const o = gestures.lastObs;
      return buildGrab.update(t, o && o.pose === 'pinch' ? o.pinchPoint : null);
    }
    buildGrab.reset();
    if (modes.mode === 'docking') {
      const center = gestures.lastObs?.center;
      return center ? [{ type: 'steer', ...steerFromPalm(center, state.steerSensitivity) }] : [];
    }
    return modes.mode === 'baseView' || modes.mode === 'launch' ? countdownGesture.update(t, gestures.lastObs?.fingers ?? null) : (countdownGesture.reset(), []);
  },
};
/** The session in use, so the AstroLife shell can stop it. Started below, with the explorer. */
let tracking: TrackingSession | null = null;
const startHandTracking = () => { tracking = startTracking(trackingDeps); };
// 🖐 Turn on hand control: a new session replaces whatever stopped (it never reopens the camera by itself).
bus.on((intent) => {
  if (intent.type === 'restartTracking' && !['loading', 'tracking'].includes(state.status.kind)) startHandTracking();
});

// The mission HUD's map: the planets where they are now, the bases' worlds marked, the rocket and its route.
const MAP_BODIES = BODIES.map((b, i) => ({ b, i })).filter(({ b }) => b.kind === 'planet' || b.kind === 'dwarf');
const MAP_RADIUS = Math.max(...MAP_BODIES.map(({ b }) => b.orbitRadius));
const planetIndex = (bodyId: string) => {
  const b = BODIES.find((x) => x.id === bodyId)!;
  return BODIES.findIndex((x) => x.id === (b.parent ?? b.id));
};
const BASE_PLANETS = new Set(BASES.map((x) => planetIndex(x.body)));
const mapPos = new THREE.Vector3();
const flat = (v: THREE.Vector3) => ({ x: v.x, z: v.z });
function miniMap(): MapView {
  const here = mission.base ? planetIndex(mission.base.base.body) : -1;
  const trip = mission.trip;
  return {
    bodies: MAP_BODIES.map(({ b, i }) => ({ ...flat(system.worldPosition(i, mapPos)), color: `#${b.color.toString(16).padStart(6, '0')}`, base: BASE_PLANETS.has(i), here: i === here && !trip })),
    rocket: modes.mode === 'travel' ? flat(mission.rocket.position) : null,
    route: trip ? [flat(system.worldPosition(planetIndex(trip.from.base.body), mapPos)), flat(system.worldPosition(planetIndex(trip.to.base.body), mapPos))] : null,
    maxRadius: MAP_RADIUS,
  };
}

// ----------------------------------------------------------------- loop ----
const focusPos = new THREE.Vector3();
let lastNow = performance.now();
/** The previous frame's own CPU time (this callback), for Auto's headroom check. */
let lastCpuMs = 0;

// ------------------------------------------------------------- deep links (v2.4, app/deepLink.ts) ----
const link = parseDeepLink(location.search, {
  bodies: BODIES.map((b) => b.id),
  bases: BASES.map((b) => ({ id: b.id, body: b.body })),
  horizon: Object.keys(LAYOUTS),
  range: [MIN_TIME, MAX_TIME],
});
if (link.lang) state.lang = link.lang;
if (link.time !== undefined) {
  clock.jumpTo(link.time);
  clock.paused = true; // a shared moment stays put until Space or the time bar
}
/** The body, base and view need the planets where the date puts them: applied on the first frame. */
let pendingLink = link.body !== undefined;
function applyLink() {
  setFocus(BODIES.findIndex((b) => b.id === link.body), true); // a link cuts there: no fly-in
  if (link.base) bus.emit({ type: 'enterBase', baseId: link.base });
  if (link.view === 'horizon') bus.emit({ type: 'toggleHorizon' });
}
/** The address bar follows the view, quietly (replaceState: Back isn't filled with views). */
let addressKey = '';
function followAddress() {
  // Under the AstroLife shell the scene is only a backdrop: the address names no view, so a reload opens the shell again.
  const view = shell?.isOpen ? { body: 'sun', base: null, horizon: false, lang: state.lang }
    : { body: BODIES[state.focus].id, base: mission.base?.base.id ?? null, horizon: mission.horizon !== null, lang: state.lang };
  const keepDate = link.time !== undefined && clock.paused && clock.time === link.time;
  const key = `${view.body}|${view.base}|${view.horizon}|${view.lang}|${keepDate}`;
  if (key === addressKey) return;
  addressKey = key;
  const search = linkSearch(location.search, view, keepDate);
  if (search !== location.search) history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
}

// ------------------------------------------------- AstroLife 2126 (?flags=astrolife, decision 21) ----
// The shell opens first, over the scene (a link to a view opens that view instead). The camera is
// asked for only when the explorer opens, and stopped again whenever the shell takes the screen.
const shell = shellCode ? new shellCode.Shell({
  lang: () => state.lang,
  emit: bus.emit,
  canLeave: () => modes.mode === 'solarView' || modes.mode === 'focus' || (modes.mode === 'baseView' && !mission.countdown),
  storage,
  cover(open) {
    document.body.classList.toggle('shell-open', open);
    if (!open) {
      startHandTracking();
      return;
    }
    tracking?.dispose('handControlPaused');
    tracking = null;
    state.selected = null;
    state.menuOpen = state.passportOpen = state.weightOpen = false;
    if (mission.base) mission.leave();
  },
  show(bodyId) {
    const index = BODIES.findIndex((b) => b.id === bodyId);
    if (index >= 0 && index !== state.focus) setFocus(index);
  },
  journey({ from, to, at }) {
    journey = { from, to, saved: boardClock(clock, at) };
    bus.emit({ type: 'enterBase', baseId: from });
    bus.emit({ type: 'chooseDestination', baseId: to });
  },
  flash: (text) => gestureHud.flash(text),
  capture: () => new Promise((resolve) => { sceneCopy = resolve; }),
  files: { png: toPng, download, canShare: canShareFile },
}) : null;
/** A copy of the next rendered frame is wanted (an AstroLife postcard): taken right after it's drawn, like a photo. */
let sceneCopy: ((copy: HTMLCanvasElement) => void) | null = null;
/** A booked journey under way in the explorer, and the clock as it was before boarding (app/journey.ts). */
let journey: (Journey & { saved: SavedTime }) | null = null;
if (shell && !pendingLink) shell.open();
else startHandTracking();

/** Auto changes tier only where a rebuild can't interrupt anything: the overview, a body, a base at rest. */
function canSwitchTier() {
  if (photo.pending || document.hidden) return false;
  if (modes.mode === 'solarView' || modes.mode === 'focus') return true;
  return modes.mode === 'baseView' && !mission.horizon && !mission.countdown && !cinematic.active && !cinematicRequest;
}

/** What one frame's phases share (one object, reused: nothing is allocated per frame). */
const frame = { now: 0, dt: 0, cpuStart: 0, view: null as ReturnType<Mission['update']> };
/** The sky over a base at this frame's time (local time, the Sun, Phobos, Deimos, Earth), once per frame. */
const skyFor = (id: string) => {
  if (!skies.has(id)) skies.set(id, skyOver(system.bases.find((b) => b.base.id === id)!, clock.time));
  return skies.get(id)!;
};

// The frame loop, in named phases (app/frameLoop.ts fixes their order).
const phases: FramePhases = {
  start(now) {
    frame.now = now;
    frame.cpuStart = performance.now();
    // Ultra that can't keep up gives way to High (once; choosing Ultra again re-arms it).
    if (ultraGuard.frame(now - lastNow, state.quality)) {
      setQualitySetting('high');
      gestureHud.flash(t('ultraTooSlow', state.lang));
    }
    if (governor.frame(now - lastNow)) resize();
    const autoSwitch = autoTier?.frame(now - lastNow, lastCpuMs, governor.targetMs, canSwitchTier());
    if (autoSwitch && autoSwitch !== state.quality) setQuality(autoSwitch);
    frame.dt = Math.min((now - lastNow) / 1000, 0.1); // avoid jumps after tab switches
    lastNow = now;
  },

  simulateWorld() {
    if (clock.advance(frame.dt)) gestureHud.flash(t('timeLimit', state.lang));
    system.update(clock.time, clock.effectiveRate, frame.dt);
  },

  applyInput() {
    if (pendingLink) {
      pendingLink = false;
      applyLink();
    }
    cinematic.validate(cinematicContext());
    if ((cinematic.active || cinematicRequest) && [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"], #weight-panel:not([hidden]), #passport-panel:not([hidden]), #photo-toast:not([hidden])')]
      .some((panel) => !panel.hidden && panel.getClientRects().length > 0 && getComputedStyle(panel).visibility !== 'hidden')) cancelCinematic();
  },

  simulateMission() {
    frame.view = mission.update(frame.dt, rig.camera);
    // Left the journey for free roam (or the shell): the visitor's own date and speed come back.
    if (journey && !journeyOngoing(modes.mode, mission.base?.base.id ?? null, journey)) {
      restoreClock(clock, journey.saved);
      journey = null;
      shell?.journeyEnded();
    }
  },

  updateScene() {
    const { now, dt, view } = frame;
    // Showcase bases: built only while their world is in focus, or a rocket is on its way there.
    skies.clear();
    showcases.trueScale = state.trueScale;
    showcases.operationsPaused = clock.paused;
    showcases.update(
      (id) => mission.base?.base.id === id || mission.trip?.to.base.id === id || baseById(id).body === BODIES[state.focus].id,
      state.quality === 'low' ? 'low' : 'high', now / 1000, rig.camera, reducedMotion.matches,
      mission.horizon ? mission.base?.base.id ?? null : null,
      (id) => skyFor(id).local,
      mission.horizonEye,
      renderer,
    );
    cinematic.validate(cinematicContext()); // rebuilds may have retired the owner in this frame
    pipeline.baseOn = showcases.drawing;
    // Pass 2 walks only the base's planet (whose surface holds the base) and the rocket with its dust.
    pipeline.baseRoots = showcases.drawing && mission.base ? [system.nodes[BODIES.findIndex((b) => b.id === mission.base!.base.body)].pivot, ...mission.baseRoots()] : [];
    if (view !== 'chase') {
      rig.setTarget(view?.target ?? system.worldPosition(state.focus, focusPos));
      rig.update(dt);
    } else if (!cinematic.active && rig.camera.view?.enabled) {
      rig.camera.clearViewOffset(); // the chase and landing cameras frame themselves
    }
    if (cinematicRequest) {
      const context = cinematicContext();
      if (context) cinematic.start(cinematicRequest, context, reducedMotion.matches);
      cinematicRequest = null;
    }
    system.setHorizon(mission.horizon ? state.focus : null);
    document.body.classList.toggle('horizon', mission.horizon !== null);
    system.updateView(rig.camera, state.focus, { height: innerHeight, pixelRatio: fullPixelRatio() }, dt, rig.zoomDistance, state.trueScale);
    showcases.syncMaps(); // updateView can finish a fade and close the previously borrowed image.
    // A photo gets every pixel the tier allows; auto-quality measures afresh afterwards.
    if (photo.pending && governor.scale < 1) {
      governor.reset();
      resize();
    }
  },

  render() {
    if (overlay.enabled) {
      const target = governor.targetMs;
      overlay.resolutionInfo = `${Math.round(governor.scale * 100)}% · ${renderer.getPixelRatio().toFixed(2)}x · holds ${target ? Math.round(1000 / target) : '—'} fps`;
      overlay.tierInfo = autoTier ? `Auto: ${autoTier.describe()}` : `${state.qualitySetting} (fixed)`;
    }
    debug.frameStats?.beginGpu();
    pipeline.render();
    showcases.afterRender();
    debug.frameStats?.endGpu();
    photo.afterRender();
    if (sceneCopy) {
      const done = sceneCopy;
      sceneCopy = null;
      done(snapshot(canvas, null)); // same task as the render: the drawing buffer still holds this frame
    }
  },

  updateUi() {
    const { now } = frame;
    labels.update(
      system.nodes,
      rig.camera,
      (state.selected ?? BODIES[state.focus]).id,
      gestures.ui.pointer ? gestures.ui.hoverId : mouseHoverId,
      state.lang,
    );

    // Names in the horizon view's sky (after the camera has moved this frame).
    const horizonSky = mission.horizon && mission.base ? showcases.sky(mission.base.base.id) : null;
    skyLabels.render(
      horizonSky
        ? horizonSky.labelPoints().map(({ id, world }) => ({ id, world, text: (SKY_MOONS.find((m) => m.id === id)?.name ?? BODIES.find((b) => b.id === id)!.name)[state.lang] }))
        : [],
      rig.camera,
    );
    overlay.onRender(now);
    debug.update();
    gestureHud.render(gestures.ui, extras.ui, state.lang);
    timeBar.render(clock, state.lang, state.timeBarOpen, now);
    timeDial.render(extras.ui.dialActive, clock, state.lang);
    credits.update(state.lang);
    const hereSky = mission.base && (modes.mode === 'baseView' || mission.horizon) ? skyFor(mission.base.base.id) : null;
    mission.setRocketNight(mission.base ? skyFor(mission.base.base.id).local.night : 0);
    const cinematicAvailable = FLAGS.has('cinematic') && modes.mode === 'baseView' && mission.base?.base.id === 'jezero';
    basePanel.render(modes.mode === 'baseView' && !mission.horizon ? mission.base?.base ?? null : null, state.lang, mission.destination?.base.id ?? null, hereSky, build.enabled,
      cinematicAvailable ? cinematicControls.root : undefined);
    cinematicControls.render(cinematicAvailable, !!mission.horizon, state.lang, cinematic.selected, cinematic.animating, reducedMotion.matches);
    const buildStatus = build.active ? build.status() : null;
    buildPanel.render(buildStatus && mission.base ? {
      kind: build.kind, status: buildStatus, preview: build.preview(), best: state.baseLevels[mission.base.base.id] ?? 1,
      canUndo: build.canUndo, canRedo: build.canRedo, dust: skyFor(mission.base.base.id).sol.dust,
      touchHint: !state.buildHintSeen && coarsePointer.matches,
    } : null, state.lang);
    // Build camera: zoomed so a cell is at least ~44 px (52 with margin) in the free part of the screen.
    if (build.active) {
      const panel = buildPanelSize;
      const sheet = panel.width > innerWidth * 0.9; // phones: a bottom sheet
      const free = Math.min(sheet ? innerHeight - panel.height : innerHeight, sheet ? innerWidth : innerWidth - panel.width);
      mission.buildFrame = THREE.MathUtils.clamp((CELL * free) / (4 * 52), 0.35, 1.4);
    }
    missionOverlay.render({
      count: modes.mode === 'launch' ? mission.countdown?.count ?? null : null,
      byHand: !(mission.countdown?.auto ?? true),
      flyingTo: modes.mode === 'travel' ? mission.trip?.to.base.name[state.lang] ?? null : null,
      horizon: mission.horizon && hereSky ? hereSky : null,
      // Quantized so the overlay only rebuilds a few times a second.
      docking: modes.mode === 'docking' && mission.dock
        ? { altitude: Math.round((mission.dock.state.alt / mission.dock.startAlt) * 50) / 50, auto: mission.dock.auto || state.autoLand, sensitivity: state.steerSensitivity }
        : null,
    }, state.lang);
    const readout = mission.readout();
    missionHud.render(readout, readout && miniMap(), state.lang);
    passportPanel.render(state.passportOpen, state.passport, state.lang, state.baseLevels);
    weightPanel.render(state.weightOpen, state.weightKg, (state.selected ?? BODIES[state.focus]).id, state.lang);
    hud.render({
      lang: state.lang,
      focused: BODIES[state.focus],
      selected: state.selected,
      status: state.status,
      textures: system.textureStatus,
      quality: state.quality,
      qualitySetting: state.qualitySetting,
      watermark: state.watermark,
      trueScale: state.trueScale,
      weightKg: state.weightKg,
      timeMs: clock.time,
    });
    shell?.render();
    followAddress();
    // Idle eligibility must see this frame's panel visibility before deciding to fade.
    chrome.update(now, modes.mode, gestures.ui.pointer !== null);
  },

  end() {
    // Optional warm-up must not retain programs belonging to replaceable base or
    // mission owners. Defer until navigation returns to the persistent scene.
    if (prewarmPending && !showcases.hasEntries && (modes.mode === 'focus' || modes.mode === 'solarView')) {
      prewarmPending = false; // coalesce rapid quality requests
      void pipeline.prewarm();
    }
    lastCpuMs = performance.now() - frame.cpuStart;
    debug.frameStats?.frame(frame.now, lastCpuMs);
  },
};

renderer.setAnimationLoop((now) => runFrame(phases, now));
