import { GuidedMission } from './app/guidedMission';
// Wiring and the frame loop. What the app does lives in src/app/: the mode
// machine (modes.ts), intent handling (intentHandler.ts), photos, tracking,
// debug tools, settings and the phone info sheet.
import * as THREE from 'three';
import { initNativeNormalMap } from './native/normalMap';
import { frameSeconds } from './app/frameLoop';
import { createIntentHandler } from './app/intentHandler';
import { Mission } from './app/mission';
import { setupDebugTools } from './app/debugTools';
import { setupInfoSheet } from './app/infoSheet';
import { modeForFocus, ModeMachine } from './app/modes';
import { PhotoFlow } from './app/photoFlow';
import { createState } from './app/state';
import { storage,writeLanguage } from './app/settings';
import {readCheckpoint,writeCheckpoint} from './app/checkpoint';
import {ResumeMission} from './ui/resumeMission';
import { DestinationPicker, pickerDestinations, pickerIntents } from './app/destinationPicker';
import { StudioStage } from './scene/studioStage';
import { DestinationFlow, type FlowMission } from './app/destinationFlow';
import type { DestinationPickerView } from './ui/destinationPickerView';
import {JapanDetail} from './scene/japanDetail';
import {LocalSpaceport} from './scene/localSpaceport';
import {ActiveVehicle} from './ui/activeVehicle';
import {JapanViewControls} from './ui/japanViewControls';
import {landingTelemetry} from './sim/landingTelemetry';
import {RuntimeMetrics} from './performance/runtimeMetrics';
import { cameraEvents } from './performance/cameraEvents';
import type { DiagnosticsContext } from './performance/diagnostics';
import { startTracking, type TrackingDeps } from './app/tracking';
import { attachPageLifecycle } from './app/pageLifecycle';
import { config } from './config';
import { BODIES, reachFactor } from './data/bodies';
import { BASES, baseById, baseOn } from './data/bases';
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
import { MarsCinematicDirector, type CinematicContext, type CinematicRequest } from './scene/marsCinematicDirector';
import { CinematicControls } from './ui/cinematicControls';
import { pickBody } from './scene/picking';
import { ScenePipeline } from './scene/postprocessing';
import { SolarSystem } from './scene/solarSystem';
import { MAX_TIME, MIN_TIME, SimClock } from './sim/clock';
import { linkSearch, parseDeepLink } from './app/deepLink';
import { afterStartFresh, startPlan, type StartFacts } from './app/startPlan';
import { CreditsDialog } from './ui/credits';
import { DebugOverlay } from './ui/debugOverlay';
import { GestureHud } from './ui/gestureHud';
import { Hud } from './ui/hud';
import { t, tf } from './ui/i18n';
import { PlanetLabels } from './ui/labels';
import { Recorder } from './ui/recorder';
import { TimeBar } from './ui/timeBar';
import { TimeDialOverlay } from './ui/timeDial';
import { WeightPanel } from './ui/weightPanel';
import { BasePanel } from './ui/basePanel';
import { SpaceportEntry } from './ui/spaceportEntry';
import { MissionOverlay } from './ui/missionOverlay';
import { LAYOUTS, Showcases } from './scene/baseKit/showcases';
import { Build } from './app/build';
import { BuildPanel } from './ui/buildPanel';
import { BuildGrab } from './gestures/buildGrab';
import { CELL } from './sim/buildRules';
import { skyOver, type SkyReport } from './app/baseSky';
import { clockLabel, nextSetting } from './sim/localSky';
import { SKY_MOONS } from './data/skyMoons';
import { SkyLabels } from './ui/skyLabels';
import { ChromeUi } from './ui/chrome';
import { CleanView } from './ui/cleanView';
import './ui/experience.css';
import { MissionHud, type MapView } from './ui/missionHud';
import { PassportPanel } from './ui/passportPanel';
import { CountdownGesture } from './gestures/countdown';
import { DestinationPrep, JourneyTracker, parseJourneySim, type JourneyPhase } from './app/journeyStatus';
import { JourneyStatusView } from './ui/journeyStatusView';
import { SunsetPreview } from './app/sunsetPreview';
import { localHours, presetTimes, type TimePreset } from './app/timePresets';
import { clearViewFor, type ClearView } from './app/jezeroLandmarks';

const state = createState();
const runtimeMetrics=new RuntimeMetrics();
// Compile the tiny C++ texture kernel asynchronously; the JS path remains ready
// immediately, including browsers where WebAssembly or the request is blocked.
void initNativeNormalMap();
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
const japanBase=system.bases.find(b=>b.base.id==='cape')!;
const japanDetail=new JapanDetail(japanBase);
const activeVehicle=new ActiveVehicle();
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
if (import.meta.env.DEV) Object.assign(window, { __app: { renderer, system, pipeline, config, rig, clock, extras, modes, governor, get autoTier() { return autoTier; }, get mission() { return mission; }, get showcases() { return showcases; }, get build() { return build; }, bus, get journey() { return { tracker: journeyTracker, prep: journeyPrep, view: journeyView, phase: journeyPhase }; } } });
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
  if(localSpaceport.active)return null;
  return pickBody(system.nodes, rig.camera, { x: x / innerWidth, y: y / innerHeight }, innerWidth, innerHeight, 12, mission.pickFilter() ?? pickable(BODIES[state.focus]));
}

const spaceport = new SpaceportEntry();
const localSpaceport=new LocalSpaceport((x,y)=>bus.emit({type:'steer',x,y}));
photo.captureCanvas=()=>localSpaceport.canvas??canvas;
photo.captureSubject=()=>localSpaceport.active?{id:'tanegashima-spaceport',name:{en:'Japan spaceport',my:'ဂျပန်အာကာသစခန်း',ja:'日本の宇宙港'}[state.lang]}:state.focus===0?{id:'solar-system',name:t('solarSystem',state.lang)}:{id:BODIES[state.focus].id,name:BODIES[state.focus].name[state.lang]};
let pendingStampText: string | null = null;
let activeStampText: string | null = null;
let stampClearTimer = 0;
function showPassportStampToast(text: string) {
  if (pickerOwns()) { pendingStampText = text; return; }
  activeStampText = text;
  gestureHud.flash(text);
  clearTimeout(stampClearTimer);
  stampClearTimer = window.setTimeout(() => { if (activeStampText === text) activeStampText = null; }, 1250);
}
const mission = new Mission({
  state, modes, rig, clock, bases: system.bases, bodies: system.nodes, scene: system.scene, setFocus,
  flash: (text) => { activeStampText = null; clearTimeout(stampClearTimer); gestureHud.flash(text); },
  flashStamp: (text) => showPassportStampToast(text),
  reducedMotion: () => reducedMotion.matches,
  goldenHour: (node) => {
    const ms = nextSetting(node.body.body, node.base.lat, node.base.lon, clock.time);
    return ms === null ? null : { ms, sun: skyOver(node, ms).local.sun };
  },
  rocketOptions: () => ({ engines: 5, textureSize: PROFILES[state.quality].kitTexture, quality: state.quality === 'low' ? 'low' : 'high', design: 'shuttle' }),
  presentLaunch: (destination, complete, cancel) => {
    spaceport.render(state.lang, state.quality === 'low', reducedMotion.matches);
    return spaceport.startLaunch(destination.base.name[state.lang], complete, cancel);
  },
  report: (message) => overlay.report(message),
  exploreClear: () => exploreClear(),
});
const basePanel = new BasePanel(bus.emit);
// ---------------------------------------- SPCE-LINE Orbital Journey (Tanegashima → Jezero only) ----
// The journey message comes from the mission and scene state each frame (journeyStatus.ts). After touchdown at Jezero
// the destination is "prepared" until its scene is interactive; ?journeysim=slow|fail (dev or ?debug) simulates a slow
// or a failed (recoverable: Try again) preparation. Arrival offers one action: the existing horizon view.
const journeyTracker = new JourneyTracker();
const journeyPrep = new DestinationPrep(parseJourneySim(location.search, import.meta.env.DEV || new URLSearchParams(location.search).has('debug')));
const journeyView = new JourneyStatusView(() => {
  if (modes.mode !== 'baseView' || mission.base?.base.id !== 'jezero' || mission.horizon || journeyTracker.phase !== 'arrived') return;
  journeyTracker.end();
  bus.emit({ type: 'toggleHorizon' });
}, () => journeyPrep.retry(performance.now()));
let journeyPhase: JourneyPhase | null = null;
/** Reduced motion: settle the rig's framing once chrome has measured the arrival card (this frame). */
let journeyFrameCut = false;
/** While Jezero is being prepared, the ways into exploring it wait. */
const journeyBlocks = (intent: Intent) => (journeyPhase === 'preparing' || journeyPhase === 'failed') && modes.mode === 'baseView'
  && (intent.type === 'toggleHorizon' || intent.type === 'goldenHour' || intent.type === 'toggleBuild');
