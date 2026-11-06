import * as THREE from 'three';

/** Where the horizon view stands: the angle round the base, how far the eye looks up, how far out it stands. */
export interface HorizonPose {
  yaw: number;
  pitch: number;
  distance: number;
}

/**
 * The horizon view (showcase bases): standing on the plain outside the base at eye height, looking in
 * across it with the sky behind. It owns the camera while it's on, clipping much nearer than the orbit
 * views need, and gives the clipping back when it ends.
 */
export class HorizonView {
  /** Where the view stands; null when it's off. */
  pose: HorizonPose | null = null;
  /** Where the eye stands, in the base's frame (for the sky dome). */
  readonly eye = new THREE.Vector3();
  private savedClip: { near: number; far: number } | null = null;
  /** The camera's eye and look point, in the base's frame (eased there, so it rides along with the ground). */
  private cam: { eye: THREE.Vector3; look: THREE.Vector3 } | null = null;

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly reducedMotion: () => boolean) {}

  /** Down to the ground south of the base (clear of the panels), gliding from where the camera is now. */
  enter(base: THREE.Group) {
    this.pose = { yaw: Math.PI / 2 - 0.25, pitch: 0.04, distance: 2.1 };
    base.updateWorldMatrix(true, false);
    const eye = base.worldToLocal(this.camera.position.clone());
    const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).add(this.camera.position);
    this.cam = { eye, look: base.worldToLocal(ahead) };
    // The eye is a few cm (scene units) off the ground: clip much nearer than the orbit views need.
    this.savedClip = { near: this.camera.near, far: this.camera.far };
    this.camera.near = 0.002;
    this.camera.far = 1200; // the starfield is 600–1000 out
    this.camera.updateProjectionMatrix();
  }

  /** Back up: the camera's clipping and world-up again. Returns whether the view was on. */
  exit(): boolean {
    if (!this.pose) return false;
    this.pose = null;
    this.cam = null;
    if (this.savedClip) [this.camera.near, this.camera.far] = [this.savedClip.near, this.savedClip.far];
    this.savedClip = null;
    this.camera.updateProjectionMatrix();
    this.camera.up.set(0, 1, 0);
    return true;
  }

  /** Drag (or the open hand): look around. */
  look(dx: number, dy: number) {
    this.pose!.yaw += dx;
    this.pose!.pitch = THREE.MathUtils.clamp(this.pose!.pitch - dy * 0.5, -0.15, 0.6);
  }

  /** Zoom: step closer or back. */
  step(factor: number) {
    this.pose!.distance = THREE.MathUtils.clamp(this.pose!.distance * factor, 0.7, 2.3);
  }

  /** Golden hour: stand to the side of the Sun's line (base frame), looking in across the base, so the light rakes from the side. */
  faceAcross(sun: THREE.Vector3) {
    this.pose!.yaw = Math.atan2(sun.z, sun.x) + Math.PI / 2;
    this.pose!.pitch = 0.04;
  }

  /** Once a frame while it's on: the frame's camera placed at the eye, looking in across the base. */
  update(dt: number, base: THREE.Group, camera: THREE.PerspectiveCamera) {
    const h = this.pose!;
    base.updateWorldMatrix(true, false);
    const eye = this.eye.set(Math.cos(h.yaw) * h.distance, 0.055, Math.sin(h.yaw) * h.distance);
    const look = new THREE.Vector3(-Math.cos(h.yaw), Math.tan(h.pitch), -Math.sin(h.yaw)).add(eye);
    // Eased in the base's frame, then placed: if the planet jumps (a time jump), the view jumps with it.
    const cam = (this.cam ??= { eye: eye.clone(), look: look.clone() });
    const k = this.reducedMotion() ? 1 : 1 - Math.exp(-dt * 4);
    cam.eye.lerp(eye, k);
    cam.look.lerp(look, k);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(base.matrixWorld);
    camera.position.copy(base.localToWorld(cam.eye.clone()));
    camera.up.copy(up);
    camera.lookAt(base.localToWorld(cam.look.clone()));
    camera.updateMatrixWorld();
  }
}
