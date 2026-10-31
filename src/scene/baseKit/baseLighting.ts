import * as THREE from 'three';
import { makeSkyMaterial } from './horizon';

// Light at a showcase base (v2.3). The base is drawn in a second render pass of its
// own (layer BASE_LAYER, after the planets, before bloom), lit by a directional Sun
// from the base's real local sky, with a cached shadow map and an environment cube
// of that sky, while the planets keep their single point-light Sun. Night is simply
// the Sun below the horizon: no more dimming tricks.

/** The render layer of everything at a showcase base (pass 2). */
export const BASE_LAYER = 1;

/** The scene's Sun (a point light, no falloff): the base Sun matches it at Earth's distance. */
export const SCENE_SUN = 3.2;

/** Real sunlight relative to Earth's: 1/r² (Mars ≈ 0.43). Shown in the base card; not applied to the light (see sunIntensity). */
export const relativeSunlight = (rAU: number) => 1 / (rAU * rAU);

/**
 * Direct sunlight at a base. The app lights every planet alike (stylized: Mars as bright as Earth),
 * and the base's ground patch blends into the planet, so the base Sun matches the scene's Sun: a
 * realistic 43% only at the base would leave a dark island on a bright planet. The dust season moves
 * light from direct to scattered (see skyFill), keeping the total about the same.
 */
export function sunIntensity(_rAU: number, dust: number): number {
  return SCENE_SUN * (0.68 + 0.22 * dust); // with the sky fill, about the planet's own light
}

/** Shadow edge softness (PCF radius, texels): crisp in clear air, soft in the dust season. */
export const shadowRadius = (dust: number) => 1.5 + 2.5 * THREE.MathUtils.clamp((1 - dust) / 0.4, 0, 1);

/** Sky fill light: more of it when dust scatters the sunlight (haze), little at night. */
export const skyFill = (dust: number, night: number) => (0.45 + 0.6 * (1 - dust)) * (1 - 0.9 * night); // Mars' dusty sky lights the shadows

export interface ShadowKey {
  /** The Sun's direction in the base's frame. */
  sun: THREE.Vector3;
  /** Where the rocket stands or hovers, base frame (null: none). */
  rocket: THREE.Vector3 | null;
  /** The Build layout's version. */
  layout: number;
  /** The base's scale in the scene (the overview boost fades on the way in). */
  scale: number;
}

/** Does the cached shadow map need redrawing? The Sun moved > 0.5°, the rocket moved, the layout or scale changed. */
export function shadowStale(prev: ShadowKey | null, next: ShadowKey): boolean {
  if (!prev) return true;
  if (prev.sun.angleTo(next.sun) > THREE.MathUtils.degToRad(0.5)) return true;
  if ((prev.rocket === null) !== (next.rocket === null)) return true;
  if (prev.rocket && next.rocket && prev.rocket.distanceTo(next.rocket) > 1e-3) return true;
  if (prev.layout !== next.layout) return true;
  return Math.abs(prev.scale - next.scale) > prev.scale * 1e-3;
}

export interface EnvKey {
  sun: THREE.Vector3;
  night: number;
  /** The base's orientation in the scene (the cube is world-aligned). */
  turn: THREE.Quaternion;
}

/** Does the sky's environment cube need re-rendering? The sky's look changed (Sun moved > 2°, darkness by > 0.05) or the base turned > 2°. */
export function envStale(prev: EnvKey | null, next: EnvKey): boolean {
  if (!prev) return true;
  const deg2 = THREE.MathUtils.degToRad(2);
  return prev.sun.angleTo(next.sun) > deg2 || Math.abs(prev.night - next.night) > 0.05 || prev.turn.angleTo(next.turn) > deg2;
}

export interface LightingOptions {
  /** Shadows and an environment map (High, Ultra); Low has neither. */
  shadows: boolean;
  shadowSize: number;
  envSize: number;
}

/** Put a whole subtree on the base layer (pass 2) or back on the default one. */
export function setBaseLayer(root: THREE.Object3D, on: boolean) {
  root.traverse((o) => (on ? o.layers.set(BASE_LAYER) : o.layers.set(0)));
}

export class BaseLighting {
  readonly sun = new THREE.DirectionalLight(0xfff1dc, 0);
  readonly fill = new THREE.HemisphereLight(0xd8b088, 0x6a4a34, 0);
  /** The sky's reflections for base materials (null on Low). */
  get envMap(): THREE.Texture | null { return this.envFiltered?.texture ?? null; }
  shadowUpdates = 0;
  envUpdates = 0;
  private readonly target = new THREE.Object3D();
  private shadowKey: ShadowKey | null = null;
  private envKey: EnvKey | null = null;
  /** The shadow matrix in the base's frame, captured when the map was drawn (re-anchored every frame). */
  private readonly localShadowMatrix = new THREE.Matrix4();
  private anchored = false;
  private readonly inverse = new THREE.Matrix4();
  private readonly scaleV = new THREE.Vector3();
  private readonly turnQ = new THREE.Quaternion();
  private readonly envScene = new THREE.Scene();
  private readonly envCamera: THREE.CubeCamera | null = null;
  private readonly envTarget: THREE.WebGLCubeRenderTarget | null = null;
  private readonly envDome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  private envFilter: THREE.PMREMGenerator | null = null;
  private envFiltered: THREE.WebGLRenderTarget | null = null;
  private disposed = false;

