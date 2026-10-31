import * as THREE from 'three';
import { TUNNEL_RADIUS } from '../../data/baseLayout';

export type HabitatSlot = 'hull' | 'hullFlat' | 'dark' | 'window' | 'red' | 'safety';
export type HabitatPart = [HabitatSlot, THREE.BufferGeometry];
export interface HabitatIdentity {
  readonly identifier: string;
  /** Stable semantic role; a future inspector can localize its display name. */
  readonly role: 'habitat' | 'command' | 'laboratory';
}
export const HABITAT_IDENTITIES: Readonly<Record<string, HabitatIdentity>> = Object.freeze({
  habA: Object.freeze({ identifier: 'HAB-01', role: 'habitat' }),
  habB: Object.freeze({ identifier: 'CMD-01', role: 'command' }),
  habC: Object.freeze({ identifier: 'LAB-01', role: 'laboratory' }),
});

export interface HabitatOptions {
  quality: 'low' | 'high';
  identifier: string;
  /** Port headings about local Y, measured from +Z toward +X. */
  ports: readonly number[];
}

// Tiny 3×5 vector lettering: no font downloads, CanvasTexture, per-label material,
// or extra scene objects. Dark pixel quads remain legible even where the rounded
// roof protrudes through the off-white hatch backing; both use existing batches.
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  H: ['101', '101', '111', '101', '101'], A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'], C: ['011', '100', '100', '100', '011'],
  M: ['101', '111', '111', '101', '101'], D: ['110', '101', '101', '101', '110'],
  L: ['100', '100', '100', '100', '111'], '-': ['000', '000', '111', '000', '000'],
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
};

function identifierGeometry(text: string) {
  const positions: number[] = [];
  const size = 0.0032;
  const width = (text.length * 4 - 1) * size;
  [...text].forEach((letter, n) => GLYPHS[letter]?.forEach((row, j) => [...row].forEach((pixel, i) => {
    if (pixel !== '1') return;
    const x = -width / 2 + (n * 4 + i) * size;
    const z = (j - 2.5) * size;
    const edge = size * 0.9;
    positions.push(x, 0.13, z, x, 0.13, z + edge, x + edge, 0.13, z,
      x + edge, 0.13, z, x, 0.13, z + edge, x + edge, 0.13, z + edge);
  })));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.userData.text = text;
  return geometry;
}

function feature(geometry: THREE.BufferGeometry, name: string) {
  geometry.userData.feature = name;
  return geometry;
}

/**
 * Module-local parts (Y up), within the original .163 outer band / .13 height.
 * Every returned geometry is exclusive to the caller: batching transforms it in
 * place, so geometry is not cached/shared across habitats. Materials are supplied
 * and shared by Showcase; this factory allocates no material or texture.
 */
export function habitatParts({ quality, identifier, ports }: HabitatOptions): HabitatPart[] {
  const rich = quality === 'high';
  const profile = [new THREE.Vector2(0, 0), new THREE.Vector2(0.16, 0), new THREE.Vector2(0.16, 0.05)];
  const steps = rich ? 8 : 5;
  const segments = rich ? 28 : 14;
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    profile.push(new THREE.Vector2(0.16 * Math.cos(a), 0.05 + 0.08 * Math.sin(a)));
  }
  const accent: HabitatSlot = rich ? 'safety' : 'red';
  const parts: HabitatPart[] = [
    ['hull', feature(new THREE.LatheGeometry(profile, segments), 'shell')],
    ['dark', feature(new THREE.CylinderGeometry(0.163, 0.163, 0.014, segments, 1, true).translate(0, 0.045, 0), 'foundation')],
    ['window', new THREE.BoxGeometry(0.05, 0.016, 0.01).translate(0, 0.075, 0.148)],
    ['window', new THREE.BoxGeometry(0.05, 0.016, 0.01).rotateY(Math.PI).translate(0, 0.075, -0.148)],
    ['dark', new THREE.BoxGeometry(0.059, 0.024, 0.008).translate(0, 0.075, 0.146)],
    ['dark', new THREE.BoxGeometry(0.059, 0.024, 0.008).translate(0, 0.075, -0.146)],
    [accent, feature(new THREE.TorusGeometry(0.1614, 0.0014, 3, segments).rotateX(Math.PI / 2).translate(0, 0.052, 0), 'seam')],
    ['hullFlat', new THREE.BoxGeometry(0.078, 0.003, 0.023).translate(0, 0.1275, 0)],
    ['dark', feature(identifierGeometry(identifier), 'identifier')],
    [accent, new THREE.BoxGeometry(0.078, 0.001, 0.003).translate(0, 0.129, 0.012)],
  ];
  // Meridional ribs follow the same elliptical dome; stop below the roof hatch.
  for (let n = 0; n < (rich ? 8 : 4); n++) {
    const azimuth = n * Math.PI * 2 / (rich ? 8 : 4);
    const points = Array.from({ length: rich ? 9 : 5 }, (_, i) => {
      const a = i / (rich ? 8 : 4) * 1.25;
      const r = 0.16 * Math.cos(a);
      return new THREE.Vector3(r * Math.sin(azimuth), 0.05 + 0.08 * Math.sin(a), r * Math.cos(azimuth));
    });
    parts.push(['dark', feature(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), rich ? 10 : 5, 0.0012, rich ? 4 : 3, false), 'rib')]);
  }
  // The entry frame and actual corridor connection ports use the same owned
  // geometry recipe. Ports remain inside the pre-existing circular exclusion.
  for (const heading of new Set([Math.PI, ...ports])) {
    const door = new THREE.CylinderGeometry(0.0225, 0.0225, 0.004, rich ? 16 : 8).rotateX(Math.PI / 2).translate(0, 0.035, 0.1555).rotateY(heading);
    const ring = new THREE.TorusGeometry(0.0265, 0.0015, rich ? 4 : 3, rich ? 16 : 8).translate(0, 0.035, 0.158).rotateY(heading);
    parts.push(['dark', feature(door, 'port')], [accent, feature(ring, 'port')]);
  }
  return parts;
}

/** Local X is the corridor axis. Keep the original .035 swept radius and endpoints. */
export function corridorParts(length: number, quality: 'low' | 'high'): HabitatPart[] {
  const rich = quality === 'high';
  const parts: HabitatPart[] = [['hull', new THREE.CylinderGeometry(0.031, 0.031, length, rich ? 12 : 8, 1, true).rotateZ(Math.PI / 2).translate(0, TUNNEL_RADIUS, 0)]];
  const count = rich ? 7 : 3;
  for (let n = 0; n < count; n++) {
    const x = (n / (count - 1) - 0.5) * (length - 0.003);
    const ring = new THREE.TorusGeometry(TUNNEL_RADIUS - 0.0015, 0.0015, rich ? 4 : 3, rich ? 12 : 8).rotateY(Math.PI / 2).translate(x, TUNNEL_RADIUS, 0);
    parts.push([n === Math.floor(count / 2) ? (rich ? 'safety' : 'red') : 'dark', feature(ring, 'collar')]);
  }
  return parts;
}
