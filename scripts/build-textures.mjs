// Builds public/textures/{1k,2k,4k}/ from Solar System Scope (CC BY 4.0) and,
// for the moons Solar System Scope doesn't have, USGS Astrogeology global
// mosaics of NASA mission data (public domain). The sky is NASA's Deep Star
// Maps 2020 (public domain), decoded from HDR (OpenEXR) with three.js.
//
//   npm run textures:build
//     = node scripts/build-textures.mjs .texture-sources --download
//   … --only=io,europa   build just these outputs (by file name, without extension)
//
// Sources are downloaded once into <source-dir> (git-ignored) and reused. The
// USGS mosaics are large GeoTIFFs (115–200 MB each).
//
// Each texture is made from the highest resolution the source offers, resized
// with Lanczos, so all tiers come from the same master. The outputs are
// committed: this only needs to run again to change the set.
// Sources: https://www.solarsystemscope.com/textures/ and
// https://astrogeology.usgs.gov (files at planetarymaps.usgs.gov/mosaic/).
import fs from 'node:fs';
import path from 'node:path';

const SOURCE_URL = 'https://www.solarsystemscope.com/textures/download/';
const USGS_URL = 'https://planetarymaps.usgs.gov/mosaic/';
const SVS_URL = 'https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/';
/** Decoded HDR sources, shared by their tiers (see exrImage). */
const exrCache = new Map();
const OUT = path.resolve('public/textures');
const WIDTH = { '1k': 1024, '2k': 2048, '4k': 4096 };
const ALL = ['1k', '2k', '4k'];
const BASE = ['1k', '2k']; // never needed in 4K (low-frequency maps) or no 4K source

const TEXTURES = [
  { out: 'sun.jpg', src: '8k_sun.jpg', tiers: ALL },
  { out: 'mercury.jpg', src: '8k_mercury.jpg', tiers: ALL },
  { out: 'venus.jpg', src: '4k_venus_atmosphere.jpg', tiers: ALL },
  { out: 'earth_day.jpg', src: '8k_earth_daymap.jpg', tiers: ALL },
  { out: 'earth_night.jpg', src: '8k_earth_nightmap.jpg', tiers: ALL },
  { out: 'earth_clouds.jpg', src: '8k_earth_clouds.jpg', tiers: ALL, gray: true },
  { out: 'earth_normal.jpg', src: '8k_earth_normal_map.tif', tiers: ALL, normal: true },
  // Specular (white = ocean) → roughness: glossy oceans, matte land.
  { out: 'earth_roughness.jpg', src: '8k_earth_specular_map.tif', tiers: BASE, roughness: true },
  { out: 'mars.jpg', src: '8k_mars.jpg', tiers: ALL },
  // The source has no Mars elevation map: derive relief from the color map's luminance.
  { out: 'mars_bump.jpg', src: '8k_mars.jpg', tiers: BASE, bump: true },
  { out: 'jupiter.jpg', src: '8k_jupiter.jpg', tiers: ALL },
  { out: 'saturn.jpg', src: '8k_saturn.jpg', tiers: ALL },
  { out: 'saturn_ring.png', src: '8k_saturn_ring_alpha.png', tiers: BASE, ring: true },
  { out: 'uranus.jpg', src: '2k_uranus.jpg', tiers: BASE },
  { out: 'neptune.jpg', src: '2k_neptune.jpg', tiers: BASE },
  { out: 'moon.jpg', src: '8k_moon.jpg', tiers: ALL },
  // USGS mosaics. Most are centered on 180° (shift180 re-centers them on 0°, like the
  // planet maps), and the gray ones are tinted in the material (bodies.ts textures.tint).
  { out: 'io.jpg', src: 'Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif', usgs: true, tiers: ALL },
  // Their polar gaps (no data = black) are filled from the nearest imaged latitude.
  { out: 'europa.jpg', src: 'Europa_Voyager_GalileoSSI_global_mosaic_500m.tif', usgs: true, tiers: ALL, gray: true, shift180: true, fillGaps: true },
  { out: 'ganymede.jpg', src: 'Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m.tif', usgs: true, tiers: ALL, shift180: true, fillGaps: true },
  { out: 'callisto.jpg', src: 'Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif', usgs: true, tiers: ALL, gray: true, shift180: true, fillGaps: true },
  // Cassini's near-infrared view sees through Titan's haze; flattened, since in visible light the haze hides it.
  // New Horizons saw one hemisphere well; the rest (south of ~30°S, dark in 2015) is filled like the gaps above.
  { out: 'pluto.jpg', src: 'Pluto_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif', usgs: true, tiers: ALL, gray: true, shift180: true, fillGaps: true },
  // The sky: NASA/Goddard SVS Deep Star Maps 2020 (star data ESA/Gaia/DPAC), plate carrée in J2000
  // celestial coordinates, centered on RA 0h with RA increasing to the left (the view from inside).
  { out: 'sky.jpg', src: 'starmap_2020_4k.exr', svs: true, tiers: ['2k', '4k'], exr: true },
  { out: 'titan.jpg', src: 'Titan_ISS_P19658_Mosaic_Global_4km.tif', usgs: true, tiers: BASE, gray: true, shift180: true, flatten: true },
];

