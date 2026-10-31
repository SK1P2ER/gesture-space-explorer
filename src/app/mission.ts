import * as THREE from 'three';
import { BASES, baseById, baseOn } from '../data/bases';
import { BODIES, type Body } from '../data/bodies';
import type { Intent } from '../intents';
import { nextInSystem } from '../navigation';
import type { CameraRig } from '../scene/cameraRig';
import { LAYOUTS } from '../scene/baseKit/showcases';
import { setBaseLayer } from '../scene/baseKit/baseLighting';
import { padFrame, type BaseNode } from '../scene/bases';
import { WarpStreaks } from '../scene/rocket';
import { Rocket, SEPARATE_AT, type RocketOptions } from '../scene/rocketKit';
import { DUST_PUFFS, PadDust } from '../scene/padDust';
import { atmosphereOf, dustFor, type Atmosphere } from '../data/atmosphere';
import type { SimClock } from '../sim/clock';
import { dockingParams, startDocking, stepDocking, STEER_RANGE, type DockingParams, type DockingState } from '../sim/docking';
import type { LandingContext } from '../sim/landingReplay';
import { stamp } from '../sim/passport';
import { fuelLeft, routeKm, tripFuel } from '../sim/route';
import type { MissionReadout } from '../ui/missionHud';
import { writePassport } from './settings';
import { arcBetween, bezier, bezierTangent, flightProgress, SKIP_TO, travelSeconds, warpLevel, type V3 } from '../sim/travel';
import { t, tf } from '../ui/i18n';
import type { ModeMachine } from './modes';
import type { AppState } from './state';

export interface MissionDeps {
  state: AppState;
  modes: ModeMachine;
  rig: CameraRig;
  clock: SimClock;
  bases: BaseNode[];
  scene: THREE.Scene;
  /** Focus a body (flies the camera there; SolarView or Focus mode). */
  setFocus: (index: number) => void;
  /** A short on-screen message. */
  flash: (text: string) => void;
  reducedMotion: () => boolean;
  /** The next golden hour at a base: when (ms) and where the Sun will be (base frame); null if the Sun won't set soon. */
  goldenHour: (base: BaseNode) => { ms: number; sun: THREE.Vector3 } | null;
  /** How to build the rocket: texture size and detail from the quality setting. */
  rocketOptions: () => RocketOptions;
  /** Something that should never happen and was recovered from: for the console and the ?debug report. */
  report?: (message: string) => void;
  /** A rocket lifted off from one base for another (AstroLife counts a booked journey from here). */
  liftedOff?: (fromBaseId: string, toBaseId: string) => void;
  /** A rocket touched down on a base's pad. */
  landed?: (baseId: string) => void;
}

/** How the camera is driven this frame: the rig, aimed at a point; or by the mission itself (the chase view). */
export type CameraControl = { target: THREE.Vector3 } | 'chase' | null;

/** The approach point: this many base sizes above the destination pad. */
export const APPROACH_HEIGHT = 3;
/** The landing legs start to open this far into the descent (0–1), and take this long. */
export const LEGS_AT = 0.4;
export const LEGS_SECONDS = 1;
/** The camera shakes this long after liftoff (not with reduced motion). */
export const SHAKE_SECONDS = 1.2;
/** Landing dust starts this far into the descent (0–1). */
export const DUST_FROM = 0.65;
/** At booster separation, the camera looks back at the booster tumbling away for this long. */
export const LOOK_BACK_SECONDS = 1.5;
/** How much of the look-back view to use, t seconds into it: eases in and out over 0.35 s. */
export function lookBackWeight(t: number) {
  const ramp = 0.35;
  const w = Math.max(0, Math.min(1, t / ramp, (LOOK_BACK_SECONDS - t) / ramp));
  return w * w * (3 - 2 * w);
}
/** How far the legs are out during a landing: none before LEGS_AT of the descent, then easing out over LEGS_SECONDS. */
export const legDeploy = (progress: number, secondsSince: number) => (progress < LEGS_AT ? 0 : Math.min(1, secondsSince / LEGS_SECONDS));
/** Base sizes per pad radius (the pad is PAD_RADIUS of a base size), to place the docking rocket. */
const PAD_RADIUS = 0.35;
/** How far the arrow keys move the steering point per press (−1 … 1 across). */
const KEY_STEP = 0.25;

const bodyIndex = (id: string) => BODIES.findIndex((b) => b.id === id);

/** Push a point out to `radius` from `center` if it's inside (the chase camera must stay above ground). */
export function keepAbove(point: THREE.Vector3, center: THREE.Vector3, radius: number) {
  const d = point.distanceTo(center);
  if (d < radius) point.sub(center).multiplyScalar(radius / Math.max(d, 1e-9)).add(center);
  return point;
}
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];
const vec = (a: V3) => new THREE.Vector3(...a);

interface Countdown {
  count: 3 | 2 | 1;
  /** Seconds since the last count. */
  timer: number;
  /** Counting by itself (button, Enter) or by hand (fingers). */
  auto: boolean;
}

