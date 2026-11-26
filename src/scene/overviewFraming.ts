import * as THREE from 'three';

type Vec3 = readonly [number, number, number];
type Box = { min: Vec3; max: Vec3 };

/** Blender's "NEO CAM 01 | Coastal overview" in app axes (x, z, -y). */
export const OVERVIEW_REFERENCE = { eye: [75, 369, 670] as Vec3, target: [3, 24, 118] as Vec3 };
export const OVERVIEW_YAW_DEG = 0;

/** Reference campus subjects in app axes and metres. */
export const OVERVIEW_SUBJECTS: Record<'terminal' | 'pad' | 'tower' | 'offshore' | 'landing' | 'assemblyHall', Box> = {
  terminal: { min: [-224, 7, -178], max: [-89, 34, -79] },
  pad: { min: [-106, 4, -84], max: [106, 70, 96] },
  tower: { min: [143, 6, -144], max: [197, 23, -106] }, // Control building
  offshore: { min: [160, 7, 257], max: [211, 21, 306] },
  landing: { min: [-219, 6, 41], max: [-131, 9, 129] },
  assemblyHall: { min: [-107, 6, -277], max: [-6, 86, -213] },
};

const corners = (b: Box) => [0, 1, 2, 3, 4, 5, 6, 7].map(i => new THREE.Vector3(i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]));
const SUBJECT_POINTS = Object.values(OVERVIEW_SUBJECTS).flatMap(corners);

/** Screen area the scene is not covered by UI: fractions of the canvas height taken by the top bar and the dock. */
export interface Bands { top: number; bottom: number }
const MARGIN_X = 0.06, MARGIN_Y = 0.06;

/** The Overview direction: the reference camera's, turned by OVERVIEW_YAW_DEG (same pitch). */
export function overviewDirection(out = new THREE.Vector3(), yawDeg = OVERVIEW_YAW_DEG) {
  out.set(...OVERVIEW_REFERENCE.target).sub(new THREE.Vector3(...OVERVIEW_REFERENCE.eye)).normalize();
  return out.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(yawDeg));
}

/**
 * The Overview pose for a canvas aspect, vertical FOV and UI bands: the reference direction and pitch, pulled back just
 * far enough that every subject fits (with a margin) in the part of the screen between the top bar and the dock:
 * centred across, and moved up or down only as far as the bar and the dock need (the orbit pivot stays on the campus).
 * Narrow screens therefore move back instead of cropping the terminal or the offshore platform.
 */
export function overviewPose(aspect: number, fovDeg: number, bands: Bands, eye: THREE.Vector3, target: THREE.Vector3, yawDeg = OVERVIEW_YAW_DEG) {
  const forward = overviewDirection(undefined, yawDeg), right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2), tanH = tanV * aspect;
  const yTop = 1 - 2 * Math.min(bands.top, 0.45) - MARGIN_Y, yBottom = -1 + 2 * Math.min(bands.bottom, 0.45) + MARGIN_Y;
  const xMax = 1 - MARGIN_X, centreY = (yTop + yBottom) / 2;
  /** How far the subjects must move up (+) or down (-) on screen to sit between the bands: none if they already do. */
  const lift = (y0: number, y1: number) => y1 - y0 > yTop - yBottom ? centreY - (y0 + y1) / 2 : Math.min(Math.max(0, yBottom - y0), yTop - y1);
  const centre = SUBJECT_POINTS.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(SUBJECT_POINTS.length);
  const rel = new THREE.Vector3();
  const bounds = (aim: THREE.Vector3, distance: number) => {
    const from = aim.clone().addScaledVector(forward, -distance);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, depth = 0;
    for (const p of SUBJECT_POINTS) {
      rel.subVectors(p, from); const z = rel.dot(forward); depth += z;
      const x = rel.dot(right) / (z * tanH), y = rel.dot(up) / (z * tanV);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x0, x1, y0, y1, depth: depth / SUBJECT_POINTS.length };
  };
  const aim = centre.clone();
  for (let distance = 300; distance <= 2100; distance += 5) {
    aim.copy(centre);
    let b = bounds(aim, distance);
    for (let i = 0; i < 8; i++) { // perspective: a few passes
      aim.addScaledVector(right, (b.x0 + b.x1) / 2 * b.depth * tanH).addScaledVector(up, -lift(b.y0, b.y1) * b.depth * tanV);
      b = bounds(aim, distance);
    }
    if (b.x0 >= -xMax && b.x1 <= xMax && b.y0 >= yBottom && b.y1 <= yTop) return place(aim, distance, forward, eye, target, true);
  }
  // Nothing fits (an extreme window): the widest allowed view.
  return place(aim, 2100, forward, eye, target, false);
}

/** Deck height of the campus (m): the orbit pivot never sits below it. */
const PIVOT_MIN_Y = 8;
/**
 * Eye `distance` back from the aim point. A lift for a tight band (phone landscape) can put the aim point under the
 * ground; the pivot then slides back along the same line of sight up to deck height, so the picture is unchanged but
 * orbiting turns around the campus, not a point underground.
 */
function place(aim: THREE.Vector3, distance: number, forward: THREE.Vector3, eye: THREE.Vector3, target: THREE.Vector3, fits: boolean) {
  eye.copy(aim).addScaledVector(forward, -distance);
  target.copy(aim);
  if (target.y < PIVOT_MIN_Y && forward.y < 0) target.addScaledVector(forward, -(PIVOT_MIN_Y - target.y) / -forward.y);
  return fits;
}