function updateJourney(now: number) {
  const snap = () => ({ mode: modes.mode, baseId: mission.base?.base.id ?? null, destinationId: mission.destination?.base.id ?? null,
    countdown: !!mission.countdown, presenting: mission.presentingLaunch,
    trip: mission.trip ? { from: mission.trip.from.base.id, to: mission.trip.to.base.id } : null,
    horizon: !!mission.horizon, prep: journeyPrep.state });
  let phase = journeyTracker.update(snap());
  if (phase === null) journeyPrep.reset();
  else if (modes.mode === 'baseView' && mission.base?.base.id === 'jezero') {
    if (journeyPrep.state === 'idle') journeyPrep.begin(now);
    journeyPrep.update(now, !!showcases.get('jezero'));
    phase = journeyTracker.update(snap());
  }
  if (phase === 'arrived' && journeyPhase !== 'arrived') basePanel.collapse(); // the arrival card is the next step
  // The card covers part of the scene: Mars is framed in what it leaves free (chrome's covering panels, measured now
  // rather than on the next 200 ms tick). Reduced motion: a cut (settled after chrome.update below), not an eased glide.
  if ((phase === 'arrived') !== (journeyPhase === 'arrived')) { chrome.remeasure(); journeyFrameCut = reducedMotion.matches; }
  journeyPhase = phase;
  // The base panel's ways into exploring wait while Jezero is prepared (the intents are held as well: journeyBlocks).
  const hold = phase === 'preparing' || phase === 'failed';
  for (const b of document.querySelectorAll<HTMLButtonElement>('#base-panel :is(.horizon, .golden, .build)')) {
    if (hold && !b.disabled) { b.disabled = true; b.dataset.journeyHeld = ''; }
    else if (!hold && 'journeyHeld' in b.dataset) { b.disabled = false; delete b.dataset.journeyHeld; }
  }
  const host = document.querySelector<HTMLElement>('#spaceport-view[open][data-purpose="mission"]');
  const focusFree = !checkpointPending && !state.menuOpen && !state.passportOpen && !state.weightOpen && !document.querySelector('dialog[open]') && !pickerOwns();
  journeyView.render(phase, state.lang, host, focusFree, now);
}
/** Set while the saved-mission offer is unanswered: true refuses an intent that would start, redirect or replace a journey. */
let missionLocked:((intent:Intent)=>boolean)|null=null;
const japanViewControls=new JapanViewControls(()=>{if(mission.base?.base.id!=='cape'){if(missionLocked?.({type:'enterBase',baseId:'cape'}))return;mission.enter('cape');}localSpaceport.enter();},()=>localSpaceport.map(),()=>localSpaceport.active?localSpaceport.reset():mission.resetJapanView());
spaceport.root.prepend(japanViewControls.root);
// The launch preview covers the ground view: hand its camera back as it was when the preview closes.
spaceport.groundView={save:()=>localSpaceport.viewPose(),restore:(pose)=>localSpaceport.restoreView(pose as ReturnType<LocalSpaceport['viewPose']>)};
if (import.meta.env.DEV) Object.assign((window as unknown as { __app: object }).__app, { spaceport,japanDetail,localSpaceport,runtimeMetrics,state });
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
const entryQuery = new URLSearchParams(location.search);
const FLAGS = new Set((entryQuery.get('flags') ?? '').split(',').filter(Boolean));
// Both flags are required; the normal Explorer and bare / retain their controls.
const guided = FLAGS.has('astrolife') && FLAGS.has('guided') ? new GuidedMission(bus.emit, () => ({
  mode:modes.mode, base:mission.base?.base.id ?? null, lang:state.lang,
  blocked:checkpointPending || spaceport.active || state.menuOpen || state.passportOpen || state.weightOpen || !!document.querySelector('dialog[open]'),
  sensitivity:state.steerSensitivity,
})) : null;
if (import.meta.env.DEV) Object.assign((window as unknown as {__app:object}).__app, {guided});
// ---------------------------------------------- 3D destination picker ----
// The Tanegashima ground link includes the picker. Other entries can opt in with ?flags=picker3d.
const entryBase = entryQuery.get('base')?.toLowerCase();
const tanegashimaGroundEntry = entryQuery.get('site') === 'ground' && (entryBase === 'tanegashima' || entryBase === 'cape');
const pickerEnabled = FLAGS.has('picker3d') || (tanegashimaGroundEntry && !guided);
let picker: { logic: DestinationPicker; view: DestinationPickerView } | null = null;
let pickerWasOwning = false;
/**
 * Opened from the Tanegashima ground view: that view is set aside (the existing Earth-map switch, the ground scene kept
 * loaded but not drawn: one renderer draws one scene) and Back restores it. Not a base entry, not a stamp, no choice.
 */
let pickerFromGround = false;
/**
 * SPIKE (?flags=picker3d,studio): free mode's screens 2–3 are drawn as a studio of their own (scene/studioStage.ts) by
 * this renderer in this loop, instead of the solar-system scene. Without the flag nothing below is created or changed.
 */
const studioStage = FLAGS.has('picker3d') && FLAGS.has('studio') ? new StudioStage() : null;
if (import.meta.env.DEV && studioStage) Object.assign((window as unknown as { __app: object }).__app, { studio: studioStage });
/**
 * Free mode's screen flow (the owner's contract, 2026-11-14): 1 base overview → 2 destination selection → 3 journey
 * confirmation → launch. Screen 2's choice is a preview (the mission and its checkpoint do not change); Confirm sets
 * the destination and screen 3 opens only once the mission has accepted it. Guided keeps its own flow (option A).
 */
const flow = pickerEnabled ? new DestinationFlow() : null;
/**
 * Hiding is not pausing: while screens 2–3 hide the time pill, time runs on as before, and Pause / Resume stays one
 * tap away in Settings (the same togglePause the time bar and Space send). Flag on only.
 */
const menuPause = flow ? (() => {
  const b = document.createElement('button');
  b.id = 'menu-pause'; b.type = 'button';
  b.addEventListener('click', () => bus.emit({ type: 'togglePause' }));
  document.querySelector('#footer-menu .settings-options')?.prepend(b);
  return b;
})() : null;
const PAUSE_WORDS = { en: 'Pause', my: 'ရပ်ရန်', ja: '一時停止' } as const;
const FLOW_CHOOSE_WORDS = { en: '🪐 Choose a destination', my: '🪐 သွားမည့်နေရာ ရွေးရန်', ja: '🪐 行き先を選ぶ' } as const;
const FLOW_VIEW_WORDS = { en: '🧭 View journey', my: '🧭 ခရီးစဉ်ကြည့်ရန်', ja: '🧭 旅程を確認' } as const;
const RESUME_WORDS = { en: 'Resume', my: 'ပြန်စရန်', ja: '再開' } as const;
let flowGeneration = 0;
let flowRefusedAt = -Infinity;
/** Set while the flow sends its own intents (Confirm, Launch): the flow's gate lets exactly those through. */
let flowSending = false;
/**
 * The Details dialog is open: 👆 selection and 👍 confirmation pause (only they: the mission, time and the rest go on).
 * Opening cancels a hold in progress; closing makes a 👍 still held owe a release (fresh input), like a screen change.
 */