interface Trip {
  from: BaseNode;
  to: BaseNode;
  elapsed: number;
  seconds: number;
  /** The real distance, km, and the share of the tank it burns. */
  km: number;
  fuel: number;
  /** Lifted off as the lander alone (no booster to drop). */
  lander: boolean;
  /** Seconds into the look-back at the separating booster (null: none, or over). */
  lookBack: number | null;
  /** The camera when the rocket lifted off, to ease from it into the chase view. */
  camStart: { position: THREE.Vector3; quaternion: THREE.Quaternion };
}

/**
 * Bases, rockets and landings: everything from BaseView on. Takes the intents
 * those modes reinterpret (handle returns true when it did), moves the rocket,
 * and drives the camera there (update).
 */
export class Mission {
  /** One exclusive BaseView camera lease; false leaves the existing owner in control. */
  baseCamera: ((dt: number, camera: THREE.PerspectiveCamera) => boolean) | null = null;
  /** The base you're at (BaseView, Launch), or arriving at (Docking). */
  base: BaseNode | null = null;
  /** Where the rocket will go. */
  destination: BaseNode | null = null;
  countdown: Countdown | null = null;
  trip: Trip | null = null;
  /** The docking mini-game, while in Docking. */
  dock: { state: DockingState; params: DockingParams; steer: { x: number; y: number } | null; auto: boolean; startAlt: number; misses: number; settle: number; legT: number } | null = null;
  /** The rocket (v2.2): built the first time it's needed, freed when you leave the bases and trips. */
  private kit: { rocket: Rocket; key: string; dust: PadDust; layers?: string } | null = null;
  /** A full stack (booster attached), or the lander alone after a separation. Kept here: the rocket itself may be freed and rebuilt. */
  private stacked = true;
  private night = 0;
  /** The pad the dust is on (it settles there after the engines stop). */
  private dustPad: BaseNode | null = null;
  readonly warp = new WarpStreaks();
  /** The clock's speed before you came down to a base: bases run in real time, so they don't spin away. */
  private savedRate: number | null = null;
  /** The horizon view (showcase bases): standing on the ground, looking along it. Yaw turns round the base. */
  horizon: { yaw: number; pitch: number; distance: number } | null = null;
  /** Where the horizon view's eye stands, in the base's frame (for the sky dome). */
  readonly horizonEye = new THREE.Vector3();
  private savedClip: { near: number; far: number } | null = null;
  /** The horizon camera's eye and look point, in the base's frame (eased there, so it rides along with the ground). */
  private horizonCam: { eye: THREE.Vector3; look: THREE.Vector3 } | null = null;
  /** Build mode: where the camera looks on the ground (base units; drag pans), and how much it frames (set by main for the screen). */
  readonly buildPan = new THREE.Vector2();
  buildFrame = 1.2;
  private seconds = 0;
  /** What the last trip burned, for the fuel gauge while docking. */
  private lastTripFuel = 0;
  /** The latest landing's settings, for ?debug recordings (replayable with sim/landingReplay.ts). */
  lastLanding: LandingContext | null = null;

  constructor(private readonly d: MissionDeps) {
    d.scene.add(this.warp.lines);
  }

  /** The rocket's scene object (built on first use, at the current quality). */
  get rocket(): THREE.Group {
    if (!this.kit) this.buildRocket();
    return this.kit!.rocket.group;
  }

  /** Once a frame: rebuild if the quality changed (the options are compared here, not on every read). */
  private checkRocket() {
    if (this.kit && this.kit.key !== JSON.stringify(this.d.rocketOptions())) this.freeRocket();
  }

  private buildRocket() {
    const opts = this.d.rocketOptions();
    const key = JSON.stringify(opts);
    {
      const rocket = new Rocket(opts);
      if (!this.stacked) rocket.separate(true); // the booster is long gone: a lander
      const dust = new PadDust(opts.quality === 'low' ? DUST_PUFFS.few : DUST_PUFFS.full);
      this.d.scene.add(rocket.group, dust.mesh);
      this.kit = { rocket, key, dust };
    }
  }

  private freeRocket() {
    this.kit?.rocket.dispose();
    this.kit?.dust.dispose();
    this.kit = null;
  }

  /** Windows glow after dark; sunlit paint and dust dim. */
  setRocketNight(night: number) {
    this.night = night;
    this.kit?.rocket.setNight(night, this.rocketOnBaseLayer);
  }

  /**
   * Is the rocket drawn in the base pass (v2.3)? At a showcase base, standing, counting down,
   * landing or in Build mode: lit by the base's Sun and casting its shadow. In flight, with the planets.
   */
  get rocketOnBaseLayer() {
    const mode = this.d.modes.mode;
    return this.baseShadows && !!this.base && !!LAYOUTS[this.base.base.id] && (mode === 'baseView' || mode === 'launch' || mode === 'docking' || mode === 'build');
  }

  /** The rocket and its dust, as scene branches (the base pass draws only what it needs). */
  baseRoots(): THREE.Object3D[] {
    return this.kit ? [this.kit.rocket.group, this.kit.dust.mesh] : [];
  }

  /** A showcase base has its own Sun, pass and shadows (High, Ultra; Low: off). Set by main from the quality. */
  baseShadows = false;

  /** Engines at this level, in this air (whichever stage is firing; steady with reduced motion). */
  private thrust(level: number, air: Atmosphere) {
    this.kit?.rocket.setThrust(level, this.seconds, air, this.d.reducedMotion());
  }

