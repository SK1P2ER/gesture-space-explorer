import { describe, expect, it } from 'vitest';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { BODIES } from '../src/data/bodies';
import { ROVER, ROVER_SWEEP, segmentHitsPolygon } from '../src/data/baseLayout';
import { best, BUILD_KINDS, cellBlocked, cellSquare, dustFactor, evaluate, History, MAX_MODULES, parsePlaced, sunSine, type Placed, type SolConditions } from '../src/sim/buildRules';
import { siteFrame, solarLongitude, sunDirection, sunPath } from '../src/sim/localSky';

const mars = BODIES.find((b) => b.id === 'mars')!;
const conditions = (iso: string): SolConditions => {
  const ms = Date.parse(iso);
  return { ...sunPath(siteFrame(mars, 18.4, 77.6, ms), sunDirection(mars, ms)), dust: dustFactor(solarLongitude(mars, ms)) };
};
/**
 * Today (the app's date in these tests) and the dustiest sol (Ls ≈ 255°, found by scanning 2024–25:
 * 18 May 2024), which at Jezero is also winter: a 10-hour day with the Sun low.
 */
const TODAY = conditions('2026-10-24T00:00:00Z');
const DUSTY = conditions('2024-05-18T00:00:00Z');
const at = (kind: Placed['kind'], i: number, j: number): Placed => ({ kind, i, j, rot: 0 });

/** Free cells, nearest the pad first (what a player would fill). */
const freeCells = (() => {
  const cells: [number, number][] = [];
  for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) if (!cellBlocked(JEZERO, [], i, j)) cells.push([i, j]);
  return cells.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
})();
const layout = (kinds: Placed['kind'][]) => kinds.map((k, n) => at(k, ...freeCells[n]));
/** Like layout(), but the greenhouse goes on the free cell nearest the habitat. */
const withGreenhouse = (kinds: Placed['kind'][]) => {
  const out = layout(kinds.filter((k) => k !== 'greenhouse'));
  const h = out.find((p) => p.kind === 'habitat')!;
  const free = freeCells.filter(([i, j]) => !out.some((p) => p.i === i && p.j === j)).sort((a, b) => Math.hypot(a[0] - h.i, a[1] - h.j) - Math.hypot(b[0] - h.i, b[1] - h.j));
  return [...out, at('greenhouse', ...free[0])];
};

describe('Mars’ seasons (Ls), checked against known dates', () => {
  // Mars Year 37 began 26 Dec 2022 (Ls 0); its solstices and equinox per the Mars Climate Database calendar.
  for (const [iso, ls] of [['2022-12-26', 0], ['2023-07-12', 90], ['2024-01-12', 180], ['2024-06-07', 270]] as const) {
    it(`Ls ${ls}° on ${iso}`, () => {
      const got = solarLongitude(mars, Date.parse(`${iso}T12:00:00Z`));
      expect(Math.abs(((got - ls + 540) % 360) - 180)).toBeLessThan(4);
    });
  }

  it('dust: clear most of the year, worst around Ls 255°', () => {
    expect(dustFactor(90)).toBe(1);
    expect(dustFactor(255)).toBeCloseTo(0.6, 9);
    expect(dustFactor(200)).toBeLessThan(1);
    expect(DUSTY.dust).toBeLessThan(0.61);
  });
});

describe('placing modules', () => {
  it('only on free cells: not on the pad, the buildings, the paths, outside, or on another module', () => {
    expect(cellBlocked(JEZERO, [], 0, 0)).toBe('pad');
    expect(cellBlocked(JEZERO, [], -3, -1)).toBe('building'); // habitat A at (−0.75, −0.25)
    expect(cellBlocked(JEZERO, [], 20, 0)).toBe('outside');
    const [i, j] = freeCells[0];
    expect(cellBlocked(JEZERO, [], i, j)).toBeNull();
    const placed = [at('solar', i, j)];
    expect(cellBlocked(JEZERO, placed, i, j)).toBe('occupied');
    expect(cellBlocked(JEZERO, placed, i, j, placed[0])).toBeNull(); // moving it: its own cell is fine
    expect(freeCells.length).toBeGreaterThan(MAX_MODULES); // room for a full base
    expect(cellBlocked(JEZERO, [], 6, 0)).toBe('path'); // the east rover loop runs here
  });
});

describe('rovers keep their road', () => {
  it('no placeable cell (as a full module footprint) touches the strip a rover sweeps along its loop', () => {
    expect(ROVER_SWEEP).toBeGreaterThanOrEqual(Math.hypot(ROVER.length, ROVER.width) / 2 - 1e-12);
    let checked = 0;
    for (const [i, j] of freeCells) {
      const sq = cellSquare(i, j, 0); // the whole cell, not the slightly shrunk test square
      for (const loop of JEZERO.roverLoops)
        for (let k = 0; k < loop.length; k++) expect(segmentHitsPolygon(loop[k], loop[(k + 1) % loop.length], ROVER_SWEEP, sq), `cell ${i},${j} on loop leg ${k}`).toBe(false);
      checked++;
    }
    expect(checked).toBeGreaterThan(MAX_MODULES);
  });
});

