import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { surfacePoint } from '../src/data/bases';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { baseSize, padFrame, PAD_RADIUS } from '../src/scene/bases';
import { Showcase } from '../src/scene/baseKit/showcase';
import { Rocket } from '../src/scene/rocketKit';
import { cellBlocked, parsePlaced } from '../src/sim/buildRules';
import { landingBases } from './helpers/landingBase';

describe('persistent landing pad parity (before Phase 2)', () => {
  it('preserves the origin, .35 radius, .015 deck top and local Y-up orientation', () => {
    const fixture = landingBases();
    try {
      const { jezero } = fixture;
      const pad = jezero.pad as THREE.Mesh;
      const bounds = new THREE.Box3().setFromBufferAttribute(pad.geometry.getAttribute('position') as THREE.BufferAttribute);
      expect(PAD_RADIUS).toBe(0.35);
      expect(pad.position.toArray()).toEqual([0, 0.0075, 0]);
      expect(bounds.max.y + pad.position.y).toBeCloseTo(0.015, 7);
      expect(bounds.min.x).toBeCloseTo(-0.35, 7);
      expect(bounds.max.z).toBeCloseTo(0.35, 7);
      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(jezero.group.quaternion);
      expect(normal.distanceTo(new THREE.Vector3(...surfacePoint(jezero.base.lat, jezero.base.lon)))).toBeLessThan(1e-8);
      expect(pad.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    } finally { fixture.dispose(); }
  });

  it('keeps padFrame at the base origin through translation, spin and overview scaling', () => {
    const fixture = landingBases();
    try {
      const b = fixture.jezero;
      for (const scale of [1, 2.5]) {
        b.body.tilt.scale.setScalar(scale);
        b.body.tilt.position.set(5, -2, 9);
        b.body.mesh.rotation.y = 0.7;
        const frame = padFrame(b);
        expect(frame.center.distanceTo(b.group.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-8);
        expect(frame.normal.length()).toBeCloseTo(1, 9);
        expect(frame.size).toBeCloseTo(baseSize(b.body.body.radius) * scale, 9);
      }
    } finally { fixture.dispose(); }
  });

  it('borrows the persistent material shared by all five pads and gives each pad owned geometry', () => {
    const fixture = landingBases();
    try {
      const pads = fixture.bases.map((b) => b.pad as THREE.Mesh);
      expect(new Set(pads.map((p) => p.material)).size).toBe(1);
      expect(new Set(pads.map((p) => p.geometry)).size).toBe(5);
    } finally { fixture.dispose(); }
  });

  it('does not free the persistent deck when the Jezero showcase retires', () => {
    const fixture = landingBases();
    const pad = fixture.jezero.pad as THREE.Mesh;
    const geometry = vi.spyOn(pad.geometry, 'dispose');
    const material = vi.spyOn(pad.material as THREE.Material, 'dispose');
    const view = new Showcase(JEZERO, { quality: 'low', R: 5.6, site: { point: new THREE.Vector3(0, 1, 0), quaternion: new THREE.Quaternion(), scale: 1 / 5.6 } });
    fixture.jezero.group.add(view.group);
    try {
      view.dispose();
      expect(geometry).not.toHaveBeenCalled();
      expect(material).not.toHaveBeenCalled();
      expect(pad.parent).toBe(fixture.jezero.group);
    } finally { geometry.mockRestore(); material.mockRestore(); fixture.dispose(); }
  });

  it('leaves the existing parked/docking rocket origin and deployed feet above the deck', () => {
    const rocket = new Rocket({ quality: 'low', textureSize: 16 });
    try {
      rocket.group.position.y = 0.02;
      rocket.group.scale.setScalar(0.5);
      rocket.booster.getObjectByName('flame')!.visible = false;
      // Invisible exhaust is not part of the solid swept envelope.
      for (const deploy of [0, 0.5, 1]) {
        rocket.setLegs(deploy);
        rocket.group.updateMatrixWorld(true);
        let minimum = Infinity;
        rocket.group.traverseVisible((object) => {
          if (!(object instanceof THREE.Mesh) || object.name === 'flame') return;
          const geometry = object.geometry;
          geometry.computeBoundingBox();
          if (object instanceof THREE.InstancedMesh) {
            for (let n = 0; n < object.count; n++) {
              const matrix = new THREE.Matrix4(); object.getMatrixAt(n, matrix);
              minimum = Math.min(minimum, geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld.clone().multiply(matrix)).min.y);
            }
          } else minimum = Math.min(minimum, geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld).min.y);
        });
        expect(minimum).toBeGreaterThan(0.015);
      }
    } finally { rocket.dispose(); }
  });

  it('retains pad exclusion and a previously valid saved Build cell', () => {
    expect(cellBlocked(JEZERO, [], 0, 0)).not.toBeNull();
    const saved = [{ kind: 'habitat', i: 0, j: -5, rot: 0 }];
    expect(parsePlaced(JSON.stringify(saved), JEZERO)).toEqual(saved);
  });
});