  /** The rocket's numbers, if it exists (for tests and the budget). */
  rocketStats() {
    return this.kit?.rocket.stats() ?? null;
  }

  private legs(deploy: number) {
    this.kit?.rocket.setLegs(deploy);
  }

  node(baseId: string) {
    return this.d.bases.find((b) => b.base.id === baseId)!;
  }

  /** What pointing can pick: in BaseView, any body with a base (to fly to); otherwise the usual. */
  pickFilter(): ((body: Body) => boolean) | null {
    return this.d.modes.mode === 'baseView' ? (body) => baseOn(body.id) !== null : null;
  }

  /** Fly down to a base (from wherever you are, through its body's Focus). */
  enter(baseId: string) {
    const { modes, state, clock } = this.d;
    const b = this.node(baseId);
    const index = bodyIndex(b.base.body);
    if (modes.mode === 'solarView' || state.focus !== index) this.d.setFocus(index);
    if (!modes.go('baseView')) return;
    this.base = b;
    if (this.destination === b) this.destination = null;
    this.stampPassport(b);
    this.stacked = true;
    this.kit?.rocket.restack();
    state.selected = null;
    if (this.savedRate === null && !clock.paused) {
      this.savedRate = clock.rate;
      clock.setRate(1);
    }
    this.frameBase(b);
  }

  private frameBase(b: BaseNode) {
    const size = padFrame(b).size;
    this.d.rig.focus(size * 0.2, size * (LAYOUTS[b.base.id]?.frame ?? 0.55), false); // a showcase base is bigger
  }

  /** Back up to orbit around the base's body. */
  leave() {
    if (!this.base || !this.d.modes.canGo('focus')) return;
    const index = bodyIndex(this.base.base.body);
    this.release();
    this.d.setFocus(index);
  }

  /** O or the 🌄 button at a showcase base: down to the ground and back. */
  toggleHorizon() {
    if (this.horizon) return this.exitHorizon();
    if (!this.base || !LAYOUTS[this.base.base.id] || this.d.modes.mode !== 'baseView') return;
    this.horizon = { yaw: Math.PI / 2 - 0.25, pitch: 0.04, distance: 2.1 }; // south of the base, clear of the panels
    // Start from where the camera is now, in the base's frame, and glide down from there.
    const g = this.base.group;
    g.updateWorldMatrix(true, false);
    const eye = g.worldToLocal(this.d.rig.camera.position.clone());
    const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(this.d.rig.camera.quaternion).add(this.d.rig.camera.position);
    this.horizonCam = { eye, look: g.worldToLocal(ahead) };
    // The eye is a few cm (scene units) off the ground: clip much nearer than the orbit views need.
    const cam = this.d.rig.camera;
    this.savedClip = { near: cam.near, far: cam.far };
    cam.near = 0.002;
    cam.far = 1200; // the starfield is 600–1000 out
    cam.updateProjectionMatrix();
  }

  /**
   * 🌅 Golden hour: time jumps (like timeJump) to the Sun 6° above the horizon before the next
   * local sunset, and the horizon view opens looking across the light: long shadows, warm walls.
   */
  goToGoldenHour() {
    if (!this.base || !LAYOUTS[this.base.base.id]) return;
    const golden = this.d.goldenHour(this.base);
    if (!golden) return this.d.flash(t('noSunset', this.d.state.lang));
    this.d.clock.jumpTo(golden.ms);
    if (!this.horizon) this.toggleHorizon();
    if (this.horizon) {
      // Stand to the side of the Sun's line, looking in across the base: the light rakes from the side.
      this.horizon.yaw = Math.atan2(golden.sun.z, golden.sun.x) + Math.PI / 2;
      this.horizon.pitch = 0.04;
    }
  }

  /** Back up to the usual view over the base. */
  exitHorizon() {
    if (!this.horizon) return;
    this.horizon = null;
    this.horizonCam = null;
    const cam = this.d.rig.camera;
    if (this.savedClip) [cam.near, cam.far] = [this.savedClip.near, this.savedClip.far];
    this.savedClip = null;
    cam.updateProjectionMatrix();
    cam.up.set(0, 1, 0);
    if (this.base) {
      this.d.rig.adopt(cam.position, padFrame(this.base).center);
      this.frameBase(this.base);
    }
  }

  /** Done with bases: forget them and give the clock its speed back. */
  private release() {
    this.exitHorizon();
    this.base = this.destination = null;
    this.countdown = null;
    if (this.savedRate !== null) this.d.clock.setRate(this.savedRate);
    this.savedRate = null;
  }

  /** ← → in BaseView: the next base to fly to. */
  private cycleDestination(dir: 1 | -1) {
    const others = BASES.filter((b) => b.id !== this.base?.base.id);
    const i = this.destination ? others.findIndex((b) => b.id === this.destination!.base.id) : dir === 1 ? -1 : 0;
    this.destination = this.node(others[(i + dir + others.length) % others.length].id);
  }

  private choose(baseId: string) {
    if (baseId !== this.base?.base.id) this.destination = this.node(baseId);
  }

