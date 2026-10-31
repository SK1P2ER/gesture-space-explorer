import * as THREE from 'three';
import type { Body, BodyTextures, TextureTier } from '../data/bodies';
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
  /** Whether a 4K version exists (when the body's maxTier allows it). */
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

const TIERS: TextureTier[] = ['1k', '2k', '4k'];
/** Width in texels of each tier's maps. */
export const TIER_WIDTH: Record<TextureTier, number> = { '1k': 1024, '2k': 2048, '4k': 4096 };
const minTier = (a: TextureTier, b: TextureTier) => TIERS[Math.min(TIERS.indexOf(a), TIERS.indexOf(b))];

const FADE_SECONDS = 0.6;

/** The image layers a body has. */
export function bodyLayers(body: Body): Layer[] {
  return (Object.keys(LAYERS) as Layer[]).filter((l) => body.textures[l]);
}

/** The tier a layer is really loaded at when `tier` is asked for: 2K-only maps and the body's maxTier cap it. */
export function layerTier(body: Body, layer: Layer, tier: TextureTier): TextureTier {
  return LAYERS[layer].hd ? minTier(tier, body.textures.maxTier) : minTier(tier, '2k');
}

/** The layers that switch to `tier` when the body is seen up close (none if the body has no such tier). */
export function hdLayers(body: Body, tier: TextureTier): Layer[] {
  if (TIERS.indexOf(body.textures.maxTier) < TIERS.indexOf(tier)) return [];
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
  baseState: 'loading' | 'ready' | 'fallback' = 'loading';
  hdLoading = false;

  /**
   * The textures every body keeps are on their way: the first load, or a quality change's swap.
   * During a swap `baseState` stays 'ready' (the old set is still shown), so this is the only sign
   * of one; swaps queue for the shared upload slices, one body after another.
   */
  get baseLoading(): boolean {
    return this.baseRequest !== null;
  }

  private readonly layers: Layer[];
  private readonly next: Partial<Record<Layer, { value: THREE.Texture | null }>> = {};
  private readonly placeholder: Layers = {};
  private base: Layers | null = null;
  private baseTier: TextureTier | null = null;
  /** Base sets replaced by a quality change, disposed once they're no longer on screen. */
  private retired: Layers[] = [];
  /** Up-close textures (4K on High, 2K on Low) and the tier they were loaded at. */
  private hd: { tier: TextureTier; set: Layers } | null = null;
  private hdWanted: TextureTier | null = null;
  private shown: Layers;
  private fadingTo: Layers | null = null;
  private baseGeneration = 0;
  private hdGeneration = 0;
  private baseRequest: AbortController | null = null;
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
  async loadBase(tier: TextureTier) {
    if (this.disposed || tier === this.baseTier || this.baseState === 'fallback') return;
    const generation = ++this.baseGeneration;
    this.baseRequest?.abort();
    const request = this.baseRequest = new AbortController();
    const cancellation = combineTextureSignals(request.signal, this.ctx.uploads.signal);
    const { signal } = cancellation;
    this.baseTier = tier;
    const first = this.base === null;
    let set: Layers;
    try {
      set = await this.loadLayers(this.layers, tier, signal);
      if (signal.aborted || this.disposed || generation !== this.baseGeneration) {
        disposeLayers(set);
        return;
      }
      if (!set.map) {
        disposeLayers(set);
        throw new Error('color map missing');
      }
    } catch (e) {
      if (signal.aborted || this.disposed || generation !== this.baseGeneration) return;
      if (!first) return; // keep the textures we have
      console.warn(`[textures] ${this.body.id}: images unavailable, using procedural textures`, e);
      this.base = this.fallback();
      this.baseState = 'fallback';
      return;
    } finally {
      cancellation.dispose();
      if (this.baseRequest === request) this.baseRequest = null;
    }
    if (this.base) this.retired.push(this.base);
    this.base = set;
    this.baseState = 'ready';
    this.releaseUnused();
  }

  /**
   * After a WebGL context loss: the GPU copies are gone and sliced uploads keep
   * no CPU copy to restore from, so fetch everything again (the browser cache
   * makes that cheap) and fade back in from the placeholders.
   */
  reload() {
    if (this.disposed || this.baseState === 'fallback' || !this.baseTier) return; // procedural canvases restore themselves
    const tier = this.baseTier;
    this.baseRequest?.abort();
    this.hdRequest?.abort();
    this.baseRequest = this.hdRequest = null;
    ++this.baseGeneration;
    ++this.hdGeneration;
    this.hdLoading = false;
    if (this.base) this.retired.push(this.base);
    if (this.hd) this.retired.push(this.hd.set);
    this.base = this.hd = null;
    this.baseTier = null;
    this.shown = this.placeholder; // what's on the GPU now is blank anyway
    this.fadingTo = null;
    this.fade.value = 0;
    for (const l of this.layers) {
      this.bind(l, this.placeholder[l]!);
      this.next[l]!.value = this.placeholder[l]!;
    }
    this.releaseUnused();
    void this.loadBase(tier).then(() => {
      if (this.hdWanted) this.setHd(this.hdWanted);
    });
  }

  /**
   * Asks for the up-close textures at `tier`, or releases them (null).
   * Loading happens in the background; the fade starts once they're on the GPU.
   */
  setHd(tier: TextureTier | null) {
    if (this.disposed) return;
    if (tier !== this.hdWanted) {
      this.hdRequest?.abort();
      this.hdRequest = null;
      ++this.hdGeneration;
      this.hdLoading = false;
    }
    this.hdWanted = tier;
    if (this.hd && tier && this.hd.tier !== tier) {
      this.retired.push(this.hd.set); // from before a quality change
      this.hd = null;
    }
    if (tier && !this.hd && !this.hdLoading && this.baseState === 'ready' && hdLayers(this.body, tier).length) {
      void this.loadHd(tier);
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
    const base = { ...this.placeholder, ...this.base };
    return this.hd && this.hd.tier === this.hdWanted ? { ...base, ...this.hd.set } : base;
  }

  private async loadHd(tier: TextureTier) {
    const generation = ++this.hdGeneration;
    this.hdRequest?.abort();
    const request = this.hdRequest = new AbortController();
    const cancellation = combineTextureSignals(request.signal, this.ctx.uploads.signal);
    const { signal } = cancellation;
    this.hdLoading = true;
    let set: Layers;
    try {
      set = await this.loadLayers(hdLayers(this.body, tier), tier, signal);
    } catch (e) {
      if (!signal.aborted && !this.disposed && generation === this.hdGeneration) console.warn(`[textures] ${this.body.id}:`, e);
      return;
    } finally {
      cancellation.dispose();
      if (generation === this.hdGeneration) this.hdLoading = false;
      if (this.hdRequest === request) this.hdRequest = null;
    }
    if (!signal.aborted && !this.disposed && generation === this.hdGeneration) {
      this.hd = { tier, set };
    } else {
      disposeLayers(set); // this request no longer owns publication
    }
  }

  /** Loads, decodes and uploads layers. A failed layer is left out (its placeholder or 2K version stays). */
  private async loadLayers(layers: Layer[], tier: TextureTier, signal: AbortSignal): Promise<Layers> {
    const results = await Promise.allSettled(
      layers.map(async (layer) => {
        const file = this.body.textures[layer]!;
        const decoded = await loadTexture(file, layerTier(this.body, layer, tier), LAYERS[layer].role, this.ctx.anisotropy, signal);
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
    this.baseRequest?.abort();
    this.hdRequest?.abort();
    this.baseRequest = this.hdRequest = null;
    ++this.baseGeneration;
    ++this.hdGeneration;
    this.hdLoading = false;
    this.fade.value = 0;
    for (const layer of this.layers) {
      this.bind(layer, null);
      this.next[layer]!.value = null;
    }
    const textures = new Set<THREE.Texture>();
    for (const set of [this.placeholder, this.base, this.hd?.set, ...this.retired]) {
      if (set) for (const texture of Object.values(set)) textures.add(texture);
    }
    this.base = this.hd = this.fadingTo = null;
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
