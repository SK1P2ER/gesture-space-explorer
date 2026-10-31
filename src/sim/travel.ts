// A rocket's trip between two bases: a cubic Bézier arc (not real physics) that
// leaves straight up from the start pad and comes down straight onto the far one.
// Pure vector math, so it can be tested; the ends are recomputed every frame
// because the planets keep moving.

export type V3 = [number, number, number];

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export interface Arc {
  p0: V3;
  p1: V3;
  p2: V3;
  p3: V3;
}

/**
 * From above the start pad to above the destination pad (both normals pointing out of
 * their body): control points pushed out along each normal by a third of the distance,
 * plus a lift above the plane of the orbits so the arc clears the bodies between.
 */
export function arcBetween(start: V3, startNormal: V3, end: V3, endNormal: V3): Arc {
  const d = dist(start, end);
  const out = d * 0.35;
  const lift: V3 = [0, d * 0.12, 0];
  return { p0: start, p1: add(add(start, startNormal, out), lift), p2: add(add(end, endNormal, out), lift), p3: end };
}

export function bezier({ p0, p1, p2, p3 }: Arc, t: number): V3 {
  const u = 1 - t;
  const [a, b, c, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [0, 1, 2].map((k) => a * p0[k] + b * p1[k] + c * p2[k] + e * p3[k]) as V3;
}

/** Direction of travel (not normalized). */
export function bezierTangent({ p0, p1, p2, p3 }: Arc, t: number): V3 {
  const u = 1 - t;
  return [0, 1, 2].map((k) => 3 * u * u * (p1[k] - p0[k]) + 6 * u * t * (p2[k] - p1[k]) + 3 * t * t * (p3[k] - p2[k])) as V3;
}

/** Seconds for a trip of this scene distance: longer trips take longer, but never tediously so. */
export const travelSeconds = (sceneDistance: number) => Math.min(14, Math.max(5, 4 + 2.5 * Math.log1p(sceneDistance / 5)));

/** Progress along the arc for elapsed time t/T: gentle lift-off and arrival (smootherstep). */
export function flightProgress(fraction: number): number {
  const x = Math.min(1, Math.max(0, fraction));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** How fast it's going, 0–1 at the peak: drives the warp streaks. */
export const warpLevel = (fraction: number) => {
  const x = Math.min(1, Math.max(0, fraction));
  return Math.max(0, Math.sin(Math.PI * x) * 1.4 - 0.4);
};

/** Skipping jumps to the start of the approach. */
export const SKIP_TO = 0.88;