describe('the energy balance over a sol', () => {
  it('the Sun rises and sets: no solar power at night', () => {
    expect(sunSine(12, TODAY.latDeg, TODAY.decDeg)).toBeGreaterThan(0.5);
    expect(sunSine(0, TODAY.latDeg, TODAY.decDeg)).toBeLessThan(0);
  });

  it('a habitat with solar but no battery runs short at night', () => {
    const s = evaluate(JEZERO, layout(['habitat', 'solar', 'solar', 'oxygen']), TODAY);
    expect(s.powered).toBe(false);
    expect(s.shortHours).toContain(0); // midnight
    expect(s.shortHours).not.toContain(12);
    expect(s.oxygen).toBeLessThan(0); // no power, no oxygen
    expect(s.level).toBe(1);
  });

  it('batteries carry it through the night; charge never goes below zero or above capacity', () => {
    const s = evaluate(JEZERO, layout(['habitat', 'oxygen', 'solar', 'solar', 'solar', 'solar', 'battery', 'battery']), TODAY);
    expect(s.powered).toBe(true);
    for (const c of s.charge) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(s.capacity);
    }
  });

  it('a greenhouse makes oxygen only with a habitat near', () => {
    const lone = evaluate(JEZERO, [at('greenhouse', ...freeCells[freeCells.length - 1])], TODAY);
    expect(lone.idleGreenhouses).toBe(1);
  });
});

describe('levels: reachable, and kept once earned', () => {
  // The sample layouts a player could build, for today and for the dustiest season.
  const LEVEL2: Placed['kind'][] = ['habitat', 'oxygen', 'solar', 'solar', 'solar', 'solar', 'solar', 'battery', 'battery'];
  const LEVEL3: Placed['kind'][] = ['habitat', 'greenhouse', 'oxygen', 'solar', 'solar', 'solar', 'solar', 'solar', 'solar', 'solar', 'battery', 'battery', 'battery'];

  for (const [name, sol] of [['today', TODAY], ['in the dustiest season', DUSTY]] as const) {
    it(`level 2 and level 3 can be reached ${name}`, () => {
      expect(evaluate(JEZERO, layout(LEVEL2), sol).level, 'level 2 layout').toBeGreaterThanOrEqual(2);
      const s3 = evaluate(JEZERO, withGreenhouse(LEVEL3), sol);
      expect(s3.idleGreenhouses).toBe(0);
      expect(s3.level, 'level 3 layout').toBe(3);
    });
  }

  it('the same base can fall short in the dust season (live status); the earned level stays', () => {
    // Enough for a clear sol, not a dusty one.
    const kinds: Placed['kind'][] = ['habitat', 'oxygen', 'solar', 'solar', 'solar', 'battery', 'battery'];
    const clear = conditions('2025-06-01T00:00:00Z');
    expect(clear.dust).toBe(1);
    expect(evaluate(JEZERO, layout(kinds), clear).level).toBe(2);
    const dusty = evaluate(JEZERO, layout(kinds), DUSTY);
    expect(dusty.powered).toBe(false);
    expect(best(2, dusty.level)).toBe(2);
    expect(best(undefined, 1)).toBe(1);
    expect(best(1, 3)).toBe(3);
  });
});

describe('undo / redo and storage', () => {
  it('steps back and forward; a new change clears redo', () => {
    const h = new History<number[]>([]);
    h.push([1]);
    h.push([1, 2]);
    expect(h.undo()).toBe(true);
    expect(h.present).toEqual([1]);
    expect(h.redo()).toBe(true);
    expect(h.present).toEqual([1, 2]);
    h.undo();
    h.push([1, 3]);
    expect(h.canRedo).toBe(false);
    h.undo();
    h.undo();
    expect(h.present).toEqual([]);
    expect(h.undo()).toBe(false);
  });

  it('survives anything in storage; drops modules on blocked cells; caps the count', () => {
    for (const bad of [null, '', 'x', '{}', '[1]', '[{"kind":"castle","i":5,"j":5}]']) expect(parsePlaced(bad, JEZERO)).toEqual([]);
    const [i, j] = freeCells[0];
    expect(parsePlaced(JSON.stringify([{ kind: 'solar', i, j, rot: 9 }, { kind: 'habitat', i: 0, j: 0 }]), JEZERO)).toEqual([{ kind: 'solar', i, j, rot: 0 }]);
    const many = freeCells.slice(0, 40).map(([a, b]) => ({ kind: 'solar', i: a, j: b }));
    expect(parsePlaced(JSON.stringify(many), JEZERO)).toHaveLength(MAX_MODULES);
    expect(BUILD_KINDS).toHaveLength(5);
  });
});
