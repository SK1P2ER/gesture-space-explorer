// The docking mini-game: steer the rocket onto the pad as it comes down. Units
// are pad radii (the pad's edge is at distance 1), so the same rules work on every
// world. Pure and deterministic (the gusts are smooth functions of time), so it
// can be tested.
//
// Difficulty follows surface gravity: on heavier worlds the rocket comes down
// faster (less time to correct) and the gusts push harder.

export interface DockingParams {
  /** Pad radii per second. */
  descent: number;
  /** Gust strength, pad radii per second. */
  gust: number;
}

const EARTH_G = 9.8;

export function dockingParams(gravity: number): DockingParams {
  const g = Math.min(1.5, gravity / EARTH_G);
  return { descent: 0.5 + 0.35 * g, gust: 0.2 + 0.6 * g };
}

export interface DockingState {
  /** Offset from the pad's center, pad radii (x: screen-right, z: toward the viewer). */
  x: number;
  z: number;
  /** Height above the pad, pad radii. */
  alt: number;
  vx: number;
  vz: number;
  /** Seconds since this attempt started (drives the gusts). */
  t: number;
  outcome: 'landed' | 'missed' | null;
}

export const startDocking = (alt: number): DockingState => ({ x: 0, z: 0, alt, vx: 0, vz: 0, t: 0, outcome: null });

/** How hard the rocket chases where it's steered, and its top sideways speed. */
const RESPONSE = 2.5;
const MAX_SPEED = 2.2;

const gustAt = (t: number, p: DockingParams) => [p.gust * Math.sin(t * 0.9 + 1.3), p.gust * Math.cos(t * 0.7)];
const clamp = (v: number) => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));

/**
 * One step. `target` is where the player steers (pad radii; null: no input, hold course);
 * auto-land steers for the center and cancels the gusts. Returns the new state.
 */
export function stepDocking(s: DockingState, dt: number, p: DockingParams, target: { x: number; z: number } | null, auto: boolean): DockingState {
  if (s.outcome) return s;
  const t = s.t + dt;
  const [gx, gz] = gustAt(t, p);
  const aim = auto ? { x: 0, z: 0 } : target;
  // What the engines push toward: the steered point (or nothing), then the wind on top.
  const wantX = aim ? clamp((aim.x - s.x) * RESPONSE) - (auto ? gx : 0) : 0;
  const wantZ = aim ? clamp((aim.z - s.z) * RESPONSE) - (auto ? gz : 0) : 0;
  const k = Math.min(1, dt * 4);
  const vx = s.vx + (wantX + gx - s.vx) * k;
  const vz = s.vz + (wantZ + gz - s.vz) * k;
  const alt = Math.max(0, s.alt - p.descent * dt);
  const x = s.x + vx * dt;
  const z = s.z + vz * dt;
  const outcome = alt > 0 ? null : Math.hypot(x, z) <= 1 ? 'landed' : 'missed';
  return { x, z, alt, vx, vz, t, outcome };
}

/** Steering input (−1 … 1 across the screen, from hand, mouse or keys) → a target, pad radii. */
export const STEER_RANGE = 3;
