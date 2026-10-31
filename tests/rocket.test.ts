import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { legDeploy, LEGS_AT } from '../src/app/mission';
import { engineLayout, legPose, paintHull, Rocket, ROCKET } from '../src/scene/rocketKit';

describe('the v2.2 rocket', () => {
  it('4–9 engine bells: a ring, with one in the middle from 5 up; none overlap', () => {
    for (let n = 4; n <= 9; n++) {
      const bells = engineLayout(n);
      expect(bells, `${n}`).toHaveLength(n);
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) expect(Math.hypot(bells[i][0] - bells[j][0], bells[i][1] - bells[j][1]), `${n}: ${i},${j}`).toBeGreaterThanOrEqual(ROCKET.bell.rim * 1.5);
    }
    expect(engineLayout(5)[0]).toEqual([0, 0]);
    expect(engineLayout(2)).toHaveLength(4); // clamped
    expect(engineLayout(20)).toHaveLength(9);
  });

  it('landing legs: folded up along the hull, deployed with the feet level with the engine rims, beyond the bells', () => {
    const folded = legPose(0);
    expect(folded.angle).toBeLessThan(0.1);
    expect(folded.foot[1]).toBeGreaterThan(ROCKET.leg.hingeY + ROCKET.leg.length * 0.99);
    const out = legPose(1);
    expect(out.foot[1]).toBeCloseTo(ROCKET.leg.foot, 9); // the foot pad's center: its edge rests on the pad
    expect(out.foot[0]).toBeGreaterThan(ROCKET.engineRing + ROCKET.bell.rim + 0.05);
    expect(legPose(0.5).angle).toBeGreaterThan(folded.angle);
    expect(legPose(0.5).angle).toBeLessThan(out.angle);
  });

  it('legs open during a landing only from 40% of the descent, over a second', () => {
    expect(legDeploy(LEGS_AT - 0.01, 5)).toBe(0);
    expect(legDeploy(LEGS_AT, 0)).toBe(0);
    expect(legDeploy(0.6, 0.5)).toBeCloseTo(0.5, 9);
    expect(legDeploy(0.9, 2)).toBe(1);
  });

  it('stays within budget: 5 draw calls with the flame; ≤ 6k triangles on High, ≤ 2.5k on Low', () => {
    const high = new Rocket({ engines: 5, textureSize: 64, quality: 'high' }).stats();
    const low = new Rocket({ engines: 5, textureSize: 64, quality: 'low' }).stats();
    expect(high.meshes).toBeLessThanOrEqual(6);
    expect(high.triangles).toBeLessThanOrEqual(6000);
    expect(low.triangles).toBeLessThanOrEqual(2500);
    expect(new Rocket({ engines: 9, textureSize: 64, quality: 'high' }).stats().triangles).toBeLessThanOrEqual(6000);
  });

  it('two stages that can part (step 3), about one unit tall like the v2.0 rocket', () => {
    const r = new Rocket({ textureSize: 64, quality: 'high' });
    expect(r.booster.getObjectByName('rocket:booster')).toBeDefined();
    expect(r.upper.getObjectByName('rocket:upper')).toBeDefined();
    expect(r.booster.getObjectByName('flame')).toBeDefined();
    r.booster.remove(r.booster.getObjectByName('flame')!); // the flame hangs below; measure the rocket
    const box = new THREE.Box3().setFromObject(r.group);
    expect(box.max.y).toBeCloseTo(ROCKET.height, 2);
    expect(box.min.y).toBeGreaterThan(-0.01); // legs out: nothing below the pad
  });

  it('paint: generated at the asked size, seams and rivets in the normal map, windows in the glow mask; the same every time', () => {
    const a = paintHull(128);
    expect(a.color.length).toBe(128 * 128 * 4);
    expect(a.normal.length).toBe(128 * 128 * 4);
    const tilted = Array.from({ length: 128 * 128 }, (_, i) => a.normal[i * 4]).filter((x) => Math.abs(x - 128) > 10).length;
    expect(tilted).toBeGreaterThan(500); // seams and rivets catch the light
    const windows = Array.from({ length: 128 * 128 }, (_, i) => a.glow[i * 4]).filter((x) => x > 150).length;
    expect(windows).toBeGreaterThan(0); // lit cabin windows
    expect(Math.min(...Array.from({ length: 128 * 128 }, (_, i) => a.glow[i * 4 + 2]))).toBeGreaterThan(40); // and a faint lift everywhere
    expect(paintHull(128).color).toEqual(a.color);
    // Soot at the base: darker than mid-booster.
    const lum = (row: number) => a.color[(row * 128 + 64) * 4];
    expect(lum(1)).toBeLessThan(lum(50) - 60);
  });

  it('High has a normal map, Low doesn’t; everything it made is freed', () => {
    const high = new Rocket({ textureSize: 64, quality: 'high' });
    const hull = high.booster.getObjectByName('rocket:booster') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(hull.material.normalMap).not.toBeNull();
    const low = new Rocket({ textureSize: 64, quality: 'low' });
    expect((low.booster.getObjectByName('rocket:booster') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.normalMap).toBeNull();
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    high.group.traverse((o) => {
      if (o instanceof THREE.Mesh) spies.push(vi.spyOn(o.geometry, 'dispose'), vi.spyOn(o.material as THREE.Material, 'dispose'));
    });
    const mapDispose = vi.spyOn(hull.material.map!, 'dispose');
    new THREE.Group().add(high.group);
    high.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
    expect(mapDispose).toHaveBeenCalled();
    expect(high.group.parent).toBeNull();
  });
});
