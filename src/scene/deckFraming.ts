import * as THREE from 'three';
import type { Bands } from './overviewFraming';

/**
 * Standing eye level, about 1.8 m above the offshore deck, looking over the windscreen toward the launch apron.
 */
export const DECK_EYE = [180.6, 9.72, 272.8] as const;

/**
 * Subjects framed from the Observation Deck:
 * - shuttle & gantry at rest (Y=8.5..68 m) plus liftoff headroom (up to Y=98 m so t=10 s liftoff stays in frame)
 * - foreground windscreen rim point directly along the sightline so the deck context reads cleanly
 */
export const DECK_SUBJECTS = {
  padAndLiftoff: { min: [-18, 8.0, -28], max: [38, 98.0, 18] },
  foregroundRail: [175, 8.98, 264.85],
} as const;

const corners = (b: { min: readonly [number, number, number]; max: readonly [number, number, number] }) =>
  [0, 1, 2, 3, 4, 5, 6, 7].map(
    i => new THREE.Vector3(i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]),
  );

export const deckSubjectPoints = () => [...corners(DECK_SUBJECTS.padAndLiftoff), new THREE.Vector3(...DECK_SUBJECTS.foregroundRail)];

const MARGIN_X = 0.06;
const MARGIN_Y = 0.06;

/**
 * Band-aware Observation Deck framing for desktop, portrait phone, and landscape phone.
 * Keeps the camera fixed at eye level on the offshore deck (`DECK_EYE`) and adjusts vertical aim and FOV
 * so the shuttle, gantry, liftoff ascent headroom, and foreground deck edge sit cleanly between
 * `bands.top` and `bands.bottom`. Returns the vertical FOV (deg) to apply.
 */
export function deckPose(aspect: number, fovDeg: number, bands: Bands, eye: THREE.Vector3, target: THREE.Vector3) {
  eye.set(...DECK_EYE);
  const points = deckSubjectPoints();
  const centre = new THREE.Box3().setFromPoints(corners(DECK_SUBJECTS.padAndLiftoff)).getCenter(new THREE.Vector3());
  const yTop = 1 - 2 * Math.min(bands.top, 0.45) - MARGIN_Y;
  const yBottom = -1 + 2 * Math.min(bands.bottom, 0.45) + MARGIN_Y;
  const xMax = 1 - MARGIN_X;
  const centreY = (yTop + yBottom) / 2;

  const baseDist = eye.distanceTo(centre);
  const rel = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  const evalFov = (lens: number) => {
    const tanV = Math.tan(THREE.MathUtils.degToRad(lens) / 2);
    const tanH = tanV * aspect;
    target.copy(centre);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let pass = 0; pass < 8; pass++) {
      forward.subVectors(target, eye).normalize();
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      up.crossVectors(right, forward);
      x0 = Infinity; x1 = -Infinity; y0 = Infinity; y1 = -Infinity;
      for (const p of points) {
        rel.subVectors(p, eye);
        const z = rel.dot(forward);
        if (z <= 1) return null;
        const x = rel.dot(right) / (z * tanH);
        const y = rel.dot(up) / (z * tanV);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      if (x0 >= -xMax && x1 <= xMax && y0 >= yBottom && y1 <= yTop) {
        return { fits: true, x0, x1, y0, y1 };
      }
      target
        .addScaledVector(right, ((x0 + x1) / 2) * baseDist * tanH)
        .addScaledVector(up, (((y0 + y1) / 2) - centreY) * baseDist * tanV);
    }
    return { fits: x0 >= -xMax && x1 <= xMax && y0 >= yBottom && y1 <= yTop, x0, x1, y0, y1 };
  };

  // Start from a natural 30 deg coastal lens on desktop so the deck windscreen & bay frame the lower foreground
  const startLens = Math.max(28, Math.min(fovDeg, 36));
  for (let lens = startLens; lens <= 86; lens += 1) {
    const res = evalFov(lens);
    if (res?.fits) return lens;
  }
  evalFov(86);
  return 86;
}
