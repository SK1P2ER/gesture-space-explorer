import * as THREE from 'three';

const FLIGHT_SECONDS = 1.5;
/** A focused body (incl. rings) fills this share of the view's height — or width, if narrower. */
const FOCUS_FILL = 0.5;
/** Overview: the outermost orbit plus this margin must fit in view. */
const OVERVIEW_MARGIN = 1.04;

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Flight {
  t: number; // 0 → 1
  from: THREE.Vector3;
  fromDistance: number;
  fromAim: number;
  /** Extra pull-back at mid-flight, so long trips show where you're going. Set on the first frame. */
  hop: number | null;
}

// Orbit camera around a (moving) target. Rotation and zoom are smoothed so
// both keyboard steps and noisy hand input feel fluid; switching bodies is a
// timed, eased flight.
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Cut to the new body instead of flying (prefers-reduced-motion). */
  reducedMotion = false;

  private theta = 0.6; // azimuth
  private phi = 1.15; // polar angle from +Y
  private distance = 125;
  /** The camera's distance without a flight's mid-way pull-back: what the overview boost follows, so it doesn't swell and shrink during fly-ins. */
  zoomDistance = 125;
  /** How far ahead of the target to look, toward the camera, × distance (see overviewFraming). */
  private aim = 0;
  private goal = { theta: this.theta, phi: this.phi, distance: this.distance, aim: this.aim };
  private minDistance = 2;
  private maxDistance = 260;
  private systemRadius = 100;
  private flight: Flight | null = null;
  private snap = true;
  private framing: { key: string; distance: number; aim: number } | null = null;
  /** What focus() was last asked to frame, so a resize can frame it again. */
  private framed = { extent: 1, overview: true };
  /** Share of the view's height covered at the bottom (the info sheet on phones), and what's shown so far (eased). */
  /** Shares of the view covered by UI on each side (panels, sheets). */
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** The insets as currently shown (eased toward `insets`). */
  private shown: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

  private readonly target = new THREE.Vector3();
  private readonly goalTarget = new THREE.Vector3();
  private readonly lastGoalTarget = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 2000);
    // Portrait screens: look down more steeply, so the orbits fill the tall view instead of a thin band.
    if (aspect < 1) this.phi = this.goal.phi = 0.75;
  }

  /** Radius of the outermost orbit (plus its planet): what the overview must show. */
  setSystemRadius(radius: number) {
    this.systemRadius = radius;
  }

  rotate(dx: number, dy: number) {
    this.goal.theta += dx;
    this.goal.phi = THREE.MathUtils.clamp(this.goal.phi + dy, 0.15, Math.PI - 0.15);
  }

  zoom(factor: number) {
    if (this.flight) this.flight = null; // zooming takes over: stop where we are
    this.goal.distance = THREE.MathUtils.clamp(this.goal.distance * factor, this.minDistance, this.maxDistance);
  }

  get flying() {
    return this.flight !== null;
  }

  /**
   * Focus a body: fly to a close orbit view that frames it.
   * @param radius the body's radius
   * @param extent how far it reaches out (its rings, or atmosphere)
   * @param overview frame the whole system instead (the Sun)
   */
  focus(radius: number, extent: number, overview: boolean, instant = false) {
    this.framed = { extent, overview };
    this.minDistance = radius * 2.2;
    this.maxDistance = this.overviewFraming().distance * 2;
    this.goal.distance = this.framingDistance();
    this.goal.aim = overview ? this.overviewFraming().aim : 0;
    if (instant || this.reducedMotion) {
      this.flight = null;
      this.distance = this.goal.distance;
      this.aim = this.goal.aim;
      this.snap = true;
      return;
    }
    this.flight = { t: 0, from: this.target.clone(), fromDistance: this.distance, fromAim: this.aim, hop: null };
  }

  /** Keep framing the same thing as it changes size (a base on a planet whose overview boost fades): no new flight, zoom kept. */
  reframe(radius: number, extent: number) {
    if (!this.framed || this.framed.overview || Math.abs(extent - this.framed.extent) < extent * 1e-4) return;
    const before = this.framingDistance();
    this.framed = { extent, overview: false };
    this.minDistance = radius * 2.2;
    this.goal.distance *= this.framingDistance() / before; // keeps any zoom applied on top
  }

  /**
   * A panel covers this share of the view's height at the bottom (the info sheet on
   * phones): keep the focused body centered in the space above it, and small enough
   * to fit there, on top of any zoom the user applied. The overview ignores it.
   */
  setBottomInset(fraction: number) {
    this.setInsets({ top: 0, right: 0, bottom: fraction, left: 0 });
  }

  /**
   * UI covers these shares of the view on each side (from the panels' real rects):
   * keep the focused body centered in what's left, and small enough to fit there.
   */
  setInsets(next: Insets) {
    const c = (v: number) => THREE.MathUtils.clamp(v, 0, 0.8);
    const insets = { top: c(next.top), right: c(next.right), bottom: c(next.bottom), left: c(next.left) };
    // At least a fifth of the view stays free each way.
    for (const [a, b] of [['top', 'bottom'], ['left', 'right']] as const) {
      const over = insets[a] + insets[b] - 0.8;
      if (over > 0) [insets[a], insets[b]] = [insets[a] - over / 2, insets[b] - over / 2];
    }
    const same = (Object.keys(insets) as (keyof Insets)[]).every((k) => Math.abs(insets[k] - this.insets[k]) < 0.002);
    if (same) return;
    const before = this.framingDistance();
    this.insets = insets;
    this.goal.distance *= this.framingDistance() / before;
  }

  /** Borrowed framing measurements for an exclusive temporary camera owner. */
  get viewInsets(): Readonly<Insets> { return this.insets; }

  /**
   * Look at the target from this direction (a world vector from the target toward the
   * camera), easing there; called every frame it follows a turning planet without a
   * jump where the azimuth wraps round.
   */
  setViewDirection(dir: THREE.Vector3) {
    const d = dir.clone().normalize();
    const theta = Math.atan2(d.x, d.z);
    this.goal.theta += Math.atan2(Math.sin(theta - this.goal.theta), Math.cos(theta - this.goal.theta));
    this.goal.phi = THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(d.y, -1, 1)), 0.15, Math.PI - 0.15);
  }

  /** Take over from a camera that was placed by hand (the rocket's chase view), continuing smoothly from there. */
  adopt(position: THREE.Vector3, target: THREE.Vector3) {
    const offset = position.clone().sub(target);
    this.target.copy(target);
    this.goalTarget.copy(target);
    this.lastGoalTarget.copy(target);
    this.distance = this.goal.distance = this.zoomDistance = offset.length();
    this.theta = this.goal.theta = Math.atan2(offset.x, offset.z);
    this.phi = this.goal.phi = Math.acos(THREE.MathUtils.clamp(offset.y / offset.length(), -1, 1));
    this.aim = this.goal.aim = 0;
    this.flight = null;
    this.snap = false;
  }

  setTarget(position: THREE.Vector3) {
    this.goalTarget.copy(position);
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 8); // frame-rate independent easing
    this.theta += (this.goal.theta - this.theta) * k;
    this.phi += (this.goal.phi - this.phi) * k;

    const f = this.flight;
    if (this.snap) {
      this.snap = false;
      this.target.copy(this.goalTarget);
    } else if (f) {
      f.hop ??= Math.min(f.from.distanceTo(this.goalTarget), this.systemRadius) * 0.3;
      f.t = Math.min(1, f.t + dt / FLIGHT_SECONDS);
      const e = easeInOutCubic(f.t);
      // Toward the body's current position, so the flight ends on it even as it orbits.
      this.target.lerpVectors(f.from, this.goalTarget, e);
      // Interpolate distance in log space: zooming from far to close feels evenly paced.
      const logDistance = THREE.MathUtils.lerp(Math.log(f.fromDistance), Math.log(this.goal.distance), e);
      this.zoomDistance = Math.exp(logDistance);
      this.distance = this.zoomDistance + f.hop * Math.sin(Math.PI * e);
      this.aim = THREE.MathUtils.lerp(f.fromAim, this.goal.aim, e);
      if (f.t >= 1) this.flight = null;
    } else {
      // Move with the body as it orbits (no trailing lag), easing out any remaining offset.
      this.target.add(this.goalTarget).sub(this.lastGoalTarget).lerp(this.goalTarget, k);
      this.distance += (this.goal.distance - this.distance) * k;
      this.zoomDistance = this.distance;
      this.aim += (this.goal.aim - this.aim) * k;
    }
    this.lastGoalTarget.copy(this.goalTarget);

    place(this.camera, this.target, this.distance, this.phi, this.theta, this.aim);

    // Shift the picture so the target sits in the middle of the uncovered part.
    for (const side of ['top', 'right', 'bottom', 'left'] as const) this.shown[side] += (this.insets[side] - this.shown[side]) * k;
    const dx = (this.shown.right - this.shown.left) / 2;
    const dy = (this.shown.bottom - this.shown.top) / 2;
    if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
      const [w, h] = [1000 * this.camera.aspect, 1000];
      this.camera.setViewOffset(w, h, w * dx, h * dy, w, h);
    } else if (this.camera.view?.enabled) {
      this.camera.clearViewOffset();
    }
  }

  /**
   * New viewport shape (window resize, phone rotated): frame the same thing
   * again for it, keeping any zoom the user applied on top of the framing.
   */
  resize(aspect: number) {
    const before = this.framingDistance();
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const scale = this.framingDistance() / before;
    this.goal.distance *= scale;
    this.distance *= scale;
    this.maxDistance = this.overviewFraming().distance * 2;
    if (this.framed.overview) this.goal.aim = this.aim = this.overviewFraming().aim;
  }

  /** Distance at which the focused body (or, for the overview, every orbit) fills the view as intended. */
  private framingDistance() {
    return this.framed.overview
      ? this.overviewFraming().distance
      : this.framed.extent / (FOCUS_FILL * this.tanHalfFovFree());
  }

  /**
   * Overview framing at the current elevation and aspect ratio. Seen from
   * above at an angle, the near side of the orbits drops much further below
   * the Sun than the far side rises above it, so instead of looking straight
   * at the Sun, look a bit ahead of it (`aim`) to center the whole system,
   * then take the smallest distance at which it fits — the width too, so a
   * portrait phone still shows every orbit. Solved numerically against the
   * real projection (cached): perspective makes the extremes fall
   * off-center, so a closed form is easy to get subtly wrong.
   */
  private overviewFraming(): { distance: number; aim: number } {
    const key = `${this.camera.aspect}|${this.goal.phi}|${this.systemRadius}`;
    if (this.framing?.key === key) return this.framing;

    const r = OVERVIEW_MARGIN * this.systemRadius;
    const ring = Array.from({ length: 64 }, (_, i) => {
      const a = (i / 64) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    });
    const camera = this.camera.clone();
    camera.clearViewOffset(); // the overview ignores the bottom inset
    const origin = new THREE.Vector3();
    const p = new THREE.Vector3();
    const extents = (distance: number, aim: number) => {
      place(camera, origin, distance, this.goal.phi, this.goal.theta, aim);
      camera.updateMatrixWorld();
      let [minY, maxY, maxX, behind] = [Infinity, -Infinity, 0, false];
      for (const q of ring) {
        p.copy(q).project(camera);
        behind ||= p.z > 1;
        [minY, maxY, maxX] = [Math.min(minY, p.y), Math.max(maxY, p.y), Math.max(maxX, Math.abs(p.x))];
      }
      return { minY, maxY, maxX, behind };
    };
    const centeredAim = (distance: number) => {
      let [lo, hi] = [0, 0.95]; // looking further ahead moves the system up the screen
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        const e = extents(distance, mid);
        if (e.minY + e.maxY < 0) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    let [lo, hi] = [r, r * 10];
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const e = extents(mid, centeredAim(mid));
      if (!e.behind && e.maxY - e.minY <= 2 && e.maxX <= 1) hi = mid;
      else lo = mid;
    }
    this.framing = { key, distance: hi, aim: centeredAim(hi) };
    return this.framing;
  }

  /** Half the view's smaller dimension (as a tangent), counting only the height above the bottom inset. */
  private tanHalfFovFree() {
    const tanHalfHeight = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const { top, right, bottom, left } = this.insets;
    return tanHalfHeight * Math.min(1 - top - bottom, this.camera.aspect * (1 - left - right));
  }
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Orbit `camera` around `target`, looking `aim` × distance ahead of it toward the camera. */
function place(camera: THREE.Camera, target: THREE.Vector3, distance: number, phi: number, theta: number, aim: number) {
  const offset = new THREE.Vector3().setFromSphericalCoords(distance, phi, theta);
  camera.position.copy(target).add(offset);
  const ahead = new THREE.Vector3(offset.x, 0, offset.z).setLength(aim * distance);
  camera.lookAt(ahead.add(target));
}
