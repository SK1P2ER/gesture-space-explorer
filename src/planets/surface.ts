import * as THREE from 'three';
import type { Body, BodyTextures, TextureSize } from '../data/bodies';
import { patchShader, replaceOnce } from './shaderPatch';
import { combineTextureSignals, disposeTexture, loadTexture, solidTexture, type TextureRole, type UploadQueue } from './textureLoader';

export interface TextureContext {
  uploads: UploadQueue;
  anisotropy: number;
}

/** Which materials a body's textures go into. */
export interface SurfaceMaterials {
  surface: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
  clouds?: THREE.MeshStandardMaterial;
  ring?: THREE.MeshStandardMaterial;
}

type Slot = 'map' | 'normalMap' | 'bumpMap' | 'emissiveMap' | 'roughnessMap' | 'alphaMap';

interface LayerSpec {
  material: keyof SurfaceMaterials;
  slot: Slot;
  role: TextureRole;
  /** Whether a 4K version exists (when the body's maxSize allows it). */
  hd: boolean;
  /** Shown until the image arrives; RGBA bytes. */
  placeholder: (body: Body) => [number, number, number, number];
}

const LAYERS = {
  map: {
    material: 'surface',
    slot: 'map',
    role: 'color',
    hd: true,
    // A tinted map gets white: the material's color already supplies the tint.
    placeholder: (b) => (b.textures.tint ? [255, 255, 255, 255] : [(b.color >> 16) & 255, (b.color >> 8) & 255, b.color & 255, 255]),
  },
  normal: { material: 'surface', slot: 'normalMap', role: 'data', hd: true, placeholder: () => [128, 128, 255, 255] },
  bump: { material: 'surface', slot: 'bumpMap', role: 'data', hd: false, placeholder: () => [0, 0, 0, 255] },
  night: { material: 'surface', slot: 'emissiveMap', role: 'color', hd: true, placeholder: () => [0, 0, 0, 255] },
  roughness: { material: 'surface', slot: 'roughnessMap', role: 'data', hd: false, placeholder: () => [230, 230, 230, 255] },
  clouds: { material: 'clouds', slot: 'alphaMap', role: 'data', hd: true, placeholder: () => [0, 0, 0, 255] },
  ring: { material: 'ring', slot: 'map', role: 'color', hd: false, placeholder: () => [0, 0, 0, 0] },
} satisfies Record<string, LayerSpec>;

export type Layer = keyof typeof LAYERS & keyof BodyTextures;
export type Layers = Partial<Record<Layer, THREE.Texture>>;

const SIZES: TextureSize[] = ['1k', '2k', '4k'];
/** Width in texels of each size's maps. */
export const TEXTURE_WIDTH: Record<TextureSize, number> = { '1k': 1024, '2k': 2048, '4k': 4096 };
const smallerSize = (a: TextureSize, b: TextureSize) => SIZES[Math.min(SIZES.indexOf(a), SIZES.indexOf(b))];

const FADE_SECONDS = 0.6;

/** The image layers a body has. */
export function bodyLayers(body: Body): Layer[] {
  return (Object.keys(LAYERS) as Layer[]).filter((l) => body.textures[l]);
}

/** The size a layer is really loaded at when `size` is asked for: 2K-only maps and the body's maxSize cap it. */
export function layerSize(body: Body, layer: Layer, size: TextureSize): TextureSize {
  return LAYERS[layer].hd ? smallerSize(size, body.textures.maxSize) : smallerSize(size, '2k');
}

/** The layers that switch to `size` when the body is seen up close (none if the body has no such size). */
export function hdLayers(body: Body, size: TextureSize): Layer[] {
  if (SIZES.indexOf(body.textures.maxSize) < SIZES.indexOf(size)) return [];
  return bodyLayers(body).filter((l) => LAYERS[l].hd);
}

