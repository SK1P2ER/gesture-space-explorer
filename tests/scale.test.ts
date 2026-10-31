import { describe, expect, it } from 'vitest';
import { BODIES, reachFactor, systemReach } from '../src/data/bodies';
import { SCALE } from '../src/data/scale';

const planets = BODIES.filter((b) => b.kind === 'planet');

describe('scene scale', () => {
  it('keeps the real size order', () => {
    const byDiameter = [...planets].sort((a, b) => a.facts.diameterKm - b.facts.diameterKm).map((b) => b.id);
    const byRadius = [...planets].sort((a, b) => a.radius - b.radius).map((b) => b.id);
    expect(byRadius).toEqual(byDiameter);
  });

  it('makes small planets bigger than before (v1.0: Mercury 0.56, Earth 1)', () => {
    expect(planets.find((b) => b.id === 'mercury')!.radius).toBeGreaterThan(1.2);
    expect(planets.find((b) => b.id === 'earth')!.radius).toBeCloseTo(SCALE.earthRadius);
  });

  it('never lets neighbours (their rings, or their moons) touch when they line up', () => {
    for (let i = 1; i < planets.length; i++) {
      const [a, b] = [planets[i - 1], planets[i]];
      const gap = b.orbitRadius - a.orbitRadius - systemReach(a) - systemReach(b);
      expect(gap, `${a.id} → ${b.id}`).toBeGreaterThanOrEqual(SCALE.clearance - 1e-9);
    }
  });

  it('keeps Mercury clear of the Sun and its glow', () => {
    expect(planets[0].orbitRadius - planets[0].radius).toBeGreaterThan(SCALE.sunRadius * 1.6);
  });

  it('spaces planets by log distance, moving one out only as far as a neighbour’s system needs', () => {
    const mercury = planets[0];
    const innerEdge = (b: (typeof planets)[0]) => b.orbitRadius - b.radius * reachFactor(b);
    const onLogScale = (b: (typeof planets)[0]) => innerEdge(mercury) + SCALE.unitsPerLn * Math.log(b.orbitAU / mercury.orbitAU);
    for (let i = 1; i < planets.length; i++) {
      const [a, b] = [planets[i - 1], planets[i]];
      const floor = a.orbitRadius + systemReach(a) + systemReach(b) + SCALE.clearance;
      expect(innerEdge(b), b.id).toBeGreaterThanOrEqual(onLogScale(b) - 1e-9);
      if (innerEdge(b) > onLogScale(b) + 1e-9) expect(b.orbitRadius, `${b.id} is on the floor`).toBeCloseTo(floor);
    }
    // Venus and Jupiter keep their real log spacing from Mercury; the Moon nudges Earth (and so Mars) out a little.
    for (const id of ['venus', 'jupiter']) expect(innerEdge(planets.find((p) => p.id === id)!), id).toBeCloseTo(onLogScale(planets.find((p) => p.id === id)!));
    expect(planets.find((p) => p.id === 'earth')!.orbitRadius - 35.91).toBeLessThan(1.5);
  });
});
