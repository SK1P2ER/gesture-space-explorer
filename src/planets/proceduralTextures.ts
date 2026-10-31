import * as THREE from 'three';

// Procedural planet textures: generated at startup, so the app stays fully
// offline with no image downloads. Noise is sampled in 3D on the unit sphere,
// so equirectangular maps have no seam and no pinching at the poles.

type RGB = [number, number, number];
type Painter = (p: { x: number; y: number; z: number; lat: number; lon: number }) => [number, number, number, number?];

// ------------------------------------------------------------- noise ----

function hash(x: number, y: number, z: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 3D value noise in [0,1]. */
function noise3(x: number, y: number, z: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

/** Fractal noise in ~[0,1]. */
function fbm(x: number, y: number, z: number, seed: number, octaves = 5) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * freq, y * freq, z * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ----------------------------------------------------------- helpers ----

const hex = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (e0: number, e1: number, v: number) => fade(clamp01((v - e0) / (e1 - e0)));

/** Sample a list of colors as a smooth gradient, t ∈ [0,1]. */
function ramp(colors: RGB[], t: number): RGB {
  const x = clamp01(t) * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(x));
  return mix(colors[i], colors[i + 1], x - i);
}

function paint(width: number, height: number, fn: Painter): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  const d = img.data;
  for (let py = 0; py < height; py++) {
    const lat = Math.PI / 2 - ((py + 0.5) / height) * Math.PI;
    const cl = Math.cos(lat), y = Math.sin(lat);
    for (let px = 0; px < width; px++) {
      const lon = ((px + 0.5) / width) * Math.PI * 2 - Math.PI;
      const [r, g, b, a = 255] = fn({ x: cl * Math.cos(lon), y, z: cl * Math.sin(lon), lat, lon });
      const i = (py * width + px) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.flipY = false; // top row first, like the image textures (see textureLoader.ts)
  return tex;
}

/** Banded gas giant: latitude bands warped by turbulence. */
function bands(colors: RGB[], bandCount: number, turbulence: number, seed: number): Painter {
  return ({ x, y, z, lat }) => {
    const warp = (fbm(x * 3, y * 3, z * 3, seed, 4) - 0.5) * turbulence;
    const t = (Math.sin((lat + warp) * bandCount) + 1) / 2;
    const fine = fbm(x * 12, y * 30, z * 12, seed + 5, 3) * 0.15;
    return [...ramp(colors, clamp01(t * 0.85 + fine)), 255] as [number, number, number, number];
  };
}

/** Elliptical storm (e.g. the Great Red Spot), blended over a painter. */
function withSpot(base: Painter, latDeg: number, lonDeg: number, w: number, h: number, color: RGB, strength = 0.85): Painter {
  const la = THREE.MathUtils.degToRad(latDeg), lo = THREE.MathUtils.degToRad(lonDeg);
  return (p) => {
    const [r, g, b] = base(p);
    const d = Math.hypot((p.lon - lo) / w, (p.lat - la) / h);
    const k = (1 - smooth(0.6, 1, d)) * strength;
    const c = mix([r, g, b], color, k);
    return [c[0], c[1], c[2], 255];
  };
}

// ------------------------------------------------------------ bodies ----

export interface BodyTextures {
  map: THREE.Texture;
  roughnessMap?: THREE.Texture;
  clouds?: THREE.Texture; // density (gray), the alpha map of a slightly larger sphere
}

// Big enough to stay sharp at our closest zoom; ~1.6 s → ~0.9 s total vs 1024×512.
const W = 768, H = 384;

export function makeBodyTextures(id: string): BodyTextures {
  switch (id) {
    case 'sun':
      return {
        map: paint(512, 256, ({ x, y, z }) => {
          const n = fbm(x * 8, y * 8, z * 8, 1, 4);
          const c = ramp([hex(0xff7a00), hex(0xffb020), hex(0xffe27a), hex(0xfff6d0)], n * 1.1);
          return [c[0], c[1], c[2]];
        }),
      };

    case 'mercury':
      return {
        map: paint(512, 256, ({ x, y, z }) => {
          const n = fbm(x * 4, y * 4, z * 4, 2);
          const craters = smooth(0.62, 0.72, noise3(x * 22, y * 22, z * 22, 3)) * 0.35;
          const c = mix(ramp([hex(0x5b5753), hex(0x8f8a84), hex(0xb9b3ab)], n), hex(0x3f3c39), craters);
          return [c[0], c[1], c[2]];
        }),
      };

    case 'venus':
      return {
        map: paint(512, 256, ({ x, y, z, lat }) => {
          const swirl = fbm(x * 2 + Math.sin(lat * 4), y * 6, z * 2, 4, 5);
          const c = ramp([hex(0xb9894a), hex(0xd9b77a), hex(0xf1dcae), hex(0xfaf0d2)], swirl);
          return [c[0], c[1], c[2]];
        }),
      };

    case 'earth': {
      const height = ({ x, y, z }: { x: number; y: number; z: number }) => fbm(x * 1.6, y * 1.6, z * 1.6, 7, 6);
      const map = paint(W, H, (p) => {
        const h = height(p);
        const polar = smooth(1.15, 1.3, Math.abs(p.lat) + (fbm(p.x * 6, p.y * 6, p.z * 6, 8, 3) - 0.5) * 0.3);
        let c: RGB;
        if (h < 0.52) {
          c = ramp([hex(0x0b2a6b), hex(0x14479b), hex(0x2a6fc2)], smooth(0.3, 0.52, h)); // deep → shallow ocean
        } else {
          const dry = fbm(p.x * 5, p.y * 5, p.z * 5, 9, 4) + Math.abs(Math.sin(p.lat * 2)) * 0.2 - Math.abs(p.lat) * 0.3;
          c = mix(ramp([hex(0x2f6b2a), hex(0x4f8a33), hex(0x7a8a3f)], smooth(0.52, 0.7, h)), hex(0xb79a64), smooth(0.55, 0.75, dry));
        }
        c = mix(c, hex(0xf2f6fa), polar);
        return [c[0], c[1], c[2]];
      });
      // Oceans are shiny (sun glint), land and ice are matte.
      const roughnessMap = paint(512, 256, (p) => {
        const v = height(p) < 0.52 && Math.abs(p.lat) < 1.15 ? 90 : 235;
        return [v, v, v];
      });
      roughnessMap.colorSpace = THREE.NoColorSpace;
      // Cloud density as gray levels: used as an alpha map on a white cloud layer.
      const clouds = paint(W, H, ({ x, y, z, lat }) => {
        const n = fbm(x * 3 + Math.sin(lat * 3) * 0.6, y * 5, z * 3, 11, 5);
        const density = smooth(0.5, 0.72, n) * 235;
        return [density, density, density];
      });
      clouds.colorSpace = THREE.NoColorSpace;
      return { map, roughnessMap, clouds };
    }

    case 'mars':
      return {
        map: paint(512, 256, ({ x, y, z, lat }) => {
          const n = fbm(x * 3, y * 3, z * 3, 12);
          const dark = smooth(0.55, 0.7, fbm(x * 2, y * 2, z * 2, 13, 4)) * 0.45;
          let c = mix(ramp([hex(0x7c2e14), hex(0xb5481f), hex(0xd8743f), hex(0xe59a62)], n), hex(0x4a1e10), dark);
          c = mix(c, hex(0xf3ece6), smooth(1.3, 1.4, Math.abs(lat))); // small polar caps
          return [c[0], c[1], c[2]];
        }),
      };

    case 'jupiter':
      return {
        map: paint(
          W,
          H,
          withSpot(
            bands([hex(0x8c5a3c), hex(0xc99b6b), hex(0xf1e4c8), hex(0xd8b48a), hex(0xa8754a)], 9, 0.25, 14),
            -22, 40, 0.28, 0.1, hex(0xb5533c),
          ),
        ),
      };

    case 'saturn':
      return { map: paint(W, H, bands([hex(0xb89a62), hex(0xe3cf9a), hex(0xf2e6c2), hex(0xd2b77e)], 7, 0.1, 15)) };

    case 'uranus':
      return { map: paint(512, 256, bands([hex(0x8fd0da), hex(0xa6e1e6), hex(0xbdeef0)], 4, 0.05, 16)) };

    case 'neptune':
      return {
        map: paint(
          512,
          256,
          withSpot(bands([hex(0x1f3a9e), hex(0x2f55c4), hex(0x4a78e6), hex(0x2a49b0)], 6, 0.2, 17), -20, -30, 0.3, 0.12, hex(0x162a78), 0.7),
        ),
      };

    // Moons (their tint, if any, comes from the material).
    case 'moon':
    case 'callisto':
    case 'ganymede':
      return {
        map: paint(512, 256, ({ x, y, z }) => {
          const n = fbm(x * 3, y * 3, z * 3, id.length);
          const craters = smooth(0.6, 0.72, noise3(x * 26, y * 26, z * 26, 5)) * 0.4;
          const c = mix(ramp([hex(0x4a4743), hex(0x8a8580), hex(0xc4beb6)], n), hex(0xe8e4dc), craters);
          return [c[0], c[1], c[2]];
        }),
      };
    case 'io':
      return {
        map: paint(512, 256, ({ x, y, z }) => {
          const n = fbm(x * 5, y * 5, z * 5, 9);
          const c = ramp([hex(0x8a5a20), hex(0xd8b840), hex(0xf0e080), hex(0xe8f0d0)], n);
          return [c[0], c[1], c[2]];
        }),
      };
    case 'europa':
      return { map: paint(512, 256, ({ x, y, z }) => { const n = fbm(x * 6, y * 6, z * 6, 11) * 60 + 180; return [n, n, n]; }) };
    case 'titan':
      return { map: paint(256, 128, ({ x, y, z }) => { const n = fbm(x * 2, y * 2, z * 2, 13) * 40 + 170; return [n, n, n]; }) };

    default:
      return { map: paint(64, 32, () => [128, 128, 128]) };
  }
}

/** Saturn-style ring: radial bands with a Cassini gap. u = 0 inner edge → 1 outer edge. */
export function makeRingTexture(): THREE.CanvasTexture {
  const w = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, 1);
  for (let i = 0; i < w; i++) {
    const u = i / (w - 1);
    const n = noise3(u * 60, 0, 0, 21) * 0.5 + noise3(u * 200, 0, 0, 22) * 0.25;
    const gap = 1 - (1 - smooth(0.0, 0.025, Math.abs(u - 0.62))) * 0.92; // Cassini division
    const edge = smooth(0, 0.04, u) * smooth(1, 0.9, u);
    const c = mix(hex(0xb9a275), hex(0xeadbb4), n);
    img.data.set([c[0], c[1], c[2], (0.35 + n * 0.6) * gap * edge * 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft radial glow for the Sun's corona (additive sprite). */
export function makeGlowTexture(): THREE.CanvasTexture {
  const s = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  // Deeper oranges than look right untone-mapped: ACES pulls bright colors toward white.
  g.addColorStop(0, 'rgba(255, 190, 90, 0.75)');
  g.addColorStop(0.3, 'rgba(255, 140, 40, 0.28)');
  g.addColorStop(0.6, 'rgba(255, 100, 20, 0.07)');
  g.addColorStop(1, 'rgba(255, 80, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
