import * as THREE from 'three';

/**
 * The rocket stack's shadow on the pad deck, as a flat convex outline: every vertex of the stack is projected along the
 * sun onto the deck plane, and the 2D convex hull of those points is the shadow. The stack only moves straight up during
 * the launch, so its shadow only slides away from the sun (and fades out as the rocket leaves the pad); nothing is
 * re-projected per frame. It stands in for a per-frame shadow-map redraw, which drew the whole scene twice (see
 * SpaceportPreview's shadow note): after liftoff, the climbing rocket's shadow costs a few dozen triangles here.
 */

/** Where a point lands on the horizontal plane y = planeY when moved along `dir` (a light direction, dir.y < 0). */
export function projectToPlane(point: THREE.Vector3, dir: THREE.Vector3, planeY: number, out = new THREE.Vector2()) {
  const t = (planeY - point.y) / dir.y;
  return out.set(point.x + dir.x * t, point.z + dir.z * t);
}

/** Andrew's monotone chain: the convex hull of 2D points, counter-clockwise, without collinear points. */
export function convexHull(points: readonly THREE.Vector2[]): THREE.Vector2[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: THREE.Vector2[] = [], upper: THREE.Vector2[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Horizontal slide of the shadow when the caster rises by `rise` metres (light direction `dir`). */
export function shadowSlide(rise: number, dir: THREE.Vector3, out = new THREE.Vector2()) {
  return out.set(-dir.x * rise / dir.y, -dir.z * rise / dir.y);
}

/** Shadow strength while the rocket climbs: full on the deck, gone once it is `fadeOver` metres up. */
export const shadowFade = (rise: number, fadeOver: number) => THREE.MathUtils.clamp(1 - rise / fadeOver, 0, 1);

export class RocketShadow {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly slide = new THREE.Vector2();

  /**
   * @param caster the rocket stack at rest (its world matrices must be current)
   * @param dir    the sun's light direction (from the light towards its target), normalised
   * @param deckY  height of the surface the shadow falls on
   * @param restY  the caster's root height at rest (the launch clip only raises it)
   */
  constructor(caster: THREE.Object3D, private readonly dir: THREE.Vector3, deckY: number, private readonly restY: number,
              private readonly strength = 0.34, private readonly fadeOver = 28) {
    const points: THREE.Vector2[] = [], v = new THREE.Vector3();
    caster.updateWorldMatrix(true, true);
    caster.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object.name.startsWith('FX')) return;
      const position = object.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) points.push(projectToPlane(v.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld), dir, deckY));
    });
    const hull = convexHull(points);
    const vertices: number[] = [], index: number[] = [];
    for (const p of hull) vertices.push(p.x, deckY + 0.03, p.y);
    for (let i = 1; i + 1 < hull.length; i++) index.push(0, i + 1, i); // fan, facing up
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    this.material = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: strength, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'Rocket shadow (planar)';
    this.mesh.renderOrder = 1;
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
  }

  get triangles() { return (this.mesh.geometry.index?.count ?? 0) / 3; }

  /** Follows the rocket's current height. */
  update(rocketY: number) {
    const rise = Math.max(0, rocketY - this.restY), fade = shadowFade(rise, this.fadeOver);
    shadowSlide(rise, this.dir, this.slide);
    this.mesh.position.set(this.slide.x, 0, this.slide.y);
    this.material.opacity = this.strength * fade;
    // On the pad the rocket's shadow is in the shadow map; this outline only takes over once it lifts off.
    this.mesh.visible = rise > 0.01 && fade > 0;
  }

  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.material.dispose(); }
}
