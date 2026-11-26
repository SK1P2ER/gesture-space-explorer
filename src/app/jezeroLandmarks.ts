// Jezero Dome landmarks for Explore (Phase 1: Habitat Dome, Landing Pad, Communications Dish).
// Pure: no DOM, no scene, no three.js. Ids are stable (tests and i18n keys use them).
//
// Units are the base's own frame (data/baseLayout.ts): the pad at the origin, x east, z south, y up. In the horizon
// view the showcase is built flat (showcases.ts FLAT_R), so the ground is y ≈ 0 and Explore's eye stands at
// EYE_HEIGHT on it. Every number below comes from the scene that draws it (tests/jezeroLandmarks.test.ts checks them):
// - habitat: HAB-01 (layout habA, data/baseLayouts/jezero.ts), a dome of radius 0.163 and height 0.13 (showcase.ts
//   habitatRegistry bounds; habitatParts geometry).
// - pad: LZ-01 (landingPadParts.ts LANDING_ANCHORS: [0, 0.015, 0], radius 0.35) with the rocket standing on it, which
//   Explore shows at 0.3 × half a base size (mission.ts) and ROCKET.height 0.95 tall: 0.1425 base units.
// - dish: COM-01 (layout antenna, communicationsParts.ts): a 0.4 mast with a parabolic dish (radius 0.08, centre
//   [0, 0.38, 0.02] in part units) tilted to face up and north; whole-part bounds x ±0.08, y 0 … 0.451, z −0.063 … 0.065.

import { footprint, tunnelFootprint, polygonsOverlap, type Point } from '../data/baseLayout';
import { JEZERO } from '../data/baseLayouts/jezero';

export type LandmarkId = 'habitat' | 'pad' | 'dish';
export const LANDMARK_IDS: readonly LandmarkId[] = ['habitat', 'pad', 'dish'];

export type V3 = [x: number, y: number, z: number];

/** Explore's eye height above the ground (mission.ts horizonCamera), base units: standing on the plain. */
export const EYE_HEIGHT = 0.055;
/** The eye stays this far from the base centre: inside the ground patch (terrainRadius 2.4), short of its faded rim. */
export const EYE_LIMIT = JEZERO.terrainRadius - 0.15;
/** Explore's look limits (mission.ts: drag pitch). */
export const PITCH_RANGE = { min: -0.15, max: 0.6 } as const;
/** How much of the clear view a framed landmark's bounding sphere fills (1 = touching the edges). */
export const FILL = 0.8;
/** The eye keeps this far clear of modules and tunnels while framing a landmark (base units). */
export const CLEARANCE = 0.04;

export interface Landmark {
  id: LandmarkId;
  /** The layout module it is (data/baseLayouts/jezero.ts), or null for the pad (the base origin). */
  module: string | null;
  /** The identifier stencilled on it in the scene. */
  identifier: 'HAB-01' | 'LZ-01' | 'COM-01';
  /** The bounding sphere's centre, base frame: the camera orbits it and looks at it. */
  centre: V3;
  /** The bounding sphere's radius, base units. */
  radius: number;
  /** Which side the camera stands on (radians; the eye is centre + (cos yaw, ·, sin yaw) × distance). */
  yaw: number;
  /** The eye's height above the ground (base units): a little above standing height reads a flat or low landmark. */
  eyeHeight: number;
}

const moduleAt = (id: string) => {
  const m = JEZERO.modules.find((x) => x.id === id);
  if (!m) throw new Error(`jezeroLandmarks: no module ${id}`);
  return m;
};
const habA = moduleAt('habA');
const antenna = moduleAt('antenna');

/** A habitat dome: radius 0.163, height 0.13 (a bounding cylinder → sphere). */
export const DOME = { r: 0.163, h: 0.13 } as const;
/** LZ-01, and the rocket standing on it in Explore (0.95 × 0.15 base units tall). */
export const PAD = { y: 0.015, r: 0.35, rocketTop: 0.015 + 0.95 * 0.15 } as const;
/** COM-01's whole part bounds in its own frame (mast, dish, rim, cabinet). */
export const MAST = { min: [-0.08, 0, -0.063] as V3, max: [0.08, 0.451, 0.065] as V3 } as const;

const half = (a: number, b: number) => (a + b) / 2;