  /** Enter, the button, or the first finger count: the countdown starts. */
  private startCountdown(auto: boolean) {
    if (!this.destination) return this.d.flash(t('chooseFirst', this.d.state.lang));
    this.exitHorizon();
    if (!this.d.modes.go('launch')) return;
    this.countdown = { count: 3, timer: 0, auto };
  }

  private abort() {
    this.countdown = null;
    this.d.modes.go('baseView');
    this.d.flash(t('launchAborted', this.d.state.lang));
  }

  private liftoff() {
    const { modes, rig } = this.d;
    if (!this.base || !this.destination || !modes.go('travel')) return;
    this.countdown = null;
    const from = padFrame(this.base).center.clone();
    const to = padFrame(this.destination).center.clone();
    this.trip = {
      from: this.base,
      to: this.destination,
      elapsed: 0,
      seconds: travelSeconds(from.distanceTo(to)),
      km: routeKm(this.base.base.body, this.destination.base.body, this.d.clock.time),
      fuel: tripFuel(routeKm(this.base.base.body, this.destination.base.body, this.d.clock.time)),
      camStart: { position: rig.camera.position.clone(), quaternion: rig.camera.quaternion.clone() },
      lander: !this.stacked,
      lookBack: null,
    };
    this.d.flash(t('liftoff', this.d.state.lang));
    this.d.liftedOff?.(this.trip.from.base.id, this.trip.to.base.id);
  }

  /** The arc as it is now (the planets move): from above the start pad to the approach point above the far one. */
  private arc(trip: Trip) {
    const a = padFrame(trip.from);
    const startN = a.normal.clone();
    const start = a.center.clone().addScaledVector(startN, a.size * 0.6);
    const b = padFrame(trip.to);
    const end = b.center.clone().addScaledVector(b.normal, b.size * APPROACH_HEIGHT);
    return arcBetween(v3(start), v3(startN), v3(end), v3(b.normal));
  }

  /** The rocket has reached the approach point above the destination. */
  private arrive() {
    const { modes, state, rig } = this.d;
    const trip = this.trip!;
    this.trip = null;
    this.lastTripFuel = trip.fuel;
    this.base = trip.to;
    this.destination = null;
    state.focus = bodyIndex(trip.to.base.body);
    rig.adopt(rig.camera.position, padFrame(trip.to).center);
    if (!modes.go('docking')) return;
    this.startDock(0); // docking() drives the camera from here, easing in from the chase view
  }

  /** A docking attempt from the approach height (pad radii). */
  private startDock(misses: number) {
    const body = BODIES[bodyIndex(this.base!.base.body)];
    const startAlt = APPROACH_HEIGHT / PAD_RADIUS;
    this.lastLanding = { baseId: this.base!.base.id, gravity: body.gravity, sensitivity: this.d.state.steerSensitivity, autoLand: this.d.state.autoLand, startAlt };
    this.dock = { state: startDocking(startAlt), startAlt, params: dockingParams(body.gravity), steer: null, auto: false, misses, settle: 0, legT: 0 };
  }

  private land() {
    if (!this.base || !this.d.modes.go('baseView')) return;
    this.dock = null;
    // Hand the camera back to the rig (world-up again) where it is now.
    const { rig } = this.d;
    rig.camera.up.set(0, 1, 0);
    rig.adopt(rig.camera.position, padFrame(this.base).center);
    this.frameBase(this.base);
    this.d.flash(tf('landedOn', this.d.state.lang, { name: this.base.base.name[this.d.state.lang] }));
    this.stampPassport(this.base);
    this.d.landed?.(this.base.base.id);
  }

  /** A stamp for a base you've reached (the first time only), kept on the device. */
  private stampPassport(b: BaseNode) {
    const { state } = this.d;
    const { passport, isNew } = stamp(state.passport, b.base.id, Date.now());
    if (!isNew) return;
    state.passport = passport;
    writePassport(passport);
    // After the arrival message (the HUD shows one at a time).
    setTimeout(() => this.d.flash(tf('newStamp', state.lang, { name: b.base.name[state.lang] })), 1600);
  }

  /** The mission HUD's numbers: fuel, distance and time left, and the base. Null outside bases and trips. */
  readout(): MissionReadout | null {
    const { modes, state } = this.d;
    const name = (b: BaseNode) => b.base.name[state.lang];
    switch (modes.mode) {
      case 'baseView':
      case 'launch':
        return this.base ? { base: name(this.base), fuel: 1, km: null, eta: null } : null; // refueled at every base
      case 'travel': {
        const trip = this.trip;
        if (!trip) return null;
        const fraction = Math.min(1, trip.elapsed / trip.seconds);
        const u = flightProgress(fraction);
        return { base: name(trip.to), fuel: fuelLeft(u, trip.fuel), km: trip.km * (1 - u), eta: Math.max(0, trip.seconds - trip.elapsed) };
      }
      case 'docking': {
        const d = this.dock;
        if (!d || !this.base) return null;
        // Hovering burns a little more, the longer (and the more tries) it takes.
        const burn = Math.min(0.1, 0.03 * (d.misses + 1 - d.state.alt / d.startAlt));
        return { base: name(this.base), fuel: Math.max(0, 1 - this.lastTripFuel - burn), km: null, eta: null };
      }
      default:
        return null;
    }
  }

