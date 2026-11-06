import * as THREE from 'three';
import { BASES, baseById, baseOn } from '../data/bases';
import { BODIES, bodyById, bodyIndex, type Body, type Lang } from '../data/bodies';
import type { Intent } from '../intents';
import { nextInSystem } from '../navigation';
import { LAYOUTS } from '../scene/baseKit/showcases';
import { padFrame, type BaseNode } from '../scene/bases';
import { WarpStreaks } from '../scene/rocket';
import type { RocketOptions } from '../scene/rocketKit';
import { RocketStage } from './rocketStage';
import { HorizonView, type HorizonPose } from './horizonView';
import { Landing, type DockAttempt } from './landing';
import { Flight, type Trip } from './flight';
import { atmosphereOf, dustFor, type Atmosphere } from '../data/atmosphere';
import type { LandingContext } from '../sim/landingReplay';
import { stamp, type Passport } from '../sim/passport';
import { fuelLeft } from '../sim/route';
import type { MissionReadout } from '../ui/missionHud';
import { flightProgress } from '../sim/travel';
import { t, tf } from '../ui/i18n';
import type { Mode } from './modes';
import type { SteerSensitivity } from '../gestures/steer';

/** The app's mode, as a mission reads and changes it. */
export interface MissionModes {
  readonly mode: Mode;
  canGo(to: Mode): boolean;
  /** Moves to `to` if allowed; returns whether it did. */
  go(to: Mode): boolean;
}

/** The camera rig, as a mission uses it: its camera, and where it frames and aims. */
export interface MissionRig {
  readonly camera: THREE.PerspectiveCamera;
  focus(radius: number, extent: number, overview: boolean, instant?: boolean): void;
  reframe(radius: number, extent: number): void;
  setViewDirection(dir: THREE.Vector3): void;
  /** Takes over a camera position and target (after the mission drove the camera itself). */
  adopt(position: THREE.Vector3, target: THREE.Vector3): void;
}

/** The shown date, as a mission reads and changes it. */
export interface MissionClock {
  readonly time: number;
  readonly rate: number;
  readonly paused: boolean;
  setRate(rate: number): void;
  jumpTo(ms: number): void;
}

/** What a mission reads and changes of the app's state. */
export interface MissionState {
  /** Index into BODIES. */
  focus: number;
  selected: Body | null;
  lang: Lang;
  autoLand: boolean;
  passport: Passport;
  steerSensitivity: SteerSensitivity;
  passportOpen: boolean;
  menuOpen: boolean;
  weightOpen: boolean;
}

export interface MissionDeps {
  state: MissionState;
  /** Keep the passport on the device (it changed: a new stamp). */
  savePassport: (passport: Passport) => void;
  modes: MissionModes;
  rig: MissionRig;
  clock: MissionClock;
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

/** Landing dust starts this far into the descent (0–1). */
export const DUST_FROM = 0.65;
const UP = new THREE.Vector3(0, 1, 0);

interface Countdown {
  count: 3 | 2 | 1;
  /** Seconds since the last count. */
  timer: number;
  /** Counting by itself (button, Enter) or by hand (fingers). */
  auto: boolean;
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
  /** The trip between bases (Travel). */
  private readonly flight: Flight;
  /** The landing at the end of a trip (the docking mini-game). */
  private readonly landing: Landing;
  /** The rocket and its pad dust: built when first needed, freed when you leave the bases and trips. */
  private readonly stage: RocketStage;
  /** The pad the dust is on (it settles there after the engines stop). */
  private dustPad: BaseNode | null = null;
  readonly warp = new WarpStreaks();
  /** The clock's speed before you came down to a base: bases run in real time, so they don't spin away. */
  private savedRate: number | null = null;
  /** The horizon view (showcase bases): standing on the ground, looking in across the base. */
  private readonly view: HorizonView;
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
    this.stage = new RocketStage(d);
    this.view = new HorizonView(d.rig.camera, d.reducedMotion);
    this.landing = new Landing(this.stage, d.reducedMotion);
    this.flight = new Flight(this.stage, this.warp, d.reducedMotion);
  }

  /** The trip under way, while in Travel. */
  get trip(): Trip | null {
    return this.flight.trip;
  }

  /** The docking mini-game's attempt, while in Docking. */
  get dock(): DockAttempt | null {
    return this.landing.attempt;
  }

  /** Where the horizon view stands (yaw turns round the base); null when it's off. */
  get horizon(): HorizonPose | null {
    return this.view.pose;
  }

  /** Where the horizon view's eye stands, in the base's frame (for the sky dome). */
  get horizonEye(): THREE.Vector3 {
    return this.view.eye;
  }

  /** The rocket's scene object (built on first use, at the current quality). */
  get rocket(): THREE.Group {
    return this.stage.group;
  }

  /** Windows glow after dark; sunlit paint and dust dim. */
  setRocketNight(night: number) {
    this.stage.setNight(night, this.rocketOnBaseLayer);
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
    return this.stage.roots();
  }

  /** A showcase base has its own Sun, pass and shadows (High, Ultra; Low: off). Set by main from the quality. */
  baseShadows = false;

  /** Engines at this level, in this air (whichever stage is firing; steady with reduced motion). */
  private thrust(level: number, air: Atmosphere) {
    this.stage.thrust(level, this.seconds, air);
  }

