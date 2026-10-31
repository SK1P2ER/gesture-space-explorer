import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MarsBaseOperationsController, DOOR_LIMIT, DISH_LIMIT, SOLAR_LIMIT } from '../src/scene/baseKit/operations';
import { Showcase } from '../src/scene/baseKit/showcase';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { Showcases } from '../src/scene/baseKit/showcases';
import { LandingPad } from '../src/scene/baseKit/landingPad';
import { garageParts } from '../src/scene/baseKit/roverGarageParts';
import { landingBases } from './helpers/landingBase';

const tick = (controller: MarsBaseOperationsController, count = 100, state: 'active' | 'standby' = 'active') => {
  for (let n = 0; n < count; n++) controller.update(0.1, state, false, false, 1, 0.1, 0);
};
const make = (quality: 'high' | 'low' = 'high', operations = true) => new Showcase(JEZERO, {
  quality, operations, textureSize: 16, R: 5.6,
  site: { point: new THREE.Vector3(0, 1, 0), quaternion: new THREE.Quaternion(), scale: 1 / 5.6 },
});

describe('entry-owned Mars operations', () => {
  it('starts with safe neutral poses and supports repeated disposal and ignored late updates', () => {
    const ops = new MarsBaseOperationsController(true, true);
    expect([ops.doorAngle, ops.solarAngle, ops.dishAngle]).toEqual([0, 0, 0]);
    tick(ops); ops.dispose(); ops.dispose(); tick(ops);
    expect([ops.state, ops.doorAngle, ops.solarAngle, ops.dishAngle]).toEqual(['standby', 0, 0, 0]);
  });

  it('opens and closes smoothly, with continuous interruption and exact endpoints', () => {
    const ops = new MarsBaseOperationsController(true, true);
    tick(ops, 5); const open = ops.doorAngle;
    expect(open).toBeGreaterThan(0); expect(open).toBeLessThan(DOOR_LIMIT);
    tick(ops, 1, 'standby'); expect(ops.doorAngle).toBeCloseTo(open - 0.055);
    tick(ops); expect(ops.doorAngle).toBe(DOOR_LIMIT);
    tick(ops, 100, 'standby'); expect(ops.doorAngle).toBe(0);
  });

  it('pauses without catch-up, bounds time steps, and resumes from the current pose', () => {
    const ops = new MarsBaseOperationsController(true, true);
    tick(ops, 5); const pose = [ops.doorAngle, ops.solarAngle, ops.dishAngle];
    ops.update(300, 'active', true, false, 1, 0.1, 0);
    expect([ops.doorAngle, ops.solarAngle, ops.dishAngle]).toEqual(pose);
    ops.update(300, 'active', false, false, 1, 0.1, 0);
    expect(ops.doorAngle).toBeCloseTo(pose[0] + 0.055);
    const angle = ops.doorAngle;
    for (const dt of [NaN, Infinity, -1]) ops.update(dt, 'active', false, false, 1, 0.1, 0);
    expect(ops.doorAngle).toBe(angle);
  });

  it('keeps solar and antenna motion bounded and stows at night', () => {
    const ops = new MarsBaseOperationsController(true, true);
    for (let n = 0; n < 5000; n++) {
      ops.update(0.1, 'active', false, false, n < 2500 ? 1 : -1, 0.001, 0);
      expect(Math.abs(ops.solarAngle)).toBeLessThanOrEqual(SOLAR_LIMIT);
      expect(Math.abs(ops.dishAngle)).toBeLessThanOrEqual(DISH_LIMIT);
    }
    for (let n = 0; n < 300; n++) ops.update(0.1, 'standby', false, false, 0, -1, 1);
    expect(ops.solarAngle).toBe(0); expect(ops.dishAngle).toBe(0);
  });

  it('uses stable reduced-motion poses even if the preference changes while paused', () => {
    const ops = new MarsBaseOperationsController(true, true); tick(ops, 10);
    ops.update(0, 'active', true, true, 1, 0.1, 0);
    expect([ops.doorAngle, ops.solarAngle, ops.dishAngle]).toEqual([DOOR_LIMIT, 0, 0]);
    ops.update(10, 'standby', true, true, 1, 0.1, 0);
    expect(ops.doorAngle).toBe(0);
  });

  it('keeps Low static, and reserves motion for opted-in moving parts', () => {
    const low = new MarsBaseOperationsController(false, false); tick(low);
    expect([low.doorAngle, low.solarAngle, low.dishAngle]).toEqual([0, 0, 0]);
    const ordinary = new MarsBaseOperationsController(false, true); tick(ordinary);
    expect(ordinary.doorAngle).toBe(0); expect(ordinary.dishAngle).toBe(0);
    expect(ordinary.solarAngle).toBeGreaterThan(0);
  });

  it('keeps the original default/Low batches and fits the unchanged experimental High caps', () => {
    for (const [quality, operations, meshes, triangles] of [
      ['low', true, 16, 6646], ['high', false, 18, 16898], ['high', true, 21, 16934],
    ] as const) {
      const view = make(quality, operations);
      try { expect(view.stats()).toEqual({ meshes, triangles }); }
      finally { view.dispose(); }
    }
  });

  it('retains moving geometry/material identity, releases each resource once and ignores late application', () => {
    const borrowed = new THREE.Texture(), borrowedDispose = vi.spyOn(borrowed, 'dispose');
    for (let cycle = 0; cycle < 3; cycle++) {
      const view = make(), ops = new MarsBaseOperationsController(true, true);
      view.setEnvironment(borrowed); view.syncMap(borrowed);
      const resources = new Set<THREE.BufferGeometry | THREE.Material>();
      view.group.traverse(o => {
        if (o instanceof THREE.Mesh) { resources.add(o.geometry); resources.add(o.material as THREE.Material); }
      });
      const released = [...resources].map(resource => vi.spyOn(resource, 'dispose'));
      const door = view.group.getObjectByName('kit:operations:door') as THREE.Mesh;
      const geometry = door.geometry, material = door.material;
      expect(material).toBe((view.group.getObjectByName('kit:hullFlat') as THREE.Mesh).material);
      expect((view.group.getObjectByName('kit:operations:dish') as THREE.Mesh).material)
        .toBe((view.group.getObjectByName('kit:hull') as THREE.Mesh).material);
      expect((view.group.getObjectByName('kit:operations:dish-rim') as THREE.Mesh).material)
        .toBe((view.group.getObjectByName('kit:dark') as THREE.Mesh).material);
      for (let n = 0; n < 50; n++) {
        tick(ops, 1); view.applyOperations(ops);
        expect(door.geometry).toBe(geometry); expect(door.material).toBe(material);
      }
      for (const spy of released) expect(spy).not.toHaveBeenCalled();
      view.dispose(); view.dispose(); ops.dispose();
      expect(() => view.applyOperations(ops)).not.toThrow();
      for (const spy of released) expect(spy).toHaveBeenCalledTimes(1);
      expect(borrowedDispose).not.toHaveBeenCalled();
    }
    borrowed.dispose();
  });

  it('keeps the door sweep inside the bay, below header/roof and away from walls', () => {
    const view = make(), ops = new MarsBaseOperationsController(true, true);
    try {
      const mesh = view.group.getObjectByName('kit:operations:door') as THREE.Mesh;
      const p = mesh.geometry.getAttribute('position');
      const v = new THREE.Vector3();
      for (let n = 0; n <= 100; n++) {
        ops.doorAngle = n / 100 * DOOR_LIMIT; view.applyOperations(ops);
        mesh.parent!.updateMatrix();
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(mesh.parent!.matrix);
          expect(Math.abs(v.x)).toBeLessThan(0.095); // clear of entry columns and side walls
          expect(v.y).toBeGreaterThanOrEqual(-0.0002);
          expect(v.y).toBeLessThan(0.083); // header bottom; roof bottom .098
          expect(v.z).toBeGreaterThan(0.02); // back wall is at -.08
          expect(v.z).toBeLessThanOrEqual(0.1062);
        }
      }
      const shell = garageParts('high', true);
      try {
        // There is no longer an opaque box spanning the opening behind the moving door.
        for (const [slot, g] of shell) if (slot === 'dark') {
          g.computeBoundingBox();
          expect(g.boundingBox!.containsPoint(new THREE.Vector3(0, 0.04, 0.095))).toBe(false);
        }
      } finally { shell.forEach(([, g]) => g.dispose()); }
    } finally { view.dispose(); }
  });

  it('preserves solar anchors and instance buffers at both angle limits', () => {
    const view = make(), ops = new MarsBaseOperationsController(true, true);
    try {
      const panels = view.group.getObjectByName('kit:panels:solar') as THREE.InstancedMesh;
      const supports = view.group.getObjectByName('kit:panels:dark') as THREE.InstancedMesh;
      const support = new THREE.Matrix4(), panel = new THREE.Matrix4();
      const pivot = new THREE.Matrix4().makeTranslation(0, 0.05, 0);
      for (const angle of [-SOLAR_LIMIT, 0, SOLAR_LIMIT]) {
        ops.solarAngle = angle; view.applyOperations(ops);
        for (let i = 0; i < panels.count; i++) {
          supports.getMatrixAt(i, support); panels.getMatrixAt(i, panel);
          const origin = new THREE.Vector3().setFromMatrixPosition(support.clone().multiply(pivot));
          expect(new THREE.Vector3().setFromMatrixPosition(panel).distanceTo(origin)).toBeLessThan(1e-6);
        }
      }
    } finally { view.dispose(); }
  });

  it('keeps tracker corners clear of the ground at the existing .05 pivot height', () => {
    const view = make(), ops = new MarsBaseOperationsController(true, true);
    try {
      const plate = view.group.getObjectByName('kit:panels:solar') as THREE.InstancedMesh;
      const p = plate.geometry.getAttribute('position'), v = new THREE.Vector3();
      for (const angle of [-SOLAR_LIMIT, SOLAR_LIMIT]) {
        ops.solarAngle = angle; view.applyOperations(ops);
        const rotation = new THREE.Matrix4().makeRotationZ(-angle).setPosition(0, 0.05, 0);
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(rotation);
          expect(v.y).toBeGreaterThan(0.016); // .004 patch lift + conservative .012 bump envelope
        }
      }
    } finally { view.dispose(); }
  });

  it('preserves the dish mount and vertical profile, without casting stale moving shadows', () => {
    const view = make(), ops = new MarsBaseOperationsController(true, true);
    try {
      view.setShadows(true);
      const dish = view.group.getObjectByName('kit:operations:dish') as THREE.Mesh;
      const pivot = dish.parent!, mount = pivot.position.clone();
      const p = dish.geometry.getAttribute('position'), point = new THREE.Vector3();
      for (const angle of [-DISH_LIMIT, 0, DISH_LIMIT]) {
        ops.dishAngle = angle; view.applyOperations(ops); pivot.updateMatrix();
        expect(pivot.position.toArray()).toEqual(mount.toArray());
        for (let n = 0; n < p.count; n++) {
          point.fromBufferAttribute(p, n).applyMatrix4(pivot.matrix);
          expect(point.y).toBeCloseTo(p.getY(n) + 0.38, 6);
        }
      }
      for (const name of ['door', 'dish', 'dish-rim']) {
        const part = view.group.getObjectByName(`kit:operations:${name}`) as THREE.Mesh;
        expect(part.castShadow).toBe(false); expect(part.receiveShadow).toBe(true);
      }
      expect((view.group.getObjectByName('kit:hull') as THREE.Mesh).castShadow).toBe(true);
    } finally { view.dispose(); }
  });

  it('changes steady status with no allocations, drift or change to landing datum/geometry', () => {
    const view = make(), pad = new LandingPad('high'), ops = new MarsBaseOperationsController(true, true);
    try {
      const datum = pad.anchors.get('DOCK-ANCHOR')!.position.toArray();
      const guidance = pad.group.getObjectByName('landing:guidance') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      const geometry = guidance.geometry;
      for (const state of ['standby', 'active', 'landing', 'maintenance'] as const) {
        ops.update(0.1, state, false, false, 0, 1, 0);
        view.applyOperations(ops); pad.setOperationalState(ops.state);
        pad.setDaylight(0, true); const color = guidance.material.color.getHex();
        pad.setDaylight(0, true); expect(guidance.material.color.getHex()).toBe(color);
        expect(guidance.geometry).toBe(geometry);
        expect(pad.anchors.get('DOCK-ANCHOR')!.position.toArray()).toEqual(datum);
        view.update(2, null, false); const beacon = (view.group.getObjectByName('kit:tip') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.getHex();
        view.update(3, null, false);
        expect((view.group.getObjectByName('kit:tip') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.getHex()).toBe(beacon);
      }
    } finally { view.dispose(); pad.dispose(); }
  });

  it('retires controllers on quality, horizon and base exit without stale owners or callbacks', () => {
    const fixture = landingBases(), manager = new Showcases(fixture.bases);
    manager.operationsEnabled = true; manager.textureSize = 16; manager.operationsAt = () => 'active';
    fixture.jezero.group.visible = true;
    const renderer = {} as THREE.WebGLRenderer;
    const frame = (quality: 'high' | 'low', seconds: number, want = true, horizon: string | null = null) =>
      manager.update(id => want && id === 'jezero', quality, seconds, new THREE.PerspectiveCamera(), false,
        horizon, () => null, new THREE.Vector3(), renderer);
    try {
      expect(manager.hasEntries).toBe(false);
      frame('high', 0); const first = manager.operationsFor('jezero')!;
      expect(manager.hasEntries).toBe(true);
      frame('high', 0.1); expect(first.doorAngle).toBeGreaterThan(0);
      fixture.jezero.group.visible = false;
      frame('high', 0.2);
      expect(manager.drawing).toBe(false);
      expect(manager.hasEntries).toBe(true);
      fixture.jezero.group.visible = true;
      manager.operationsPaused = true; const angle = first.doorAngle;
      frame('high', 20); expect(first.doorAngle).toBe(angle);
      manager.operationsPaused = false;
      frame('low', 21); expect(first.doorAngle).toBe(0);
      const low = manager.operationsFor('jezero')!; expect(low).not.toBe(first);
      frame('high', 22); const high = manager.operationsFor('jezero')!;
      frame('high', 23, true, 'jezero'); expect(manager.operationsFor('jezero')).not.toBe(high);
      expect(high.state).toBe('standby');
      frame('high', 24, false); expect(manager.operationsFor('jezero')).toBeNull();
      expect(manager.hasEntries).toBe(false);
      for (const old of [first, low, high]) { tick(old); expect(old.doorAngle).toBe(0); }
      frame('high', 25); expect(manager.operationsFor('jezero')!.doorAngle).toBe(0);
      frame('high', 26, false);
    } finally { frame('high', 27, false); fixture.dispose(); }
  });
});
