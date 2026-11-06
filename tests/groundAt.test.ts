import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { groundAt } from '../src/scene/bases';

// A base group scaled so its world is R base units in radius, centred R below the origin.
const base = (R: number) => {
  const group = new THREE.Group();
  group.scale.setScalar(1 / R);
  group.updateMatrixWorld(true);
  return group;
};
/** A camera at a point in base units, looking at another (base units too). */
const camera = (R: number, position: [number, number, number], target: [number, number, number]) => {
  const c = new THREE.PerspectiveCamera(50, 1, 1e-6, 100);
  c.up.set(0, 0, -1);
  c.position.set(...position).divideScalar(R);
  c.lookAt(new THREE.Vector3(...target).divideScalar(R));
  c.updateMatrixWorld(true);
  return c;
};

describe('groundAt: a screen point to the base ground, in base units', () => {
  it('straight down at the screen centre hits the ground under the camera', () => {
    const [x, z] = groundAt(base(10), camera(10, [2, 10, 3], [2, 0, 3]), 0.5, 0.5)!;
    expect(x).toBeCloseTo(2, 6);
    expect(z).toBeCloseTo(3, 6);
  });

  it('follows the ground as it curves away, to within a hair', () => {
    const R = 1000;
    // The ray from 0.5 up drops 1 in 8: it would meet a flat plane at x = 4.
    const [x, z] = groundAt(base(R), camera(R, [0, 0.5, 0], [4, 0, 0]), 0.5, 0.5)!;
    expect(x).toBeGreaterThan(4);
    expect(z).toBeCloseTo(0, 6);
    const ground = Math.sqrt(R * R - x * x) - R;
    expect(Math.abs(0.5 - x / 8 - ground)).toBeLessThan(1e-4);
  });

  it('a ray along the ground or away from it hits nothing', () => {
    expect(groundAt(base(10), camera(10, [0, 1, 0], [5, 1, 0]), 0.5, 0.5)).toBeNull();
    expect(groundAt(base(10), camera(10, [0, 1, 0], [0, 5, 0]), 0.5, 0.5)).toBeNull();
  });
});