export const LANDMARKS: Readonly<Record<LandmarkId, Landmark>> = Object.freeze({
  // From the north-east: the open side of the cluster (the pad's rocket stays out of the line of sight), with CMD-01
  // and LAB-01 behind it.
  habitat: { id: 'habitat', module: 'habA', identifier: 'HAB-01', centre: [habA.x, DOME.h / 2, habA.z], radius: Math.hypot(DOME.r, DOME.h / 2), yaw: -Math.PI / 4, eyeHeight: 0.09 },
  // From the south, between the flag and the greenhouse, on the sunlit side (Jezero is at 18° N); the eye raised to
  // look down onto the flat pad (from standing height it is a sliver).
  pad: { id: 'pad', module: null, identifier: 'LZ-01', centre: [0, half(PAD.y, PAD.rocketTop), 0], radius: Math.hypot(PAD.r, (PAD.rocketTop - PAD.y) / 2), yaw: Math.PI / 2, eyeHeight: 0.3 },
  // From the north-north-east: the dish faces up and north, the habitats stand behind it. Due north would put the
  // eye off the ground patch.
  dish: {
    id: 'dish', module: 'antenna', identifier: 'COM-01',
    centre: [antenna.x + half(MAST.min[0], MAST.max[0]), half(MAST.min[1], MAST.max[1]), antenna.z + half(MAST.min[2], MAST.max[2])],
    radius: Math.hypot(MAST.max[0] - MAST.min[0], MAST.max[1] - MAST.min[1], MAST.max[2] - MAST.min[2]) / 2, yaw: -Math.PI / 3, eyeHeight: EYE_HEIGHT,
  },
});

export const isLandmarkId = (id: unknown): id is LandmarkId => typeof id === 'string' && (LANDMARK_IDS as readonly string[]).includes(id);

/** A horizon pose: the eye orbits `centre` at `distance` (horizontal), on the `yaw` side, looking in at `pitch`. */
export interface HorizonPose {
  centre: V3;
  yaw: number;
  pitch: number;
  distance: number;
  /** The eye's height above the ground. */
  height: number;
}

/**
 * The part of the view the Explore card leaves clear, for framing: its centre in normalized device coordinates
 * (x right, y up, −1 … 1) and its size as a share of the view's width and height.
 */
export interface ClearView { cx: number; cy: number; w: number; h: number }
export const FULL_VIEW: ClearView = Object.freeze({ cx: 0, cy: 0, w: 1, h: 1 });
export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * The largest clear band beside a covering card (below it on phones and desktop; left of it in the short-landscape
 * right column), from CSS pixels. `top` / `bottom`: the heights kept for the header and for the bottom controls and the
 * camera preview (every band stays between them). No card, or one that covers nothing: the full view between them.
 */
export function clearViewFor(width: number, height: number, card: Rect | null, gap = 8, bottom = 0, top = 0): ClearView {
  if (width <= 0 || height <= 0) return FULL_VIEW;
  const ceiling = Math.min(height * 0.4, Math.max(0, top));
  const floor = Math.max(ceiling + height * 0.3, height - Math.max(0, bottom));
  const whole = { cx: 0, cy: 1 - (ceiling + floor) / height, w: 1, h: (floor - ceiling) / height };
  const inset = top > 0 || bottom > 0;
  if (!card) return inset ? whole : FULL_VIEW;
  const [l, r, t, b] = [Math.max(0, card.left), Math.min(width, card.right), Math.max(0, card.top), Math.min(height, card.bottom)];
  if (r - l < 1 || b - t < 1) return inset ? whole : FULL_VIEW;
  const bands: [x0: number, y0: number, x1: number, y1: number][] = [
    [0, Math.max(ceiling, Math.min(floor, b + gap)), width, floor], // below
    [0, ceiling, width, Math.max(ceiling, t - gap)], // above
    [0, ceiling, Math.max(0, l - gap), floor], // left
    [Math.min(width, r + gap), ceiling, width, floor], // right
  ];
  const area = ([x0, y0, x1, y1]: (typeof bands)[number]) => Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const best = bands.reduce((a, c) => (area(c) > area(a) ? c : a));
  if (area(best) < 1) return inset ? whole : FULL_VIEW;
  const [x0, y0, x1, y1] = best;
  return { cx: (x0 + x1) / width - 1, cy: 1 - (y0 + y1) / height, w: (x1 - x0) / width, h: (y1 - y0) / height };
}

