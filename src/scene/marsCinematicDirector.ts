import * as THREE from 'three';
import { easeInOutCubic, type Insets } from './cameraRig';
import type { BaseNode } from './bases';
import type { Showcase } from './baseKit/showcase';
import type { LandingPad } from './baseKit/landingPad';
import type { Mode } from '../app/modes';

export const CINEMATIC_VIEWS = ['overview', 'habitats', 'landing', 'garage', 'panorama'] as const;
export type CinematicView = typeof CINEMATIC_VIEWS[number];
export type CinematicRequest = CinematicView | 'flyover';
export interface CinematicContext {
  base: BaseNode;
  owner: Showcase;
  landing: LandingPad;
  mode: Mode;
  horizon: boolean;
  quality: string;
}
const UP = new THREE.Vector3(0, 1, 0);
const FLIGHT = ['overview', 'habitats', 'landing', 'garage', 'overview'] as const;
const OFFSETS: Record<CinematicView, [number, number, number]> = {
  overview: [1.7, 2.1, 2.4], habitats: [0.55, 0.65, 0.85],
  landing: [0.65, 0.75, 0.8], garage: [0.35, 0.65, 0.65], panorama: [1.9, 0.65, 1.6],
};

/** One temporary camera lease. Borrows the camera/base/metadata; owns no GPU resources or scheduling. */
export class MarsCinematicDirector {
  private lease: CinematicContext | null = null;
  private clip: { near: number; far: number; up: THREE.Vector3 } | null = null;
  private disposed = false;
  private elapsed = 0;
  private segment = 0;
  private completing = false;
  private request: CinematicRequest | null = null;
  generation = 0;
  readonly eye = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly fromLook = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly toLook = new THREE.Vector3();
  private readonly fromQ = new THREE.Quaternion();
  private readonly localQ = new THREE.Quaternion();
  private readonly goalQ = new THREE.Quaternion();
  private readonly worldQ = new THREE.Quaternion();
  private readonly inverse = new THREE.Matrix4();
  private readonly matrix = new THREE.Matrix4();
  private readonly point = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}
  get active() { return this.lease !== null; }
  get selected() { return this.request; }
  get animating() { return this.active && (this.request === 'flyover' || this.elapsed < 1.4); }

  validate(context: CinematicContext | null) {
    const old = this.lease;
    if (old && (!context || context.mode !== 'baseView' || context.base !== old.base ||
      context.owner !== old.owner || context.horizon !== old.horizon || context.quality !== old.quality ||
      old.owner.group.parent !== old.base.group)) this.cancel();
  }

  start(request: CinematicRequest, context: CinematicContext, reducedMotion: boolean) {
    this.cancel();
    if (this.disposed || context.mode !== 'baseView' || context.base.base.id !== 'jezero' ||
      context.owner.group.parent !== context.base.group || (request === 'flyover' && reducedMotion)) return false;
    this.lease = context;
    this.request = request;
    this.elapsed = 0; this.segment = 0; this.completing = false;
    this.clip = { near: this.camera.near, far: this.camera.far, up: this.camera.up.clone() };
    const group = context.base.group;
    group.updateWorldMatrix(true, false);
    this.inverse.copy(group.matrixWorld).invert();
    this.from.copy(this.camera.position).applyMatrix4(this.inverse);
    this.camera.getWorldDirection(this.point).transformDirection(this.inverse);
    this.fromLook.copy(this.from).addScaledVector(this.point, 1);
    group.getWorldQuaternion(this.worldQ);
    this.fromQ.copy(this.worldQ).invert().multiply(this.camera.quaternion);
    this.destination(request === 'flyover' ? FLIGHT[0] : request);
    // Unsafe entry positions must not sweep through terrain or buildings.
    if (reducedMotion || !Number.isFinite(this.from.lengthSq()) || this.from.y < 0.6 || this.from.length() > 10) {
      this.from.copy(this.to); this.fromLook.copy(this.toLook);
      this.fromQ.setFromRotationMatrix(this.matrix.lookAt(this.from, this.fromLook, UP));
      if (request !== 'flyover') this.elapsed = 1.4;
    }
    return true;
  }

  private destination(view: CinematicView) {
    const c = this.lease!;
    this.toLook.set(-0.35, 0.08, 0.1);
    if (view === 'habitats') {
      this.toLook.set(0, 0, 0);
      for (const anchor of c.owner.habitatAnchors.values()) this.toLook.add(this.point.setFromMatrixPosition(anchor.matrix));
      this.toLook.multiplyScalar(1 / Math.max(1, c.owner.habitatAnchors.size)); this.toLook.y += 0.08;
    } else if (view === 'landing') {
      this.toLook.copy(c.landing.anchors.get('PAD-CENTER')!.position); this.toLook.y += 0.08;
    } else if (view === 'garage') {
      this.toLook.setFromMatrixPosition(c.owner.infrastructureAnchors.get('ROV-01')!.matrix); this.toLook.y += 0.06;
    }
    this.to.fromArray(OFFSETS[view]).add(this.toLook);
    this.to.y = Math.max(0.65, this.to.y);
  }

  /** Called only through Mission's exclusive BaseView handoff, never alongside Rig placement. */
  update(dt: number, reducedMotion: boolean, paused: boolean, insets: Insets) {
    if (!this.lease) return false;
    if (this.completing || (this.request === 'flyover' && reducedMotion)) { this.cancel(); return false; }
    if (!paused) this.elapsed += Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    const duration = this.request === 'flyover' ? 2 : 1.4;
    const k = reducedMotion ? 1 : easeInOutCubic(Math.min(1, this.elapsed / duration));
    // Preserve readable framing above/alongside the existing panels. Only move
    // farther up/out from the clearance corridor as the usable viewport narrows.
    const free = Math.max(0.2, Math.min(1 - insets.top - insets.bottom,
      this.camera.aspect * (1 - insets.left - insets.right)));
    const pullBack = this.request === 'panorama' ? Math.min(2.5, 1 / free) : 1 / free;
    this.point.subVectors(this.to, this.toLook).multiplyScalar(pullBack).add(this.toLook);
    this.eye.lerpVectors(this.from, this.point, k);
    this.look.lerpVectors(this.fromLook, this.toLook, k);
    this.eye.y = Math.max(0.6, this.eye.y);
    const group = this.lease.base.group;
    group.updateWorldMatrix(true, false);
    group.getWorldQuaternion(this.worldQ);
    this.goalQ.setFromRotationMatrix(this.matrix.lookAt(this.eye, this.look, UP));
    this.localQ.slerpQuaternions(this.fromQ, this.goalQ, k);
    this.camera.position.copy(this.eye).applyMatrix4(group.matrixWorld);
    this.camera.quaternion.copy(this.worldQ).multiply(this.localQ);
    this.camera.up.copy(UP).applyQuaternion(this.worldQ);
    this.camera.near = 0.002;
    this.camera.far = this.clip!.far;
    const w = 1000 * this.camera.aspect;
    this.camera.setViewOffset(w, 1000, w * (insets.right - insets.left) / 2,
      1000 * (insets.bottom - insets.top) / 2, w, 1000);
    this.camera.updateMatrixWorld();
    if (this.request === 'flyover' && this.elapsed >= duration) {
      this.segment++;
      if (this.segment >= FLIGHT.length) this.completing = true;
      else {
        this.from.copy(this.eye); this.fromLook.copy(this.toLook);
        this.fromQ.copy(this.localQ); this.destination(FLIGHT[this.segment]); this.elapsed = 0;
      }
    }
    return true;
  }

  /** No transform snapshot is restored: the current Mission/Rig state resumes. */
  cancel() {
    this.generation++;
    if (this.lease && this.clip && this.camera.near === 0.002 && this.camera.far === this.clip.far) {
      this.camera.near = this.clip.near; this.camera.far = this.clip.far;
      this.camera.up.copy(this.clip.up); this.camera.clearViewOffset(); this.camera.updateProjectionMatrix();
    }
    this.lease = null; this.clip = null; this.request = null; this.completing = false;
  }

  dispose() { if (!this.disposed) { this.cancel(); this.disposed = true; } }
}
