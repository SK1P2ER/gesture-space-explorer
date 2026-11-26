import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { padPose, padPoints, PAD_SUBJECTS } from '../src/scene/padFraming';
import { SpaceportCollision, type SpaceportSite } from '../src/scene/spaceportCollision';

function projectAll(aspect: number, fovDeg: number, eye: THREE.Vector3, target: THREE.Vector3, points: THREE.Vector3[]) {
  const camera = new THREE.PerspectiveCamera(fovDeg, aspect, 0.5, 4000);
  camera.position.copy(eye);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return points.map(p => p.clone().project(camera));
}

function lensForAspect(aspect: number, base = 30) {
  return THREE.MathUtils.radToDeg(
    2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base / 2)) / Math.min(1, aspect / 1.5)),
  );
}

describe('Launch Pad band-aware framing (P3.0)', () => {
  const cases = [
    { name: 'desktop 1440x900', aspect: 1440 / 900, bands: { top: 0.08, bottom: 0.16 } },
    { name: 'phone portrait 390x844', aspect: 390 / 844, bands: { top: 0.09, bottom: 0.27 } },
    { name: 'phone landscape 844x390', aspect: 844 / 390, bands: { top: 0.16, bottom: 0.38 } },
  ];

  for (const c of cases) {
    it(`fits shuttle, gantry, arms, and pad base between header and dock on ${c.name}`, () => {
      const fov = lensForAspect(c.aspect);
      const eye = new THREE.Vector3();
      const target = new THREE.Vector3();
      const appliedFov = padPose(c.aspect, fov, c.bands, eye, target);
      expect(appliedFov).toBeGreaterThanOrEqual(fov);
      expect(eye.distanceTo(target)).toBeLessThanOrEqual(220);
      expect(target.y).toBeGreaterThanOrEqual(8);
      const realSite = JSON.parse(readFileSync('public/spaceport/site.json', 'utf8')) as SpaceportSite;
      const safety = new SpaceportCollision(realSite);
      expect(safety.constrain(eye, eye).distanceTo(eye)).toBeLessThan(1e-4);
      // Line of sight to the pad must not intersect the Hero Terminal geometry (collider 0, raw bounds).
      const terminalOnly = new SpaceportCollision({ ...realSite, colliders: [realSite.colliders[0]] }, 0);
      expect(terminalOnly.blocked(eye, target)).toBe(false);

      const yTop = 1 - 2 * c.bands.top - 0.055;
      const yBottom = -1 + 2 * c.bands.bottom + 0.055;
      const projected = projectAll(c.aspect, appliedFov, eye, target, padPoints());
      for (const p of projected) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(0.95);
        expect(p.y).toBeLessThanOrEqual(yTop);
        expect(p.y).toBeGreaterThanOrEqual(yBottom);
        expect(p.z).toBeGreaterThan(-1);
        expect(p.z).toBeLessThan(1);
      }
    });
  }

  it('makes the shuttle and gantry substantially larger on phone portrait than the static P2.9 landmark', () => {
    const aspect = 390 / 844;
    const fov = lensForAspect(aspect);
    const bands = { top: 0.09, bottom: 0.27 };
    const eye = new THREE.Vector3();
    const target = new THREE.Vector3();
    const appliedFov = padPose(aspect, fov, bands, eye, target);

    const heroCorners = [
      new THREE.Vector3(0, PAD_SUBJECTS.hero.min[1], 0),
      new THREE.Vector3(0, PAD_SUBJECTS.hero.max[1], 0),
    ];
    const p30 = projectAll(aspect, appliedFov, eye, target, heroCorners);
    const p29 = projectAll(aspect, fov, new THREE.Vector3(-112, 44, -150), new THREE.Vector3(0, 32, 0), heroCorners);
    const p30Span = Math.abs(p30[1].y - p30[0].y);
    const p29Span = Math.abs(p29[1].y - p29[0].y);
    expect(p30Span).toBeGreaterThan(p29Span * 1.45);
  });
});
