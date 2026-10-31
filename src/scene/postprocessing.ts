import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Config } from '../config';
import { BASE_LAYER } from './baseKit/baseLighting';

/**
 * Draws the scene, optionally with bloom. Bloom runs on the linear HDR image
 * before tone mapping (OutputPass applies ACES + sRGB afterwards), so only
 * what is brighter than `bloomThreshold` glows: the Sun, ocean sun-glints.
 */
export class ScenePipeline {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly output: OutputPass;
  private bloomOn = true;
  private readonly basePass: LayerRenderPass;
  /** Draw the base pass this frame (there's a showcase base in view). */
  baseOn = false;
  /** The scene's top-level branches that hold the base (its planet, the rocket, its dust); pass 2 skips the rest. */
  baseRoots: THREE.Object3D[] = [];
  /** Last size given; the bloom buffers only get it while bloom is on (Low quality never allocates them). */
  private size = { width: 1, height: 1, applied: false };

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly cfg: Config['render'],
  ) {
    // Half float keeps the HDR values for bloom; 4× MSAA keeps the edges as smooth as the canvas's own antialiasing.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    // Pass 2 (v2.3): a showcase base, lit by its own Sun, drawn over the planets (depth kept) and before bloom.
    this.basePass = new LayerRenderPass(scene, camera, BASE_LAYER, () => this.baseRoots);
    this.basePass.clear = false;
    this.composer.addPass(this.basePass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), cfg.bloomStrength, cfg.bloomRadius, cfg.bloomThreshold);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
  }

  /**
   * Compiles, in the background (compileAsync), every shader the path not in
   * use will need, so switching quality never stalls on compilation:
   * - the scene's materials: three.js builds separate programs for drawing to
   *   the screen (tone mapped) and into the bloom buffer (linear) — ~0.5 s of
   *   compiling on the first switch otherwise (measured);
   * - with bloom off (Low), also bloom's and the output pass's own shaders,
   *   which would otherwise compile on the first bloom frame (40–55 ms).
   */
  async prewarm(): Promise<void> {
    const toBloomBuffer = this.composer.renderTarget1;
    this.renderer.setRenderTarget(this.bloomOn ? null : toBloomBuffer);
    const scene = this.renderer.compileAsync(this.scene, this.camera); // programs are chosen synchronously, here
    let passes: Promise<unknown> | null = null;
    // Stand-in for the passes' full-screen triangle. Same attributes (position + uv, no
    // normal): which attributes exist is part of a program's cache key, so a PlaneGeometry
    // would compile programs the passes never look up.
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    if (!this.bloomOn) {
      const quads = new THREE.Scene();
      const b = this.bloom;
      for (const m of [b.materialHighPassFilter, ...b.separableBlurMaterials, b.compositeMaterial, b.blendMaterial, this.output.material]) {
        quads.add(new THREE.Mesh(quad, m));
      }
      // OutputPass picks its defines on its first render. Give it the same ones now, so the
      // program compiled here is the one it looks up then (a raw shader's program depends
      // only on its source and defines).
      if (Object.keys(this.output.material.defines ?? {}).length === 0) {
        this.output.material.defines = outputPassDefines(this.renderer);
      }
      this.renderer.setRenderTarget(toBloomBuffer); // the bloom passes draw into render targets
      passes = this.renderer.compileAsync(quads, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    }
    this.renderer.setRenderTarget(null);
    await Promise.all([scene, passes]);
    quad.dispose();
  }

  get bloomEnabled() {
    return this.bloomOn;
  }

  /** MSAA samples for the bloom path (High 4, Ultra 8), clamped to the GPU's maximum. */
  setSamples(samples: number) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const n = Math.min(samples, gl.getParameter(gl.MAX_SAMPLES) as number);
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (target.samples === n) continue;
      target.samples = n;
      target.dispose(); // reallocated with the new sample count on the next frame
    }
  }

  get samples() {
    return this.composer.renderTarget1.samples;
  }

  set bloomEnabled(on: boolean) {
    this.bloomOn = on;
    this.applySize();
  }

  /** CSS pixels; call after any renderer.setPixelRatio change too. */
  setSize(width: number, height: number) {
    this.size = { width, height, applied: false };
    this.applySize();
  }

  private applySize() {
    if (!this.bloomOn || this.size.applied) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.size.width, this.size.height);
    this.size.applied = true;
  }

  render() {
    this.renderer.toneMappingExposure = this.cfg.exposure; // live-tunable in debug mode
    this.basePass.enabled = this.baseOn;
    if (!this.bloomOn) {
      this.renderer.render(this.scene, this.camera);
      if (this.baseOn) {
        // Low: the same second pass, straight to the screen, over the planets' depth.
        const auto = this.renderer.autoClear;
        this.renderer.autoClear = false;
        withLayer(this.camera, BASE_LAYER, () => this.renderer.render(this.scene, this.camera), this.scene, this.baseRoots);
        this.renderer.autoClear = auto;
      }
      return;
    }
    this.bloom.strength = this.cfg.bloomStrength;
    this.bloom.radius = this.cfg.bloomRadius;
    this.bloom.threshold = this.cfg.bloomThreshold;
    this.composer.render();
  }
}

const TONE_MAPPING_DEFINES: Partial<Record<THREE.ToneMapping, string>> = {
  [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING',
  [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
  [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING',
  [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
  [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING',
  [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
  [THREE.CustomToneMapping]: 'CUSTOM_TONE_MAPPING',
};

/** The defines OutputPass sets on its first render (same rules, same order). */
function outputPassDefines(renderer: THREE.WebGLRenderer): Record<string, string> {
  const defines: Record<string, string> = {};
  if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) defines.SRGB_TRANSFER = '';
  const toneMapping = TONE_MAPPING_DEFINES[renderer.toneMapping];
  if (toneMapping) defines[toneMapping] = '';
  return defines;
}

/**
 * Run `draw` with the camera seeing only one layer (lights are filtered by it too). For an
 * overlay pass, set the scene's background colour aside: three.js clears colour and depth for
 * a coloured background on every render, which would wipe the first pass.
 */
function withLayer(camera: THREE.Camera, layer: number, draw: () => void, scene?: THREE.Scene, roots?: THREE.Object3D[]) {
  const mask = camera.layers.mask;
  // Hide the branches with nothing on this layer, so the renderer doesn't walk them (lights stay).
  const hidden: THREE.Object3D[] = [];
  if (scene && roots?.length) for (const c of scene.children) if (c.visible && !(c as THREE.Light).isLight && !roots.includes(c)) (c.visible = false, hidden.push(c));
  const background = scene?.background ?? null;
  const autoUpdate = scene?.matrixWorldAutoUpdate ?? true;
  camera.layers.set(layer);
  if (scene) {
    scene.background = null;
    scene.matrixWorldAutoUpdate = false; // pass 1 just updated every matrix: don't walk the whole scene again
  }
  try {
    draw();
  } finally {
    camera.layers.mask = mask;
    if (scene) {
      scene.background = background;
      scene.matrixWorldAutoUpdate = autoUpdate;
    }
    for (const c of hidden) c.visible = true;
  }
}

/** A RenderPass that draws only one layer (and only that layer's lights). */
class LayerRenderPass extends RenderPass {
  constructor(scene: THREE.Scene, camera: THREE.Camera, private readonly layer: number, private readonly roots: () => THREE.Object3D[]) {
    super(scene, camera);
  }

  override render(...args: Parameters<RenderPass['render']>) {
    withLayer(this.camera, this.layer, () => super.render(...args), this.scene, this.roots());
  }
}
