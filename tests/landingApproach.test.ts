import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { landingViewDirection } from '../src/app/mission';
import { surfacePoint } from '../src/data/bases';
import type { BaseNode } from '../src/scene/bases';

describe('Japan arrival camera', () => {
  it('looks inland from the Pacific while keeping a tangent, screen-relative steering frame as Earth rotates', () => {
    for (const angle of [0, 0.5, 2, 5]) {
      const mesh = new THREE.Object3D();
      mesh.rotation.set(0.41, angle, -0.2);
      mesh.scale.setScalar(2.5);
      mesh.updateMatrixWorld();
      const base = { base: { id: 'cape', body: 'earth', lat: 30.4, lon: 131 }, body: { mesh } } as BaseNode;
      const point = new THREE.Vector3(...surfacePoint(base.base.lat, base.base.lon));
      const normal = point.clone().transformDirection(mesh.matrixWorld);
      // Independent finite difference on the actual globe mapping: increasing
      // longitude is east, regardless of Earth's tilt or current spin.
      const east = new THREE.Vector3(...surfacePoint(base.base.lat, base.base.lon + .001))
        .sub(point).transformDirection(mesh.matrixWorld);
      const toward = landingViewDirection(base, normal);
      expect(toward.dot(east)).toBeGreaterThan(.999999);
      expect(toward.dot(normal)).toBeCloseTo(0, 12);
      expect(toward.length()).toBeCloseTo(1, 12);
      expect(new THREE.Vector3().crossVectors(normal, toward).length()).toBeCloseTo(1, 12);
    }
  });

  it('keeps the polar fallback finite for other worlds', () => {
    const base = { base: { id: 'tranquility', body: 'moon' } } as BaseNode;
    for (const normal of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)]) {
      const toward = landingViewDirection(base, normal);
      expect(toward.toArray().every(Number.isFinite)).toBe(true);
      expect(toward.dot(normal)).toBe(0);
      expect(toward.length()).toBe(1);
    }
  });
});