const [srcDir, ...flags] = process.argv.slice(2);
const only = flags.find((f) => f.startsWith('--only='))?.slice(7).split(',');
const selected = TEXTURES.filter((t) => !only || only.includes(t.out.replace(/\.\w+$/, '')));
if (!srcDir) {
  console.error('usage: node scripts/build-textures.mjs <source-dir> [--download]');
  process.exit(1);
}

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('sharp is not installed. Run: npm install');
  process.exit(1);
}

fs.mkdirSync(srcDir, { recursive: true });
for (const t of selected) {
  const src = t.src;
  const file = path.join(srcDir, src);
  if (fs.existsSync(file)) continue;
  if (!flags.includes('--download')) {
    console.error(`missing ${file} (pass --download to fetch it)`);
    process.exit(1);
  }
  console.log(`download ${src}`);
  const res = await fetch((t.svs ? SVS_URL : t.usgs ? USGS_URL : SOURCE_URL) + src);
  if (!res.ok || (!t.exr && !res.headers.get('content-type')?.startsWith('image/'))) {
    console.error(`  failed: HTTP ${res.status} ${res.headers.get('content-type')}`);
    process.exit(1);
  }
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

for (const t of selected) {
  for (const tier of t.tiers) {
    const w = WIDTH[tier];
    // The USGS mosaics are bigger than sharp's default pixel limit (Pluto: 310 MP).
    const source = t.exr ? (await exrImage(path.join(srcDir, t.src))).clone() : sharp(path.join(srcDir, t.src), { limitInputPixels: false });
    let img = source.resize(w, t.ring ? 64 : w / 2, { kernel: 'lanczos3', fit: 'fill' });
    if (t.shift180) img = await shiftHalf(img);
    if (t.fillGaps) img = await fillGaps(img);
    if (t.gray) img = img.grayscale();
    if (t.flatten) img = img.linear(0.4, 96); // 40% contrast around mid-gray
    if (t.roughness) img = img.grayscale().linear(-0.5, 230); // spec 255 → 0.40, spec 0 → 0.90
    if (t.bump) img = img.grayscale().normalise().blur(0.6);
    img = t.ring
      ? img.png({ compressionLevel: 9 })
      : img.jpeg({ quality: t.normal ? 92 : 85, mozjpeg: true, chromaSubsampling: t.normal ? '4:4:4' : '4:2:0' });
    const file = path.join(OUT, tier, t.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await img.toFile(file);
    console.log(`${tier}/${t.out}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  }
}

/** Rolls an equirectangular map by half its width: a map centered on 180° becomes centered on 0°. */
async function shiftHalf(img) {
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const row = width * channels;
  const half = (width / 2) * channels;
  const out = Buffer.alloc(data.length);
  for (let y = 0; y < height; y++) {
    const o = y * row;
    data.copy(out, o, o + half, o + row);
    data.copy(out, o + row - half, o, o + half);
  }
  return sharp(out, { raw: { width, height, channels } });
}

/**
 * Mosaics leave unimaged areas black. Each black pixel takes the average color of the
 * nearest row (toward the equator) that has data there, so poles fade to a plain cap.
 */
async function fillGaps(img) {
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const isGap = (i) => {
    for (let c = 0; c < Math.min(channels, 3); c++) if (data[i + c] > 4) return false;
    return true;
  };
  const rowMean = (y) => {
    const sum = new Array(channels).fill(0);
    let n = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (isGap(i)) continue;
      for (let c = 0; c < channels; c++) sum[c] += data[i + c];
      n++;
    }
    return n > width / 4 ? sum.map((v) => Math.round(v / n)) : null;
  };
  const fill = (from, to, step) => {
    let mean = null;
    for (let y = from; y !== to; y += step) {
      mean = rowMean(y) ?? mean;
      if (!mean) continue;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * channels;
        if (isGap(i)) for (let c = 0; c < channels; c++) data[i + c] = mean[c];
      }
    }
  };
  const mid = Math.floor(height / 2);
  fill(mid, height, 1); // equator → south pole
  fill(mid - 1, -1, -1); // equator → north pole
  return sharp(data, { raw: { width, height, channels } });
}


/**
 * An HDR (OpenEXR) map as an 8-bit sRGB image. The star map's values are already 0–1
 * (linear), so this is just the sRGB encoding. three's EXRLoader returns rows bottom
 * first: flipped, so the map is top row first like every other texture here.
 */
async function exrImage(file) {
  if (!exrCache.has(file)) {
    const THREE = await import('three');
    const { EXRLoader } = await import('three/examples/jsm/loaders/EXRLoader.js');
    const buf = fs.readFileSync(file);
    const { width, height, data } = new EXRLoader().setDataType(THREE.FloatType).parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const srgb = (v) => {
      v = Math.min(1, Math.max(0, v));
      return (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
    };
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgb[j] = srgb(data[i]);
      rgb[j + 1] = srgb(data[i + 1]);
      rgb[j + 2] = srgb(data[i + 2]);
    }
    exrCache.set(file, sharp(rgb, { raw: { width, height, channels: 3 } }).flip());
  }
  return exrCache.get(file);
}