  /** Arrow keys in Docking: nudge the steering point. */
  private nudge(dx: number, dy: number) {
    const d = this.dock!;
    const s = d.steer ?? { x: d.state.x / STEER_RANGE, y: d.state.z / STEER_RANGE };
    const c = (v: number) => Math.max(-1, Math.min(1, v));
    d.steer = { x: c(s.x + dx * KEY_STEP), y: c(s.y + dy * KEY_STEP) };
  }

  /**
   * BaseView with no base: the state the M-at-Jezero defect left behind. Nothing reaches it now,
   * but if anything does, recover to the overview once rather than throwing from every frame
   * (which froze the scene). Checked at the intent and frame boundaries. Returns true if it recovered.
   */
  private recoverOrphanedBaseView(boundary: 'intent' | 'frame'): boolean {
    if (this.d.modes.mode !== 'baseView' || this.base !== null) return false;
    const message = `Mission invariant: baseView without an active base (at the ${boundary} boundary); recovered to SolarView`;
    console.error(`[mission] ${message}`);
    this.d.report?.(message);
    this.release(); // horizon, countdown, destination and the clock's saved speed
    this.d.setFocus(0); // the Sun: the overview
    return true;
  }

  /** Mode-specific meanings of intents. Returns true if it took the intent. */
  handle(intent: Intent): boolean {
    if (this.recoverOrphanedBaseView('intent')) return true; // the intent only recovers: it was meant for a broken view
    const { modes, state } = this.d;
    if (intent.type === 'dismiss' && (state.passportOpen || state.menuOpen)) return false; // Esc closes the passport or menu first
    switch (modes.mode) {
      case 'solarView':
      case 'focus':
        if (intent.type === 'enterBase') {
          const id = intent.baseId ?? baseOn(BODIES[state.focus].id)?.id;
          if (id) this.enter(id);
          return true;
        }
        // Pointing at (or clicking) the planet whose card is already open: go down to its base.
        if (intent.type === 'select' && intent.bodyId && state.selected?.id === intent.bodyId) {
          const base = baseOn(intent.bodyId);
          if (base) {
            this.enter(base.id);
            return true;
          }
        }
        return false;

      case 'baseView':
        if (intent.type === 'toggleHorizon') {
          this.toggleHorizon();
          return true;
        }
        if (intent.type === 'goldenHour') {
          this.goToGoldenHour();
          return true;
        }
        if (this.horizon) {
          // On the ground: drag (or the open hand) looks around, zoom steps closer or back, Esc stands up.
          if (intent.type === 'rotate') {
            this.horizon.yaw += intent.dx;
            this.horizon.pitch = THREE.MathUtils.clamp(this.horizon.pitch - intent.dy * 0.5, -0.15, 0.6);
            return true;
          }
          if (intent.type === 'zoom') {
            this.horizon.distance = THREE.MathUtils.clamp(this.horizon.distance * intent.factor, 0.7, 2.3);
            return true;
          }
          if (intent.type === 'dismiss' && !state.weightOpen) {
            this.exitHorizon();
            return true;
          }
        }
        switch (intent.type) {
          case 'next': this.cycleDestination(1); return true;
          case 'prev': this.cycleDestination(-1); return true;
          case 'chooseDestination': this.choose(intent.baseId); return true;
          case 'select':
            if (!intent.bodyId) this.startCountdown(true); // Enter: launch
            else {
              // Pointing at a body: fly to its base.
              const base = baseOn(intent.bodyId);
              if (base && base.id !== this.base?.base.id) this.choose(base.id);
              else if (!base) this.d.flash(tf('noBaseThere', state.lang, { name: BODIES[bodyIndex(intent.bodyId)].name[state.lang] }));
            }
            return true;
          case 'launch': this.startCountdown(true); return true;
          case 'countdown':
            if (intent.n === 3) this.startCountdown(false);
            return true;
          case 'enterBase':
            if (intent.baseId && intent.baseId !== this.base?.base.id) {
              this.exitHorizon();
              this.enter(baseById(intent.baseId).id);
            }
            return true;
          case 'nextMoon':
            // Only leave a base when navigation can succeed; the general handler reports no moons.
            if (nextInSystem(BODIES, state.focus) !== null) this.release();
            return false; // then the usual handler flies to the moon, or explains why it can't
          case 'dismiss':
            if (state.weightOpen) return false;
            this.leave();
            return true;
          default:
            return false;
        }

      case 'build':
        // Drag (or the open hand) pans across the base instead of turning round it.
        if (intent.type === 'rotate') {
          const k = this.buildFrame * 0.6;
          this.buildPan.x = THREE.MathUtils.clamp(this.buildPan.x - intent.dx * k * 2, -1.6, 1.6);
          this.buildPan.y = THREE.MathUtils.clamp(this.buildPan.y - intent.dy * k * 2, -1.6, 1.6);
          return true;
        }
        return false;

      case 'launch':
        if (intent.type === 'dismiss') {
          this.abort();
          return true;
        }
        if (intent.type === 'countdown') {
          const c = this.countdown;
          if (c && !c.auto && intent.n === c.count - 1) {
            c.timer = 0;
            if (intent.n === 1) this.liftoff();
            else c.count = 2;
          }
          return true;
        }
        return false;

      case 'docking':
        if (!this.dock) return false;
        switch (intent.type) {
          case 'steer': this.dock.steer = { x: intent.x, y: intent.y }; return true;
          case 'next': this.nudge(1, 0); return true;
          case 'prev': this.nudge(-1, 0); return true;
          case 'zoom': this.nudge(0, intent.factor > 1 ? 1 : -1); return true; // ↓ toward you, ↑ away
          case 'select': this.dock.auto = true; return true;
          case 'dismiss': this.dock.auto = true; return true; // no way back up: land
          default: return false;
        }

      case 'travel':
        if (intent.type === 'select' && this.trip) {
          this.trip.lookBack = null; // skipping skips the look-back too
          this.trip.elapsed = Math.max(this.trip.elapsed, SKIP_TO * this.trip.seconds); // Enter / the button: skip
          return true;
        }
        return false;

      default:
        return false;
    }
  }

