import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type UtilityQuality = 'low' | 'high';
export type UtilitySlot = 'hull' | 'hullFlat' | 'dark' | 'window' | 'red' | 'safety' | 'solar';
export type UtilityPart = [UtilitySlot, THREE.BufferGeometry];
/** Box with its base at y, matching Showcase's original construction convention. */
export const utilityBox = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
export const utilityCylinder = (r: number, h: number, segments = 10) => new THREE.CylinderGeometry(r, r, h, segments).translate(0, h / 2, 0);

// Vector stencils share existing material batches; no font/texture/scene-object owner.
const GLYPHS: Readonly<Record<string, string>> = {
  R: '110101110101101', O: '111101101101111', V: '101101101101010',
  P: '110101110100100', W: '101101111111101', C: '011100100100011',
  M: '101111111101101', '-': '000000111000000',
  '0': '111101101101111', '1': '010110010010111',
};

/** Local XZ, facing +Y; caller supplies location or facade rotation. */
export function utilityStencil(identifier: string, size: number) {
  const vertices: number[] = [];
  const width = (identifier.length * 4 - 1) * size;
  [...identifier].forEach((letter, n) => [...GLYPHS[letter]].forEach((pixel, i) => {
    if (pixel !== '1') return;
    const x = -width / 2 + (n * 4 + i % 3) * size, z = (Math.floor(i / 3) - 2.5) * size;
    const e = size * 0.88;
    vertices.push(x, 0, z, x, 0, z + e, x + e, 0, z, x + e, 0, z, x, 0, z + e, x + e, 0, z + e);
  }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(vertices.length / 3 * 2), 2));
  geometry.computeVertexNormals();
  geometry.userData.identifier = identifier;
  return geometry;
}

/** Consume exclusive inputs and conversion temporaries; the returned merge belongs to the caller. */
export function mergeOwned(inputs: THREE.BufferGeometry[]) {
  const parts = inputs.map((source) => {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    return geometry;
  });
  try {
    const merged = mergeGeometries(parts);
    if (!merged) throw new Error('Incompatible utility geometry attributes');
    return merged;
  } finally { for (const geometry of parts) geometry.dispose(); }
}