/**
 * A body's textures. Every change — placeholder → 2K on load, 2K ⇄ 4K on
 * zoom — cross-fades in the shader instead of popping, and textures that are
 * no longer shown are disposed.
 *
 * How the fade works: each slot (e.g. `map`) gets a twin (`mapNext`) and the
 * shader shows mix(slot, twin, fade). A change binds the new texture to the
 * twin and animates fade 0 → 1; then it moves into the slot and fade resets
 * to 0, which looks identical.
 */
export class PlanetSurface {
  readonly fade = { value: 0 };
  standardState: 'loading' | 'ready' | 'fallback' = 'loading';
  hdLoading = false;

  /**
   * The textures every body keeps are on their way: the first load, or a quality change's swap.
   * During a swap `standardState` stays 'ready' (the old set is still shown), so this is the only sign
   * of one; swaps queue for the shared upload slices, one body after another.
   */
  get standardLoading(): boolean {
    return this.standardRequest !== null;
  }

  private readonly layers: Layer[];
  private readonly next: Partial<Record<Layer, { value: THREE.Texture | null }>> = {};
  private readonly placeholder: Layers = {};
  private standard: Layers | null = null;
  private standardSize: TextureSize | null = null;
  /** Standard sets replaced by a quality change, disposed once they're no longer on screen. */
  private retired: Layers[] = [];
  /** Up-close textures (4K on High, 2K on Low) and the size they were loaded at. */
  private hd: { size: TextureSize; set: Layers } | null = null;
  private hdWanted: TextureSize | null = null;
  private shown: Layers;
  private fadingTo: Layers | null = null;
  private standardGeneration = 0;
  private hdGeneration = 0;
  private standardRequest: AbortController | null = null;
  private hdRequest: AbortController | null = null;
  private disposed = false;

  constructor(
    private readonly body: Body,
    private readonly materials: SurfaceMaterials,
    private readonly ctx: TextureContext,
    /** Procedural textures, used when the images can't be loaded (e.g. offline without them). */
    private readonly fallback: () => Layers,
  ) {
    this.layers = bodyLayers(body).filter((l) => materials[LAYERS[l].material]);
    for (const layer of this.layers) {
      const spec: LayerSpec = LAYERS[layer];
      const texture = solidTexture(spec.placeholder(body), spec.role);
      this.placeholder[layer] = texture;
      this.bind(layer, texture);
      this.next[layer] = { value: texture };
    }
    this.shown = this.placeholder;
    for (const name of Object.keys(materials) as (keyof SurfaceMaterials)[]) {
      const material = materials[name];
      const layers = this.layers.filter((l) => LAYERS[l].material === name);
      if (material && layers.length) {
        addCrossFade(material, layers.map((l) => LAYERS[l].slot), this.fade, layers.map((l) => this.next[l]!));
      }
    }
  }

  /** Loads (or, on a quality change, swaps to) the textures every body keeps; the swap cross-fades too. */
  async loadStandard(size: TextureSize) {
    if (this.disposed || size === this.standardSize || this.standardState === 'fallback') return;
    const generation = ++this.standardGeneration;
    this.standardRequest?.abort();
    const request = this.standardRequest = new AbortController();
    const cancellation = combineTextureSignals(request.signal, this.ctx.uploads.signal);
    const { signal } = cancellation;
    this.standardSize = size;
    const first = this.standard === null;
    let set: Layers;
    try {
      set = await this.loadLayers(this.layers, size, signal);
      if (signal.aborted || this.disposed || generation !== this.standardGeneration) {
        disposeLayers(set);
        return;
      }
      if (!set.map) {
        disposeLayers(set);
        throw new Error('color map missing');
      }
    } catch (e) {
      if (signal.aborted || this.disposed || generation !== this.standardGeneration) return;
      if (!first) return; // keep the textures we have
      console.warn(`[textures] ${this.body.id}: images unavailable, using procedural textures`, e);
      this.standard = this.fallback();
      this.standardState = 'fallback';
      return;
    } finally {
      cancellation.dispose();
      if (this.standardRequest === request) this.standardRequest = null;
    }
    if (this.standard) this.retired.push(this.standard);
    this.standard = set;
    this.standardState = 'ready';
    this.releaseUnused();
  }