  /** Per frame, after the scene has moved: the rocket, the countdown, and where the camera goes. */
  update(dt: number, camera: THREE.PerspectiveCamera): CameraControl {
    this.recoverOrphanedBaseView('frame');
    this.seconds += dt;
    const mode = this.d.modes.mode;
    const shown = mode === 'baseView' || mode === 'launch' || mode === 'travel' || mode === 'docking' || mode === 'build';
    if (!shown) this.freeRocket(); // nothing to show it in: free it (rebuilt when needed)
    else {
      this.checkRocket();
      this.rocket.visible = true;
      this.kit!.rocket.update(dt);
      // The rocket and its pad dust: in the base pass at a showcase base (lit by its Sun, sorted with its glass), else with the planets.
      const onBase = this.rocketOnBaseLayer;
      const dustOnBase = this.baseShadows && !!this.dustPad && !!LAYOUTS[this.dustPad.base.id] && this.d.modes.mode !== 'travel';
      const key = `${onBase}|${dustOnBase}|${this.baseShadows}|${this.stacked}`;
      if (this.kit!.layers !== key) {
        setBaseLayer(this.kit!.rocket.group, onBase);
        this.kit!.rocket.setShadows(onBase && this.baseShadows);
        setBaseLayer(this.kit!.dust.mesh, dustOnBase);
        this.kit!.layers = key;
      }
      this.updateDust(dt, camera);
    }

    if (this.countdown) {
      this.countdown.timer += dt;
      if (this.countdown.auto && this.countdown.timer >= 1) {
        this.countdown.timer = 0;
        if (this.countdown.count === 1) this.liftoff();
        else this.countdown.count = (this.countdown.count - 1) as 2 | 1;
      } else if (!this.countdown.auto && this.countdown.timer > 5) {
        this.abort(); // the hand stopped counting
      }
    }

    if (this.d.modes.mode === 'travel' && this.trip) return this.fly(dt, camera);
    this.warp.update(camera, UP, 0, dt);

    if (mode === 'docking' && this.base && this.dock) return this.docking(dt, camera);
    if (!this.base || (mode !== 'baseView' && mode !== 'launch' && mode !== 'build')) {
      this.exitHorizon();
      return null;
    }
    // The rocket stands on the pad; the camera stays on the base as its planet turns.
    const pad = padFrame(this.base);
    this.rocket.position.copy(pad.center).addScaledVector(pad.normal, pad.size * 0.02);
    this.rocket.quaternion.setFromUnitVectors(UP, pad.normal);
    this.rocket.scale.setScalar(pad.size * 0.5 * (this.horizon ? 0.3 : 1)); // from the ground it would tower over the base
    this.kit!.rocket.setLander(!this.stacked);
    this.thrust(mode === 'launch' ? 0.25 : 0, atmosphereOf(this.base.base.body));
    this.legs(this.stacked ? 0 : 1); // a stack stands on the booster; the lander on its legs
    const side = new THREE.Vector3().crossVectors(UP, pad.normal);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    // Keep framing the base as the planet's overview boost fades on the way in (the size changes).
    this.d.rig.reframe(pad.size * 0.2, pad.size * (LAYOUTS[this.base.base.id]?.frame ?? 0.55));
    if (mode === 'baseView' && this.d.modes.mode === 'baseView' && this.baseCamera?.(dt, camera)) return 'chase';
    if (this.horizon && mode === 'baseView') return this.horizonCamera(dt, camera);
    if (mode === 'build') {
      // From above, tilted a little toward the south: the grid reads, and dragging pans across the base.
      this.exitHorizon();
      const g = this.base.group;
      g.updateWorldMatrix(true, false);
      this.d.rig.reframe(pad.size * 0.2, pad.size * this.buildFrame);
      const south = new THREE.Vector3(0, 0, 1).transformDirection(g.matrixWorld);
      this.d.rig.setViewDirection(pad.normal.clone().multiplyScalar(0.94).addScaledVector(south, 0.34));
      return { target: g.localToWorld(new THREE.Vector3(this.buildPan.x, 0, this.buildPan.y)) };
    }
    this.d.rig.setViewDirection(pad.normal.clone().multiplyScalar(0.8).addScaledVector(side.normalize(), 0.6));
    return { target: pad.center };
  }

