import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createJapanSpaceport } from '../src/scene/japanSpaceport';
import { surfacePoint } from '../src/data/bases';
import { landingBases } from './helpers/landingBase';

describe('stylized Tanegashima spaceport', () => {
  it('fits a small coastal base with five draw calls and a bounded geometry budget', () => {
    const port = createJapanSpaceport(7.14);
    const bounds = new THREE.Box3().setFromObject(port);
    expect(port.name).toBe('spaceport:tanegashima');
    expect(port.children).toHaveLength(5);
    expect(bounds.min.x).toBeGreaterThan(-0.5);
    expect(bounds.max.x).toBeLessThan(0.5);
    expect(bounds.min.z).toBeGreaterThan(-0.5);
    expect(bounds.max.z).toBeLessThan(0.5);
    expect(bounds.min.y).toBeGreaterThan(-0.03);
    expect(bounds.max.y).toBeLessThan(0.45);
    let triangles = 0;
    port.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      triangles += object.geometry.index.count / 3;
      expect(Array.from(object.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
    });
    expect(triangles).toBeLessThanOrEqual(1200);
  });

  it('keeps the landing footprint clear below the raised service arm', () => {
    const port = createJapanSpaceport(7.14), point = new THREE.Vector3();
    port.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const positions = object.geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index);
        if (Math.hypot(point.x, point.z) < 0.35) expect(point.y).toBeGreaterThan(0.28);
      }
    });
  });

  it('adds a Japanese facade mark without textures or shared instance materials', () => {
    const first = createJapanSpaceport(7.14), second = createJapanSpaceport(7.14);
    expect(first.getObjectByName('spaceport:red')).toBeDefined();
    for (let index = 0; index < first.children.length; index++) {
      const a = first.children[index] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      const b = second.children[index] as typeof a;
      expect(a.material.map).toBeNull();
      expect(a.material).not.toBe(b.material);
      expect(a.geometry).not.toBe(b.geometry);
    }
  });

  it('faces its facade toward the Pacific without turning the pad frame', () => {
    const fixture = landingBases();
    const base = fixture.bases.find((node) => node.base.id === 'cape')!;
    try {
      const surface = new THREE.Vector3(...surfacePoint(base.base.lat, base.base.lon));
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(base.group.quaternion).distanceTo(surface)).toBeLessThan(1e-12);
      expect(base.pad.position.x).toBe(0);
      expect(base.pad.position.z).toBe(0);
      base.group.updateWorldMatrix(true, true);
      const east = new THREE.Vector3(...surfacePoint(base.base.lat, base.base.lon + 0.001)).sub(surface);
      east.addScaledVector(surface, -east.dot(surface)).transformDirection(base.body.mesh.matrixWorld);
      const facade = new THREE.Vector3(0, 0, 1).transformDirection(base.buildings[0].matrixWorld);
      expect(facade.dot(east)).toBeGreaterThan(0.999999);
    } finally {
      fixture.dispose();
      base.buildings[0].traverse((object) => {
        if (object instanceof THREE.Mesh) (object.material as THREE.Material).dispose();
      });
    }
  });
});
