import * as THREE from 'three';
import { mergeOwned, utilityBox as box, utilityStencil, type UtilityPart, type UtilityQuality } from './utilityGeometry';

export function garageParts(quality: UtilityQuality, hollow = false): UtilityPart[] {
  const rich = quality === 'high';
  const accent = rich ? 'safety' : 'red';
  const parts: UtilityPart[] = [
    ...(hollow ? [
      ['dark', box(0.02, 0.098, 0.18, -0.12, 0, 0.01)],
      ['dark', box(0.02, 0.098, 0.18, 0.12, 0, 0.01)],
      ['dark', box(0.26, 0.098, 0.02, 0, 0, -0.09)],
      ['dark', box(0.26, 0.002, 0.2, 0, 0.098)],
    ] as UtilityPart[] : [['dark', box(0.26, 0.1, 0.2)]] as UtilityPart[]),
    ['window', box(0.05, 0.012, 0.05, 0, 0.1, 0)],
    ['hullFlat', box(0.24, 0.003, 0.18, 0, 0.098)],
    ['hullFlat', box(0.014, 0.09, 0.008, -0.102, 0, 0.101)],
    ['hullFlat', box(0.014, 0.09, 0.008, 0.102, 0, 0.101)],
    ['hullFlat', box(0.218, 0.012, 0.008, 0, 0.083, 0.101)],
    [accent, box(0.006, 0.075, 0.002, -0.113, 0, 0.102)],
    [accent, box(0.006, 0.075, 0.002, 0.113, 0, 0.102)],
    ['window', box(0.17, 0.003, 0.004, 0, 0.079, 0.102)],
    ['hullFlat', box(0.1, 0.001, 0.028, 0, 0.102, -0.057)],
    ['dark', utilityStencil('ROV-01', 0.003).translate(0, 0.1032, -0.057)],
    ['dark', box(0.045, 0.008, 0.035, 0.083, 0.101, -0.055)],
  ];
  // The facade is optionally extracted as one rigid inward-opening leaf by Showcase.
  const count = rich ? 6 : 4;
  for (let n = 0; n < count; n++) {
    const bottom = n * 0.075 / count + (n ? 0.0007 : 0);
    const top = (n + 1) * 0.075 / count - (n < count - 1 ? 0.0007 : 0);
    const panel = box(0.18, top - bottom, 0.01, 0, bottom, 0.101);
    panel.userData.feature = 'garage-door';
    parts.push(['hullFlat', panel]);
  }
  if (rich) for (const x of [-0.105, 0.105]) for (const y of [0.014, 0.046, 0.078]) parts.push(['dark', box(0.004, 0.004, 0.001, x, y, 0.105)]);
  return parts;
}

/** Two shared instance batches; every output is owned by this Showcase, not BuildView. */
export function roverParts(quality: UtilityQuality): UtilityPart[] {
  const rich = quality === 'high';
  const bodyParts: THREE.BufferGeometry[] = [box(0.08, 0.025, 0.05, 0, 0.012), box(0.006, 0.03, 0.006, 0.025, 0.037), box(0.03, 0.004, 0.04, -0.01, 0.04),
    box(0.002, 0.025, 0.002, -0.027, 0.037), box(0.016, 0.008, 0.025, -0.015, 0.044)];
  const darkParts: THREE.BufferGeometry[] = [box(0.014, 0.008, 0.01, 0.025, 0.059), box(0.006, 0.004, 0.002, 0.025, 0.061, 0.006), box(0.074, 0.004, 0.046, 0, 0.01)];
  for (const x of [-0.028, 0, 0.028]) for (const sign of [-1, 1]) {
    darkParts.push(new THREE.CylinderGeometry(0.01, 0.01, 0.007, rich ? 12 : 6).rotateX(Math.PI / 2).translate(x, 0.01, sign * 0.028));
    bodyParts.push(new THREE.CylinderGeometry(0.0045, 0.0045, 0.001, rich ? 10 : 5).rotateX(Math.PI / 2).translate(x, 0.01, sign * 0.0315));
  }
  if (rich) for (const z of [-0.0255, 0.0255]) darkParts.push(box(0.03, 0.012, 0.001, -0.009, 0.019, z));
  const body = mergeOwned(bodyParts);
  const wheels = mergeOwned(darkParts);
  return [['hullFlat', body], ['dark', wheels]];
}