  /** Standing on the plain outside the base, eye height, looking in across it with the sky behind. */
  private horizonCamera(dt: number, camera: THREE.PerspectiveCamera): CameraControl {
    const h = this.horizon!;
    const g = this.base!.group;
    g.updateWorldMatrix(true, false);
    const eye = this.horizonEye.set(Math.cos(h.yaw) * h.distance, 0.055, Math.sin(h.yaw) * h.distance);
    const look = new THREE.Vector3(-Math.cos(h.yaw), Math.tan(h.pitch), -Math.sin(h.yaw)).add(eye);
    // Eased in the base's frame, then placed: if the planet jumps (a time jump), the view jumps with it.
    const cam = (this.horizonCam ??= { eye: eye.clone(), look: look.clone() });
    const k = this.d.reducedMotion() ? 1 : 1 - Math.exp(-dt * 4);
    cam.eye.lerp(eye, k);
    cam.look.lerp(look, k);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(g.matrixWorld);
    camera.position.copy(g.localToWorld(cam.eye.clone()));
    camera.up.copy(up);
    camera.lookAt(g.localToWorld(cam.look.clone()));
    camera.updateMatrixWorld();
    return 'chase';
  }

  /** Docking: the sim steps, the rocket hovers over the pad accordingly, the camera watches from above. */
  private docking(dt: number, camera: THREE.PerspectiveCamera): CameraControl {
    const d = this.dock!;
    const pad = padFrame(this.base!);
    const n = pad.normal;
    // A fixed frame on the pad: 'toward' (where the camera sits, behind the rocket) and 'right'.
    // The camera's up is the pad's normal, so the rocket always stands upright on screen,
    // and steering right / down moves it right / down on screen.
    const toward = UP.clone().addScaledVector(n, -UP.dot(n));
    if (toward.lengthSq() < 1e-6) toward.set(1, 0, 0).addScaledVector(n, -n.x);
    toward.normalize();
    const right = new THREE.Vector3().crossVectors(n, toward).normalize();
    if (d.settle > 0) {
      d.settle -= dt; // a moment on the ground (or off the pad) before the outcome
      if (d.settle <= 0) {
        if (d.state.outcome === 'landed') this.land();
        else {
          this.startDock(d.misses + 1);
          this.d.flash(t('missedPad', this.d.state.lang));
        }
        if (!this.dock) return { target: pad.center };
      }
    } else {
      const auto = d.auto || this.d.state.autoLand;
      const target = d.steer ? { x: d.steer.x * STEER_RANGE, z: d.steer.y * STEER_RANGE } : null;
      d.state = stepDocking(d.state, dt, d.params, target, auto);
      if (d.state.outcome) d.settle = 0.8;
    }
    const s = this.dock!.state;
    // The landing legs swing out from 40% of the way down, over a second.
    const dock = this.dock!;
    if (1 - s.alt / dock.startAlt >= LEGS_AT) dock.legT += dt;
    this.legs(legDeploy(1 - s.alt / dock.startAlt, dock.legT));
    const unit = pad.size * PAD_RADIUS;
    this.rocket.position.copy(pad.center)
      .addScaledVector(right, s.x * unit)
      .addScaledVector(toward, s.z * unit)
      .addScaledVector(n, Math.max(s.alt * unit, pad.size * 0.02));
    // Leaning into the sideways motion.
    const lean = new THREE.Vector3().copy(n).addScaledVector(right, s.vx * 0.12).addScaledVector(toward, s.vz * 0.12).normalize();
    this.rocket.quaternion.setFromUnitVectors(UP, lean);
    this.rocket.scale.setScalar(pad.size * 0.5);
    this.kit!.rocket.setLander(!this.stacked);
    this.thrust(s.outcome ? 0 : 0.6, atmosphereOf(this.base!.base.body));
    this.dockCamera(camera, pad.center, n, toward, s.alt * unit, pad.size, dt);
    return 'chase';
  }

