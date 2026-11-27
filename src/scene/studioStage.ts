// SPIKE (?flags=picker3d,studio): the Planet Selection Studio's drawing, on the app's existing renderer and loop.
//
// Ownership: this owns one Scene (a flat background colour) and one camera. It owns no geometry, texture or material.
// While the studio shows, the picker view's own orb group (made and disposed by DestinationPickerView) is moved from
// the solar-system scene into this one, and moved back on exit. The main scene, the camera rig, the post-processing
// pipeline and the ground view's renderer are not touched: they are simply not drawn for that time.
import * as THREE from 'three';

export class StudioStage {
  readonly scene = new THREE.Scene();
  /** At the origin, looking down −z, no view offset: the orbs are placed in front of it by the picker view. */
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
  active = false;
  /** Counters for the spike's checks (how often the studio was entered, left and drawn). */
  readonly stats = { entered: 0, exited: 0, frames: 0 };
  private home: THREE.Object3D | null = null;

  constructor() {
    this.scene.background = new THREE.Color(0x081220);
    this.scene.matrixAutoUpdate = false;
  }

  /** Take the orb group for the time the studio shows. Remembers where it came from. */
  enter(group: THREE.Object3D) {
    if (this.active) return;
    this.home = group.parent;
    this.scene.add(group); // three.js removes it from its previous parent
    this.active = true;
    this.stats.entered++;
  }

  /** Give the orb group back to where it came from. Nothing else was changed, so nothing else is restored. */
  exit(group: THREE.Object3D) {
    if (!this.active) return;
    if (this.home) this.home.add(group); else this.scene.remove(group);
    this.home = null;
    this.active = false;
    this.stats.exited++;
  }

  /** One draw of the studio, straight to the canvas: no composer, no bloom, no base pass. */
  render(renderer: THREE.WebGLRenderer, exposure: number, aspect: number) {
    if (this.camera.aspect !== aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    renderer.setRenderTarget(null);
    renderer.toneMappingExposure = exposure; // the pipeline sets its own again on its next frame
    renderer.render(this.scene, this.camera);
    this.stats.frames++;
  }
}
