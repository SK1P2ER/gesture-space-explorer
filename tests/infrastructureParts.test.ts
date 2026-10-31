import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { Showcase, TRACKER_LIMIT } from '../src/scene/baseKit/showcase';
import { garageParts, roverParts } from '../src/scene/baseKit/roverGarageParts';
import { communicationsParts } from '../src/scene/baseKit/communicationsParts';
import { solarArrayParts, solarPanelGeometry, solarSupportGeometry } from '../src/scene/baseKit/solarArrayParts';
import { mergeOwned, type UtilityPart } from '../src/scene/baseKit/utilityGeometry';
import * as garageFactory from '../src/scene/baseKit/roverGarageParts';
import * as commFactory from '../src/scene/baseKit/communicationsParts';
import * as solarFactory from '../src/scene/baseKit/solarArrayParts';

const site = { point: new THREE.Vector3(0, 1, 0), quaternion: new THREE.Quaternion(), scale: 1 / 5.6 };
const release = (parts: UtilityPart[]) => parts.forEach(([, g]) => g.dispose());
const bounds = (parts: UtilityPart[]) => {
  const result = new THREE.Box3();
  for (const [, g] of parts) { g.computeBoundingBox(); result.union(g.boundingBox!); }
  return result;
};
const count = (parts: UtilityPart[]) => parts.reduce((sum, [, g]) => sum + (g.index?.count ?? g.getAttribute('position').count) / 3, 0);

