import * as THREE from 'three';
import type { Bands } from './overviewFraming';

/** Frontal arrival direction, in app axes. Stay inside the planting, beneath the canopy collider, and show the entrance. */
export const TERMINAL_EYE = [-153, 13.4, -98.4] as const;
export const TERMINAL_TARGET = [-152.75, 12.4, -110.8] as const;
/** Sign, open doors, shelter and the first arrival's passenger/pod area. Full source detail is unchanged. */
export const TERMINAL_BOUNDS = { min: [-158, 9.9, -113], max: [-146, 15.8, -105] } as const;
export const terminalPoints = () => [
  { min: [-157.3, 10, -112], max: [-148.2, 14.3, -110.7] }, // sign and doorway
  { min: [-154.2, 10, -112], max: [-148.5, 12.3, -107.8] }, // visible approach
  { min: [-151.28, 10.32, -107.85], max: [-147.02, 12.1, -105.45] }, // parked hover shuttle and side pods
].flatMap(box => Array.from({ length: 8 }, (_, i) => new THREE.Vector3(
  i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2],
)));

/** Fit the arrival within the real UI bands, keeping a clear frontal direction on desktop and phones. */
export function terminalPose(aspect: number, fov: number, bands: Bands, eye: THREE.Vector3, target: THREE.Vector3) {
  const forward = new THREE.Vector3(...TERMINAL_TARGET).sub(new THREE.Vector3(...TERMINAL_EYE)).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  const top = 1 - 2 * Math.min(bands.top, .45) - .08, bottom = -1 + 2 * Math.min(bands.bottom, .45) + .08;
  const points = terminalPoints(), centre = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const delta = new THREE.Vector3();
  // Stay inside the foreground tree line. Pulling back on phones fitted an overly conservative box but put a tree
  // directly in front of the people. Widen the lens for the actual UI band instead of retreating behind the planting.
  const distance = 10.5;
  for (let lens = fov; lens <= 148; lens += .5) {
    const tanY = Math.tan(THREE.MathUtils.degToRad(lens) / 2), tanX = tanY * aspect;
    target.copy(centre);
    for (let pass = 0; pass < 6; pass++) {
      eye.copy(target).addScaledVector(forward, -distance);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const point of points) {
        delta.subVectors(point, eye); const depth = delta.dot(forward);
        const x = delta.dot(right) / (depth * tanX), y = delta.dot(up) / (depth * tanY);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      if (x0 >= -.92 && x1 <= .92 && y0 >= bottom && y1 <= top) return lens;
      target.addScaledVector(right, (x0 + x1) / 2 * distance * tanX);
      target.addScaledVector(up, ((y0 + y1) / 2 - (top + bottom) / 2) * distance * tanY);
    }
  }
  eye.copy(target).addScaledVector(forward, -distance);
  return 148;
}
