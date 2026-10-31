import type { Config } from '../config';
import type { Hand, Point3 } from '../tracking/types';

// Landmarks → a compact, scale-invariant observation of one hand. Pure.
//
// Coordinates here are MIRRORED (selfie view) and aspect-corrected:
//   x ∈ [0,1] left→right as the user sees themselves, y ∈ [0,1] top→bottom.
// Distances are measured in a space where 1 unit of y == 1 unit of x on screen.

export type Pose = 'palm' | 'fist' | 'point' | 'v' | 'pinch' | 'none';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Fingers {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

export interface HandObs {
  pose: Pose;
  fingers: Fingers;
  /** wrist→tip / wrist→PIP for index, middle, ring, pinky (extended ≈ 1.35, curled ≈ 0.65). */
  ratios: [number, number, number, number];
  pinchRatio: number;
  palm: number; // wrist → middle-finger base, in normalized height units
  center: Vec2; // palm center (middle-finger base)
  indexTip: Vec2;
  pinchPoint: Vec2; // midpoint of thumb tip and index tip
}

const WRIST = 0;
const THUMB_TIP = 4;
const PINKY_MCP = 17;
const INDEX = { mcp: 5, pip: 6, tip: 8 };
const MIDDLE = { mcp: 9, pip: 10, tip: 12 };
const RING = { pip: 14, tip: 16 };
const PINKY = { pip: 18, tip: 20 };

/**
 * @param aspect video width / height (x is scaled by this so distances are isomorphic)
 * @param wasPinching previous pose was pinch → use the looser exit threshold (hysteresis)
 */
export function observeHand(
  hand: Hand,
  aspect: number,
  cfg: Config['gestures'],
  wasPinching = false,
): HandObs {
  const p = hand.landmarks.map(([x, y]: Point3): Vec2 => ({ x: (1 - x) * aspect, y }));
  const palm = dist(p[WRIST], p[MIDDLE.mcp]) || 1e-6;

  const ratio = (f: { pip: number; tip: number }) => dist(p[WRIST], p[f.tip]) / (dist(p[WRIST], p[f.pip]) || 1e-6);
  const ratios: HandObs['ratios'] = [ratio(INDEX), ratio(MIDDLE), ratio(RING), ratio(PINKY)];
  const [index, middle, ring, pinky] = ratios.map((r) => r > cfg.extendedRatio);
  // Thumb: informational only (logging). It is ignored for pose decisions
  // because people hold it differently in a ✌️ or ☝️.
  const thumb = dist(p[THUMB_TIP], p[PINKY_MCP]) / palm > 1.2;

  const pinchRatio = dist(p[THUMB_TIP], p[INDEX.tip]) / palm;
  // In a fist the thumb also rests near the index tip; a real pinch keeps the
  // index finger out of the palm.
  const indexOut = dist(p[WRIST], p[INDEX.tip]) / palm > cfg.pinchMinIndexReach;
  const pinching = indexOut && pinchRatio < (wasPinching ? cfg.pinchExit : cfg.pinchEnter);

  let pose: Pose;
  if (pinching) pose = 'pinch';
  else if (index && middle && ring && pinky) pose = 'palm';
  else if (!index && !middle && !ring && !pinky) pose = 'fist';
  else if (index && !middle && !ring && !pinky) pose = 'point';
  // ✌️ is lenient: a relaxed V often has the ring or pinky half raised.
  // Only all four fingers up is a palm (handled above).
  else if (index && middle) pose = 'v';
  else pose = 'none';

  const unscale = (v: Vec2): Vec2 => ({ x: v.x / aspect, y: v.y });
  return {
    pose,
    fingers: { thumb, index, middle, ring, pinky },
    ratios,
    pinchRatio,
    palm,
    center: unscale(p[MIDDLE.mcp]),
    indexTip: unscale(p[INDEX.tip]),
    pinchPoint: unscale(mid(p[THUMB_TIP], p[INDEX.tip])),
  };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
