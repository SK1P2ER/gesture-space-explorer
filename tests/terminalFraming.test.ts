import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { terminalPoints, terminalPose } from '../src/scene/terminalFraming';

describe('arrival camera keeps the entrance and parked pod clear of the actual UI', () => {
  for (const [width, height, topPx, dockPx] of [[1440, 900, 76, 160], [390, 844, 88, 260], [844, 390, 64, 162]]) {
    it(`${width}×${height}`, () => {
      const aspect = width / height;
      const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) / Math.min(1, aspect / 1.5)));
      const bands = { top: topPx / height, bottom: dockPx / height };
      const eye = new THREE.Vector3(), target = new THREE.Vector3();
      const lens = terminalPose(aspect, fov, bands, eye, target);
      const camera = new THREE.PerspectiveCamera(lens, aspect, 2, 15000);
      camera.position.copy(eye); camera.lookAt(target); camera.updateMatrixWorld();
      for (const point of terminalPoints()) {
        const p = point.project(camera);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(.92001);
        expect(p.y).toBeLessThanOrEqual(1 - 2 * bands.top - .0799);
        expect(p.y).toBeGreaterThanOrEqual(-1 + 2 * bands.bottom + .0799);
        expect(p.z).toBeGreaterThan(-1); expect(p.z).toBeLessThan(1);
      }
      // The camera remains on the public approach side, in front of the shelter and terminal colliders.
      expect(eye.z).toBeGreaterThan(-105);
      expect(eye.z).toBeLessThan(-96);
      expect(eye.y).toBeGreaterThan(10);
    });
  }
});
