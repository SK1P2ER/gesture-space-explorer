import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { deckPose, deckSubjectPoints, DECK_EYE } from '../src/scene/deckFraming';
import { SpaceportCollision, type SpaceportSite } from '../src/scene/spaceportCollision';

function projectAll(aspect: number, fovDeg: number, eye: THREE.Vector3, target: THREE.Vector3, points: THREE.Vector3[]) {
  const camera = new THREE.PerspectiveCamera(fovDeg, aspect, 0.5, 4000);
  camera.position.copy(eye);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return points.map(p => p.clone().project(camera));
}

describe('Observation Deck framing (P3.3)', () => {
  const cases = [
    { name: 'desktop 1440x900', aspect: 1440 / 900, bands: { top: 0.08, bottom: 0.16 } },
    { name: 'phone portrait 390x844', aspect: 390 / 844, bands: { top: 0.09, bottom: 0.27 } },
    { name: 'phone landscape 844x390', aspect: 844 / 390, bands: { top: 0.16, bottom: 0.38 } },
  ];

  for (const c of cases) {
    it(`frames shuttle, gantry, and liftoff headroom from the offshore deck on ${c.name}`, () => {
      const eye = new THREE.Vector3();
      const target = new THREE.Vector3();
      const fov = deckPose(c.aspect, 30, c.bands, eye, target);
      expect(eye.toArray()).toEqual([...DECK_EYE]);

      // Eye must stay completely clear of all site.json colliders and terrain floor
      const realSite = JSON.parse(readFileSync('public/spaceport/site.json', 'utf8')) as SpaceportSite;
      const safety = new SpaceportCollision(realSite);
      expect(safety.constrain(eye, eye).distanceTo(eye)).toBeLessThan(1e-4);

      const yTop = 1 - 2 * c.bands.top - 0.055;
      const yBottom = -1 + 2 * c.bands.bottom + 0.055;
      const projected = projectAll(c.aspect, fov, eye, target, deckSubjectPoints());
      for (const p of projected) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(0.95);
        expect(p.y).toBeLessThanOrEqual(yTop);
        expect(p.y).toBeGreaterThanOrEqual(yBottom);
        expect(p.z).toBeGreaterThan(-1);
        expect(p.z).toBeLessThan(1);
      }
    });
  }
});
