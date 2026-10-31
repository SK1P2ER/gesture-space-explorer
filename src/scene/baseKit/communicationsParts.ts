import * as THREE from 'three';
import { utilityBox as box, utilityStencil, type UtilityPart, type UtilityQuality } from './utilityGeometry';

export function communicationsParts(quality: UtilityQuality): UtilityPart[] {
  const rich = quality === 'high';
  const dish = new THREE.LatheGeometry(Array.from({ length: rich ? 9 : 5 }, (_, n) => {
    const t = n / (rich ? 8 : 4);
    return new THREE.Vector2(0.08 * t, 0.025 * t * t);
  }), rich ? 20 : 10).rotateX(-0.7).translate(0, 0.38, 0.02);
  dish.userData = { feature: 'dish', tilt: -0.7, center: [0, 0.38, 0.02] };
  const rim = new THREE.TorusGeometry(0.079, 0.001, 3, rich ? 20 : 10).rotateX(Math.PI / 2).translate(0, 0.025, 0).rotateX(-0.7).translate(0, 0.38, 0.02);
  rim.userData.feature = 'dish-rim';
  const parts: UtilityPart[] = [
    ['dark', box(0.025, 0.4, 0.025)],
    ['dark', box(0.1, 0.012, 0.012, 0, 0.12)],
    ['dark', box(0.012, 0.012, 0.1, 0, 0.24)],
    ['hull', dish],
    ['dark', rim],
    ['hullFlat', box(0.075, 0.045, 0.06, 0, 0, -0.03)],
    ['dark', utilityStencil('COM-01', 0.0025).translate(0, 0.0453, -0.03)],
    [rich ? 'safety' : 'red', box(0.075, 0.003, 0.004, 0, 0.025, -0.061)],
    ['dark', box(0.035, 0.022, 0.025, 0, 0.34, -0.012)],
  ];
  if (rich) for (const x of [-0.028, 0.028]) parts.push(['dark', box(0.006, 0.11, 0.006, x, 0, 0.005).rotateZ(x > 0 ? -0.2 : 0.2)]);
  return parts;
}