  /**
   * After a WebGL context loss: the GPU copies are gone and sliced uploads keep
   * no CPU copy to restore from, so fetch everything again (the browser cache
   * makes that cheap) and fade back in from the placeholders.
   */
  reload() {
    if (this.disposed || this.standardState === 'fallback' || !this.standardSize) return; // procedural canvases restore themselves
    const size = this.standardSize;
    this.standardRequest?.abort();
    this.hdRequest?.abort();
    this.standardRequest = this.hdRequest = null;
    ++this.standardGeneration;
    ++this.hdGeneration;
    this.hdLoading = false;
    if (this.standard) this.retired.push(this.standard);
    if (this.hd) this.retired.push(this.hd.set);
    this.standard = this.hd = null;
    this.standardSize = null;
    this.shown = this.placeholder; // what's on the GPU now is blank anyway
    this.fadingTo = null;
    this.fade.value = 0;
    for (const l of this.layers) {
      this.bind(l, this.placeholder[l]!);
      this.next[l]!.value = this.placeholder[l]!;
    }
    this.releaseUnused();
    void this.loadStandard(size).then(() => {
      if (this.hdWanted) this.setHd(this.hdWanted);
    });
  }

  /**
   * Asks for the up-close textures at `size`, or releases them (null).
   * Loading happens in the background; the fade starts once they're on the GPU.
   */
  setHd(size: TextureSize | null) {
    if (this.disposed) return;
    if (size !== this.hdWanted) {
      this.hdRequest?.abort();
      this.hdRequest = null;
      ++this.hdGeneration;
      this.hdLoading = false;
    }
    this.hdWanted = size;
    if (this.hd && size && this.hd.size !== size) {
      this.retired.push(this.hd.set); // from before a quality change
      this.hd = null;
    }
    if (size && !this.hd && !this.hdLoading && this.standardState === 'ready' && hdLayers(this.body, size).length) {
      void this.loadHd(size);
    }
    this.releaseUnused();
  }

  /** Advances the cross-fade; call every frame with real (not simulated) time. */
  update(dt: number) {
    if (this.disposed) return;
    if (!this.fadingTo) {
      const goal = this.goal();
      if (this.layers.every((l) => goal[l] === this.shown[l])) return;
      this.fadingTo = goal;
      for (const l of this.layers) this.next[l]!.value = goal[l]!;
    }
    this.fade.value = Math.min(1, this.fade.value + dt / FADE_SECONDS);
    if (this.fade.value < 1) return;
    this.shown = this.fadingTo;
    this.fadingTo = null;
    for (const l of this.layers) this.bind(l, this.shown[l]!);
    this.fade.value = 0;
    this.releaseUnused();
  }

  private goal(): Layers {
    const standard = { ...this.placeholder, ...this.standard };
    return this.hd && this.hd.size === this.hdWanted ? { ...standard, ...this.hd.set } : standard;
  }

  private async loadHd(size: TextureSize) {
    const generation = ++this.hdGeneration;
    this.hdRequest?.abort();
    const request = this.hdRequest = new AbortController();
    const cancellation = combineTextureSignals(request.signal, this.ctx.uploads.signal);
    const { signal } = cancellation;
    this.hdLoading = true;
    let set: Layers;
    try {
      set = await this.loadLayers(hdLayers(this.body, size), size, signal);
    } catch (e) {
      if (!signal.aborted && !this.disposed && generation === this.hdGeneration) console.warn(`[textures] ${this.body.id}:`, e);
      return;
    } finally {
      cancellation.dispose();
      if (generation === this.hdGeneration) this.hdLoading = false;
      if (this.hdRequest === request) this.hdRequest = null;
    }
    if (!signal.aborted && !this.disposed && generation === this.hdGeneration) {
      this.hd = { size, set };
    } else {
      disposeLayers(set); // this request no longer owns publication
    }
  }