  /**
   * Behind and above the rocket, looking down at ~40° with the pad's normal as up: the
   * rocket reads upright, the pad below it. Closes in as it comes down; eases there.
   */
  private dockCamera(camera: THREE.PerspectiveCamera, pad: THREE.Vector3, n: THREE.Vector3, toward: THREE.Vector3, height: number, size: number, dt: number) {
    const look = pad.clone().addScaledVector(n, height * 0.62);
    const extent = size * 0.8 + height * 0.8;
    const distance = extent / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const goal = look.clone().addScaledVector(n.clone().multiplyScalar(0.62).addScaledVector(toward, 0.78).normalize(), distance);
    const goalQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(goal, look, n));
    const k = this.d.reducedMotion() ? 1 : 1 - Math.exp(-dt * 3);
    camera.position.lerp(goal, k);
    camera.quaternion.slerp(goalQ, k);
    camera.up.copy(n);
    camera.updateMatrixWorld();
  }

  /**
   * Pad dust: in the last second of the countdown and the first moments of liftoff (the
   * launch pad), and the last part of a landing until it settles (the landing pad). How much
   * and what colour depend on the world; none with reduced motion.
   */
  private updateDust(dt: number, camera: THREE.Camera) {
    const mode = this.d.modes.mode;
    let emit = 0;
    if (mode === 'launch' && this.countdown && this.base) {
      emit = this.countdown.count === 1 ? 1 : this.countdown.count === 2 ? 0.25 : 0;
      this.dustPad = this.base;
    } else if (mode === 'travel' && this.trip) {
      emit = Math.max(0, 1 - this.trip.elapsed / 2.5);
      this.dustPad = this.trip.from;
    } else if (mode === 'docking' && this.dock && this.base) {
      const progress = 1 - this.dock.state.alt / this.dock.startAlt;
      emit = this.dock.state.outcome ? 0.5 * (this.dock.settle / 0.8) : THREE.MathUtils.smoothstep(progress, DUST_FROM, 0.97);
      this.dustPad = this.base;
    }
    if (this.d.reducedMotion()) emit = 0;
    const pad = this.dustPad;
    const dust = pad ? dustFor(pad.base.body) : { amount: 0, color: 0 };
    this.kit!.dust.update(dt, pad ? padFrame(pad) : null, camera, emit, dust.amount, dust.color, this.night);
  }

  /** Travel: the rocket along the arc, the chase camera behind it, the warp streaks. */
  private fly(dt: number, camera: THREE.PerspectiveCamera): CameraControl {
    const trip = this.trip!;
    trip.elapsed += dt;
    const fraction = trip.elapsed / trip.seconds;
    const rocket = this.kit!.rocket;
    // Booster separation partway out; the upper stage flies on (and will land on its own legs).
    if (this.stacked && fraction >= SEPARATE_AT) {
      this.stacked = false;
      rocket.separate(this.d.reducedMotion());
      if (!this.d.reducedMotion()) trip.lookBack = 0; // a look back at the booster falling away
    }
    rocket.setLander(trip.lander);
    this.legs(trip.lander ? Math.max(0, 1 - trip.elapsed) : 0); // a lander folds its legs in the first second
    const arc = this.arc(trip);
    const u = flightProgress(fraction);
    const pos = vec(bezier(arc, u));
    const dir = vec(bezierTangent(arc, Math.min(0.999, Math.max(0.001, u)))).normalize();
    const size = padFrame(trip.from).size;
    this.rocket.position.copy(pos);
    this.rocket.quaternion.setFromUnitVectors(UP, dir);
    this.rocket.scale.setScalar(size * 0.5);
    // Still in the launch world's air for the first moments, then vacuum: the flame turns blue-white and spreads.
    this.thrust(1, fraction < 0.08 ? atmosphereOf(trip.from.base.body) : 'none');

    // Behind and a little above the rocket, looking past it.
    const back = Math.max(0.6, size * 4);
    const up = UP.clone().addScaledVector(dir, -UP.dot(dir));
    if (up.lengthSq() < 1e-6) up.set(1, 0, 0);
    up.normalize();
    const chasePos = pos.clone().addScaledVector(dir, -back).addScaledVector(up, back * 0.35);
    // Never underground: right after liftoff "behind the rocket" points into the planet.
    for (const node of [trip.from, trip.to]) keepAbove(chasePos, node.body.mesh.getWorldPosition(new THREE.Vector3()), node.body.body.radius * node.body.tilt.scale.x * 1.06);
    // A small shake at liftoff (none with reduced motion).
    if (!this.d.reducedMotion() && trip.elapsed < SHAKE_SECONDS) {
      const a = back * 0.015 * (1 - trip.elapsed / SHAKE_SECONDS);
      chasePos.add(new THREE.Vector3(Math.sin(this.seconds * 53) * a, Math.sin(this.seconds * 47 + 1) * a, Math.cos(this.seconds * 59) * a));
    }
    const look = new THREE.Matrix4().lookAt(chasePos, pos.clone().addScaledVector(dir, back), up);
    const chaseQ = new THREE.Quaternion().setFromRotationMatrix(look);
    // Separation: beside the upper stage, looking back at the booster tumbling away, then back to the chase.
    if (trip.lookBack !== null) {
      trip.lookBack += dt;
      const w = lookBackWeight(trip.lookBack);
      if (trip.lookBack >= LOOK_BACK_SECONDS) trip.lookBack = null;
      else if (w > 0) {
        const booster = rocket.booster.getWorldPosition(new THREE.Vector3());
        const side = new THREE.Vector3().crossVectors(dir, up).normalize();
        const eye = pos.clone().addScaledVector(side, back * 0.55).addScaledVector(dir, back * 0.2).addScaledVector(up, back * 0.15);
        for (const node of [trip.from, trip.to]) keepAbove(eye, node.body.mesh.getWorldPosition(new THREE.Vector3()), node.body.body.radius * node.body.tilt.scale.x * 1.06);
        const lookBackQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, booster.lerp(pos, 0.35), up));
        chasePos.lerp(eye, w);
        chaseQ.slerp(lookBackQ, w);
      }
    }
    const blend = Math.min(1, trip.elapsed / 1.2); // ease from where the camera was
    const k = blend * blend * (3 - 2 * blend);
    camera.position.lerpVectors(trip.camStart.position, chasePos, k);
    camera.quaternion.slerpQuaternions(trip.camStart.quaternion, chaseQ, k);
    camera.updateMatrixWorld();
    this.warp.update(camera, dir, this.d.reducedMotion() ? 0 : warpLevel(fraction), dt);

    if (fraction >= 1) this.arrive();
    return 'chase';
  }
}
