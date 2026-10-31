// The asteroid belt and a hint of the Kuiper belt: thousands of small bodies,
// sampled once (seeded, so every visit looks the same) and drawn as instanced
// rocks. Pure data here; scene/belts.ts draws them.
//
// Each rock keeps a real semi-major axis — the asteroid belt's Kirkwood gaps,
// cleared by resonances with Jupiter, stay empty — and moves at its Kepler
// period, so inner rocks overtake outer ones. On screen the belt fills the
// clear band between its neighbours' systems (scale.ts), spread by log distance.

import { BODIES, sceneDistance, systemReach, type Body } from './bodies';
import { SCALE } from './scale';

export { sceneDistance };

export interface BeltSpec {
  /** Semi-major axes, AU. */
  aMin: number;
  aMax: number;
  /** Resonance gaps (AU) left empty, ± gapHalfWidth. */
  gaps: number[];
  gapHalfWidth: number;
  /** Typical inclination (Rayleigh σ), degrees. */
  inclination: number;
  /** Rock radius range, scene units (exaggerated like everything else, so the belt shows in the overview). */
  size: [number, number];
}

export const ASTEROIDS: BeltSpec = {
  aMin: 2.06,
  aMax: 3.3,
  gaps: [2.5, 2.82, 2.95, 3.27], // 3:1, 5:2, 7:3, 2:1 with Jupiter
  gapHalfWidth: 0.025,
  inclination: 7,
  size: [0.06, 0.36],
};

export const KUIPER: BeltSpec = {
  aMin: 38,
  aMax: 50,
  gaps: [],
  gapHalfWidth: 0,
  inclination: 10,
  size: [0.12, 0.5],
};

/**
 * Rocks shrink as the camera gets close (scene units from the camera). They're sized to
 * be seen from the overview, where the nearest is ~200 units away; seen from a planet
 * nearby at true size they'd be boulders. Below `full` they stay a few pixels wide.
 * The shader in scene/belts.ts does the same.
 */
export const NEAR_CAMERA = { hidden: 1.5, full: 60 };

export function nearCameraScale(distance: number): number {
  const x = Math.min(1, Math.max(0, (distance - NEAR_CAMERA.hidden) / (NEAR_CAMERA.full - NEAR_CAMERA.hidden)));
  return x * x * (3 - 2 * x); // smoothstep
}

const body = (id: string) => BODIES.find((b) => b.id === id)!;
const planets = () => BODIES.filter((b) => b.kind === 'planet');

/** Where a belt goes on screen: [inner, outer] scene radius, clear of its neighbours' systems. */
export function beltBand(spec: BeltSpec): [number, number] {
  if (spec === ASTEROIDS) {
    const [mars, jupiter] = [body('mars'), body('jupiter')];
    return [mars.orbitRadius + systemReach(mars) + SCALE.clearance, jupiter.orbitRadius - systemReach(jupiter) - SCALE.clearance];
  }
  const neptune = planets().at(-1)!;
  return [neptune.orbitRadius + systemReach(neptune) + SCALE.clearance, sceneDistance(spec.aMax)];
}

export interface BeltSample {
  count: number;
  /** Per rock: scene radius, angle at J2000 (rad), mean motion (rad/day), height amplitude (scene units). */
  orbit: Float32Array;
  /** Per rock: its ascending node (rad), so height = amplitude · sin(angle − node). */
  node: Float32Array;
  /** Per rock: radius, scene units. */
  size: Float32Array;
  /** Per rock: semi-major axis, AU (for tests). */
  a: Float32Array;
}

/** A small, fast, seeded RNG (mulberry32), so the belt is the same on every load. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inGap = (spec: BeltSpec, a: number) => spec.gaps.some((g) => Math.abs(a - g) < spec.gapHalfWidth);

export function sampleBelt(spec: BeltSpec, count: number, seed = 1): BeltSample {
  const rand = seeded(seed);
  const [inner, outer] = beltBand(spec);
  const [lnMin, lnMax] = [Math.log(spec.aMin), Math.log(spec.aMax)];
  /** Scene units per AU across the band, for the vertical spread. */
  const unitsPerAu = (outer - inner) / (spec.aMax - spec.aMin);
  const sample: BeltSample = {
    count,
    orbit: new Float32Array(count * 4),
    node: new Float32Array(count),
    size: new Float32Array(count),
    a: new Float32Array(count),
  };
  for (let i = 0; i < count; i++) {
    let a: number;
    do a = Math.exp(lnMin + (lnMax - lnMin) * (0.5 * (rand() + rand()))); // denser in the middle
    while (inGap(spec, a));
    const radius = inner + ((Math.log(a) - lnMin) / (lnMax - lnMin)) * (outer - inner);
    const incl = spec.inclination * Math.sqrt(-2 * Math.log(1 - rand())) * (Math.PI / 180); // Rayleigh
    const periodDays = 365.25 * a ** 1.5; // Kepler's third law
    sample.orbit.set([radius, rand() * Math.PI * 2, (Math.PI * 2) / periodDays, unitsPerAu * a * Math.sin(incl)], i * 4);
    sample.node[i] = rand() * Math.PI * 2;
    sample.size[i] = spec.size[0] + (spec.size[1] - spec.size[0]) * rand() ** 4; // mostly small, a few big
    sample.a[i] = a;
  }
  return sample;
}

/** For tests: is this belt clear of these bodies' systems? */
export const clearOf = (spec: BeltSpec, bodies: Body[]) => {
  const [inner, outer] = beltBand(spec);
  return bodies.every((b) => b.orbitRadius + systemReach(b) <= inner || b.orbitRadius - systemReach(b) >= outer);
};
