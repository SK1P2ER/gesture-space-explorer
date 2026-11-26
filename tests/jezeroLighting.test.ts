// Jezero Day / Golden Hour / Night looks: driven by the sky state (Sun elevation, nightness), not by a preset id.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { BaseLighting, fillIntensity, goldenness, NIGHT_FILL, skyFill, SUN_DAY, SUN_LOW } from '../src/scene/baseKit/baseLighting';
import { LandingPad } from '../src/scene/baseKit/landingPad';
import { SAFETY_NIGHT_GLOW, Showcase } from '../src/scene/baseKit/showcase';

const R = 1.574 / 0.28;
const site = { point: new THREE.Vector3(0, 1, 0), quaternion: new THREE.Quaternion(), scale: 1 / R };
const renderer = () => ({ shadowMap: { needsUpdate: false } }) as unknown as THREE.WebGLRenderer;
const sunAt = (elevationDeg: number) => { const e = THREE.MathUtils.degToRad(elevationDeg); return new THREE.Vector3(Math.cos(e), Math.sin(e), 0); };

describe('Jezero lighting looks', () => {
  it('golden hour: 0 with the Sun high, near 1 at 6°, gone in the dark', () => {
    expect(goldenness(81, 0)).toBe(0);
    expect(goldenness(6, 0)).toBeGreaterThan(0.95);
    expect(goldenness(-60, 1)).toBe(0);
  });

  it('the fill is unchanged by day, raised in the golden hour, and never below the night skyglow', () => {
    expect(fillIntensity(1, 0, 81)).toBeCloseTo(skyFill(1, 0), 10);
    expect(fillIntensity(1, 0, 6)).toBeGreaterThan(skyFill(1, 0) * 2);
    expect(fillIntensity(1, 1, -60)).toBeCloseTo(NIGHT_FILL, 10);
    expect(fillIntensity(1, 1, -60)).toBeLessThan(fillIntensity(1, 0, 81));
  });

  it('the base Sun warms as it gets low; the fill turns cool at night; settles on the first update (no easing)', () => {
    const l = new BaseLighting(new THREE.Group(), { shadows: false, shadowSize: 256, envSize: 16 }, 2.4);
    try {
      l.update(renderer(), sunAt(81), 81, 0, 1.52, 1, null, 0);
      expect(l.sun.color.equals(SUN_DAY)).toBe(true);
      const dayFill = l.fill.color.clone();
      l.update(renderer(), sunAt(6), 6, 0, 1.52, 1, null, 0);
      expect(l.sun.color.b).toBeLessThan(SUN_DAY.b - 0.1);
      expect(l.sun.color.r).toBeCloseTo(SUN_LOW.r, 1);
      expect(l.sun.intensity).toBeGreaterThan(0);
      l.update(renderer(), sunAt(-60), -60, 1, 1.52, 1, null, 0);
      expect(l.sun.intensity).toBe(0);
      expect(l.fill.intensity).toBeCloseTo(NIGHT_FILL, 10);
      expect(l.fill.color.b).toBeGreaterThan(l.fill.color.r); // cool skyglow
      // Back to day in one update: a preset is a clock jump, the look follows at once.
      l.update(renderer(), sunAt(81), 81, 0, 1.52, 1, null, 0);
      expect(l.fill.color.equals(dayFill)).toBe(true);
      expect(l.sun.color.equals(SUN_DAY)).toBe(true);
    } finally { l.dispose(); }
  });

  it('night: the safety trim and the pad markings glow faintly; none by day; windows warm', () => {
    // High: the trim is drawn in safety orange (Low draws those accents in the kit's red, which already has a glow).
    const s = new Showcase(JEZERO, { quality: 'high', R, site });
    const pad = new LandingPad('low');
    try {
      const safety = (s as unknown as { mats: { safety: THREE.MeshStandardMaterial } }).mats.safety;
      // The trim is drawn: some mesh of the base uses it.
      let used = false;
      s.group.traverse((o) => { if (o instanceof THREE.Mesh && ([] as THREE.Material[]).concat(o.material).includes(safety)) used = true; });
      expect(used).toBe(true);
      const padSafety = (pad.group.getObjectByName('landing:safety') as THREE.Mesh).material as THREE.MeshStandardMaterial;
      s.setDaylight(0, sunAt(81), 1); pad.setDaylight(0, true);
      expect(safety).toBeDefined();
      expect(safety!.emissive.getHex()).toBe(0);
      expect(padSafety.emissive.getHex()).toBe(0);
      s.setDaylight(1, sunAt(-60), 1); pad.setDaylight(1, true);
      expect(safety!.emissive.equals(SAFETY_NIGHT_GLOW)).toBe(true);
      expect(padSafety.emissive.equals(SAFETY_NIGHT_GLOW)).toBe(true);
      // Subtle: well below the trim's own colour.
      expect(SAFETY_NIGHT_GLOW.r).toBeLessThan(0.35);
      const window = (s.group.getObjectByName('kit:window') as THREE.Mesh).material as THREE.MeshBasicMaterial;
      expect(window.color.r).toBeGreaterThan(window.color.b);
    } finally { s.dispose(); pad.dispose(); }
  });
});
