// A cinematic transfer, not an orbital dynamics solver. The radial departure and
// arrival tangents are preserved while an optional lift bends around solid bodies.
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
  /** Mid-flight displacement, with zero displacement and derivative at both ends. */
  lift?: V3;
}

export interface FlightBody { center: V3; radius: number }
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => a.map(v => v / Math.hypot(...a)) as V3;

/** A sideways escape direction, tangent to both pad normals. Keep its sign for a trip. */
export function flightSide(startNormal: V3, endNormal: V3): V3 {
  let side = cross(startNormal, endNormal);
  if (Math.hypot(...side) < 1e-5) {
    const reference: V3 = Math.abs(startNormal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    side = add(reference, startNormal, -dot(reference, startNormal));
  }
  if (dot(side, [0, 1, 0]) < 0) side = side.map(v => -v) as V3;
  return unit(side);
}

/**
 * Certify the entire quartic curve using its control hull, not just sampled frames.
 * Subdivision tightens the hull; an unresolved interval is conservatively blocked.
 */
export function arcClearsBody(arc: Arc, body: FlightBody): boolean {
  const { p0, p1, p2, p3, lift = [0, 0, 0] } = arc;
  const controls = [p0, add(p0, add(p1, p0, -1), 0.75),
    add(add(p1, p2).map(v => v / 2) as V3, lift, 8 / 3),
    add(p3, add(p2, p3, -1), 0.75), p3];
  const clear = (points: V3[], depth: number): boolean => {
    let distanceSq = 0;
    for (let k = 0; k < 3; k++) {
      const low = Math.min(...points.map(p => p[k]));
      const high = Math.max(...points.map(p => p[k]));
      const delta = Math.max(low - body.center[k], body.center[k] - high, 0);
      distanceSq += delta * delta;
    }
    if (distanceSq >= body.radius * body.radius) return true;
    if (dist(points[0], body.center) < body.radius || dist(points[4], body.center) < body.radius || depth === 14) return false;
    const left = [points[0]], right = [points[4]];
    let row = points;
    while (row.length > 1) {
      row = row.slice(1).map((p, i) => add(p, row[i]).map(v => v / 2) as V3);
      left.push(row[0]);
      right.unshift(row[row.length - 1]);
    }
    return clear(left, depth + 1) && clear(right, depth + 1);
  };
  return clear(controls, 0);
}

/**
 * Radial liftoff and descent, with a smooth sideways bypass when a solid body
 * obstructs the transfer. Bodies and pad positions must use the same world frame.
 */
export function arcBetween(start: V3, startNormal: V3, end: V3, endNormal: V3, bodies: FlightBody[] = [], side?: V3): Arc {
  const d = dist(start, end);
  for (const body of bodies) {
    if (dist(start, body.center) < body.radius || dist(end, body.center) < body.radius) {
      throw new Error(`Flight endpoint inside body: ${JSON.stringify({ body, start, end })}`);
    }
  }
  const out = d * 0.35;
  let direction: V3 = side ?? (bodies.length ? flightSide(startNormal, endNormal) : [0, 1, 0]);
  if (!side && bodies.length) {
    // A bypass must also be reachable from both ends: the Moon's near-side
    // approach can otherwise bend back into Earth, however high the arc grows.
    const rayClears = (point: V3, dir: V3) => bodies.every(body => {
      const toward = add(body.center, point, -1);
      if (Math.hypot(...toward) < body.radius + 1 && dot(toward, dir) > 1e-8) return false;
      const along = Math.max(0, dot(toward, dir));
      return dist(add(point, dir, along), body.center) > body.radius + 0.005;
    });
    const candidates: V3[] = [direction, direction.map(v => -v) as V3, [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    const outward = add(startNormal, endNormal);
    if (Math.hypot(...outward) > 1e-5) {
      for (const weight of [0.25, 1, 4]) for (const sign of [-1, 1]) candidates.push(unit(add(outward, direction, sign * weight)));
    }
    // Crowded moon/planet systems may block both normal-plane directions.
    for (let i = 0; i < 128; i++) {
      const y = 1 - 2 * (i + 0.5) / 128;
      const r = Math.sqrt(1 - y * y), angle = i * 2.399963229728653;
      candidates.push([r * Math.cos(angle), y, r * Math.sin(angle)]);
    }
    const candidate = candidates.find(candidate => rayClears(start, candidate) && rayClears(end, candidate));
    if (!candidate) throw new Error('No clear bypass direction between flight endpoints');
    direction = candidate;
  }
  const arc: Arc = { p0: start, p1: add(start, startNormal, out), p2: add(end, endNormal, out), p3: end };
  const clears = (height: number) => {
    arc.lift = direction.map(v => v * height) as V3;
    return bodies.every(body => arcClearsBody(arc, body));
  };
  let low = d * 0.12, high = low;
  if (clears(high)) return arc;
  // A larger sideways arc clears even a far-side launch without cutting a chord
  // through its planet. Refine the height so moving planets don't cause step jumps.
  for (let i = 0; i < 32; i++) {
    high = Math.max(high * 2, 0.01);
    if (clears(high)) {
      for (let j = 0; j < 18; j++) {
        const mid = (low + high) / 2;
        if (clears(mid)) high = mid;
        else low = mid;
      }
      clears(high);
      return arc;
    }
    low = high;
  }
  throw new Error(`No clear flight arc: ${JSON.stringify({ start, end, direction, blocked: bodies.filter(body => !arcClearsBody(arc, body)) })}`);
}

export function bezier({ p0, p1, p2, p3, lift = [0, 0, 0] }: Arc, t: number): V3 {
  const u = 1 - t;
  const [a, b, c, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [0, 1, 2].map((k) => a * p0[k] + b * p1[k] + c * p2[k] + e * p3[k] + 16 * t * t * u * u * lift[k]) as V3;
}

/** Direction of travel (not normalized). */
export function bezierTangent({ p0, p1, p2, p3, lift = [0, 0, 0] }: Arc, t: number): V3 {
  const u = 1 - t;
  return [0, 1, 2].map((k) => 3 * u * u * (p1[k] - p0[k]) + 6 * u * t * (p2[k] - p1[k]) + 3 * t * t * (p3[k] - p2[k]) + 32 * t * u * (1 - 2 * t) * lift[k]) as V3;
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
