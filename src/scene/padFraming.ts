import * as THREE from 'three';
import type { Bands } from './overviewFraming';

type Vec3 = readonly [number, number, number];
type Box = { min: Vec3; max: Vec3 };

/** Approved Launch Pad viewing direction (matching site.json "pad" landmark), in app Y-up axes. */
export const PAD_REFERENCE = { eye: [-112, 44, -150] as Vec3, target: [0, 32, 0] as Vec3 };

/**
 * Subjects the Launch Pad view must keep readable between the top bar and dock:
 * - hero: shuttle (nose to mount), gantry tower, and both service arms through their 0° → 88° retraction sweep
 * - deck: pad slab, blast trench, and grade-integrated apron around the base
 */
export const PAD_SUBJECTS: Record<'hero' | 'deck', Box> = {
  hero: { min: [-12, 8.5, -24], max: [35, 68, 22] },
  deck: { min: [-22, 6.0, -24], max: [35, 10.0, 24] },
};

const corners = (b: Box) =>
  [0, 1, 2, 3, 4, 5, 6, 7].map(
    i => new THREE.Vector3(i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]),
  );

export const padPoints = () => Object.values(PAD_SUBJECTS).flatMap(corners);

const MARGIN_X = 0.06;
const MARGIN_Y = 0.06;
const PIVOT_MIN_Y = 8;

export function padDirection(out = new THREE.Vector3()) {
  return out.set(...PAD_REFERENCE.target).sub(new THREE.Vector3(...PAD_REFERENCE.eye)).normalize();
}

/**
 * Band-aware Launch Pad framing for desktop, portrait phone, and landscape phone.
 * Keeps the shuttle nose, gantry, service-arm swing, and pad base inside the open viewport between
 * the header (`bands.top`) and dock (`bands.bottom`), enlarging the shuttle and gantry on portrait phones
 * while clamping distance <= 215 m (in front of the Hero Terminal) and widening the lens if needed in
 * short landscape viewports. Returns the vertical FOV (deg) to apply.
 */
export function padPose(aspect: number, fovDeg: number, bands: Bands, eye: THREE.Vector3, target: THREE.Vector3) {
  const forward = padDirection();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  const yTop = 1 - 2 * Math.min(bands.top, 0.45) - MARGIN_Y;
  const yBottom = -1 + 2 * Math.min(bands.bottom, 0.45) + MARGIN_Y;
  const xMax = 1 - MARGIN_X;
  const centreY = (yTop + yBottom) / 2;

  const points = padPoints();
  const centre = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const rel = new THREE.Vector3();

  const bounds = (aim: THREE.Vector3, distance: number, tanH: number, tanV: number) => {
    const from = aim.clone().addScaledVector(forward, -distance);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, depth = 0;
    for (const p of points) {
      rel.subVectors(p, from);
      const z = rel.dot(forward);
      if (z <= 1) return null;
      depth += z;
      const x = rel.dot(right) / (z * tanH);
      const y = rel.dot(up) / (z * tanV);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    return { x0, x1, y0, y1, depth: depth / points.length };
  };

  const aim = centre.clone();
  // Keep the camera clear of the Hero Terminal roof collider (X in [-234,-74], Y in [13.2,41.2], Z in [-191,-83.7]).
  const clearOfTerminal = (p: THREE.Vector3) =>
    p.x > -73 || p.y > 42.5 || p.z > -83 || p.z < -192;

  for (let lens = fovDeg; lens <= Math.max(fovDeg, 96); lens += 1) {
    const tanV = Math.tan(THREE.MathUtils.degToRad(lens) / 2);
    const tanH = tanV * aspect;
    const minDist = lens === fovDeg ? 60 : 100;
    for (let distance = minDist; distance <= 190; distance += 2) {
      aim.copy(centre);
      let b = bounds(aim, distance, tanH, tanV);
      if (!b) continue;
      for (let i = 0; i < 8; i++) {
        aim
          .addScaledVector(right, ((b.x0 + b.x1) / 2) * b.depth * tanH)
          .addScaledVector(up, (((b.y0 + b.y1) / 2) - centreY) * b.depth * tanV);
        b = bounds(aim, distance, tanH, tanV);
        if (!b) break;
      }
      if (b && b.x0 >= -xMax && b.x1 <= xMax && b.y0 >= yBottom && b.y1 <= yTop) {
        place(aim, distance, forward, eye, target);
        if (clearOfTerminal(eye)) return lens;
      }
    }
  }
  place(centre, 130, forward, eye, target);
  return Math.max(fovDeg, 96);
}

function place(
  aim: THREE.Vector3,
  distance: number,
  forward: THREE.Vector3,
  eye: THREE.Vector3,
  target: THREE.Vector3,
) {
  eye.copy(aim).addScaledVector(forward, -distance);
  target.copy(aim);
  if (target.y < PIVOT_MIN_Y && forward.y < 0) {
    target.addScaledVector(forward, -(PIVOT_MIN_Y - target.y) / -forward.y);
  }
}
