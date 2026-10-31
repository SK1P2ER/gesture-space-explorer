import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { along, footprint, onSphere, PANEL, pathLength, ROVER, type BaseLayout } from '../src/data/baseLayout';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { Showcase } from '../src/scene/baseKit/showcase';
import { parsePlaced } from '../src/sim/buildRules';

const R = 5.6;
const site = { point: new THREE.Vector3(0, 1, 0), quaternion: new THREE.Quaternion(), scale: 1 / R };
const make = (layout = JEZERO) => new Showcase(layout, { quality: 'low', R, site });
const mesh = (view: Showcase, name: string) => view.group.getObjectByName(name) as THREE.Mesh;
const isolated = (id: string): BaseLayout => ({ modules: [JEZERO.modules.find((m) => m.id === id)!], tunnels: [], walks: [], roverLoops: [], terrainRadius: 2.4, frame: 1.4 });

describe('utility infrastructure parity, captured before extraction', () => {
  it('retains garage, array and antenna coordinates and original exclusion footprints', () => {
    for (const [id, x, z] of [['garage', 0.75, -0.6], ['solar', 0.925, 0.7], ['antenna', -1.2, -0.65]] as const) {
      const m = JEZERO.modules.find((m) => m.id === id)!;
      expect([m.x, m.z, m.rot ?? 0]).toEqual([x, z, 0]);
      const points = footprint(m);
      const span = [Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1]))];
      const expected = id === 'garage' ? [0.26, 0.2] : id === 'solar' ? [0.44, 0.5] : [0.18, 0.18];
      span.forEach((value, n) => expect(value).toBeCloseTo(expected[n], 8));
    }
  });

  it('preserves the garage facade width, height and forward door plane (a closed facade, not a drive-through)', () => {
    const view = make(isolated('garage'));
    try {
      const m = JEZERO.modules.find((m) => m.id === 'garage')!;
      const { y, up } = onSphere(m.x, m.z, R);
      const inverse = new THREE.Matrix4().compose(new THREE.Vector3(m.x, y, m.z), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...up)), new THREE.Vector3(1, 1, 1)).invert();
      const geometry = mesh(view, 'kit:hullFlat').geometry.clone().applyMatrix4(inverse);
      try {
        const p = geometry.getAttribute('position');
        // The original central door remains inside this facade envelope after detail is added.
        const forward = [];
        for (let n = 0; n < p.count; n++) if (p.getZ(n) >= 0.1059) forward.push(new THREE.Vector3().fromBufferAttribute(p, n));
        const door = new THREE.Box3().setFromPoints(forward);
        expect(door.min.x).toBeCloseTo(-0.09, 5); expect(door.max.x).toBeCloseTo(0.09, 5);
        expect(door.min.y).toBeCloseTo(0, 5); expect(door.max.y).toBeCloseTo(0.075, 5);
        expect(door.max.z).toBeCloseTo(0.106, 5);
      } finally { geometry.dispose(); }
    } finally { view.dispose(); }
  });

  it('retains twelve panel anchor sites and dimensions', () => {
    const view = make();
    try {
      const panels = mesh(view, 'kit:panels:solar') as THREE.InstancedMesh;
      const posts = mesh(view, 'kit:panels:dark') as THREE.InstancedMesh;
      expect(panels.count).toBe(12); expect(posts.count).toBe(12);
      const matrix = new THREE.Matrix4();
      for (let c = 0; c < 3; c++) for (let r = 0; r < 4; r++) {
        posts.getMatrixAt(c * 4 + r, matrix);
        const p = new THREE.Vector3().setFromMatrixPosition(matrix);
        expect(p.x).toBeCloseTo(0.765 + c * 0.16, 6);
        expect(p.z).toBeCloseTo(0.49 + r * 0.14, 6);
        expect(p.y).toBeCloseTo(onSphere(p.x, p.z, R).y, 6);
      }
      panels.geometry.computeBoundingBox();
      const size = panels.geometry.boundingBox!.getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(PANEL.w, 7); expect(size.z).toBeCloseTo(PANEL.d, 7);
    } finally { view.dispose(); }
  });

  it('preserves two rover envelopes and existing path sampling', () => {
    const view = make();
    try {
      const body = mesh(view, 'kit:rovers:hullFlat') as THREE.InstancedMesh;
      const wheels = mesh(view, 'kit:rovers:dark') as THREE.InstancedMesh;
      expect(body.count).toBe(2); expect(wheels.count).toBe(2);
      const bounds = new THREE.Box3();
      for (const part of [body, wheels]) { part.geometry.computeBoundingBox(); bounds.union(part.geometry.boundingBox!); }
      expect(bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(ROVER.length, 7);
      expect(bounds.getSize(new THREE.Vector3()).z).toBeCloseTo(ROVER.width, 7);
      expect(bounds.min.y).toBeCloseTo(0, 7); expect(bounds.max.y).toBeCloseTo(0.067, 7);
      for (const seconds of [0, 5, 27]) {
        view.update(seconds, null, true);
        JEZERO.roverLoops.forEach((points, n) => {
          const length = pathLength(points, true);
          const expected = along(points, true, (seconds * (0.05 + 0.015 * n) + n * length * 0.37) % length).p;
          const matrix = new THREE.Matrix4(); body.getMatrixAt(n, matrix);
          const actual = new THREE.Vector3().setFromMatrixPosition(matrix);
          expect(actual.x).toBeCloseTo(expected[0], 6); expect(actual.z).toBeCloseTo(expected[1], 6);
        });
      }
    } finally { view.dispose(); }
  });

  it('keeps the antenna tip above its original mast, with its original local orientation', () => {
    const view = make();
    try {
      const tip = mesh(view, 'kit:tip');
      const m = JEZERO.modules.find((m) => m.id === 'antenna')!;
      const { y, up } = onSphere(m.x, m.z, R);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...up));
      const expected = new THREE.Vector3(0, 0.41, 0).applyQuaternion(q).add(new THREE.Vector3(m.x, y, m.z));
      tip.geometry.computeBoundingSphere();
      expect(tip.geometry.boundingSphere!.center.clone().applyMatrix4(tip.matrix).distanceTo(expected)).toBeLessThan(1e-7);
      expect(tip.quaternion.angleTo(q)).toBeLessThan(1e-7);
    } finally { view.dispose(); }
  });

  it('shares existing materials inside a view and releases owned outputs without freeing borrowed maps', () => {
    const view = make();
    const map = new THREE.Texture(); const released = vi.spyOn(map, 'dispose');
    try {
      view.syncMap(map); view.setEnvironment(map);
      expect(mesh(view, 'kit:rovers:dark').material).toBe(mesh(view, 'kit:panels:dark').material);
      expect(mesh(view, 'kit:rovers:hullFlat').material).toBe(mesh(view, 'kit:hullFlat').material);
      const geometries = ['kit:panels:solar', 'kit:panels:dark', 'kit:rovers:hullFlat', 'kit:rovers:dark'].map((name) => vi.spyOn(mesh(view, name).geometry, 'dispose'));
      view.dispose(); view.dispose();
      for (const spy of geometries) expect(spy).toHaveBeenCalledTimes(1);
      expect(released).not.toHaveBeenCalled();
    } finally { view.dispose(); map.dispose(); }
  });

  it('still accepts existing saved placements beside utility structures', () => {
    const saved = [{ kind: 'habitat', i: 0, j: -5, rot: 0 }, { kind: 'solar', i: 0, j: 5, rot: 1 }];
    expect(parsePlaced(JSON.stringify(saved), JEZERO)).toEqual(saved);
  });
});
