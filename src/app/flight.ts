import * as THREE from 'three';
import { padFrame, type BaseNode } from '../scene/bases';
import { SEPARATE_AT } from '../scene/rocketKit';
import { atmosphereOf } from '../data/atmosphere';
import { arcBetween, bezier, bezierTangent, flightProgress, SKIP_TO, travelSeconds, warpLevel, type V3 } from '../sim/travel';
import { routeKm, tripFuel } from '../sim/route';
import { APPROACH_HEIGHT } from './landing';
import type { RocketStage } from './rocketStage';
import type { WarpStreaks } from '../scene/rocket';

/** The camera shakes this long after liftoff (not with reduced motion). */
export const SHAKE_SECONDS = 1.2;
/** At booster separation, the camera looks back at the booster tumbling away for this long. */
export const LOOK_BACK_SECONDS = 1.5;
/** How much of the look-back view to use, t seconds into it: eases in and out over 0.35 s. */
export function lookBackWeight(t: number) {
  const ramp = 0.35;
  const w = Math.max(0, Math.min(1, t / ramp, (LOOK_BACK_SECONDS - t) / ramp));
  return w * w * (3 - 2 * w);
}
/** Push a point out to `radius` from `center` if it's inside (the chase camera must stay above ground). */
export function keepAbove(point: THREE.Vector3, center: THREE.Vector3, radius: number) {
  const d = point.distanceTo(center);
  if (d < radius) point.sub(center).multiplyScalar(radius / Math.max(d, 1e-9)).add(center);
  return point;
}
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];
const vec = (a: V3) => new THREE.Vector3(...a);

export interface Trip {
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
 * A trip between two bases (Travel): the rocket along an arc that follows the moving planets, the
 * booster separating partway out, and the chase camera behind it, with a shake at liftoff and a look
 * back at the falling booster; the warp streaks rush past.
 */
export class Flight {
  trip: Trip | null = null;

  readonly #stage: RocketStage;
  readonly #warp: WarpStreaks;
  readonly #reducedMotion: () => boolean;

  constructor(stage: RocketStage, warp: WarpStreaks, reducedMotion: () => boolean) {
    this.#stage = stage;
    this.#warp = warp;
    this.#reducedMotion = reducedMotion;
  }

  /** Liftoff from one base for another, on the date `time` (ms), from where the camera is now. */
  begin(from: BaseNode, to: BaseNode, time: number, camera: THREE.Camera) {
    const a = padFrame(from).center.clone();
    const b = padFrame(to).center.clone();
    this.trip = {
      from,
      to,
      elapsed: 0,
      seconds: travelSeconds(a.distanceTo(b)),
      km: routeKm(from.base.body, to.base.body, time),
      fuel: tripFuel(routeKm(from.base.body, to.base.body, time)),
      camStart: { position: camera.position.clone(), quaternion: camera.quaternion.clone() },
      lander: !this.#stage.stacked,
      lookBack: null,
    };
  }

  end() {
    this.trip = null;
  }

  /** Enter or the button: skip ahead, past the look-back too. */
  skip() {
    const trip = this.trip!;
    trip.lookBack = null;
    trip.elapsed = Math.max(trip.elapsed, SKIP_TO * trip.seconds);
  }

  /** The arc as it is now (the planets move): from above the start pad to the approach point above the far one. */
  #arc(trip: Trip) {
    const a = padFrame(trip.from);
    const startN = a.normal.clone();
    const start = a.center.clone().addScaledVector(startN, a.size * 0.6);
    const b = padFrame(trip.to);
    const end = b.center.clone().addScaledVector(b.normal, b.size * APPROACH_HEIGHT);
    return arcBetween(v3(start), v3(startN), v3(end), v3(b.normal));
  }

  /**
   * Once a frame: the rocket along the arc, the chase camera behind it, the warp streaks. `seconds`
   * is the mission's running time (the flame and the shake follow it). Returns whether the rocket has
   * reached the approach point above the destination.
   */
  fly(dt: number, camera: THREE.PerspectiveCamera, seconds: number): boolean {
    const trip = this.trip!;
    trip.elapsed += dt;
    const fraction = trip.elapsed / trip.seconds;
    const rocket = this.#stage.rocket;
    // Booster separation partway out; the upper stage flies on (and will land on its own legs).
    if (this.#stage.stacked && fraction >= SEPARATE_AT) {
      this.#stage.separate();
      if (!this.#reducedMotion()) trip.lookBack = 0; // a look back at the booster falling away
    }
    rocket.setLander(trip.lander);
    this.#stage.legs(trip.lander ? Math.max(0, 1 - trip.elapsed) : 0); // a lander folds its legs in the first second
    const arc = this.#arc(trip);
    const u = flightProgress(fraction);
    const pos = vec(bezier(arc, u));
    const dir = vec(bezierTangent(arc, Math.min(0.999, Math.max(0.001, u)))).normalize();
    const size = padFrame(trip.from).size;
    this.#stage.group.position.copy(pos);
    this.#stage.group.quaternion.setFromUnitVectors(UP, dir);
    this.#stage.group.scale.setScalar(size * 0.5);
    // Still in the launch world's air for the first moments, then vacuum: the flame turns blue-white and spreads.
    this.#stage.thrust(1, seconds, fraction < 0.08 ? atmosphereOf(trip.from.base.body) : 'none');

    // Behind and a little above the rocket, looking past it.
    const back = Math.max(0.6, size * 4);
    const up = UP.clone().addScaledVector(dir, -UP.dot(dir));
    if (up.lengthSq() < 1e-6) up.set(1, 0, 0);
    up.normalize();
    const chasePos = pos.clone().addScaledVector(dir, -back).addScaledVector(up, back * 0.35);
    // Never underground: right after liftoff "behind the rocket" points into the planet.
    for (const node of [trip.from, trip.to]) keepAbove(chasePos, node.body.mesh.getWorldPosition(new THREE.Vector3()), node.body.body.radius * node.body.tilt.scale.x * 1.06);
    // A small shake at liftoff (none with reduced motion).
    if (!this.#reducedMotion() && trip.elapsed < SHAKE_SECONDS) {
      const a = back * 0.015 * (1 - trip.elapsed / SHAKE_SECONDS);
      chasePos.add(new THREE.Vector3(Math.sin(seconds * 53) * a, Math.sin(seconds * 47 + 1) * a, Math.cos(seconds * 59) * a));
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
    this.#warp.update(camera, dir, this.#reducedMotion() ? 0 : warpLevel(fraction), dt);
    return fraction >= 1;
  }
}
