import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { onSphere } from '../src/data/baseLayout';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { Showcase, type KitQuality } from '../src/scene/baseKit/showcase';

const R = 1.574 / 0.28; // Mars' radius in base units
const site = { point: new THREE.Vector3(0.3, 0.32, 0.9).normalize(), quaternion: new THREE.Quaternion(), scale: 1 / R };
const build = (quality: KitQuality) => new Showcase(JEZERO, { quality, R, site });

describe('the Jezero showcase', () => {
  it('stays within the draw-call and triangle budget (High ≤ 22 / 18k, Low ≤ 16 / 7k)', () => {
    const high = build('high').stats();
    const low = build('low').stats();
    expect(high.meshes).toBeLessThanOrEqual(22);
    expect(high.triangles).toBeLessThanOrEqual(18_000);
    expect(low.meshes).toBeLessThanOrEqual(16);
    expect(low.triangles).toBeLessThanOrEqual(7_000);
  });

  it('every building stands on the curved ground, not floating above it', () => {
    const s = build('low');
    const box = new THREE.Box3();
    for (const name of ['kit:hull', 'kit:dark']) {
      const mesh = s.group.getObjectByName(name) as THREE.Mesh;
      box.setFromObject(mesh);
      // The far modules sit well below the pad's plane, as the ground curves away.
      expect(box.min.y).toBeLessThan(onSphere(1.1, 0, R).y + 0.01);
    }
  });

  it('rovers move along their loops; astronauts walk; the dust devil keeps away with reduced motion', () => {
    const s = build('high');
    const rovers = s.group.getObjectByName('kit:rovers:hullFlat') as THREE.InstancedMesh;
    const a = new THREE.Matrix4();
    const b = new THREE.Matrix4();
    rovers.getMatrixAt(0, a);
    s.update(5, new THREE.PerspectiveCamera(), false);
    rovers.getMatrixAt(0, b);
    expect(new THREE.Vector3().setFromMatrixPosition(a).distanceTo(new THREE.Vector3().setFromMatrixPosition(b))).toBeGreaterThan(0.1);
    const dust = s.group.getObjectByName('kit:dust')!;
    s.update(1, new THREE.PerspectiveCamera(), false);
    expect(dust.visible).toBe(true);
    s.update(1, new THREE.PerspectiveCamera(), true);
    expect(dust.visible).toBe(false);
    expect(build('low').group.getObjectByName('kit:dust')).toBeUndefined();
  });

  it('the ground uses the planet’s own texture coordinates and fades out at its rim', () => {
    const s = build('low');
    const g = s.terrain.geometry;
    const uv = g.getAttribute('uv');
    const color = g.getAttribute('color');
    // The center: the base's own spot on the map.
    const p = site.point;
    expect(uv.getX(0)).toBeCloseTo((((Math.atan2(p.z, -p.x) / (Math.PI * 2)) % 1) + 1) % 1, 6);
    expect(uv.getY(0)).toBeCloseTo(0.5 + Math.asin(p.y) / Math.PI, 6);
    expect(color.getW(0)).toBe(1);
    expect(color.getW(color.count - 1)).toBe(0); // rim: invisible, so no edge
    expect(s.terrain.visible).toBe(false); // until the planet's texture is in
    s.syncMap(new THREE.Texture());
    expect(s.terrain.visible).toBe(true);
  });

  it('frees every geometry and material it made, but not the planet’s texture', () => {
    const s = build('high');
    const planetMap = new THREE.Texture();
    const mapDispose = vi.spyOn(planetMap, 'dispose');
    s.syncMap(planetMap);
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    s.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        geos.add(o.geometry);
        mats.add(o.material as THREE.Material);
      }
    });
    const spies = [...geos].map((g) => vi.spyOn(g, 'dispose'));
    const matSpies = [...mats].map((m) => vi.spyOn(m, 'dispose'));
    const parent = new THREE.Group().add(s.group);
    s.dispose();
    for (const spy of [...spies, ...matSpies]) expect(spy).toHaveBeenCalled();
    expect(mapDispose).not.toHaveBeenCalled();
    expect(parent.children).toHaveLength(0);
  });
});
