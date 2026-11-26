// Eased camera moves for the launch preview (presets, places, reset). Pure math on plain {x, y, z} vectors, so it is
// tested without WebGL; spaceportPreview.ts steps it from its render loop and applies the pose to the camera.

export interface Vec3 { x: number; y: number; z: number }

/** Camera preset switches (Overview / Launch Pad / Follow): short enough to feel direct, long enough to keep context. */
export const PRESET_MS = 400;
/** Place cards and Reset keep their existing longer, arcing flight. */
export const FLIGHT_MS = 900;

export const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
/** THREE.MathUtils.smoothstep over 0..1 (the flight curve the preview already used). */
export const smoothstep = (t: number) => t * t * (3 - 2 * t);

export interface TweenOptions {
  durationMs: number;
  ease?: (t: number) => number;
  /** Lift the eye on the way (world units, scaled by how low the ends are), as the place flights always did. */
  arc?: boolean;
}

/**
 * One move from the pose the camera had when it started (never a stored preset) to a destination that may move each
 * frame (Follow tracks the rocket). `step` returns the pose for the elapsed time; `done` once it has arrived.
 */
export class CameraTween {
  private elapsedMs = 0;
  readonly fromEye: Vec3;
  readonly fromTarget: Vec3;
  constructor(fromEye: Vec3, fromTarget: Vec3, private readonly options: TweenOptions) {
    this.fromEye = { ...fromEye }; this.fromTarget = { ...fromTarget };
  }
  get progress() { return Math.min(1, this.options.durationMs <= 0 ? 1 : this.elapsedMs / this.options.durationMs); }
  get done() { return this.progress >= 1; }

  /** Advances by `dtMs` and writes the eased pose toward the (current) destination into `eye` and `target`. */
  step(dtMs: number, toEye: Vec3, toTarget: Vec3, eye: Vec3, target: Vec3) {
    this.elapsedMs += Math.max(0, dtMs);
    const t = (this.options.ease ?? easeInOutCubic)(this.progress);
    lerp(this.fromEye, toEye, t, eye);
    lerp(this.fromTarget, toTarget, t, target);
    if (this.options.arc) eye.y += 4 * t * (1 - t) * Math.max(0, 120 - Math.min(this.fromEye.y, toEye.y));
    return this.done;
  }
}

function lerp(a: Vec3, b: Vec3, t: number, out: Vec3) {
  out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.z = a.z + (b.z - a.z) * t;
}
