import * as THREE from 'three';

export type LandingSlot = 'metal' | 'dark' | 'safety' | 'guidance';
export type LandingPart = [LandingSlot, THREE.BufferGeometry];
export type LandingQuality = 'low' | 'high';

/** Base-local datum, not the top of the deck: Mission owns the .02 rocket offset. */
export const LANDING_ANCHORS = Object.freeze({
  'LZ-01': { position: [0, 0.015, 0], radius: 0.35 },
  'PAD-CENTER': { position: [0, 0.015, 0], radius: 0 },
  'PAD-PERIMETER': { position: [0, 0.017, 0], radius: 0.35 },
  'DOCK-ANCHOR': { position: [0, 0, 0], radius: 0 },
} as const);

const ring = (inner: number, outer: number, segments: number, y: number, start = 0, arc = Math.PI * 2) =>
  new THREE.RingGeometry(inner, outer, segments, 1, start, arc).rotateX(-Math.PI / 2).translate(0, y, 0);
const box = (w: number, h: number, d: number, x: number, y: number, z: number) =>
  new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Font-free LZ-01 stencil in the existing material batches, facing local +Y. */
function stencil() {
  const glyphs = ['100100100100111', '111001010100111', '000000111000000', '111101101101111', '010110010010111'];
  const positions: number[] = [];
  const size = 0.004;
  glyphs.forEach((glyph, letter) => [...glyph].forEach((pixel, n) => {
    if (pixel !== '1') return;
    const x = (letter * 4 + n % 3 - 9.5) * size;
    const z = 0.234 + (Math.floor(n / 3) - 2.5) * size;
    const e = size * 0.88;
    positions.push(x, 0.0174, z, x, 0.0174, z + e, x + e, 0.0174, z,
      x + e, 0.0174, z, x, 0.0174, z + e, x + e, 0.0174, z + e);
  }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
  geometry.computeVertexNormals();
  geometry.userData.identifier = 'LZ-01';
  return geometry;
}

/**
 * Additive detail, not a replacement deck. The persistent .35 pad/.015 deck and
 * Mission's datum remain unchanged. All new solids fit r <= .35, y <= .018,
 * below the rocket's existing parked/docking envelope. No raised clamps.
 * Every geometry is caller-owned and consumed by LandingPad's material batching.
 */
export function landingPadParts(quality: LandingQuality): LandingPart[] {
  const rich = quality === 'high';
  const segments = rich ? 64 : 32;
  const parts: LandingPart[] = [
    ['metal', ring(0.322, 0.349, segments, 0.016)],
    ['metal', new THREE.CylinderGeometry(0.349, 0.349, 0.012, segments, 1, true).translate(0, 0.007, 0)],
    ['safety', ring(0.28, 0.316, segments, 0.0176)],
    ['dark', ring(0.125, 0.128, segments, 0.016)],
    ['safety', box(0.092, 0.001, 0.029, 0, 0.0163, 0.234)],
    ['dark', stencil()],
  ];
  const panels = rich ? 12 : 6;
  for (let n = 0; n < panels; n++) {
    const a = n * Math.PI * 2 / panels;
    // Separated metal panels expose the original dark deck as radial seams.
    parts.push(['metal', ring(0.13, 0.277, rich ? 5 : 4, 0.0154, a + 0.012, Math.PI * 2 / panels - 0.024)]);
  }
  const stripes = rich ? 24 : 12;
  for (let n = 0; n < stripes; n++) parts.push(['dark', ring(0.281, 0.315, 1, 0.0178, n * Math.PI * 2 / stripes, Math.PI / stripes)]);
  for (let n = 0; n < 4; n++) {
    const a = n * Math.PI / 2;
    // Low-profile alignment bars, inward chevrons and flush service housings.
    parts.push(['guidance', box(0.003, 0.001, 0.062, 0, 0.016, 0.18).rotateY(a)]);
    for (const side of [-1, 1]) parts.push(['safety', box(0.018, 0.001, 0.004, 0, 0, 0).rotateY(side * Math.PI / 4).translate(side * 0.006, 0.0168, 0.147).rotateY(a)]);
    parts.push(['dark', box(0.019, 0.012, 0.012, 0, 0.006, 0.333).rotateY(a)]);
    if (rich) parts.push(['metal', box(0.014, 0.002, 0.008, 0, 0.013, 0.333).rotateY(a)]);
  }
  const lamps = rich ? 16 : 8;
  for (let n = 0; n < lamps; n++) {
    const a = (n + 0.5) * Math.PI * 2 / lamps;
    parts.push(['guidance', box(0.014, 0.002, 0.007, 0, 0.017, 0.338).rotateY(a)]);
  }
  return parts;
}