  /** Loads, decodes and uploads layers. A failed layer is left out (its placeholder or 2K version stays). */
  private async loadLayers(layers: Layer[], size: TextureSize, signal: AbortSignal): Promise<Layers> {
    const results = await Promise.allSettled(
      layers.map(async (layer) => {
        const file = this.body.textures[layer]!;
        const decoded = await loadTexture(file, layerSize(this.body, layer, size), LAYERS[layer].role, this.ctx.anisotropy, signal);
        if (signal.aborted) {
          disposeTexture(decoded);
          signal.throwIfAborted();
        }
        // upload owns decoded from this point, including on rejection.
        return [layer, await this.ctx.uploads.upload(decoded, { signal })] as const;
      }),
    );
    const set: Layers = {};
    for (const r of results) {
      if (r.status === 'fulfilled') set[r.value[0]] = r.value[1];
      else if (!signal.aborted) console.warn(`[textures] ${this.body.id}:`, r.reason);
    }
    if (signal.aborted) {
      disposeLayers(set);
      signal.throwIfAborted();
    }
    return set;
  }

  /** Disposes textures that are no longer wanted once they're neither shown nor fading. */
  private releaseUnused() {
    const inUse = (set: Layers) =>
      this.layers.some((l) => set[l] && (this.shown[l] === set[l] || this.fadingTo?.[l] === set[l]));
    if (this.hd && !this.hdWanted && !inUse(this.hd.set)) {
      disposeLayers(this.hd.set);
      this.hd = null;
    }
    this.retired = this.retired.filter((set) => {
      if (inUse(set)) return true;
      disposeLayers(set);
      return false;
    });
  }

  /** Terminal teardown: detach borrowed sampler references before freeing owned layers. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.standardRequest?.abort();
    this.hdRequest?.abort();
    this.standardRequest = this.hdRequest = null;
    ++this.standardGeneration;
    ++this.hdGeneration;
    this.hdLoading = false;
    this.fade.value = 0;
    for (const layer of this.layers) {
      this.bind(layer, null);
      this.next[layer]!.value = null;
    }
    const textures = new Set<THREE.Texture>();
    for (const set of [this.placeholder, this.standard, this.hd?.set, ...this.retired]) {
      if (set) for (const texture of Object.values(set)) textures.add(texture);
    }
    this.standard = this.hd = this.fadingTo = null;
    this.retired = [];
    this.shown = {};
    for (const layer of this.layers) delete this.placeholder[layer];
    for (const texture of textures) disposeTexture(texture);
  }

  private bind(layer: Layer, texture: THREE.Texture | null) {
    const spec: LayerSpec = LAYERS[layer];
    (this.materials[spec.material] as unknown as Record<Slot, THREE.Texture | null>)[spec.slot] = texture;
    // (Every slot is filled from construction on, so this never changes the shader.)
  }
}

function disposeLayers(set: Layers) {
  for (const texture of Object.values(set)) disposeTexture(texture);
}

/** Makes the listed texture slots sample mix(slot, slotNext, fade). */
function addCrossFade(material: THREE.Material, slots: Slot[], fade: { value: number }, next: { value: THREE.Texture | null }[]) {
  patchShader(material, `fade:${slots.join(',')}`, (shader) => {
    shader.uniforms.texFade = fade;
    let fs = shader.fragmentShader;
    slots.forEach((slot, i) => {
      shader.uniforms[`${slot}Next`] = next[i];
      fs = fs.replace(new RegExp(`texture2D\\(\\s*${slot}\\s*,`, 'g'), `fadeSample_${slot}(`);
      fs = replaceOnce(
        fs,
        `uniform sampler2D ${slot};`,
        `uniform sampler2D ${slot};
        uniform sampler2D ${slot}Next;
        vec4 fadeSample_${slot}(vec2 uv) { return mix(texture2D(${slot}, uv), texture2D(${slot}Next, uv), texFade); }`,
      );
    });
    shader.fragmentShader = 'uniform float texFade;\n' + fs;
  });
}
