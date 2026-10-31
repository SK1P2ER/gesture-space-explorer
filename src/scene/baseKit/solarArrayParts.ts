import * as THREE from 'three';
import { PANEL, solarFieldSize, type Module } from '../../data/baseLayout';
import { mergeOwned, utilityBox as box, utilityCylinder, utilityStencil, type UtilityQuality, type UtilityPart } from './utilityGeometry';

function tinted(geometry: THREE.BufferGeometry, hex: number, constantUv = false) {
  const c = new THREE.Color(hex), count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let n = 0; n < count; n++) colors.set([c.r, c.g, c.b], n * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (constantUv) {
    const uv = geometry.getAttribute('uv');
    for (let n = 0; n < uv.count; n++) uv.setXY(n, 0.07, 0.07);
  }
  return geometry;
}

const face = (w: number, d: number, x: number, z: number, y: number) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, y, z);

/** One coloured instance batch: frames/cells follow the existing tracker without extra meshes. */
export function solarPanelGeometry(quality: UtilityQuality) {
  const rich = quality === 'high';
  const parts = [tinted(new THREE.BoxGeometry(PANEL.w, 0.0057, PANEL.d).translate(0, -0.00015, 0), 0x34558f)];
  for (const x of [-0.058, 0.058]) parts.push(tinted(rich ? new THREE.BoxGeometry(0.004, 0.006, 0.08).translate(x, 0, 0) : face(0.004, 0.08, x, 0, 0.003), 0xb8bcc4, true));
  for (const z of [-0.038, 0.038]) parts.push(tinted(rich ? new THREE.BoxGeometry(0.112, 0.006, 0.004).translate(0, 0, z) : face(0.112, 0.004, 0, z, 0.003), 0xb8bcc4, true));
  const cols = rich ? 6 : 3, rows = rich ? 4 : 2;
  for (let n = 1; n < cols; n++) parts.push(tinted(face(0.0008, 0.072, -0.056 + n * 0.112 / cols, 0, 0.0029), 0x16263f, true));
  for (let n = 1; n < rows; n++) parts.push(tinted(face(0.112, 0.0008, 0, -0.036 + n * 0.072 / rows, 0.0029), 0x16263f, true));
  return mergeOwned(parts);
}

export function solarSupportGeometry(quality: UtilityQuality) {
  const parts = [utilityCylinder(0.005, 0.05, quality === 'high' ? 8 : 5), box(0.006, 0.004, 0.07, 0, 0.04)];
  if (quality === 'high') for (const z of [-0.031, 0.031]) parts.push(new THREE.CylinderGeometry(0.004, 0.004, 0.006, 6).rotateX(Math.PI / 2).translate(0, 0.038, z));
  return mergeOwned(parts);
}

/** Power equipment fits the first existing inter-row gap; panel sites/counts are untouched. */
export function solarArrayParts(module: Module, quality: UtilityQuality): UtilityPart[] {
  const { w, d } = solarFieldSize(module);
  // No inter-row gap exists in a one-row field: don't invent an external footprint.
  if ((module.rows ?? 4) < 2) return [];
  const z = -d / 2 + PANEL.d + PANEL.gapZ / 2;
  const parts: UtilityPart[] = [
    ['hullFlat', box(0.078, 0.02, 0.032, 0, 0, z)],
    ['dark', utilityStencil('PWR-01', 0.002).translate(0, 0.0203, z)],
    ['dark', box(w - 0.02, 0.003, 0.002, 0, 0.006, z)],
    ['window', box(0.015, 0.003, 0.001, 0.021, 0.011, z + 0.016)],
  ];
  if (quality === 'high') parts.push(['safety', box(0.078, 0.002, 0.003, 0, 0.015, z + 0.016)]);
  return parts;
}