let flowDetailsOpen = false;
function pickerDetails(open: boolean) {
  flowDetailsOpen = open;
  if (open) picker?.logic.standDown();
  else picker?.logic.screenChanged();
}
if (pickerEnabled) {
  if (guided) guided.palmSelects = false;
  void import('./ui/destinationPickerView').then(({ DestinationPickerView }) => {
    picker = { logic: new DestinationPicker(), view: new DestinationPickerView(system.scene, system.nodes, {
      choose: pickerChoose, confirm: pickerConfirm, open: pickerOpen, showJourney: pickerShowJourney, back: pickerBack,
      requestTexture: (bodyId) => system.requestTexture(bodyId), details: pickerDetails,
    }) };
    if (import.meta.env.DEV) Object.assign((window as unknown as { __app: object }).__app, { picker, flow });
  });
}
const pickerGuided = () => !!guided?.session.active && guided.session.stage === 'destination';
/** The mission as the flow reads it (fresh each time). A Guided session blocks the free-mode flow (option A). */
const flowMission = (): FlowMission => ({ baseId: mission.base?.base.id ?? null, destinationId: mission.destination?.base.id ?? null,
  mode: modes.mode, blocked: !!checkpointPending || !!guided?.session.active });
const flowOpen = () => !!flow && flow.screen !== 'closed';
/** After any flow action: a new screen restarts the 👆 focus and makes a held 👍 owe a release (no timer involved). */
function flowChanged() {
  if (flow?.screen === 'closed') releaseFlowEnter();
  if (!flow || flow.generation === flowGeneration) return;
  flowGeneration = flow.generation;
  picker?.logic.screenChanged();
}
/**
 * The page's Enter that opened the flow (screen 1 → 2 or 3) is spent: while it is still held, its auto-repeat must not
 * be screen 3's Launch. Released by its keyup, or by losing focus (no keyup comes then: nothing is held afterwards and
 * the keyboard is not left blocked), or when the flow closes. The listeners live only while that Enter is held: one
 * set at most, removed with the release.
 */
let flowEnterHeld = false;
function releaseFlowEnter(e?: Event) {
  if (e instanceof KeyboardEvent && e.key !== 'Enter') return;
  if (!flowEnterHeld) return;
  flowEnterHeld = false;
  removeEventListener('keyup', releaseFlowEnter, true);
  removeEventListener('blur', releaseFlowEnter);
  document.removeEventListener('visibilitychange', releaseFlowEnter);
}
function holdFlowEnter() {
  if (flowEnterHeld) return;
  flowEnterHeld = true;
  addEventListener('keyup', releaseFlowEnter, true);
  addEventListener('blur', releaseFlowEnter);
  document.addEventListener('visibilitychange', releaseFlowEnter);
}
/** The picker owns destination input now: flag on, a base view, nothing else in charge, no saved-mission offer pending. */
function pickerOwns() {
  if (!picker || checkpointPending || spaceport.active || localSpaceport.active || mission.horizon || build.active || cinematic.active) return false;
  if (modes.mode !== 'baseView' || !mission.base) return false;
  return guided?.session.active ? pickerGuided() : flowOpen();
}
/** What the orbs and the card show as chosen: Guided's choice, screen 2's preview, or screen 3's confirmed destination. */
const pickerSelected = () => (pickerGuided() ? guided!.session.destination : flow?.screen === 'confirm' ? flow.confirmed : flow?.preview ?? null);
/** Send the flow's own intent (it passes the flow's gate; everything else in front of the mission still applies). */
function flowSend(intents: Intent[]) { flowSending = true; try { for (const i of intents) bus.emit(i); } finally { flowSending = false; } }
/** A tap on a destination label, a list choice or a 👆 selection: Guided's own choice, or screen 2's preview. */
function pickerChoose(baseId: string) {
  if (!pickerOwns() || flowDetailsOpen) return;
  if (pickerGuided()) guided!.chooseDestination(baseId);
  else flow!.choose(baseId);
}
/** The card's one action: Guided's 👍 Confirm; screen 2's Confirm (the mission decides); screen 3's Launch. */
function pickerConfirm() {
  if (!pickerOwns() || flowDetailsOpen) return;
  if (pickerGuided()) { guided!.requestConfirm(); return; }
  if (flow!.screen === 'select') {
    const id = flow!.confirmRequest();
    if (!id) return;
    flowSend(pickerIntents({ select: id }));
    if (flow!.afterConfirm(flowMission()) === 'refused') flowRefusedAt = performance.now();
    else flowRefusedAt = -Infinity;
  } else if (flow!.screen === 'confirm') flowSend(pickerIntents({ confirm: true }));
  flowChanged();
}
// Every route into countdown hands input to the mission immediately, even between rendered frames.
if (flow) modes.onChange((to) => {
  if (to !== 'launch' || !flowOpen()) return;
  flow.sync(flowMission());
  flowChanged();
});
/** Screen 1's way in, outside the ground view (a base view, free mode). */
function pickerCanOpenHere() {
  if (!picker || !flow || checkpointPending || guided?.session.active || spaceport.active || localSpaceport.active || mission.horizon || build.active || cinematic.active) return false;
  return modes.mode === 'baseView' && !!mission.base;
}
/** Screen 1 → 2: from the base view, or from the ground view (set aside; Back restores it). Guided: the ground view only. */
function pickerOpen() {
  if (!flow || guided?.session.active) { pickerOpenFromGround(); return; }
  if (localSpaceport.active) {
    if (pickerCanOpenFromGround() && flow.open(flowMission(), true)) { pickerFromGround = true; localSpaceport.map(); }
  } else if (pickerCanOpenHere()) flow.open(flowMission());
  flowRefusedAt = -Infinity;
  flowChanged();
}
/** Screen 1's shortcut → screen 3, for a destination confirmed in this session. It never launches. */
function pickerShowJourney() {
  if (!flow || guided?.session.active) return;
  if (localSpaceport.active) {
    if (pickerCanOpenFromGround() && flow.showJourney(flowMission(), true)) { pickerFromGround = true; localSpaceport.map(); }
  } else if (pickerCanOpenHere()) flow.showJourney(flowMission());
  flowChanged();
}
/**
 * The flow's gate in front of the mission while screen 2 or 3 is up: ← → move the preview, Escape is Back, a choice
 * from elsewhere is a preview, and only screen 3 may start a launch. The flow's own Confirm / Launch pass.
 */
function flowIntercept(intent: Intent): boolean {
  if (!flow || flowSending || guided?.session.active) return false;
  if (flow.screen === 'closed') return flowEntryIntercept(intent);
  switch (intent.type) {
    case 'next': case 'prev':
      if (flow.screen === 'select') flow.step(pickerDestinations(mission.base?.base.id ?? null).map((d) => d.baseId), intent.type === 'next' ? 1 : -1);
      return true;
    case 'chooseDestination':
      flow.choose(intent.baseId);
      return true;
    case 'launch': case 'countdown':
      return flow.screen !== 'confirm';
    case 'select': {
      // Enter: Launch's action, on screen 3 only, and never the Enter that opened the flow (still held: its repeat).
      // A pointed-at world with a base: a preview on screen 2.
      if (!intent.bodyId) return flow.screen !== 'confirm' || flowEnterHeld;
      const base = baseOn(intent.bodyId);
      if (base && flow.screen === 'select' && base.id !== mission.base?.base.id) flow.choose(base.id);
      return true;
    }
    case 'dismiss':
      if (state.menuOpen || state.passportOpen || state.weightOpen) return false;
      pickerBack();
      return true;
  }
  return false;
}
/**
 * Screen 1 (free mode, flag on): one launch flow. Every way to set a destination or start a launch in a base view —
 * the base sheet's Travel destinations and its Launch, ← → and Enter, the finger countdown, a 👆 dwell on a planet with
 * a base — opens the flow instead: screen 2 with that destination as a preview, or screen 3 for a launch request when
 * a confirmation of this session still holds. Nothing launches and the mission does not change here.
 */
