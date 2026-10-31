import { describe, expect, it } from 'vitest';
import { along, footprint, layoutProblems, onSphere, pathLength, polygonsOverlap, PAD_CLEARANCE, type BaseLayout } from '../src/data/baseLayout';
import { JEZERO } from '../src/data/baseLayouts/jezero';

describe('base layouts (data, not code)', () => {
  it('Jezero is sound: nothing on the pad, no overlaps, tunnels and paths clear', () => {
    expect(layoutProblems(JEZERO)).toEqual([]);
  });

  it('catches a module on the pad, overlapping modules, a blocked tunnel and a path through a building', () => {
    const bad: BaseLayout = {
      ...JEZERO,
      modules: [
        ...JEZERO.modules,
        { id: 'onPad', kind: 'habitat', x: 0.3, z: 0 },
        { id: 'clash', kind: 'garage', x: 0.8, z: -0.55 },
        { id: 'inTheWay', kind: 'flag', x: -0.95, z: -0.125 },
      ],
      roverLoops: [[[0.45, -0.6], [1.2, -0.6], [1.2, -1.2]]],
    };
    const problems = layoutProblems(bad).join('\n');
    expect(problems).toMatch(/onPad: too close to the landing pad/);
    expect(problems).toMatch(/garage overlaps clash/);
    expect(problems).toMatch(/tunnel habA–habC runs through inTheWay/);
    expect(problems).toMatch(/rover loop 0: leg 0 runs through garage/);
  });

  it('footprints: rotation turns a rectangle, circles stay round', () => {
    const g = footprint({ id: 'g', kind: 'garage', x: 0, z: 0, rot: 90 });
    const xs = g.map((p) => p[0]);
    expect(Math.max(...xs)).toBeCloseTo(0.1, 9); // the 0.2-deep side now runs along x
    const h = footprint({ id: 'h', kind: 'habitat', x: 1, z: 1 });
    for (const [x, z] of h) expect(Math.hypot(x - 1, z - 1)).toBeCloseTo(0.16, 9);
    expect(polygonsOverlap(g, footprint({ id: 'f', kind: 'flag', x: 0.5, z: 0 }))).toBe(false);
    expect(PAD_CLEARANCE).toBeCloseTo(0.45, 9);
  });

  it('places things on the curved ground: flat at the pad, falling away with distance', () => {
    const R = 5.6;
    expect(onSphere(0, 0, R).y).toBe(0);
    expect(onSphere(0, 0, R).up).toEqual([0, 1, 0]);
    const edge = onSphere(1.4, 0, R);
    expect(edge.y).toBeCloseTo(Math.sqrt(R * R - 1.96) - R, 9); // ≈ −0.18: would float without this
    expect(edge.y).toBeLessThan(-0.15);
    expect(Math.hypot(...edge.up)).toBeCloseTo(1, 9);
    expect(edge.up[0]).toBeGreaterThan(0); // tilts outward
  });

  it('walks paths at constant speed', () => {
    const sq: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(pathLength(sq, true)).toBe(4);
    expect(along(sq, true, 1.5).p).toEqual([1, 0.5]);
    expect(along(sq, true, 3.5).p).toEqual([0, 0.5]);
    expect(along(sq, true, 1.5).heading).toBeCloseTo(Math.PI / 2, 9);
  });
});
