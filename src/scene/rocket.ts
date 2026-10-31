import * as THREE from 'three';

/** Flame on or off, flickering. */
export function setThrust(rocket: THREE.Object3D, level: number, seconds: number) {
  const flame = rocket.getObjectByName('flame')!;
  flame.visible = level > 0.01;
  flame.scale.set(1, level * (0.8 + 0.2 * Math.sin(seconds * 40)), 1);
}

const STREAKS = 220;

/**
 * Warp effect: star streaks rushing past the camera along the direction of travel.
 * One draw call; positions are rebuilt each frame around the camera.
 */
export class WarpStreaks {
  readonly lines: THREE.LineSegments;
  private readonly seeds = Array.from({ length: STREAKS }, () => [Math.random(), Math.random(), Math.random()]);
  private readonly positions = new Float32Array(STREAKS * 6);
  private phase = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.visible = false;
  }

  /** @param level 0 (off) … 1 (full warp) */
  update(camera: THREE.Camera, forward: THREE.Vector3, level: number, dt: number) {
    this.lines.visible = level > 0.01;
    if (!this.lines.visible) return;
    (this.lines.material as THREE.LineBasicMaterial).opacity = 0.7 * level;
    this.phase = (this.phase + dt * 1.6) % 1;
    const f = forward.clone().normalize();
    const right = new THREE.Vector3().crossVectors(f, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, f);
    const length = 0.4 + 2.2 * level;
    this.seeds.forEach(([a, r, z], i) => {
      const angle = a * Math.PI * 2;
      const radius = 0.6 + r * 2.5;
      const depth = 8 - ((z + this.phase) % 1) * 12; // ahead → behind
      const p = camera.position.clone().addScaledVector(f, depth).addScaledVector(right, Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius);
      const q = p.clone().addScaledVector(f, -length);
      this.positions.set([p.x, p.y, p.z, q.x, q.y, q.z], i * 6);
    });
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
