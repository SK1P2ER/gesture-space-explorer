import * as THREE from 'three';

export type LandmarkId = 'assembly' | 'control' | 'pad' | 'landing';
export interface SiteBox { min: [number, number, number]; max: [number, number, number] }
export interface SpaceportSite {
  version: 1;
  landmarks: { id: LandmarkId; bounds: SiteBox; eye: [number, number, number]; target: [number, number, number] }[];
  colliders: SiteBox[];
  terrain: { x: number; z: number; dx: number; dz: number; columns: number; rows: number; heights: number[] };
  landing: { center: [number, number, number]; radius: number; approach_seconds: number };
}

/** Bilinear ground sampling avoids raycasting the 135k-triangle coastal mesh every frame. */
export function groundAt(site: SpaceportSite, x: number, z: number): number {
  const t = site.terrain;
  const u = (x - t.x) / t.dx, v = (z - t.z) / t.dz;
  if (u < 0 || v < 0 || u > t.columns - 1 || v > t.rows - 1) return 0;
  const a = Math.min(t.columns - 2, Math.floor(u)), b = Math.min(t.rows - 2, Math.floor(v));
  const h = (i: number, j: number) => t.heights[j * t.columns + i];
  return Math.max(0, THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(a, b), h(a + 1, b), u - a), THREE.MathUtils.lerp(h(a, b + 1), h(a + 1, b + 1), u - a), v - b));
}

export class SpaceportCollision {
  private readonly boxes: THREE.Box3[];
  private readonly ray = new THREE.Ray();
  private readonly delta = new THREE.Vector3();
  private readonly hit = new THREE.Vector3();
  constructor(readonly site: SpaceportSite, readonly clearance = 3) {
    this.boxes = site.colliders.map(box => new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max)).expandByScalar(clearance));
  }

  /** Swept camera motion stops before a wall even when a large drag crosses the whole building. */
  constrain(previous: THREE.Vector3, desired: THREE.Vector3): THREE.Vector3 {
    const result = desired.clone();
    this.delta.subVectors(desired, previous);
    const distance = this.delta.length();
    if (distance > 1e-6) {
      this.ray.set(previous, this.delta.normalize());
      let allowed = distance;
      for (const box of this.boxes) {
        if (box.containsPoint(previous)) continue;
        if (this.ray.intersectBox(box, this.hit)) allowed = Math.min(allowed, Math.max(0, previous.distanceTo(this.hit) - 0.05));
      }
      if (allowed < distance) result.copy(previous).addScaledVector(this.delta, allowed);
    }
    // Also recover a camera restored/teleported inside a building or under the terrain.
    for (let pass = 0; pass < 3; pass++) {
      result.y = Math.max(result.y, groundAt(this.site, result.x, result.z) + this.clearance);
      for (const box of this.boxes) if (box.containsPoint(result)) {
        const exits = [
          { axis: 'x' as const, value: box.min.x - .05 }, { axis: 'x' as const, value: box.max.x + .05 },
          { axis: 'z' as const, value: box.min.z - .05 }, { axis: 'z' as const, value: box.max.z + .05 },
          { axis: 'y' as const, value: box.max.y + .05 },
        ];
        exits.sort((a, b) => Math.abs(a.value - result[a.axis]) - Math.abs(b.value - result[b.axis]));
        result[exits[0].axis] = exits[0].value;
      }
    }
    return result;
  }

  pick(ray: THREE.Ray): LandmarkId | null {
    let nearest = Infinity, chosen: LandmarkId | null = null;
    for (const landmark of this.site.landmarks) {
      const box = new THREE.Box3(new THREE.Vector3(...landmark.bounds.min), new THREE.Vector3(...landmark.bounds.max));
      if (ray.intersectBox(box, this.hit)) {
        const distance = ray.origin.distanceToSquared(this.hit);
        if (distance < nearest) { nearest = distance; chosen = landmark.id; }
      }
    }
    return chosen;
  }
}