  /** The rocket's numbers, if it exists (for tests and the budget). */
  rocketStats() {
    return this.stage.stats();
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
    this.stage.restack();
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
    this.view.enter(this.base.group);
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
    if (this.horizon) this.view.faceAcross(golden.sun);
  }

  /** Back up to the usual view over the base. */
  exitHorizon() {
    if (!this.view.exit()) return;
    if (this.base) {
      this.d.rig.adopt(this.d.rig.camera.position, padFrame(this.base).center);
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
    this.flight.begin(this.base, this.destination, this.d.clock.time, rig.camera);
    this.d.flash(t('liftoff', this.d.state.lang));
    this.d.liftedOff?.(this.base.base.id, this.destination.base.id);
  }

  /** The rocket has reached the approach point above the destination. */
  private arrive() {
    const { modes, state, rig } = this.d;
    const trip = this.flight.trip!;
    this.flight.end();
    this.lastTripFuel = trip.fuel;
    this.base = trip.to;
    this.destination = null;
    state.focus = bodyIndex(trip.to.base.body);
    rig.adopt(rig.camera.position, padFrame(trip.to).center);
    if (!modes.go('docking')) return;
    this.startDock(0); // docking() drives the camera from here, easing in from the chase view
  }

  /** A docking attempt from the approach height, remembered for ?debug recordings. */
  private startDock(misses: number) {
    const body = bodyById(this.base!.base.body);
    const startAlt = this.landing.start(body.gravity, misses);
    this.lastLanding = { baseId: this.base!.base.id, gravity: body.gravity, sensitivity: this.d.state.steerSensitivity, autoLand: this.d.state.autoLand, startAlt };
  }

  private land() {
    if (!this.base || !this.d.modes.go('baseView')) return;
    this.landing.end();
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
    this.d.savePassport(passport);
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
            this.view.look(intent.dx, intent.dy);
            return true;
          }
          if (intent.type === 'zoom') {
            this.view.step(intent.factor);
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
              else if (!base) this.d.flash(tf('noBaseThere', state.lang, { name: bodyById(intent.bodyId).name[state.lang] }));
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
          case 'steer': this.landing.steerTo(intent.x, intent.y); return true;
          case 'next': this.landing.nudge(1, 0); return true;
          case 'prev': this.landing.nudge(-1, 0); return true;
          case 'zoom': this.landing.nudge(0, intent.factor > 1 ? 1 : -1); return true; // ↓ toward you, ↑ away
          case 'select': this.landing.landItself(); return true;
          case 'dismiss': this.landing.landItself(); return true; // no way back up: land
          default: return false;
        }

      case 'travel':
        if (intent.type === 'select' && this.trip) {
          this.flight.skip(); // Enter / the button
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
    if (!shown) this.stage.free(); // nothing to show it in (rebuilt when needed)
    else {
      // The rocket and its pad dust: in the base pass at a showcase base (lit by its Sun, sorted with its glass), else with the planets.
      this.stage.show(dt, {
        onBase: this.rocketOnBaseLayer,
        dustOnBase: this.baseShadows && !!this.dustPad && !!LAYOUTS[this.dustPad.base.id] && this.d.modes.mode !== 'travel',
        shadows: this.baseShadows,
      });
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
    this.stage.rocket.setLander(!this.stage.stacked);
    this.thrust(mode === 'launch' ? 0.25 : 0, atmosphereOf(this.base.base.body));
    this.stage.legs(this.stage.stacked ? 0 : 1); // a stack stands on the booster; the lander on its legs
    const side = new THREE.Vector3().crossVectors(UP, pad.normal);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    // Keep framing the base as the planet's overview boost fades on the way in (the size changes).
    this.d.rig.reframe(pad.size * 0.2, pad.size * (LAYOUTS[this.base.base.id]?.frame ?? 0.55));
    if (mode === 'baseView' && this.d.modes.mode === 'baseView' && this.baseCamera?.(dt, camera)) return 'chase';
    if (this.horizon && mode === 'baseView') {
      this.view.update(dt, this.base.group, camera);
      return 'chase';
    }
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

  /** Docking: the sim steps, the rocket hovers over the pad accordingly, the camera watches from above. */
  private docking(dt: number, camera: THREE.PerspectiveCamera): CameraControl {
    const pad = padFrame(this.base!);
    const outcome = this.landing.step(dt, this.d.state.autoLand);
    if (outcome) {
      if (outcome === 'landed') this.land();
      else {
        this.startDock(this.dock!.misses + 1);
        this.d.flash(t('missedPad', this.d.state.lang));
      }
      if (!this.dock) return { target: pad.center };
    }
    this.landing.place(dt, pad, camera, (level) => this.thrust(level, atmosphereOf(this.base!.base.body)));
    return 'chase';
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
    this.stage.dust(dt, pad ? padFrame(pad) : null, camera, emit, dust.amount, dust.color);
  }

  /** Travel: the rocket along the arc and the chase camera behind it, until it arrives. */
  private fly(dt: number, camera: THREE.PerspectiveCamera): CameraControl {
    if (this.flight.fly(dt, camera, this.seconds)) this.arrive();
    return 'chase';
  }
}
