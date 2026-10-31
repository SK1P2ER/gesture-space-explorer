import * as THREE from 'three';
import { seeded } from '../data/belts';
import type { TextureTier } from '../data/bodies';
import { SCENE_TO_EQUATORIAL, ShootingStarTimer } from '../data/sky';
import { patchShader, replaceOnce } from '../planets/shaderPatch';
import { combineTextureSignals, disposeTexture, loadTexture, solidTexture, type UploadQueue } from '../planets/textureLoader';

/** How bright the Milky Way is drawn: a backdrop, not a distraction from the planets. */
const BRIGHTNESS = 0.6;
const RADIUS = 1500; // inside the camera's far plane (2000), outside everything else

/**
 * The Milky Way behind everything: a sphere around the camera that looks up each
 * pixel's right ascension and declination on NASA's star map (see data/sky.ts),
 * so the band runs through Sagittarius and Cygnus where it really does. Drawn
 * first, without depth. The map is never shrunk on screen, so it needs no mipmaps:
 * 32 MB on High (4K), 8 MB on Low (2K).
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly placeholder = solidTexture([0, 0, 0, 255], 'color');
  private tier: TextureTier | null = null;
  private texture: THREE.Texture | null = null;
  private generation = 0;
  private request: AbortController | null = null;
  private disposed = false;

  constructor(private readonly uploads: UploadQueue) {
    this.material = new THREE.MeshBasicMaterial({
      map: this.placeholder, // until the map arrives: the old plain black
      color: new THREE.Color(BRIGHTNESS, BRIGHTNESS, BRIGHTNESS),
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    const toSky = new THREE.Matrix3().set(...SCENE_TO_EQUATORIAL);
    patchShader(this.material, 'sky-celestial', (shader) => {
      shader.uniforms.uToSky = { value: toSky };
      shader.vertexShader = replaceOnce(shader.vertexShader, 'void main() {', 'varying vec3 vSkyDir;\nvoid main() {\n\tvSkyDir = position;');
      shader.fragmentShader = replaceOnce(shader.fragmentShader, 'void main() {', 'uniform mat3 uToSky;\nvarying vec3 vSkyDir;\nvoid main() {');
      // Same as skyUv() in data/sky.ts: RA 0h in the middle, increasing to the left; north at the top (v = 0).
      shader.fragmentShader = replaceOnce(
        shader.fragmentShader,
        'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
        `vec3 skyDir = normalize( uToSky * vSkyDir );
	vec2 skyUv = vec2( 0.5 - atan( skyDir.y, skyDir.x ) * 0.15915494, 0.5 - asin( clamp( skyDir.z, -1.0, 1.0 ) ) * 0.31830989 );
	vec4 sampledDiffuseColor = texture2D( map, skyUv );`,
      );
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.scale.setScalar(RADIUS);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  /** Loads the map at this tier (4K on High, 2K on Low), off the main thread and in slices. */
  async setTier(tier: TextureTier) {
    if (this.disposed || tier === this.tier) return;
    const generation = ++this.generation;
    this.request?.abort();
    const request = this.request = new AbortController();
    const cancellation = combineTextureSignals(request.signal, this.uploads.signal);
    const { signal } = cancellation;
    this.tier = tier;
    try {
      const decoded = await loadTexture('sky.jpg', tier, 'color', 1, signal);
      if (signal.aborted || this.disposed || generation !== this.generation) return disposeTexture(decoded);
      decoded.wrapS = THREE.RepeatWrapping; // the seam at RA 12h blends across
      // upload owns decoded from this point, including on rejection.
      const texture = await this.uploads.upload(decoded, { mipmaps: false, signal });
      if (signal.aborted || this.disposed || generation !== this.generation) return disposeTexture(texture);
      const old = this.texture;
      this.texture = texture;
      this.material.map = texture;
      if (old) disposeTexture(old);
    } catch (e) {
      if (!signal.aborted && !this.disposed && generation === this.generation) console.warn('[sky] star map unavailable; plain background', e);
    } finally {
      cancellation.dispose();
      if (this.request === request) this.request = null;
    }
  }

  /** After a WebGL context loss: load the map again. */
  reload() {
    if (this.disposed) return;
    const tier = this.tier;
    ++this.generation;
    this.request?.abort();
    this.request = null;
    this.tier = null;
    const old = this.texture;
    this.texture = null;
    this.material.map = this.placeholder;
    if (old) disposeTexture(old);
    if (tier) void this.setTier(tier);
  }

  /** Keeps the sky centered on the camera (it's infinitely far away). */
  update(camera: THREE.Camera) {
    if (this.disposed) return;
    this.mesh.position.copy(camera.position);
  }

  /** Terminal teardown: detach the sampler before releasing owned resources. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.request?.abort();
    this.request = null;
    this.tier = null;
    this.mesh.removeFromParent();
    this.material.map = null;
    const texture = this.texture;
    this.texture = null;
    if (texture) disposeTexture(texture);
    disposeTexture(this.placeholder);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

const TRAIL = 0.45; // of the path, behind the head
const DISTANCE = 1200; // from the camera: behind every planet, in front of the sky

/** An occasional meteor: one short glowing streak somewhere in view. None with reduced motion. */
export class ShootingStars {
  readonly mesh: THREE.Mesh;
  reducedMotion = false;
  private readonly timer: ShootingStarTimer;
  private readonly rand = seeded(Date.now() & 0xffff);
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly positions: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.timer = new ShootingStarTimer(this.rand);
    const geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(4 * 3), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('aAlong', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
    geometry.setIndex([0, 1, 2, 1, 3, 2]);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec2 aAlong; // (0 tail → 1 head, side −1 → 1)
        varying vec2 vAlong;
        void main() {
          vAlong = aAlong;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec2 vAlong;
        void main() {
          float glow = pow(clamp(vAlong.x, 0.0, 1.0), 2.0) * (1.0 - abs(vAlong.y));
          gl_FragColor = vec4(vec3(1.6, 1.54, 1.4) * glow * uOpacity, 1.0); // a touch over white: bloom catches it on High
        }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  update(dt: number, camera: THREE.PerspectiveCamera) {
    const state = this.timer.update(dt, this.reducedMotion);
    if (state === null) {
      this.mesh.visible = false;
      return;
    }
    if (state === 'start') {
      // Somewhere in the upper part of the view, falling down and sideways; far behind the planets.
      const x = (this.rand() - 0.5) * 1.6;
      const y = 0.1 + this.rand() * 0.7;
      const far = (ndcX: number, ndcY: number, out: THREE.Vector3) =>
        out.set(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).setLength(DISTANCE).add(camera.position);
      far(x, y, this.from);
      far(x + (this.rand() - 0.5) * 0.9, y - 0.3 - this.rand() * 0.3, this.to);
    }
    const t = state === 'start' ? 0 : state;
    const head = new THREE.Vector3().lerpVectors(this.from, this.to, t);
    const tail = new THREE.Vector3().lerpVectors(this.from, this.to, Math.max(0, t - TRAIL));
    const toCamera = new THREE.Vector3().subVectors(camera.position, head);
    const side = new THREE.Vector3().subVectors(head, tail).cross(toCamera).normalize().multiplyScalar(DISTANCE * 0.003);
    this.positions.setXYZ(0, tail.x - side.x, tail.y - side.y, tail.z - side.z);
    this.positions.setXYZ(1, tail.x + side.x, tail.y + side.y, tail.z + side.z);
    this.positions.setXYZ(2, head.x - side.x, head.y - side.y, head.z - side.z);
    this.positions.setXYZ(3, head.x + side.x, head.y + side.y, head.z + side.z);
    this.positions.needsUpdate = true;
    this.material.uniforms.uOpacity.value = Math.sin(Math.PI * t); // fades in and out
    this.mesh.visible = true;
  }
}