describe('Mars utility factories and ownership', () => {
  it.each(['low', 'high'] as const)('%s garage preserves its envelope and original door clearance', (quality) => {
    const parts = garageParts(quality);
    try {
      const box = bounds(parts);
      expect(box.min.x).toBeGreaterThanOrEqual(-0.130001); expect(box.max.x).toBeLessThanOrEqual(0.130001);
      expect(box.min.z).toBeGreaterThanOrEqual(-0.100001); expect(box.max.z).toBeLessThanOrEqual(0.106001);
      expect(box.max.y).toBeLessThanOrEqual(0.112001);
      expect(parts.some(([, g]) => g.userData.identifier === 'ROV-01')).toBe(true);
    } finally { release(parts); }
  });

  it.each(['low', 'high'] as const)('%s rover still fits its .08 by .064 swept-path envelope', (quality) => {
    const parts = roverParts(quality);
    try {
      const box = bounds(parts);
      expect(box.getSize(new THREE.Vector3()).x).toBeCloseTo(0.08, 6);
      expect(box.getSize(new THREE.Vector3()).z).toBeCloseTo(0.064, 6);
      expect(box.min.y).toBeCloseTo(0, 6); expect(box.max.y).toBeCloseTo(0.067, 6);
      expect(parts.map(([slot]) => slot)).toEqual(['hullFlat', 'dark']);
      // The added rear antenna must start on the .037 chassis, not float above it.
      const p = parts[0][1].getAttribute('position');
      let antennaBase = Infinity;
      for (let n = 0; n < p.count; n++) if (p.getX(n) >= -0.028001 && p.getX(n) <= -0.025999 && p.getY(n) > 0.03) antennaBase = Math.min(antennaBase, p.getY(n));
      expect(antennaBase).toBeCloseTo(0.037, 6);
    } finally { release(parts); }
  });

  it.each(['low', 'high'] as const)('%s solar geometry fits the old plate and power housing stays in the row gap', (quality) => {
    const panel = solarPanelGeometry(quality), post = solarSupportGeometry(quality);
    const field = JEZERO.modules.find((m) => m.id === 'solar')!;
    const power = solarArrayParts(field, quality);
    try {
      panel.computeBoundingBox();
      expect(panel.boundingBox!.getSize(new THREE.Vector3()).toArray()).toEqual(expect.arrayContaining([expect.closeTo(0.12, 6), expect.closeTo(0.006, 6), expect.closeTo(0.08, 6)]));
      const positions = panel.getAttribute('position');
      expect(panel.getAttribute('color').count).toBe(positions.count);
      const box = bounds(power);
      expect(box.min.x).toBeGreaterThanOrEqual(-0.22); expect(box.max.x).toBeLessThanOrEqual(0.22);
      expect(box.min.z).toBeGreaterThan(-0.17); expect(box.max.z).toBeLessThan(-0.11);
      expect(power.some(([, g]) => g.userData.identifier === 'PWR-01')).toBe(true);
    } finally { panel.dispose(); post.dispose(); release(power); }
  });

  it.each(['low', 'high'] as const)('%s communications keeps the dish orientation and mast height', (quality) => {
    const parts = communicationsParts(quality);
    try {
      // The old tilted dish rises above the .41 beacon: keep its analytic rim envelope.
      expect(bounds(parts).max.y).toBeLessThanOrEqual(0.38 + 0.025 * Math.cos(0.7) + 0.08 * Math.sin(0.7) + 1e-6);
      for (const [, g] of parts) {
        const p = g.getAttribute('position');
        for (let n = 0; n < p.count; n++) if (p.getY(n) < 0.12) expect(Math.hypot(p.getX(n), p.getZ(n))).toBeLessThanOrEqual(0.090001);
      }
      const dish = parts.find(([, g]) => g.userData.feature === 'dish')![1];
      expect(dish.userData.tilt).toBe(-0.7);
      expect(dish.userData.center).toEqual([0, 0.38, 0.02]);
      const local = dish.clone().translate(0, -0.38, -0.02).rotateX(0.7);
      try {
        const p = local.getAttribute('position');
        for (let n = 0; n < p.count; n++) {
          expect(p.getY(n)).toBeGreaterThanOrEqual(-1e-6);
          expect(p.getY(n)).toBeLessThanOrEqual(0.025001);
          expect(Math.hypot(p.getX(n), p.getZ(n))).toBeLessThanOrEqual(0.080001);
        }
      } finally { local.dispose(); }
      expect(parts.some(([, g]) => g.userData.identifier === 'COM-01')).toBe(true);
    } finally { release(parts); }
  });

  it('uses richer High topology, existing material categories and independent owned sources', () => {
    for (const factory of [garageParts, communicationsParts, roverParts]) {
      const low = factory('low'), high = factory('high');
      try {
        expect(count(high)).toBeGreaterThan(count(low));
        expect(high.every(([, g]) => low.every(([, other]) => g !== other))).toBe(true);
        expect(low.every(([slot]) => ['hull', 'hullFlat', 'dark', 'window', 'red'].includes(slot))).toBe(true);
      } finally { release(low); release(high); }
    }
  });

  it('consumes indexed inputs and converted temporary buffers once when merging', () => {
    const source = new THREE.BoxGeometry(1, 1, 1);
    const converted = source.toNonIndexed();
    const inputReleased = vi.spyOn(source, 'dispose'), tempReleased = vi.spyOn(converted, 'dispose');
    const convert = vi.spyOn(source, 'toNonIndexed').mockReturnValue(converted);
    const result = mergeOwned([source]);
    try {
      expect(inputReleased).toHaveBeenCalledTimes(1); expect(tempReleased).toHaveBeenCalledTimes(1);
      expect(result).not.toBe(converted);
    } finally { convert.mockRestore(); result.dispose(); }
  });

  it('consumes static parts immediately, keeps instanced geometry live and disposes all owners once on repeated teardown', () => {
    const staticSources: ReturnType<typeof vi.spyOn>[] = [], instanceSources: ReturnType<typeof vi.spyOn>[] = [];
    const watch = (parts: UtilityPart[]) => {
      for (const [, g] of parts) staticSources.push(vi.spyOn(g, 'dispose'));
      return parts;
    };
    const originalGarage = garageFactory.garageParts, originalComm = commFactory.communicationsParts, originalPower = solarFactory.solarArrayParts;
    const staticSpies = [
      vi.spyOn(garageFactory, 'garageParts').mockImplementation((q) => watch(originalGarage(q))),
      vi.spyOn(commFactory, 'communicationsParts').mockImplementation((q) => watch(originalComm(q))),
      vi.spyOn(solarFactory, 'solarArrayParts').mockImplementation((m, q) => watch(originalPower(m, q))),
    ];
    const originalRover = garageFactory.roverParts;
    const roverSpy = vi.spyOn(garageFactory, 'roverParts').mockImplementation((quality) => {
      const parts = originalRover(quality);
      for (const [, g] of parts) instanceSources.push(vi.spyOn(g, 'dispose'));
      return parts;
    });
    const borrowed = new THREE.Texture(), borrowedReleased = vi.spyOn(borrowed, 'dispose');
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        const view = new Showcase(JEZERO, { quality: cycle % 2 ? 'low' : 'high', textureSize: 16, R: 5.6, site });
        view.syncMap(borrowed); view.setEnvironment(borrowed);
        for (const spy of staticSources) expect(spy).toHaveBeenCalledTimes(1);
        const liveInstances = instanceSources.slice(-2);
        for (const spy of liveInstances) expect(spy).not.toHaveBeenCalled();
        view.dispose(); view.dispose();
        for (const spy of [...staticSources, ...instanceSources]) expect(spy).toHaveBeenCalledTimes(1);
        expect(view.infrastructureAnchors.size).toBe(0);
        expect(borrowedReleased).not.toHaveBeenCalled();
      }
    } finally { roverSpy.mockRestore(); staticSpies.forEach((spy) => spy.mockRestore()); borrowed.dispose(); }
  });

  it('preserves semantic transforms, instance identities and the existing daylight tracker without allocating new geometry', () => {
    const view = new Showcase(JEZERO, { quality: 'high', textureSize: 16, R: 5.6, site });
    try {
      expect([...view.infrastructureAnchors.keys()]).toEqual(['PWR-01', 'ROV-01', 'COM-01']);
      for (const anchor of view.infrastructureAnchors.values()) {
        const m = JEZERO.modules.find((m) => m.id === anchor.layoutId)!;
        const p = new THREE.Vector3().setFromMatrixPosition(anchor.matrix);
        expect(p.x).toBeCloseTo(m.x, 8); expect(p.z).toBeCloseTo(m.z, 8);
      }
      const panel = view.group.getObjectByName('kit:panels:solar') as THREE.InstancedMesh;
      const geometry = panel.geometry, material = panel.material;
      for (const sun of [new THREE.Vector3(1, 1, 0), new THREE.Vector3(-1, 0.1, 0)]) {
        view.setDaylight(0, sun, 1); view.update(7, null, true);
        expect(Math.abs(view.tilt)).toBeLessThanOrEqual(TRACKER_LIMIT);
        expect(panel.geometry).toBe(geometry); expect(panel.material).toBe(material);
        expect(panel.count).toBe(12);
      }
      view.setDaylight(1, new THREE.Vector3(0, -1, 0), 1);
      expect(view.tilt).toBe(0);
    } finally { view.dispose(); }
  });
});
