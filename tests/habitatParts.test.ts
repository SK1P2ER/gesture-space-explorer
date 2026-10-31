import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { onSphere, TUNNEL_RADIUS } from '../src/data/baseLayout';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { corridorParts, HABITAT_IDENTITIES, habitatParts } from '../src/scene/baseKit/habitatParts';
import * as habitatFactory from '../src/scene/baseKit/habitatParts';
import { Showcase } from '../src/scene/baseKit/showcase';

const site = { point: new THREE.Vector3(0, 1, 0), quaternion: new THREE.Quaternion(), scale: 1 / 5.6 };
const disposeParts = (parts: ReturnType<typeof habitatParts>) => parts.forEach(([, geometry]) => geometry.dispose());
const triangles = (parts: ReturnType<typeof habitatParts>) => parts.reduce((n, [, geometry]) => n + (geometry.index?.count ?? geometry.getAttribute('position').count) / 3, 0);

describe('modular habitat details', () => {
  it('keeps identifiers dark against an off-white roof rather than hiding white lettering in the dome', () => {
    const parts = habitatParts({ quality: 'high', identifier: 'CMD-01', ports: [] });
    try {
      expect(parts.find(([, geometry]) => geometry.userData.feature === 'identifier')![0]).toBe('dark');
    } finally { disposeParts(parts); }
  });

  it('consumes every factory-owned source geometry once during batching', () => {
    const original = habitatFactory.habitatParts;
    const released: ReturnType<typeof vi.spyOn>[] = [];
    const factory = vi.spyOn(habitatFactory, 'habitatParts').mockImplementation((options) => {
      const parts = original(options);
      for (const [, geometry] of parts) released.push(vi.spyOn(geometry, 'dispose'));
      return parts;
    });
    let view: Showcase | undefined;
    try {
      view = new Showcase(JEZERO, { quality: 'high', textureSize: 16, R: 5.6, site });
      expect(factory).toHaveBeenCalledTimes(3);
      expect(released.length).toBeGreaterThan(0);
      for (const disposed of released) expect(disposed).toHaveBeenCalledTimes(1);
      view.dispose();
      for (const disposed of released) expect(disposed).toHaveBeenCalledTimes(1);
    } finally { view?.dispose(); factory.mockRestore(); }
  });

  it.each(['low', 'high'] as const)('%s detail stays inside the existing outer band and height envelope', (quality) => {
    const parts = habitatParts({ quality, identifier: 'HAB-01', ports: [0, Math.PI / 2] });
    try {
      expect(new Set(parts.map(([, geometry]) => geometry)).size).toBe(parts.length);
      for (const [, geometry] of parts) {
        const vertices = geometry.getAttribute('position');
        for (let n = 0; n < vertices.count; n++) {
          expect(Math.hypot(vertices.getX(n), vertices.getZ(n))).toBeLessThanOrEqual(0.163 + 1e-6);
          expect(vertices.getY(n)).toBeGreaterThanOrEqual(-1e-6);
          expect(vertices.getY(n)).toBeLessThanOrEqual(0.13 + 1e-6);
        }
        expect(geometry.getAttribute('normal').count).toBe(vertices.count);
      }
      const label = parts.find(([, geometry]) => geometry.userData.feature === 'identifier')![1];
      expect(label.userData.text).toBe('HAB-01');
      expect(parts.some(([, geometry]) => geometry.userData.feature === 'port')).toBe(true);
    } finally { disposeParts(parts); }
  });

  it('uses richer High detail while Low retains cheaper geometry and existing material batches', () => {
    const low = habitatParts({ quality: 'low', identifier: 'HAB-01', ports: [0] });
    const high = habitatParts({ quality: 'high', identifier: 'HAB-01', ports: [0] });
    try {
      expect(triangles(high)).toBeGreaterThan(triangles(low));
      expect(low.some(([slot]) => slot === 'safety')).toBe(false);
      expect(high.some(([slot]) => slot === 'safety')).toBe(true);
      expect(high.every(([, geometry]) => !low.some(([, other]) => other === geometry))).toBe(true);
    } finally { disposeParts(low); disposeParts(high); }
  });

  it.each(['low', 'high'] as const)('%s corridor collars retain tube clearance and endpoints', (quality) => {
    const length = 0.5;
    const parts = corridorParts(length, quality);
    try {
      for (const [, geometry] of parts) {
        const p = geometry.getAttribute('position');
        for (let n = 0; n < p.count; n++) {
          expect(Math.abs(p.getX(n))).toBeLessThanOrEqual(length / 2 + 1e-6);
          expect(Math.hypot(p.getY(n) - TUNNEL_RADIUS, p.getZ(n))).toBeLessThanOrEqual(TUNNEL_RADIUS + 1e-6);
        }
      }
      expect(parts.some(([, geometry]) => geometry.userData.feature === 'collar')).toBe(true);
    } finally { disposeParts(parts); }
  });

  it('exposes stable semantic IDs, roles and module-local inspection bounds without serializing new layout fields', () => {
    const view = new Showcase(JEZERO, { quality: 'low', R: 5.6, site });
    try {
      expect([...view.habitatAnchors.keys()]).toEqual(['habA', 'habB', 'habC']);
      for (const m of JEZERO.modules.filter((m) => m.kind === 'habitat')) {
        const anchor = view.habitatAnchors.get(m.id)!;
        expect(anchor.layoutId).toBe(m.id);
        expect(anchor.identifier).toBe(HABITAT_IDENTITIES[m.id].identifier);
        expect(anchor.role).toBe(HABITAT_IDENTITIES[m.id].role);
        const point = new THREE.Vector3().setFromMatrixPosition(anchor.matrix);
        expect(point.x).toBeCloseTo(m.x, 8);
        expect(point.z).toBeCloseTo(m.z, 8);
        expect(point.y).toBeCloseTo(onSphere(m.x, m.z, 5.6).y, 8);
        expect(anchor.bounds.max.y).toBe(0.13);
        expect('identifier' in m).toBe(false);
      }
      const before = [...view.habitatAnchors.values()];
      view.update(5, null, true);
      expect([...view.habitatAnchors.values()]).toEqual(before);
    } finally { view.dispose(); }
  });

  it('repeated construction tears down owned geometry, materials and maps once without disposing borrowed maps', () => {
    const borrowed = new THREE.Texture();
    const borrowedDisposed = vi.spyOn(borrowed, 'dispose');
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        const view = new Showcase(JEZERO, { quality: cycle % 2 ? 'low' : 'high', textureSize: 16, R: cycle === 2 ? 1e6 : 5.6, site });
        view.syncMap(borrowed); view.setEnvironment(borrowed);
        const owned = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
        view.group.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          owned.add(o.geometry);
          const material = o.material as THREE.MeshStandardMaterial;
          owned.add(material);
          for (const map of [material.map, material.normalMap]) if (map && map !== borrowed) owned.add(map);
        });
        const released = [...owned].map((resource) => vi.spyOn(resource, 'dispose'));
        view.dispose();
        expect(() => view.dispose()).not.toThrow();
        for (const spy of released) expect(spy).toHaveBeenCalledTimes(1);
        expect(borrowedDisposed).not.toHaveBeenCalled();
      }
    } finally { borrowed.dispose(); }
  });
});
