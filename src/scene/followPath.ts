// The Follow camera's path during the launch (frame 1…480 at 24 fps), as pure data and math so it can be checked
// against the site's colliders without WebGL (tests/spaceportFollowPath.test.ts). spaceportPreview.ts uses it.

/** [frame, x, y, z]: where the Follow camera is at each stop; between stops it moves on a smoothstep. */
export type FollowStop = readonly [number, number, number, number];

/**
 * Passenger Campus (P2.5): the previous path (LEGACY_FOLLOW_STOPS) ran into the Space Line terminal (x -231…-77,
 * z -189…-58, up to y 38). These stops are the same path rotated 30° about the pad (owner decision, 2026-11-20).
 */
export const FOLLOW_STOPS: readonly FollowStop[] = [[1, -28, 28, -201], [144, -23, 24, -181], [240, -23, 24, -181], [288, -21, 42, -203], [384, -31, 120, -237], [480, -37, 300, -276]];
/** The path the app used with the previous campus (kept for the regression check only). */
export const LEGACY_FOLLOW_STOPS: readonly FollowStop[] = [[1, -125, 28, -160], [144, -110, 24, -145], [240, -110, 24, -145], [288, -120, 42, -165], [384, -145, 120, -190], [480, -170, 300, -220]];

const smoothstep = (x: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The Follow eye at a frame (1-based, fractional allowed), exactly as the app computes it. */
export function followEye(frame: number, stops: readonly FollowStop[] = FOLLOW_STOPS): [number, number, number] {
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (frame <= b[0]) {
      const t = smoothstep(frame, a[0], b[0]);
      return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}
