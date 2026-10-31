import { readFileSync } from 'node:fs';
import type { Hand, Point3 } from '../../src/tracking/types';
import type { Recording } from '../../src/ui/recorder';

// Hand poses for tests, built from real MediaPipe recordings (tests/fixtures),
// in the same spirit as engine.test.ts: real landmarks, scripted motion.

export const ASPECT = 4 / 3;
export const FRAME_MS = 33;

export const fixtureHand = (name: string): Hand => {
  const rec: Recording = JSON.parse(readFileSync(new URL(`../fixtures/${name}.landmarks.json`, import.meta.url), 'utf8'));
  return rec.frames[0].hands[0];
};

// Landmark indices of each finger's joints past the knuckle.
const INDEX = [6, 7, 8];
const MIDDLE = [10, 11, 12];
const RING = [14, 15, 16];

/**
 * `base` with some landmarks replaced by `donor`'s, after aligning the donor
 * hand onto the base hand (wrist → wrist, middle knuckle → middle knuckle).
 * Used to fold fingers of a real open hand with a real fist's fingers.
 */
function compose(base: Hand, donor: Hand, indices: number[]): Hand {
  const toView = ([x, y, z]: Point3): Point3 => [x * ASPECT, y, z];
  const b = base.landmarks.map(toView);
  const d = donor.landmarks.map(toView);
  // Similarity transform as complex multiplication: p' = b0 + (p - d0) * k.
  const [sx, sy] = [d[9][0] - d[0][0], d[9][1] - d[0][1]];
  const [tx, ty] = [b[9][0] - b[0][0], b[9][1] - b[0][1]];
  const den = sx * sx + sy * sy;
  const [kr, ki] = [(tx * sx + ty * sy) / den, (ty * sx - tx * sy) / den];
  const scale = Math.hypot(kr, ki);
  const aligned = d.map(([x, y, z]): Point3 => {
    const [px, py] = [x - d[0][0], y - d[0][1]];
    return [b[0][0] + px * kr - py * ki, b[0][1] + px * ki + py * kr, z * scale];
  });
  const out = b.map((p, i) => (indices.includes(i) ? aligned[i] : p));
  return { ...base, landmarks: out.map(([x, y, z]): Point3 => [x / ASPECT, y, z]) };
}

/**
 * Swings the thumb (landmarks 2–4) about its base joint by `angle` radians,
 * away from the palm (positive) or into it (negative), measured in the view.
 */
export function swingThumb(hand: Hand, angle: number): Hand {
  const v = hand.landmarks.map(([x, y, z]): Point3 => [x * ASPECT, y, z]);
  const spread = (a: number) => {
    const [ox, oy] = [v[1][0], v[1][1]];
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return v.map((p, i): Point3 => {
      if (i < 2 || i > 4) return p;
      const [px, py] = [p[0] - ox, p[1] - oy];
      return [ox + px * c - py * s, oy + px * s + py * c, p[2]];
    });
  };
  // "Away from the palm" = whichever direction moves the thumb tip away from the pinky knuckle.
  const reach = (pts: Point3[]) => Math.hypot(pts[4][0] - pts[17][0], pts[4][1] - pts[17][1]);
  const sign = reach(spread(0.1)) > reach(spread(-0.1)) ? 1 : -1;
  return { ...hand, landmarks: spread(sign * angle).map(([x, y, z]): Point3 => [x / ASPECT, y, z]) };
}

const palm = fixtureHand('right_hands');
const fist = fixtureHand('fist');

export const HANDS = {
  palm,
  fist,
  point: fixtureHand('pointing_up'),
  v: fixtureHand('victory'),
  /** 🤘 index + pinky up. */
  rock: compose(palm, fist, [...MIDDLE, ...RING]),
  /** 🤙 thumb + pinky out (the recorded open hand's thumb, swung out like a real shaka). */
  shaka: swingThumb(compose(palm, fist, [...INDEX, ...MIDDLE, ...RING]), 0.45),
};
export type HandName = keyof typeof HANDS;

export interface Placement {
  /** Offset of the palm center from frame center, in the user's (mirrored) view. */
  dx?: number;
  dy?: number;
  /** Tilt in radians, around the wrist; positive = clockwise as the user sees it (top of the hand toward their right). */
  tilt?: number;
  /** Mirror the hand left↔right: a left hand made from a right one. */
  mirror?: boolean;
}

/** Puts a hand into the frame. All work happens in the user's view: mirrored, aspect-corrected. */
export function place(hand: Hand, { dx = 0, dy = 0, tilt = 0, mirror = false }: Placement = {}): Hand {
  const view = hand.landmarks.map(([x, y, z]): Point3 => [(1 - x) * ASPECT, y, z]);
  const [cx, cy] = view[9];
  const [wx, wy] = [view[0][0] - cx, view[0][1] - cy];
  const [c, s] = [Math.cos(tilt), Math.sin(tilt)];
  const landmarks = view.map(([x, y, z]): Point3 => {
    let px = x - cx;
    const py = y - cy;
    if (mirror) px = -px;
    // Rotate about the wrist (y points down, so this turns clockwise on screen).
    const [rx, ry] = [px - (mirror ? -wx : wx), py - wy];
    const [qx, qy] = [rx * c - ry * s + (mirror ? -wx : wx), rx * s + ry * c + wy];
    const vx = 0.5 * ASPECT + qx + dx * ASPECT;
    const vy = 0.5 + qy + dy;
    return [1 - vx / ASPECT, vy, z];
  });
  const handedness = mirror ? (hand.handedness === 'Left' ? 'Right' : 'Left') : hand.handedness;
  return { ...hand, handedness, landmarks };
}

/** Frames of one hand: `n` frames, with the placement interpolated from `from` to `to`. */
export function frames(name: HandName, n: number, from: Placement = {}, to: Placement = from): Hand[][] {
  const lerp = (a = 0, b = 0, k: number) => a + (b - a) * k;
  return Array.from({ length: n }, (_, i) => {
    const k = n === 1 ? 0 : i / (n - 1);
    return [
      place(HANDS[name], {
        dx: lerp(from.dx, to.dx, k),
        dy: lerp(from.dy, to.dy, k),
        tilt: lerp(from.tilt, to.tilt, k),
        mirror: from.mirror,
      }),
    ];
  });
}