/**
 * How far to turn the camera (radians) so what is straight ahead shows at the clear view's centre instead:
 * yaw > 0 turns left (counterclockwise seen from above), pitch > 0 looks up. `vFov` is the vertical field of view.
 */
export function lookTurn(view: ClearView, vFov: number, aspect: number): { yaw: number; pitch: number } {
  const tanV = Math.tan(vFov / 2);
  return { yaw: Math.atan(view.cx * tanV * aspect), pitch: -Math.atan(view.cy * tanV) };
}

const BY_ID = new Map(JEZERO.modules.map((m) => [m.id, m]));
const OBSTACLES: Point[][] = [
  ...JEZERO.modules.map(footprint),
  ...JEZERO.tunnels.map((t) => tunnelFootprint(BY_ID.get(t.from)!, BY_ID.get(t.to)!)),
];

/** Is a ground point (base frame x, z) at least `clearance` clear of every module and tunnel footprint? */
export function eyeClear(x: number, z: number, clearance = CLEARANCE): boolean {
  const c = clearance;
  const box: Point[] = [[x - c, z - c], [x + c, z - c], [x + c, z + c], [x - c, z + c]];
  return !OBSTACLES.some((poly) => polygonsOverlap(box, poly));
}

/** The farthest the eye can stand from `centre` on the `yaw` side and stay within EYE_LIMIT of the base centre. */
export function maxDistance(centre: V3, yaw: number, limit = EYE_LIMIT): number {
  const [ux, uz] = [Math.cos(yaw), Math.sin(yaw)];
  const along = centre[0] * ux + centre[2] * uz;
  const disc = along * along - (centre[0] ** 2 + centre[2] ** 2 - limit ** 2);
  return disc <= 0 ? 0 : Math.max(0, -along + Math.sqrt(disc));
}

/** The nearest the eye may come to a landmark: just outside its bounding sphere. */
export const minDistance = (id: LandmarkId) => LANDMARKS[id].radius * 1.15;

/** The distances the look controls may zoom a framed landmark between, on the `yaw` side. */
export function distanceRange(id: LandmarkId, yaw: number): { min: number; max: number } {
  const min = minDistance(id);
  return { min, max: Math.max(min, maxDistance(LANDMARKS[id].centre, yaw)) };
}

/**
 * Where the eye actually stands for a requested distance: within distanceRange, then pushed back along the same line
 * of sight until it is clear of the modules and tunnels (never past the range's far end).
 */
export function clearDistance(id: LandmarkId, yaw: number, distance: number): number {
  const c = LANDMARKS[id].centre;
  const { min, max } = distanceRange(id, yaw);
  let d = Math.min(Math.max(distance, min), max);
  for (; d < max; d += 0.01) if (eyeClear(c[0] + Math.cos(yaw) * d, c[2] + Math.sin(yaw) * d)) return d;
  return max;
}

/** The pitch that looks from the eye (`eyeY` high, `distance` away) at a point `centreY` high, within PITCH_RANGE. */
export function aimPitch(centreY: number, distance: number, eyeY = EYE_HEIGHT): number {
  return Math.min(PITCH_RANGE.max, Math.max(PITCH_RANGE.min, Math.atan2(centreY - eyeY, distance)));
}

/**
 * The Explore pose that frames a landmark: its bounding sphere fills FILL of the clear view (the card's free band)
 * at the camera's vertical field of view `vFov` (radians) and `aspect`, from the landmark's own side, the eye inside
 * the ground patch and clear of the modules. The clear view's offset is applied while rendering (lookTurn).
 */
export function landmarkPose(id: LandmarkId, vFov: number, aspect: number, view: ClearView = FULL_VIEW): HorizonPose {
  const lm = LANDMARKS[id];
  const tanV = Math.tan(vFov / 2) * Math.max(0.2, view.h);
  const tanH = Math.tan(vFov / 2) * aspect * Math.max(0.2, view.w);
  const range = lm.radius / Math.sin(Math.atan(Math.min(tanV, tanH) * FILL)); // eye to centre
  const rise = lm.centre[1] - lm.eyeHeight;
  const distance = clearDistance(id, lm.yaw, Math.sqrt(Math.max(range * range - rise * rise, 0)));
  return { centre: [...lm.centre], yaw: lm.yaw, pitch: aimPitch(lm.centre[1], distance, lm.eyeHeight), distance, height: lm.eyeHeight };
}