function flowEntryIntercept(intent: Intent): boolean {
  if (!flow || modes.mode !== 'baseView' || !mission.base || checkpointPending) return false;
  // Where the flow cannot open (the horizon view, the cinematic, the spaceport preview: all still the base view), a
  // launch or destination request does not reach the mission either: leave that view first. (Build is a mode of its
  // own whose ← → and Enter are the palette's; it accepts no launch or destination intent.)
  const canOpen = pickerCanOpenHere() || (localSpaceport.active && pickerCanOpenFromGround());
  let preview: string | null = null, step: 1 | -1 | 0 = 0, launch = false;
  switch (intent.type) {
    case 'chooseDestination': if (intent.baseId === mission.base.base.id) return false; preview = intent.baseId; break;
    case 'next': case 'prev': step = intent.type === 'next' ? 1 : -1; break;
    case 'launch': launch = true; break;
    case 'countdown': if (intent.n !== 3) return true; launch = true; break; // its 2 and 1 count nothing without the 3
    case 'select': {
      if (!intent.bodyId) { launch = true; if (canOpen) holdFlowEnter(); break; } // Enter (spent here until released)
      const base = baseOn(intent.bodyId);
      if (!base || base.id === mission.base.base.id) return false; // the mission's own message for a world without a base
      preview = base.id;
      break;
    }
    default: return false;
  }
  if (!canOpen) return true;
  if (launch && flow.confirmedFor(flowMission())) pickerShowJourney();
  else {
    pickerOpen();
    if (preview) flow.choose(preview);
    else if (step) flow.step(pickerDestinations(mission.base.base.id).map((d) => d.baseId), step);
  }
  return true;
}
/** In the Tanegashima ground view, where the picker could take over (the same conditions, but on the ground). */
function pickerCanOpenFromGround() {
  if (!picker || checkpointPending || spaceport.active || !localSpaceport.active || mission.horizon || build.active || cinematic.active) return false;
  if (modes.mode !== 'baseView' || mission.base?.base.id !== 'cape') return false;
  return guided?.session.active ? pickerGuided() : true;
}
/** Set the ground view aside (the Earth-map switch the view controls already use) and choose from the orbs. */
function pickerOpenFromGround() {
  if (!pickerCanOpenFromGround()) return;
  pickerFromGround = true;
  localSpaceport.map();
}
/**
 * Back. Free mode: 3 → 2 (the confirmation stays), 2 → 1 (the preview is discarded; the mission is unchanged), or 2 →
 * the ground view it was opened from. Guided from the ground view: back to it. Nothing launches, the base is the same.
 */
