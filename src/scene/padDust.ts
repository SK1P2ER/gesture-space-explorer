import * as THREE from 'three';
import { puffTexture } from './baseKit/showcase';

// Dust (v2.2) kicked up from a pad by a rocket's engines, at liftoff and in the
// last part of a landing: soft puffs that billow out across the ground, rise a
// little, and fade. One instanced draw call; positions follow the pad as its
// world turns. How much and what colour come from the world (data/atmosphere.ts):
// none on the Moon. No dust at all with reduced motion; fewer puffs on Low.

export const DUST_PUFFS = { full: 160, few: 40 };

/** A small seeded random generator (the same puffs every run: testable). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Puff {
  age: number;
  life: number;
  angle: number;
  speed: number;
  rise: number;
  size: number;
}

export interface PadFrame {
  center: THREE.Vector3;
  normal: THREE.Vector3;
  /** Scene units per base unit at this pad. */
  size: number;
}

export class PadDust {
  readonly mesh: THREE.InstancedMesh;
  private readonly puffs: Puff[] = [];
  private readonly random = rng(7);
  private carry = 0;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly color = new THREE.Color();
  private readonly m = new THREE.Matrix4();
  private readonly t1 = new THREE.Vector3();
  private readonly t2 = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();

  constructor(readonly max: number) {
    this.material = new THREE.MeshBasicMaterial({ map: puffTexture([255, 255, 255]), transparent: true, depthWrite: false, opacity: 0.55 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.material, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'pad-dust';
  }

  /** How many puffs are in the air. */
  get live() {
    return this.puffs.length;
  }

  /**
   * Per frame.
   * @param emit 0–1: how hard the engines are blowing on the pad now (0: none, the cloud settles)
   * @param amount 0–1: how much dust this world has (data/atmosphere.ts dustFor)
   * @param night 0–1: dims the dust after dark
   */
  update(dt: number, pad: PadFrame | null, camera: THREE.Camera, emit: number, amount: number, color: number, night: number) {
    // Spawn: up to the whole budget each second and a half while blowing hard.
    this.carry += emit * amount * (this.max / 1.5) * dt;
    while (this.carry >= 1 && this.puffs.length < this.max) {
      this.carry -= 1;
      const r = this.random;
      this.puffs.push({ age: 0, life: 1.4 + r() * 1.2, angle: r() * Math.PI * 2, speed: 0.5 + r() * 0.9, rise: 0.05 + r() * 0.22, size: 0.08 + r() * 0.12 });
    }
    if (this.carry > 1) this.carry = 1; // at the cap: don't bank spawns for later
    for (const p of this.puffs) p.age += dt;
    for (let i = this.puffs.length - 1; i >= 0; i--) if (this.puffs[i].age >= this.puffs[i].life) this.puffs.splice(i, 1);

    this.mesh.count = pad ? this.puffs.length : 0;
    if (!pad || !this.puffs.length) return;
    // The pad's ground plane: two directions across it.
    this.t1.set(1, 0, 0).addScaledVector(pad.normal, -pad.normal.x);
    if (this.t1.lengthSq() < 1e-6) this.t1.set(0, 0, 1).addScaledVector(pad.normal, -pad.normal.z);
    this.t1.normalize();
    this.t2.crossVectors(pad.normal, this.t1);
    const face = camera.getWorldQuaternion(new THREE.Quaternion());
    const eye = camera.getWorldPosition(new THREE.Vector3());
    this.puffs.forEach((p, i) => {
      const k = p.age / p.life;
      const r = p.speed * p.age * (1 - 0.35 * k); // billows out, slowing
      this.pos.copy(pad.center)
        .addScaledVector(this.t1, Math.cos(p.angle) * r * pad.size)
        .addScaledVector(this.t2, Math.sin(p.angle) * r * pad.size)
        .addScaledVector(pad.normal, p.rise * p.age * pad.size);
      let s = p.size * (0.5 + 2.2 * k) * Math.sin(Math.PI * Math.min(1, k * 1.15 + 0.05)) * pad.size; // grows, then fades away
      // Puffs right in front of the camera (the chase view starts in the cloud) fade out instead of filling the screen.
      s *= THREE.MathUtils.smoothstep(this.pos.distanceTo(eye), s * 2, s * 6);
      this.m.compose(this.pos, face, this.scale.setScalar(Math.max(1e-5, s)));
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.material.color.copy(this.color.setHex(color)).multiplyScalar(1 - 0.8 * night);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
    this.mesh.dispose();
    this.mesh.removeFromParent();
  }
}
