import * as THREE from 'three';
import { dockingParams, startDocking, stepDocking, STEER_RANGE, type DockingParams, type DockingState } from '../sim/docking';
import type { PadFrame } from '../scene/padDust';
import type { RocketStage } from './rocketStage';

/** The approach point: this many base sizes above the destination pad. */
export const APPROACH_HEIGHT = 3;
/** The landing legs start to open this far into the descent (0–1), and take this long. */
export const LEGS_AT = 0.4;
export const LEGS_SECONDS = 1;
/** How far the legs are out during a landing: none before LEGS_AT of the descent, then easing out over LEGS_SECONDS. */
export const legDeploy = (progress: number, secondsSince: number) => (progress < LEGS_AT ? 0 : Math.min(1, secondsSince / LEGS_SECONDS));
/** Base sizes per pad radius (the pad is PAD_RADIUS of a base size), to place the docking rocket. */
const PAD_RADIUS = 0.35;
/** How far the arrow keys move the steering point per press (−1 … 1 across). */
const KEY_STEP = 0.25;
/** A moment on the ground (or off the pad) before the outcome counts, seconds. */
export const SETTLE_SECONDS = 0.8;
const UP = new THREE.Vector3(0, 1, 0);

/** One attempt at the pad, from the approach height down. */
export interface DockAttempt {
  state: DockingState;
  params: DockingParams;
  /** Where the hand or the keys steer, −1 … 1 across (null: not steering). */
  steer: { x: number; y: number } | null;
  /** Landing itself (asked for during this attempt). */
  auto: boolean;
  /** The approach height, pad radii. */
  startAlt: number;
  misses: number;
  /** Seconds left on the ground (or off the pad) before the outcome counts. */
  settle: number;
  /** Seconds since the legs started to open. */
  legT: number;
}

/**
 * The landing at the end of a trip (Docking): the docking sim stepped from the hand, the keys or by
 * itself, the rocket hovering over the pad accordingly, and the camera watching from behind and above.
 */
export class Landing {
  attempt: DockAttempt | null = null;

  constructor(private readonly stage: RocketStage, private readonly reducedMotion: () => boolean) {}

  /** A new attempt from the approach height, under this gravity. Returns the approach height (pad radii). */
  start(gravity: number, misses: number): number {
    const startAlt = APPROACH_HEIGHT / PAD_RADIUS;
    this.attempt = { state: startDocking(startAlt), startAlt, params: dockingParams(gravity), steer: null, auto: false, misses, settle: 0, legT: 0 };
    return startAlt;
  }

  end() {
    this.attempt = null;
  }

  /** The hand: steer toward this point. */
  steerTo(x: number, y: number) {
    this.attempt!.steer = { x, y };
  }

  /** Arrow keys: nudge the steering point. */
  nudge(dx: number, dy: number) {
    const d = this.attempt!;
    const s = d.steer ?? { x: d.state.x / STEER_RANGE, y: d.state.z / STEER_RANGE };
    const c = (v: number) => Math.max(-1, Math.min(1, v));
    d.steer = { x: c(s.x + dx * KEY_STEP), y: c(s.y + dy * KEY_STEP) };
  }

  /** Enter, the button or Esc: the rocket lands itself (there's no way back up). */
  landItself() {
    this.attempt!.auto = true;
  }

  /**
   * Once a frame: the sim steps, or, once it has an outcome, the rocket settles. Returns the outcome
   * when the settling is over ('landed', or 'missed': try again), else null.
   */
  step(dt: number, autoLand: boolean): 'landed' | 'missed' | null {
    const d = this.attempt!;
    if (d.settle > 0) {
      d.settle -= dt;
      if (d.settle <= 0) return d.state.outcome === 'landed' ? 'landed' : 'missed';
      return null;
    }
    const target = d.steer ? { x: d.steer.x * STEER_RANGE, z: d.steer.y * STEER_RANGE } : null;
    d.state = stepDocking(d.state, dt, d.params, target, d.auto || autoLand);
    if (d.state.outcome) d.settle = SETTLE_SECONDS;
    return null;
  }

  /**
   * The rocket over the pad as the sim has it (legs, lean, engines through `thrust`), and the camera
   * behind and above it.
   */
  place(dt: number, pad: PadFrame, camera: THREE.PerspectiveCamera, thrust: (level: number) => void) {
    const n = pad.normal;
    // A fixed frame on the pad: 'toward' (where the camera sits, behind the rocket) and 'right'.
    // The camera's up is the pad's normal, so the rocket always stands upright on screen,
    // and steering right / down moves it right / down on screen.
    const toward = UP.clone().addScaledVector(n, -UP.dot(n));
    if (toward.lengthSq() < 1e-6) toward.set(1, 0, 0).addScaledVector(n, -n.x);
    toward.normalize();
    const right = new THREE.Vector3().crossVectors(n, toward).normalize();
    const dock = this.attempt!;
    const s = dock.state;
    // The landing legs swing out from 40% of the way down, over a second.
    if (1 - s.alt / dock.startAlt >= LEGS_AT) dock.legT += dt;
    this.stage.legs(legDeploy(1 - s.alt / dock.startAlt, dock.legT));
    const unit = pad.size * PAD_RADIUS;
    const rocket = this.stage.group;
    rocket.position.copy(pad.center)
      .addScaledVector(right, s.x * unit)
      .addScaledVector(toward, s.z * unit)
      .addScaledVector(n, Math.max(s.alt * unit, pad.size * 0.02));
    // Leaning into the sideways motion.
    const lean = new THREE.Vector3().copy(n).addScaledVector(right, s.vx * 0.12).addScaledVector(toward, s.vz * 0.12).normalize();
    rocket.quaternion.setFromUnitVectors(UP, lean);
    rocket.scale.setScalar(pad.size * 0.5);
    this.stage.rocket.setLander(!this.stage.stacked);
    thrust(s.outcome ? 0 : 0.6);
    this.watch(camera, pad.center, n, toward, s.alt * unit, pad.size, dt);
  }

  /**
   * Behind and above the rocket, looking down at ~40° with the pad's normal as up: the
   * rocket reads upright, the pad below it. Closes in as it comes down; eases there.
   */
  private watch(camera: THREE.PerspectiveCamera, pad: THREE.Vector3, n: THREE.Vector3, toward: THREE.Vector3, height: number, size: number, dt: number) {
    const look = pad.clone().addScaledVector(n, height * 0.62);
    const extent = size * 0.8 + height * 0.8;
    const distance = extent / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const goal = look.clone().addScaledVector(n.clone().multiplyScalar(0.62).addScaledVector(toward, 0.78).normalize(), distance);
    const goalQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(goal, look, n));
    const k = this.reducedMotion() ? 1 : 1 - Math.exp(-dt * 3);
    camera.position.lerp(goal, k);
    camera.quaternion.slerp(goalQ, k);
    camera.up.copy(n);
    camera.updateMatrixWorld();
  }
}