function pickerBack() {
  if (flow && flowOpen() && !guided?.session.active) {
    if (flow.back() === 'ground') { pickerFromGround = false; localSpaceport.enter(); }
    flowRefusedAt = -Infinity;
    flowChanged();
    return;
  }
  if (!pickerFromGround) return;
  pickerFromGround = false;
  localSpaceport.enter();
}
/** One detection while the picker owns input: 👆 focus and selection, 👍 confirmation (Guided confirms itself). */
function pickerObserve(t: number) {
  const o = gestures.lastObs;
  return picker!.logic.observe({ t, pose: gestures.ui.pose, pointer: gestures.ui.pointer, thumbsUp: !!o?.thumbsUp, hand: !!o },
    picker!.view.currentTargets, { width: innerWidth, height: innerHeight }, { active: true, selected: pickerSelected(), confirmByGesture: !pickerGuided() });
}
const cinematic = new MarsCinematicDirector(rig.camera);
let cinematicRequest: CinematicRequest | null = null;
const cinematicContext = (): CinematicContext | null => {
  const base = mission.base, owner = showcases.get('jezero'), landing = showcases.landingAt('jezero');
  return base?.base.id === 'jezero' && modes.mode === 'baseView' && owner && landing
    ? { base, owner, landing, mode: modes.mode, horizon: !!mission.horizon, quality: state.quality } : null;
};
const cancelCinematic = () => { cinematicRequest = null; cinematic.cancel(); };
const cinematicControls = new CinematicControls((request) => {
  if (!FLAGS.has('cinematic') || !cinematicContext()) return;
  cancelCinematic();
  if (request === 'panorama') mission.goToGoldenHour();
  else if (mission.horizon) mission.exitHorizon();
  cinematicRequest = request;
}, cancelCinematic);
mission.baseCamera = (dt) => {
  const owned = cinematic.update(dt, reducedMotion.matches, clock.paused, rig.viewInsets);
  if (owned && mission.horizon) mission.horizonEye.copy(cinematic.eye);
  return owned;
};
if (import.meta.env.DEV) Object.assign((window as unknown as { __app: object }).__app, { cinematic });
attachPageLifecycle({
  suspend: () => { saveCheckpoint();cancelCinematic(); spaceport.close(); },
  // Keep the controls/listeners, but resume in manual mode rather than restoring a stale camera lease.
  // TrackingSession stops on every pagehide and whenever the page is hidden; pageshow deliberately never reopens the camera.
  resume: cancelCinematic,
  dispose: () => { guided?.dispose(); journeyView.dispose(); saveCheckpoint();localSpaceport.dispose();japanViewControls.dispose();japanDetail.dispose();cancelCinematic(); cinematic.dispose(); cinematicControls.dispose(); spaceport.dispose(); },
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
const buildPanel = new BuildPanel(bus.emit);
// The panel's size frames the Build camera. Observed rather than measured in the loop, where reading
// it straight after the panels' DOM writes forced a synchronous layout every frame.
let buildPanelSize = { width: 0, height: 0 };
new ResizeObserver(([entry]) => {
  const [box] = entry.borderBoxSize;
  buildPanelSize = { width: box.inlineSize, height: box.blockSize };
}).observe(document.querySelector('#build-panel')!);
const coarsePointer = matchMedia('(pointer: coarse)');
const buildGrab = new BuildGrab();
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
const cleanView = new CleanView(bus.emit, (active) => {
  system.setCleanView(active);
  if (active) rig.setInsets({ top: 0, right: 0, bottom: 0, left: 0 });
});
const header = document.querySelector<HTMLElement>('header.hud')!;
const updateHeaderSize = () => document.documentElement.style.setProperty('--header-bottom', `${Math.ceil(header.getBoundingClientRect().bottom)}px`);
new ResizeObserver(updateHeaderSize).observe(header);
addEventListener('resize', updateHeaderSize);
bus.on(() => chrome.input()); // any intent (a gesture too) wakes the UI
// Near-sunset preview (sunsetPreview.ts): the clock just before a near-sunset action, read again after it is handled.
const sunsetPreview = new SunsetPreview();
// Explore's Landmarks (jezeroLandmarks.ts): a framed landmark sits in the part of the view the Explore card leaves clear
// (below it on phones and desktop, left of it in short landscape). The mission measures it once when a landmark is framed
// and again only when the viewport changes shape (never on the card's own changes). The landmark intents
// reach the mission like toggleHorizon (intentHandler passes them on); they move only the camera, never the clock.
function exploreClear(): ClearView {
  const card = document.querySelector<HTMLElement>('#mission-overlay.explore');
  const rect = card && !card.hidden && card.getClientRects().length ? card.getBoundingClientRect() : null;
  // The header and the time bar above, the camera preview and the bottom controls below: the landmark stays between.
  let bottom = 0, top = 0;
  for (const el of document.querySelectorAll<HTMLElement>('header.hud, #preview, #timebar, footer.hud.bottom > *:not(#footer-menu)')) {
    if (el.hidden || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.height <= 0) continue;
    if (r.top > innerHeight * 0.5) bottom = Math.max(bottom, innerHeight - r.top + 8);
    else if (r.bottom < innerHeight * 0.4) top = Math.max(top, r.bottom + 8);
  }
  return clearViewFor(innerWidth, innerHeight, rect, 8, bottom, top);
}
let sunsetBefore: number | null = null;
bus.on((intent) => { if (intent.type === 'goldenHour') sunsetBefore = clock.time; });
const passportPanel = new PassportPanel(bus.emit);
const countdownGesture = new CountdownGesture();
bus.on(createIntentHandler({ state, modes, rig, clock, overlay, gestureHud, photo, mission, build, setFocus,
  beforeMission: (intent) => {
    if (missionLocked?.(intent)) return true;
    if (journeyBlocks(intent)) return true;
    if (guided?.intercept(intent)) return true;
    if (flowIntercept(intent)) return true;
    if (spaceport.active) return true;
    if(localSpaceport.active) {
      if(intent.type==='select'&&intent.bodyId)return true;
      if((modes.mode==='baseView'||modes.mode==='launch')&&intent.type==='rotate'){localSpaceport.rotate(intent.dx,intent.dy);return true;}
      if((modes.mode==='baseView'||modes.mode==='launch')&&intent.type==='zoom'){localSpaceport.zoom(intent.factor);return true;}
      if(modes.mode==='baseView'&&intent.type==='dismiss'&&!state.menuOpen&&!state.passportOpen&&!state.weightOpen){localSpaceport.map();return true;}
    }
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
// After the handler: a near-sunset action that moved the clock starts (or continues) a preview; a manual time change
// (timeNow, timeJump) discards it. Speed and pause keep it.
bus.on((intent) => {
  if (intent.type === 'goldenHour' && sunsetBefore !== null) {
    sunsetPreview.sunsetApplied(sunsetBefore, clock.time, mission.base?.base.id ?? null);
    sunsetBefore = null;
  } else sunsetPreview.intent(intent.type);
  // Leaving Explore (or the base) clears the session at once, not on the next frame's sync: nothing can read a stale
  // Restore in between.
  sunsetPreview.sync(modes.mode === 'baseView' && !!mission.horizon, mission.base?.base.id ?? null);
});

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
// Jezero time presets (timePresets.ts, sunsetPreview.ts): Day / Golden Hour / Night jump the existing clock to moments
// of Jezero's local day, anchored to the time saved before the first preset (so switching never drifts). Only the
// clock moves: the camera pose, pause and speed stay (clock.jumpTo keeps them); the lighting follows the time.
const presetSite = () => {
  const b = mission.base;
  return b && b.base.id === 'jezero' && modes.mode === 'baseView' && mission.horizon ? { body: b.body.body, lat: b.base.lat, lon: b.base.lon, id: b.base.id } : null;
};
missionOverlay.onPreset = (preset: TimePreset) => {
  const site = presetSite();
  if (!site) return;
  const before = clock.time;
  const times = presetTimes(site, sunsetPreview.state?.original ?? before);
  const to = times[preset];
  if (to === null) { gestureHud.flash(t('noSunset', state.lang)); return; } // no sunset soon: the existing message
  clock.jumpTo(to);
  sunsetPreview.presetApplied(preset, before, clock.time, site.id);
  missionOverlay.announceTime(tf('presetApplied', state.lang, { preset: t(`preset.${preset}`, state.lang), time: clockLabel(localHours(site, clock.time)) }));
};
/** Is there a Golden Hour for the sol of `anchor` (a sunset within the next days)? Cached per base and local hour. */
let goldenCache = { key: '', value: true };
function goldenAvailable(node: NonNullable<typeof mission.base>, anchor: number) {
  const key = `${node.base.id}|${Math.floor(anchor / 3_600_000)}`;
  if (goldenCache.key !== key) goldenCache = { key, value: presetTimes({ body: node.body.body, lat: node.base.lat, lon: node.base.lon }, anchor).golden !== null };
  return goldenCache.value;
}
// Restore previous time: back to the saved original, still exploring; focus stays in the time group.
missionOverlay.onRestore = () => {
  const to = sunsetPreview.restore();
  if (to === null) return;
  clock.jumpTo(to);
  missionOverlay.announceTime(t('timeRestored', state.lang));
  missionOverlay.focusPreset();
};
if (import.meta.env.DEV) Object.assign((window as unknown as { __app: object }).__app, { exploreClear, sunsetPreview, presetTimes: (ms?: number) => { const s = presetSite(); return s ? presetTimes(s, ms ?? sunsetPreview.state?.original ?? clock.time) : null; } });
const timeDial = new TimeDialOverlay();
photo.toast.shareButton.addEventListener('click', () => bus.emit({ type: 'sharePhoto' }));
photo.toast.saveButton.addEventListener('click', () => bus.emit({ type: 'savePhoto' }));
attachKeyboardAndMouse(canvas, bus, config, pickAt, buildPointer);

const debugUrl = new URLSearchParams(location.search).has('debug');
document.querySelector('#version')!.textContent = `v${__APP_VERSION__}`;

// ?debug → 🩺 Diagnostics, beside Copy report. The panel and its recorder load when first opened, and nothing is
// recorded until Start. Without ?debug there is no button and no diagnostics code is fetched.
interface DiagnosticsHooks { frame(t: number, context: () => DiagnosticsContext): void; timing(t: number, detectMs: number, processingMs: number): void }
let diagnostics: DiagnosticsHooks | null = null;
if (debugUrl) {
  const copy = document.querySelector<HTMLButtonElement>('#preview .debug-copy')!;
  const toggle = Object.assign(document.createElement('button'), { type: 'button', className: 'debug-action', id: 'diagnostics-toggle', textContent: '🩺 Diagnostics' });
  toggle.hidden = copy.hidden;
  copy.after(toggle);
  const entryChunk = new URL(import.meta.url).pathname.split('/').pop() || null; // this module is the entry chunk
  toggle.addEventListener('click', () => {
    toggle.blur(); // keep Space / Enter for the scene
    void import('./ui/diagnosticsPanel').then(({ toggleDiagnostics }) => toggleDiagnostics({ appVersion: __APP_VERSION__, entryChunk, setHooks: (hooks) => { diagnostics = hooks; } }));
  });
}
const loadingPill = document.querySelector<HTMLElement>('#loading');
/** What a diagnostics segment is keyed by; read only while a session is recording. */
function diagnosticsContext(): DiagnosticsContext {
  return {
    mode: modes.mode, spaceport: localSpaceport.active,
    phase: mission.countdown ? 'countdown' : mission.horizon ? 'horizon' : 'none',
    camera: state.status.kind, tier: state.quality,
    renderScale: localSpaceport.active ? Math.max(.6, governor.scale) : governor.scale,
    pixelRatio: (localSpaceport.renderer ?? renderer).getPixelRatio(),
    loading: loadingPill ? !loadingPill.hidden : false,
  };
}

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
  timing:(...values)=>{runtimeMetrics.tracking(...values);diagnostics?.timing(values[0],values[1],values[2]);},
  // A count or a 👍 held when the camera stopped must be made again in the next session.
  stopped: () => { countdownGesture.reset(); guided?.cameraStopped(); picker?.logic.trackingLost(); spaceport.trackingStopped(); },
  frameMode: () => modes.mode,
  // In Build mode the pinch grabs modules: the engine's pinch-zoom is dropped there.
  // While the 3D picker owns input, none of the engine's own actions apply: 👆's dwell-select, ✋'s rotate, ✌️, ✊.
  // The same while the launch preview owns input (its own 👆 dwell, 👍, ✊ cancel and ✋ home apply instead).
  keep: (i) => spaceport.ownsHand ? false : guided?.session.active ? guided.session.stage==='exploring' && (i.type==='rotate'||i.type==='zoom') : pickerOwns() ? false : !(modes.mode === 'build' && i.type === 'zoom'),
  // The launch countdown only listens at a base.
  more: (t) => {
    // The open launch preview owns the hand: nothing else counts, holds or confirms underneath it.
    if (spaceport.ownsHand) {
      countdownGesture.reset(); picker?.logic.standDown();
      const o = gestures.lastObs;
      spaceport.observeHand({ t, pose: gestures.ui.pose, pointer: gestures.ui.pointer, thumbsUp: !!o?.thumbsUp, hand: !!o });
      return [];
    }
    const owns = pickerOwns();
    if (picker && !owns) picker.logic.standDown();
    if(guided?.session.active) {
      guided.observe(t,gestures.lastObs); countdownGesture.reset();
      if (owns) { const a = pickerObserve(t); if (a.select) guided.chooseDestination(a.select); }
      return [];
    }
    // The flow owns 👆 here: no finger countdown (👆 is "1"), only its own preview and the screen's one 👍 action
    // (Confirm on screen 2, Launch on screen 3), sent by the flow itself.
    if (owns) {
      countdownGesture.reset();
      // Details open: no focus, no hold (cancelled when it opened), nothing selected or confirmed until it closes.
      if (flowDetailsOpen) { picker!.logic.standDown(); return []; }
      const a = pickerObserve(t);
      if (a.select) pickerChoose(a.select);
      if (a.confirm) pickerConfirm();
      return [];
    }
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
startTracking(trackingDeps);
// Dev only (tests): the engine, the tracking callbacks, and one tracking frame's layered gestures emitted as tracking.ts does.
if (import.meta.env.DEV) Object.assign((window as unknown as { __app: object }).__app, {
  gestures, trackingDeps,
  trackingFrame: (t: number) => { const out = trackingDeps.more(t); for (const i of out) bus.emit(i); return out; },
});
// 🖐 Turn on hand control: a new session replaces whatever stopped (it never reopens the camera by itself).
bus.on((intent) => {
  if (intent.type !== 'restartTracking') return;
  const accepted = !['loading', 'tracking'].includes(state.status.kind);
  cameraEvents.emit({ type: 'restart-requested', accepted }); // for the debug diagnostics only
  if (accepted) startTracking(trackingDeps);
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
const savedMission=readCheckpoint(storage);
/**
 * What this load starts with (app/startPlan.ts): a saved journey to offer, the link's place, free mode's start on Earth
 * (the Tanegashima ground view: also after an explicit Start fresh, and where the saved checkpoint is only an idle
 * Cape), or the app's own start. Guided and the flag-off app keep theirs. The ground view is the ground-view link's own
 * entry: one enterBase, then the ground view's own loading and error handling (no extra stamp, nothing launched).
 */
const startFacts: StartFacts = { freeMode: FLAGS.has('picker3d') && !guided, guidedActive: !!guided?.session.active, saved: savedMission, link };
const startsWith = startPlan(startFacts);
let checkpointPending=startsWith==='offer';
let startOnGround = startsWith === 'ground';
let resumeOffer:ResumeMission|null=null;
let checkpointAt=0;
if(checkpointPending&&savedMission) {
  resumeOffer=new ResumeMission(savedMission,resume=>{
    checkpointPending=false;resumeOffer=null;missionLocked=null;
    if(resume){pendingLink=false;mission.resume(savedMission);localSpaceport.restore(savedMission.view??'globe');}
    else {writeCheckpoint(storage,null);guided?.discard();const next=afterStartFresh(startFacts);startOnGround=next==='ground';pendingLink=next==='link';}
    saveCheckpoint();
  });
  // Until the offer is answered, nothing may start a different journey: checkpoints are not saved meanwhile,
  // and Continue would restore the old mission over it. Viewing, camera and settings stay free.
  const journey:readonly Intent['type'][]=['chooseDestination','launch','countdown','select','next','prev'];
  /** The base this intent would go down to, resolved the way Mission.handle does in each mode. */
  const entering=(intent:Intent,atBase:boolean)=>{
    if(intent.type==='enterBase')return intent.baseId??(atBase?undefined:baseOn(BODIES[state.focus].id)?.id);
    // Away from a base, selecting the body whose card is already open goes down to its base.
    if(intent.type==='select'&&intent.bodyId&&!atBase&&state.selected?.id===intent.bodyId)return baseOn(intent.bodyId)?.id;
    return undefined;
  };
  missionLocked=(intent)=>{
    const atBase=modes.mode==='baseView'||modes.mode==='launch'||modes.mode==='build';
    const target=entering(intent,atBase);
    const refused=target!==undefined ? target!==savedMission.baseId
      : intent.type==='toggleBuild'||(atBase&&journey.includes(intent.type));
    if(refused)resumeOffer?.remind(state.lang);
    return refused;
  };
}
// No checkpoint is offered on this load (none saved, or the link names another base): a restored guided
// journey has no native mission to continue, so it starts over before the link applies.
else guided?.discard();
// While the picker is open from the ground view, the view to return to is still the ground view.
function saveCheckpoint(){if(!checkpointPending){const snapshot=mission.checkpoint();if(snapshot){snapshot.view=localSpaceport.requested||pickerFromGround?'spaceport':'globe';writeCheckpoint(storage,snapshot);}writeLanguage(state.lang);}}
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveCheckpoint();});
if (link.time !== undefined) {
  clock.jumpTo(link.time);
  clock.paused = true; // a shared moment stays put until Space or the time bar
}
/** The body, base and view need the planets where the date puts them: applied on the first frame. */
let pendingLink = link.body !== undefined && !(checkpointPending && savedMission?.phase!=='base');
function applyLink() {
  setFocus(BODIES.findIndex((b) => b.id === link.body), true); // a link cuts there: no fly-in
  if (link.base) bus.emit({ type: 'enterBase', baseId: link.base });
  if(link.base==='cape'&&new URLSearchParams(location.search).get('site')==='ground')localSpaceport.enter();
  if (link.view === 'horizon') bus.emit({ type: 'toggleHorizon' });
}
/** Free mode's start on Earth (startPlan 'ground'): Earth in view, its base, then the Tanegashima ground view. */
function startOnTheGround() {
  setFocus(BODIES.findIndex((b) => b.id === 'earth'), true);
  bus.emit({ type: 'enterBase', baseId: 'cape' });
  localSpaceport.enter();
}
/** The address bar follows the view, quietly (replaceState: Back isn't filled with views). */
let addressKey = '';
function followAddress() {
  if(checkpointPending)return;
  const view = { body: BODIES[state.focus].id, base: mission.base?.base.id ?? null, horizon: mission.horizon !== null, lang: state.lang };
  const keepDate = link.time !== undefined && clock.paused && clock.time === link.time;
  const ground=localSpaceport.requested&&mission.base?.base.id==='cape';
  const key = `${view.body}|${view.base}|${view.horizon}|${view.lang}|${keepDate}|${ground}`;
  if (key === addressKey) return;
  addressKey = key;
  const query=new URLSearchParams(linkSearch(location.search, view, keepDate));
  if(ground)query.set('site','ground');else query.delete('site');
  const search=query.size?`?${query}`:'';
  if (search !== location.search) history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
}

/** Auto changes tier only where a rebuild can't interrupt anything: the overview, a body, a base at rest. */
function canSwitchTier() {
  if (photo.pending || document.hidden) return false;
  if (modes.mode === 'solarView' || modes.mode === 'focus') return true;
  return modes.mode === 'baseView' && !mission.horizon && !mission.countdown && !cinematic.active && !cinematicRequest;
}

renderer.setAnimationLoop((now) => {
  const cpuStart = performance.now();
  if (spaceport.active) {
    // The mission clock and auto-tier pause while exploring or presenting launch.
    const dt = frameSeconds(now - lastNow);
    lastNow = now;
    spaceport.update(dt, reducedMotion.matches);
    if (spaceport.active) {
      updateJourney(now);
      lastCpuMs = performance.now() - cpuStart;
      return;
    }
    // Completion can close the presentation during update. Render its mission
    // handoff now, rather than exposing the old pad frame for one screen refresh.
  }
  // Ultra that can't keep up gives way to High (once; choosing Ultra again re-arms it).
  if (ultraGuard.frame(now - lastNow, state.quality)) {
    setQualitySetting('high');
    gestureHud.flash(t('ultraTooSlow', state.lang));
  }
  if (governor.frame(now - lastNow)) resize();
  const autoSwitch = autoTier?.frame(now - lastNow, lastCpuMs, governor.targetMs, canSwitchTier());
  if (autoSwitch && autoSwitch !== state.quality) setQuality(autoSwitch);
  const dt = frameSeconds(now - lastNow);
  lastNow = now;
  if (clock.advance(dt)) gestureHud.flash(t('timeLimit', state.lang));
  system.update(clock.time, clock.effectiveRate, dt);
  if (pendingLink) {
    pendingLink = false;
    applyLink();
  }
  if (startOnGround) {
    startOnGround = false;
    startOnTheGround();
  }
  cinematic.validate(cinematicContext());
  if ((cinematic.active || cinematicRequest) && [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"], #weight-panel:not([hidden]), #passport-panel:not([hidden]), #photo-toast:not([hidden])')]
    .some((panel) => !panel.hidden && panel.getClientRects().length > 0 && getComputedStyle(panel).visibility !== 'hidden')) cancelCinematic();
  const holdLanding=modes.mode==='docking'&&mission.base?.base.id==='cape'&&localSpaceport.requested&&localSpaceport.status==='loading';
  const view = mission.update(holdLanding?0:dt, rig.camera);
  // Guided's destination step under the picker: its card keeps step and time; the picker's card holds the choice and Confirm.
  if (guided) guided.pickerOwnsDestination = pickerWasOwning && pickerGuided();
  guided?.render();
  const atJapan=mission.base?.base.id==='cape'&&['baseView','launch','docking'].includes(modes.mode);
  localSpaceport.sync(atJapan,atJapan&&modes.mode==='docking',mission.trip?.to.base.id==='cape',state.quality==='low');
  if(atJapan)for(const object of mission.baseRoots())object.visible=false;
  // Showcase bases: built only while their world is in focus, or a rocket is on its way there.
  // The sky over the bases in view (local time, the Sun, Phobos, Deimos, Earth), once per frame.
  skies.clear();
  const skyFor = (id: string) => {
    if (!skies.has(id)) skies.set(id, skyOver(system.bases.find((b) => b.base.id === id)!, clock.time));
    return skies.get(id)!;
  };
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
  } else if (!cinematic.active) {
    if (modes.mode === 'docking' && !cleanView.active) {
      // The landing camera still follows the same rocket and pad. Reserve the
      // controls' measured space, including expanded Help, just as the orbit view does.
      rig.applyLandingInsets();
    } else if (rig.camera.view?.enabled) {
      rig.camera.clearViewOffset();
    }
  }
  if(atJapan&&modes.mode==='baseView') {
    const insets=rig.viewInsets;
    rig.camera.setViewOffset(innerWidth,innerHeight,(insets.right-insets.left)*innerWidth/2,(insets.bottom-insets.top)*innerHeight/2,innerWidth,innerHeight);
  }
  if (cinematicRequest) {
    const context = cinematicContext();
    if (context) cinematic.start(cinematicRequest, context, reducedMotion.matches);
    cinematicRequest = null;
  }
  system.setHorizon(mission.horizon ? state.focus : null);
  if(atJapan&&!localSpaceport.active)mission.japanMapCamera(rig.camera);
  const japanNight=atJapan?skyFor('cape').local.night:0;
  japanDetail.update();
  const siteView=localSpaceport.active?'ground':atJapan?'globe':'none';
  if(canvas.dataset.siteView!==siteView)canvas.dataset.siteView=siteView;
  if(canvas.dataset.siteDetail!==localSpaceport.status)canvas.dataset.siteDetail=localSpaceport.status;
  document.body.classList.toggle('local-spaceport-view',localSpaceport.active);
  document.body.classList.toggle('horizon', mission.horizon !== null);
  system.updateView(rig.camera, state.focus, { height: innerHeight, pixelRatio: fullPixelRatio() }, dt, rig.zoomDistance, state.trueScale,atJapan);
  showcases.syncMaps(); // updateView can finish a fade and close the previously borrowed image.
  // A photo gets every pixel the tier allows; auto-quality measures afresh afterwards.
  if (photo.pending && governor.scale < 1) {
    governor.reset();
    resize();
  }
  if (overlay.enabled) {
    const target = governor.targetMs;
    overlay.resolutionInfo = `${Math.round((localSpaceport.active?Math.max(.6,governor.scale):governor.scale) * 100)}% · ${(localSpaceport.renderer??renderer).getPixelRatio().toFixed(2)}x · holds ${target ? Math.round(1000 / target) : '—'} fps`;
    overlay.tierInfo = autoTier ? `Auto: ${autoTier.describe()}` : `${state.qualitySetting} (fixed)`;
  }
  debug.frameStats?.setContext((localSpaceport.renderer??renderer).getContext() as WebGL2RenderingContext);
  // The picker's orbs follow this frame's camera; its labels and card are placed in the free band of the page.
  // When it takes over, the base sheet folds once (phones only) so the scene is the selection area; its handle reopens it.
  // The flow follows the mission: a broken confirmation is dropped for good, and screens it can no longer show close.
  if (flow) { flow.sync(flowMission()); flowChanged(); }
  const owning = pickerOwns();
  // Hold passport stamp notifications while the picker is open; if already visible, clear and retain for return.
  if (owning) {
    if (activeStampText !== null) {
      pendingStampText = activeStampText;
      activeStampText = null;
      clearTimeout(stampClearTimer);
      gestureHud.hideFlash();
    }
  } else if (pendingStampText !== null && !spaceport.active && !checkpointPending && !state.menuOpen && !state.passportOpen && !state.weightOpen) {
    const deferred = pendingStampText;
    pendingStampText = null;
    showPassportStampToast(deferred);
  }
  const flowScreen = owning && !pickerGuided() && flow ? flow.screen : 'closed';
  if (document.body.classList.contains('destination-flow') !== (flowScreen !== 'closed')) document.body.classList.toggle('destination-flow', flowScreen !== 'closed');
  if (owning && !pickerWasOwning) basePanel.collapse();
  pickerWasOwning = owning;
  // Left the picker some other way than Back (a confirmed launch, another mode): there is no ground view to return to.
  if (pickerFromGround && !owning) pickerFromGround = false;
  basePanel.holdFolded = owning;
  // Its orbs are drawn in the base pass too, so the base model never paints over them.
  // SPIKE: the studio shows exactly when free mode's screen 2 or 3 is shown (never Guided's step, never photo mode).
  const studioOn = !!studioStage && !!picker && owning && flowScreen !== 'closed' && !!mission.base && !document.body.classList.contains('photo-mode');
  if (studioStage && picker) { if (studioOn) studioStage.enter(picker.view.object3d); else studioStage.exit(picker.view.object3d); }
  if (document.body.classList.contains('studio-view') !== studioOn) document.body.classList.toggle('studio-view', studioOn);
  if (owning && picker && !studioOn && pipeline.baseRoots.length) pipeline.baseRoots = [...pipeline.baseRoots, picker.view.object3d];
  // Acceptance shows as the launch countdown (or Guided's own ✓), never as a claim of the picker's.
  picker?.view.update({
    active: owning && !document.body.classList.contains('photo-mode'), camera: studioOn ? studioStage!.camera : rig.camera, studio: studioOn, lang: state.lang,
    currentBase: mission.base?.base.id ?? null, selected: pickerSelected(), hover: picker.logic.hover,
    focusProgress: picker.logic.focusProgress,
    confirmProgress: pickerGuided() ? guided!.holdProgress : picker.logic.confirmProgress,
    waitingRelease: pickerGuided() ? guided!.holdWaitingRelease : picker.logic.waitingRelease,
    // Guided's own button words (guidedMission.ts), or Launch's (screen 3; screen 2's Confirm words are the view's).
    confirmLabel: pickerGuided() ? { en: '👍 Confirm', ja: '👍 確認', my: '👍 အတည်ပြုရန်' }[state.lang] : `🚀 ${t('launch', state.lang)}`,
    reducedMotion: reducedMotion.matches, fromGround: pickerFromGround, dt,
    screen: pickerGuided() ? 'guided' : flowScreen === 'confirm' ? 'confirm' : 'select',
    confirmed: flow?.confirmed ?? null, refused: now - flowRefusedAt < 5000, generation: flow?.generation ?? 0,
    // Screen 1's way in: free mode in a base view or the ground view; Guided in the ground view only (as before).
    entry: (() => {
      const m = flowMission(), free = !!flow && !guided?.session.active;
      const canOpen = guided?.session.active ? pickerCanOpenFromGround() : pickerCanOpenFromGround() || pickerCanOpenHere();
      return { canOpen, journey: free ? flow!.confirmedFor(m) : null, saved: free ? flow!.savedFor(m) : null };
    })(),
  }, now);
  if (menuPause) {
    const label = `${clock.paused ? '▶' : '⏸'} ${(clock.paused ? RESUME_WORDS : PAUSE_WORDS)[state.lang]}`;
    if (menuPause.textContent !== label) menuPause.textContent = label;
    menuPause.setAttribute('aria-pressed', String(clock.paused));
  }
  debug.frameStats?.beginGpu();
  pipeline.bloomEnabled=PROFILES[state.quality].bloom;pipeline.exposureScale=1;
  // SPIKE: one view is drawn per frame: the studio, or the ground view, or the solar-system pipeline.
  if (studioOn) studioStage!.render(renderer, config.render.exposure, innerWidth / innerHeight);
  else if(localSpaceport.active&&atJapan) {
    localSpaceport.render({phase:modes.mode as 'baseView'|'launch'|'docking',stacked:mission.vehicleStacked,docking:mission.dock?.state??null},holdLanding?0:dt,state.quality==='low',japanNight,rig.viewInsets,reducedMotion.matches,governor.scale);
  }else pipeline.render();
  // With the picker flag, the vehicle marker yields to the picker's way in (the button never moves to dodge it).
  activeVehicle.update(localSpaceport.vehicleObject,localSpaceport.camera??rig.camera,localSpaceport.active&&!spaceport.active,state.lang,picker?.view.entryZone()??null);
  const earthMapVisible=atJapan||(modes.mode==='focus'&&BODIES[state.focus].id==='earth');
  // While the 3D picker is choosing, the Japan marker (a scene control) steps aside rather than sit among the orbs.
  // With the picker flag it also yields to screen 1's way in, like the vehicle marker (the way in never moves).
  japanViewControls.update(japanBase.group,rig.camera,earthMapVisible&&!localSpaceport.active&&!spaceport.active&&!owning,picker?.view.entryZone()??null);
  showcases.afterRender();
  debug.frameStats?.endGpu();
  photo.afterRender();
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
  // Show the same stabilized point and target the picker uses to select.
  const pickerUi = picker && pickerOwns() ? { ...gestures.ui, action: null,
    pointer: picker.logic.cursorAt(now, innerWidth, innerHeight), hoverId: picker.logic.hover, progress: picker.logic.focusProgress } : null;
  // While the launch preview owns the hand it draws its own cursor dot and ring on the target: no global pointer ring.
  const spaceportUi = spaceport.ownsHand ? { ...gestures.ui, action: null, pointer: null, progress: 0 } : null;
  gestureHud.render(spaceportUi ?? pickerUi ?? (guided?.session.active ? {...gestures.ui,action:null,pointer:null} : gestures.ui), guided?.session.active ? {...extras.ui,action:null} : extras.ui, state.lang);
  // A preview lives only while Explore (the horizon view) is open at its base.
  sunsetPreview.sync(modes.mode === 'baseView' && !!mission.horizon, mission.base?.base.id ?? null);
  timeBar.render(clock, state.lang, state.timeBarOpen, now);
  timeDial.render(extras.ui.dialActive, clock, state.lang);
  credits.update(state.lang);
  const hereSky = mission.base && (modes.mode === 'baseView' || mission.horizon) ? skyFor(mission.base.base.id) : null;
  mission.setRocketNight(mission.base ? skyFor(mission.base.base.id).local.night : 0);
  const cinematicAvailable = FLAGS.has('cinematic') && modes.mode === 'baseView' && mission.base?.base.id === 'jezero';
  const spaceportAvailable = modes.mode === 'baseView' && mission.base?.base.id === 'cape';
  spaceport.render(state.lang, state.quality === 'low', reducedMotion.matches,spaceportAvailable);
  japanViewControls.render(state.lang,localSpaceport.active,localSpaceport.requested,localSpaceport.status,atJapan&&modes.mode==='docking');
  // The base sheet steps aside while the 3D picker is a selection view of its own: Guided's destination step (the
  // sheet's travel buttons do nothing there: Guided owns that choice), or the picker opened from the ground view (the
  // ground view's controls come back with Back). Elsewhere it stays, folded once, with its handle.
  // Free mode: the base sheet is screen 1's; screens 2–3 own the screen while they are up. Its Travel button opens the
  // flow, so it says so: "View journey" for a confirmation of this session, else "Choose a destination" (Launch is
  // only screen 3's). Guided and flag off: Launch, as before.
  basePanel.launchAction = flow && !guided?.session.active
    ? (flow.confirmedFor(flowMission()) ? FLOW_VIEW_WORDS : FLOW_CHOOSE_WORDS)[state.lang] : null;
  const sheetAside = owning && (pickerGuided() || pickerFromGround || flowScreen !== 'closed');
  basePanel.render(modes.mode === 'baseView' && !mission.horizon && !sheetAside ? mission.base?.base ?? null : null, state.lang, mission.destination?.base.id ?? null, hereSky, build.enabled,
    spaceportAvailable ? spaceport.root : cinematicAvailable ? cinematicControls.root : undefined);
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
    // Exploring on foot (the horizon view): the place's name, the looks taken (the hint goes after the first), a hand driving.
    explore: mission.horizon && hereSky && mission.base ? { base: mission.base.base.name[state.lang],
      body: BODIES.find((b) => b.id === mission.base!.base.body)!.name[state.lang], looks: mission.horizonLooks, hand: state.status.kind === 'tracking',
      // Jezero's time group: the active preset, Restore's original, whether a sunset is ahead (Golden Hour).
      time: mission.base.base.id === 'jezero' ? { preset: sunsetPreview.activePreset(clock.time), restore: sunsetPreview.state?.original ?? null,
        golden: goldenAvailable(mission.base, sunsetPreview.state?.original ?? clock.time) } : null,
      // Jezero's Landmarks list: the framed landmark, and whether Back to overview has a pose to return to.
      landmarks: mission.base.base.id === 'jezero' ? { selected: mission.landmark, canReturn: mission.landmarkCanReturn } : null } : null,
    // Quantized so the overlay only rebuilds a few times a second.
    docking: modes.mode === 'docking' && mission.dock
      ? { altitude: Math.round((mission.dock.state.alt / mission.dock.startAlt) * 50) / 50, auto: mission.dock.auto || state.autoLand, sensitivity: state.steerSensitivity,telemetry:landingTelemetry(mission.dock.state,mission.dock.params) }
      : null,
  }, state.lang, guided?.session.active ?? false);
  updateJourney(now);
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
  followAddress();
  resumeOffer?.render(state.lang);
  if(now-checkpointAt>1000){saveCheckpoint();checkpointAt=now;overlay.runtimeInfo=JSON.stringify(runtimeMetrics.report());}
  // Idle eligibility must see this frame's panel visibility before deciding to fade.
  const missionActive = modes.mode === 'launch' || modes.mode === 'travel' || modes.mode === 'docking';
  document.body.classList.toggle('mission-active', missionActive);
  if (document.body.dataset.mode !== modes.mode) document.body.dataset.mode = modes.mode;
  cleanView.update(state.lang, modes.mode);
  chrome.update(now, modes.mode, gestures.ui.pointer !== null);
  if (journeyFrameCut) { journeyFrameCut = false; rig.settleFraming(); }
  if (cleanView.active) rig.setInsets({ top: 0, right: 0, bottom: 0, left: 0 });
  // Optional warm-up must not retain programs belonging to replaceable base or
  // mission owners. Defer until navigation returns to the persistent scene.
  if (prewarmPending && !showcases.hasEntries && (modes.mode === 'focus' || modes.mode === 'solarView')) {
    prewarmPending = false; // coalesce rapid quality requests
    void pipeline.prewarm();
  }
  lastCpuMs = performance.now() - cpuStart;
  const frameEnd = performance.now();
  runtimeMetrics.render(frameEnd);
  diagnostics?.frame(frameEnd, diagnosticsContext);
  debug.frameStats?.frame(now, lastCpuMs);
});
