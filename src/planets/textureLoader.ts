import * as THREE from 'three';
import type { TextureTier } from '../data/bodies';

const ROOT = `${import.meta.env.BASE_URL}textures/`;

// createImageBitmap decodes on a background thread, so even a 4K image never
// stalls a frame — or the hand tracker, which shares the main thread. Older
// Safari / Firefox ignore the decode options we rely on; they go through <img>.
const ua = navigator.userAgent;
const safari = /^((?!chrome|chromium|android).)*safari/i.test(ua) ? Number(/version\/(\d+)/i.exec(ua)?.[1] ?? 0) : Infinity;
const firefox = Number(/firefox\/(\d+)/i.exec(ua)?.[1] ?? Infinity);
const useImageBitmap = typeof createImageBitmap === 'function' && safari >= 17 && firefox >= 98;

// All planet textures are stored top row first (flipY = false), unlike three's
// default: flipping ImageBitmaps while decoding stalls frames and WebGL can't
// flip them on upload, so instead the sphere's UVs run north → south.

/** color → sRGB-decoded on the GPU; data (normal, bump, roughness, alpha) → used as-is. */
export type TextureRole = 'color' | 'data';

/** Combines request and context cancellation without requiring AbortSignal.any. */
export function combineTextureSignals(...signals: (AbortSignal | undefined)[]): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const listeners: { signal: AbortSignal; abort: () => void }[] = [];
  const dispose = () => {
    for (const { signal, abort } of listeners) signal.removeEventListener('abort', abort);
    listeners.length = 0;
  };
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      dispose();
      break;
    }
    const abort = () => {
      controller.abort(signal.reason);
      dispose();
    };
    signal.addEventListener('abort', abort, { once: true });
    listeners.push({ signal, abort });
  }
  return { signal: controller.signal, dispose };
}

export async function loadTexture(
  file: string,
  tier: TextureTier,
  role: TextureRole,
  anisotropy: number,
  signal?: AbortSignal,
): Promise<THREE.Texture> {
  const url = `${ROOT}${tier}/${file}`;
  let texture: THREE.Texture | undefined;
  let bitmap: ImageBitmap | undefined;
  try {
    signal?.throwIfAborted();
    if (useImageBitmap) {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const blob = await res.blob();
      signal?.throwIfAborted();
      // No imageOrientation: 'flipY' here — in Chrome it costs 15–20 ms frames
      // while decoding (measured). Images stay top row first, see above.
      bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      signal?.throwIfAborted(); // decoding itself cannot be aborted; release a late bitmap below
      texture = new THREE.Texture(bitmap);
    } else {
      texture = await new THREE.TextureLoader().loadAsync(url);
      signal?.throwIfAborted();
    }
    texture.flipY = false;
    texture.colorSpace = role === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = anisotropy;
    texture.needsUpdate = true;
    return texture;
  } catch (error) {
    if (texture) disposeTexture(texture);
    else bitmap?.close();
    throw error;
  }
}

/** Frees the GPU copy and, for ImageBitmaps, the decoded pixels too. */
export function disposeTexture(texture: THREE.Texture) {
  texture.dispose();
  const image: unknown = texture.image;
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
}

/** 1×1 stand-in, so a material's texture slots exist (and its shader never recompiles) before images arrive. */
export function solidTexture(rgba: [number, number, number, number], role: TextureRole): THREE.Texture {
  const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
  texture.colorSpace = role === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// Upload budget per frame. One 4K texture is 32 MB and takes ~30 ms to upload
// in one call (measured, desktop Chrome) — a visible hitch, and a late frame
// for the hand tracker. 2 MB slices cost ~2 ms each.
const MAX_BYTES_PER_FRAME = 2 * 1024 * 1024;

function waitForTurn(turn: Promise<unknown>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    turn.then(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    });
  });
}

function nextFrame(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      cancelAnimationFrame(frame);
      reject(signal.reason);
    };
    const frame = requestAnimationFrame(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    });
    signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Moves decoded textures onto the GPU, spread over frames: at most one
 * texture — or one horizontal slice of a big one — per frame.
 */
export class UploadQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private context = new AbortController();

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  /** Capture with each decode request so work from an old context cannot upload after restore. */
  get signal(): AbortSignal { return this.context.signal; }

  /** Context loss invalidates pending work immediately, including frame waits. */
  suspend() { this.context.abort(); }

  /** A restored context accepts new work; aborted requests stay invalid. */
  resume() {
    if (this.context.signal.aborted) this.context = new AbortController();
  }

  /**
   * Takes ownership of the input immediately, including on cancellation/error.
   * Success transfers ownership of the returned texture to the caller; a sliced
   * upload consumes and releases its decoded input.
   * @param mipmaps false for a texture that's never shown smaller than it is (the sky): 25% less memory
   */
  upload(texture: THREE.Texture, { mipmaps = true, signal }: { mipmaps?: boolean; signal?: AbortSignal } = {}): Promise<THREE.Texture> {
    const cancellation = combineTextureSignals(this.signal, signal);
    const turn = this.tail;
    const done = this.run(texture, mipmaps, cancellation.signal, turn).finally(cancellation.dispose);
    // A queued cancellation can finish before its predecessor. Keep that
    // predecessor in the tail so later jobs still upload one at a time.
    this.tail = Promise.all([turn, done.catch(() => {})]);
    return done;
  }

  private async run(source: THREE.Texture, mipmaps: boolean, signal: AbortSignal, turn: Promise<unknown>): Promise<THREE.Texture> {
    let target: THREE.DataTexture | undefined;
    try {
      await waitForTurn(turn, signal);
      signal.throwIfAborted();
      const image: unknown = source.image;
      const isBitmap = typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap;
      const rowsPerSlice = isBitmap ? Math.max(1, Math.floor(MAX_BYTES_PER_FRAME / (image.width * 4))) : Infinity;
      await nextFrame(signal);
      signal.throwIfAborted();
      if (!mipmaps) {
        source.generateMipmaps = false;
        source.minFilter = THREE.LinearFilter;
      }
      if (!isBitmap || rowsPerSlice >= image.height) {
        this.renderer.initTexture(source);
        signal.throwIfAborted();
        return source;
      }

      // Allocate the full texture (all mip levels) without data, then fill it
      // slice by slice straight from the decoded bitmap.
      const { width, height } = image;
      target = new THREE.DataTexture(null, width, height);
      target.source.dataReady = false;
      target.colorSpace = source.colorSpace;
      target.anisotropy = source.anisotropy;
      target.wrapS = source.wrapS;
      target.wrapT = source.wrapT;
      target.magFilter = THREE.LinearFilter;
      target.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      target.generateMipmaps = mipmaps; // so the storage gets every mip level
      target.needsUpdate = true;
      this.renderer.initTexture(target);
      signal.throwIfAborted();

      const region = new THREE.Box2();
      const position = new THREE.Vector2();
      for (let y = 0; y < height; y += rowsPerSlice) {
        if (y > 0) await nextFrame(signal);
        signal.throwIfAborted();
        const last = y + rowsPerSlice >= height;
        region.min.set(0, y);
        region.max.set(width, Math.min(height, y + rowsPerSlice));
        position.set(0, y);
        target.generateMipmaps = mipmaps && last; // build the mip chain once, after the last slice
        this.renderer.copyTextureToTexture(source, target, region, position);
        signal.throwIfAborted();
      }
      target.generateMipmaps = mipmaps;
    } catch (error) {
      if (target) disposeTexture(target);
      disposeTexture(source);
      throw error;
    }
    disposeTexture(source);
    return target;
  }
}