  constructor(readonly group: THREE.Group, readonly opts: LightingOptions, private readonly extent: number) {
    for (const l of [this.sun, this.fill]) {
      l.layers.set(BASE_LAYER); // lights only the base's pass
      group.add(l);
    }
    group.add(this.target);
    this.sun.target = this.target;
    if (opts.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(opts.shadowSize, opts.shadowSize);
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.02;
      const envTarget = new THREE.WebGLCubeRenderTarget(opts.envSize, { type: THREE.HalfFloatType });
      this.envTarget = envTarget;
      this.envCamera = new THREE.CubeCamera(0.1, 10, envTarget);
      this.envDome = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 12), makeSkyMaterial(true));
      this.envScene.add(this.envDome);
    }
  }

  /**
   * Per frame, before rendering. `sun` is the Sun's direction in the base frame.
   * Returns whether the shadow map will be redrawn this frame.
   */
  update(renderer: THREE.WebGLRenderer, sun: THREE.Vector3, elevation: number, night: number, rAU: number, dust: number, rocket: THREE.Vector3 | null, layout: number): boolean {
    if (this.disposed) return false;
    const g = this.group;
    g.updateWorldMatrix(true, false);
    const up = sun.y > -0.02;
    this.sun.intensity = up ? sunIntensity(rAU, dust) * THREE.MathUtils.smoothstep(elevation, -1, 3) : 0;
    // A night-first entry has no cached map yet. Do not bind a shadow sampler
    // until sunlight makes the normal cache-update path initialize that map.
    this.sun.castShadow = this.opts.shadows && this.sun.intensity > 0;
    this.fill.intensity = skyFill(dust, night);
    const scale = g.getWorldScale(this.scaleV).x;
    let redraw = false;
    if (this.opts.shadows && this.sun.intensity > 0) {
      const key: ShadowKey = { sun, rocket, layout, scale };
      if (shadowStale(this.shadowKey, key)) {
        key.sun = sun.clone();
        key.rocket = rocket?.clone() ?? null;
        this.placeSun(sun, scale);
        this.sun.shadow.radius = shadowRadius(dust);
        renderer.shadowMap.needsUpdate = true;
        this.shadowKey = key;
        this.anchored = false;
        this.shadowUpdates++;
        redraw = true;
      } else if (this.anchored) {
        // The base moved with its planet since the map was drawn: carry the lookup matrix along.
        this.sun.shadow.matrix.multiplyMatrices(this.localShadowMatrix, this.inverse.copy(g.matrixWorld).invert());
      }
    } else if (!this.opts.shadows) {
      this.placeSun(sun, scale);
    }
    if (this.envCamera && this.envDome) {
      const turn = g.getWorldQuaternion(this.turnQ);
      const key: EnvKey = { sun, night, turn };
      if (envStale(this.envKey, key)) {
        key.sun = sun.clone();
        key.turn = turn.clone();
        const u = this.envDome.material.uniforms;
        u.sunDir.value.copy(sun);
        u.night.value = night;
        u.sunElevation.value = elevation;
        this.envDome.quaternion.copy(turn); // the cube is world-aligned: turn the base's sky into place
        this.envCamera.update(renderer, this.envScene);
        // Own the filtered target as well as the source cube. The renderer's
        // automatic render-target PMREM cache does not release it on this path.
        this.envFilter ??= new THREE.PMREMGenerator(renderer);
        this.envFiltered = this.envFilter.fromCubemap(this.envTarget!.texture, this.envFiltered);
        this.envKey = key;
        this.envUpdates++;
      }
    }
    return redraw;
  }

  /** After the frame is drawn: remember the fresh shadow matrix in the base's frame. */
  afterRender() {
    if (!this.opts.shadows || this.anchored || !this.shadowKey) return;
    this.localShadowMatrix.multiplyMatrices(this.sun.shadow.matrix, this.group.matrixWorld);
    this.anchored = true;
  }

  /** The Sun far off along its direction (base frame), aimed at the base; its shadow box fits the ground patch. */
  private placeSun(sun: THREE.Vector3, scale: number) {
    this.sun.position.copy(sun).multiplyScalar(this.extent * 2);
    this.target.position.set(0, 0, 0);
    const cam = this.sun.shadow.camera;
    const r = this.extent * scale; // world units (the shadow camera isn't scaled with the group)
    [cam.left, cam.right, cam.top, cam.bottom] = [-r, r, r, -r];
    cam.near = 0.01 * r;
    cam.far = this.extent * 4 * scale;
    // Roll the shadow box with the base (its north), so the cached map stays valid as the planet turns.
    cam.up.set(0, 0, -1).transformDirection(this.group.matrixWorld);
    cam.layers.set(BASE_LAYER);
    cam.updateProjectionMatrix();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.sun.dispose();
    this.fill.dispose();
    this.envFiltered?.dispose();
    this.envFiltered = null;
    this.envFilter?.dispose();
    this.envFilter = null;
    this.envTarget?.dispose();
    this.envDome?.geometry.dispose();
    this.envDome?.material.dispose();
    for (const o of [this.sun, this.fill, this.target]) o.removeFromParent();
  }
}
