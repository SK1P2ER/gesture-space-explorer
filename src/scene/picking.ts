import * as THREE from 'three';
import type { Body } from '../data/bodies';
import type { Vec2 } from '../gestures/perception';
import type { BodyNode } from '../planets/planet';

const tmp = new THREE.Vector3();

/**
 * Screen-space picking with a generous tolerance: tiny planets (Mercury is a
 * few pixels wide) must still be easy to point at with a shaky finger.
 * @param screen pointer in [0,1] × [0,1], top-left origin
 */
export function pickBody(
  nodes: BodyNode[],
  camera: THREE.PerspectiveCamera,
  screen: Vec2,
  width: number,
  height: number,
  tolerancePx = 40,
  include: (body: Body) => boolean = () => true,
): string | null {
  const px = screen.x * width;
  const py = screen.y * height;
  const pxPerUnitAtDist1 = height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  let best: string | null = null;
  let bestScore = tolerancePx;
  for (const { body, mesh, tilt, anchor } of nodes) {
    if (!include(body) || !anchor.visible) continue; // faded-out moons can't be picked
    mesh.getWorldPosition(tmp);
    const distance = tmp.distanceTo(camera.position);
    tmp.project(camera);
    if (tmp.z > 1) continue; // behind the camera
    const sx = ((tmp.x + 1) / 2) * width;
    const sy = ((1 - tmp.y) / 2) * height;
    const radiusPx = ((body.radius * tilt.scale.x) / distance) * pxPerUnitAtDist1; // as drawn (overview boost)
    const score = Math.hypot(sx - px, sy - py) - radiusPx; // ≤ 0 means directly on the body
    if (score < bestScore) {
      bestScore = score;
      best = body.id;
    }
  }
  return best;
}
