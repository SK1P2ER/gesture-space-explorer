import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RocketShadow, convexHull, projectToPlane, shadowFade, shadowSlide } from '../src/scene/rocketShadow';

const sun = new THREE.Vector3(0.53, -0.78, -0.48).normalize(); // the preview's light direction (towards its target)

describe('rocket deck shadow', () => {
  it('projects a point along the light onto the plane', () => {
    const p = projectToPlane(new THREE.Vector3(0, 10, 0), sun, 0);
    // 10 m up, so it lands 10 * |dir.xz / dir.y| away, along the light's horizontal direction
    expect(p.x).toBeCloseTo(10 * 0.53 / 0.78, 5);
    expect(p.y).toBeCloseTo(10 * -0.48 / 0.78, 5);
    expect(projectToPlane(new THREE.Vector3(3, 2, -1), sun, 2).toArray()).toEqual([3, -1]); // already on the plane
  });

  it('builds a counter-clockwise convex hull without inner or collinear points', () => {
    const v = (x: number, y: number) => new THREE.Vector2(x, y);
    const hull = convexHull([v(0, 0), v(2, 0), v(1, 0), v(2, 2), v(0, 2), v(1, 1), v(1, 2)]);
    expect(hull.map(p => p.toArray())).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]]);
  });

  it('slides away from the sun and fades as the rocket climbs', () => {
    const still = shadowSlide(0, sun);
    expect(Math.abs(still.x) + Math.abs(still.y)).toBe(0);
    const s = shadowSlide(7.8, sun);
    expect(s.x).toBeCloseTo(7.8 * 0.53 / 0.78 / 1, 5);
    expect(shadowFade(0, 28)).toBe(1);
    expect(shadowFade(14, 28)).toBe(0.5);
    expect(shadowFade(40, 28)).toBe(0);
  });

  it('outlines a caster with a fan of hull triangles and follows its height', () => {
    const caster = new THREE.Group(); caster.position.y = 13;
    const box = new THREE.Mesh(new THREE.BoxGeometry(4, 40, 4)); box.position.y = 20; caster.add(box);
    const jet = new THREE.Mesh(new THREE.BoxGeometry(100, 1, 100)); jet.name = 'FX_|_core_jet_0'; caster.add(jet); // ignored
    const shadow = new RocketShadow(caster, sun, 7, 13);
    const hull = shadow.mesh.geometry.getAttribute('position').count;
    expect(shadow.triangles).toBe(hull - 2);
    expect(shadow.triangles).toBeLessThan(20); // a box's projected outline: a hexagon
    const box2 = new THREE.Box3().setFromObject(shadow.mesh);
    expect(box2.max.x - box2.min.x).toBeLessThan(80); // the 100 m FX plate did not count
    shadow.update(13);
    expect(shadow.mesh.visible).toBe(false); // on the pad the shadow map carries the rocket's shadow
    shadow.update(13.5);
    expect(shadow.mesh.visible).toBe(true);
    expect((shadow.mesh.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.34 * (1 - 0.5 / 28), 5);
    shadow.update(13 + 14);
    expect(shadow.mesh.position.x).toBeCloseTo(14 * 0.53 / 0.78, 4);
    expect((shadow.mesh.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.17, 5);
    shadow.update(100);
    expect(shadow.mesh.visible).toBe(false);
    shadow.dispose();
  });
});
