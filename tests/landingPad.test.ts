import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { LandingPad } from '../src/scene/baseKit/landingPad';
import { LANDING_ANCHORS, landingPadParts } from '../src/scene/baseKit/landingPadParts';
import * as factory from '../src/scene/baseKit/landingPadParts';
import { Rocket } from '../src/scene/rocketKit';
import { dockingParams, startDocking, stepDocking } from '../src/sim/docking';
import { legDeploy, LEGS_AT } from '../src/app/mission';

function lowestSolid(rocket: Rocket) {
  rocket.group.updateMatrixWorld(true);
  let bottom = Infinity;
  rocket.group.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh) || object.name === 'flame') return;
    object.geometry.computeBoundingBox();
    const include = (matrix: THREE.Matrix4) => {
      bottom = Math.min(bottom, object.geometry.boundingBox!.clone().applyMatrix4(matrix).min.y);
    };
    if (object instanceof THREE.InstancedMesh) {
      for (let n = 0; n < object.count; n++) {
        const instance = new THREE.Matrix4(); object.getMatrixAt(n, instance);
        include(object.matrixWorld.clone().multiply(instance));
      }
    } else include(object.matrixWorld);
  });
  return bottom;
}

describe('entry-owned landing platform detail', () => {
  it.each(['low', 'high'] as const)('%s detail respects the original footprint and rocket clearance', (quality) => {
    const parts = landingPadParts(quality);
    try {
      for (const [, geometry] of parts) {
        const p = geometry.getAttribute('position');
        expect(geometry.getAttribute('normal').count).toBe(p.count);
        expect(geometry.getAttribute('uv').count).toBe(p.count);
        for (let n = 0; n < p.count; n++) {
          expect(Math.hypot(p.getX(n), p.getZ(n))).toBeLessThanOrEqual(0.35 + 1e-7);
          expect(p.getY(n)).toBeGreaterThanOrEqual(-1e-7);
          expect(p.getY(n)).toBeLessThanOrEqual(0.018 + 1e-7);
        }
      }
      expect(parts.find(([, g]) => g.userData.identifier === 'LZ-01')).toBeDefined();
    } finally { for (const [, geometry] of parts) geometry.dispose(); }
  });

  it('keeps the docking datum distinct from the deck and exposes stable semantic metadata', () => {
    const pad = new LandingPad('low');
    try {
      expect([...pad.anchors.keys()]).toEqual(['LZ-01', 'PAD-CENTER', 'PAD-PERIMETER', 'DOCK-ANCHOR']);
      expect(pad.anchors.get('DOCK-ANCHOR')!.position.toArray()).toEqual([0, 0, 0]);
      expect(pad.anchors.get('PAD-CENTER')!.position.y).toBe(0.015);
      expect(LANDING_ANCHORS['PAD-PERIMETER'].radius).toBe(0.35);
      expect(pad.group.position.toArray()).toEqual([0, 0, 0]);
      expect(pad.group.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    } finally { pad.dispose(); }
  });

  it('batches richer High detail into the same four materials, with bounded geometry and no added lights', () => {
    const low = new LandingPad('low'), high = new LandingPad('high');
    try {
      expect(low.stats().meshes).toBe(4);
      expect(high.stats().meshes).toBe(4);
      expect(high.stats().triangles).toBeGreaterThan(low.stats().triangles);
      expect(low.stats().triangles).toBeLessThan(1000);
      expect(high.stats().triangles).toBeLessThan(2000);
      high.group.traverse((object) => expect(object instanceof THREE.Light).toBe(false));
      console.info('Landing detail budgets:', JSON.stringify({ low: low.stats(), high: high.stats() }));
    } finally { low.dispose(); high.dispose(); }
  });

  it('consumes factory geometry exactly once and releases independent owned outputs once', () => {
    const original = factory.landingPadParts;
    const sources: ReturnType<typeof vi.spyOn>[] = [];
    const spy = vi.spyOn(factory, 'landingPadParts').mockImplementation((quality) => {
      const parts = original(quality);
      for (const [, geometry] of parts) sources.push(vi.spyOn(geometry, 'dispose'));
      return parts;
    });
    const borrowed = new THREE.Texture();
    const borrowedDisposed = vi.spyOn(borrowed, 'dispose');
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        const pad = new LandingPad(cycle % 2 ? 'high' : 'low');
        const owner = new THREE.Group(); owner.add(pad.group);
        pad.setEnvironment(borrowed);
        const released = pad.group.children.flatMap((object) => {
          const mesh = object as THREE.Mesh;
          return [vi.spyOn(mesh.geometry, 'dispose'), vi.spyOn(mesh.material as THREE.Material, 'dispose')];
        });
        for (const source of sources) expect(source).toHaveBeenCalledTimes(1);
        pad.dispose(); pad.dispose();
        for (const resource of released) expect(resource).toHaveBeenCalledTimes(1);
        for (const source of sources) expect(source).toHaveBeenCalledTimes(1);
        expect(pad.group.parent).toBeNull();
        expect(borrowedDisposed).not.toHaveBeenCalled();
      }
    } finally { spy.mockRestore(); borrowed.dispose(); }
  });

  it('updates day/night without accumulating dimming, allocating GPU resources or flashing guidance', () => {
    const pad = new LandingPad('low');
    try {
      const meshes = pad.group.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
      const geometry = meshes.map((mesh) => mesh.geometry);
      const materials = meshes.map((mesh) => mesh.material);
      const daylight = materials[0].color.clone();
      const guidance = pad.group.getObjectByName('landing:guidance') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      const glow = guidance.material.color.clone();
      for (let n = 0; n < 20; n++) pad.setDaylight(1, false);
      expect(materials[0].color.r).toBeCloseTo(daylight.r * 0.25, 8);
      expect(guidance.material.color.equals(glow)).toBe(true);
      pad.setDaylight(0, false);
      expect(materials[0].color.equals(daylight)).toBe(true);
      pad.setDaylight(1, true);
      expect(materials[0].color.equals(daylight)).toBe(true);
      meshes.forEach((mesh, n) => {
        expect(mesh.geometry).toBe(geometry[n]); expect(mesh.material).toBe(materials[n]);
      });
    } finally { pad.dispose(); }
  });

  it.each([false, true])('keeps the parked solid envelope above all new detail (lander=%s)', (lander) => {
    const rocket = new Rocket({ quality: 'low', textureSize: 16 });
    try {
      rocket.setLander(lander);
      rocket.group.position.y = 0.02;
      rocket.group.scale.setScalar(0.5);
      for (const deploy of [0, 0.25, 0.5, 0.75, 1]) {
        rocket.setLegs(deploy);
        expect(lowestSolid(rocket)).toBeGreaterThan(0.018);
      }
    } finally { rocket.dispose(); }
  });

  it('clears the new deck detail through an existing Mars auto-docking trajectory, leg deployment and lift-off', () => {
    const rocket = new Rocket({ quality: 'low', textureSize: 16 });
    try {
      rocket.setLander(true);
      rocket.group.scale.setScalar(0.5);
      const params = dockingParams(3.71);
      let state = startDocking(2.5), legTime = 0;
      while (!state.outcome) {
        state = stepDocking(state, 1 / 30, params, null, true);
        const progress = 1 - state.alt / 2.5;
        if (progress >= LEGS_AT) legTime += 1 / 30;
        rocket.setLegs(legDeploy(progress, legTime));
        rocket.group.position.set(state.x * 0.35, Math.max(state.alt * 0.35, 0.02), state.z * 0.35);
        rocket.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(state.vx * 0.12, 1, state.vz * 0.12).normalize());
        expect(lowestSolid(rocket)).toBeGreaterThan(0.018);
      }
      expect(state.outcome).toBe('landed');
      for (const elevation of [0.02, 0.04, 0.1, 0.3]) {
        rocket.group.position.y = elevation;
        expect(lowestSolid(rocket)).toBeGreaterThan(0.018);
      }
    } finally { rocket.dispose(); }
  });
});
