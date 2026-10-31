import { describe, expect, it } from 'vitest';
import { BODIES, reachFactor, sceneDistance, type Body } from '../src/data/bodies';
import { BOOST, boostLevel, boostLimits, boostScale, moonOpacity } from '../src/data/boost';
import { heliocentric, length, longitude, moonAngle, moonDirection, sunCentered } from '../src/data/ephemeris';
import { SCALE } from '../src/data/scale';
import { keyToIntent } from '../src/input/keyboard';
import { config } from '../src/config';

type V = [number, number, number];
const limits = boostLimits(BODIES);
const reach = (b: Body) => b.radius * reachFactor(b);
const sub = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const toScene = ([x, y, z]: V): V => [x, z, -y];

/** Every boosted body as drawn at this time and boost level: center and how far it reaches. */
function scene(ms: number, level: number) {
  const out: { id: string; p: V; r: number }[] = [{ id: 'sun-glow', p: [0, 0, 0], r: SCALE.sunRadius * 1.6 }];
  const at = new Map<string, V>();
  for (const b of BODIES) {
    const s = boostScale(limits.get(b.id)!, level);
    if (b.kind === 'planet') {
      const lon = longitude(heliocentric(b.orbit!, ms));
      const p: V = [b.orbitRadius * Math.cos(lon), 0, -b.orbitRadius * Math.sin(lon)];
      at.set(b.id, p);
      out.push({ id: b.id, p, r: reach(b) * s });
    } else if (b.kind === 'dwarf') {
      const h = sunCentered(b, ms);
      const d = sceneDistance(length(h)) / length(h);
      out.push({ id: b.id, p: toScene(h).map((x) => x * d) as V, r: reach(b) * s });
    }
  }
  if (moonOpacity(level) > 0.01) {
    for (const m of BODIES.filter((b) => b.kind === 'moon')) {
      const parent = BODIES.find((b) => b.id === m.parent)!;
      const grown = (boostScale(limits.get(parent.id)!, level) - 1) * reach(parent);
      const dir = toScene(moonDirection(m.moon!, parent, moonAngle(m.moon!, ms), ms));
      const c = at.get(parent.id)!;
      out.push({ id: m.id, p: [0, 1, 2].map((k) => c[k] + dir[k] * (m.orbitRadius + grown)) as V, r: m.radius });
    }
  }
  return out;
}

describe('overview boost', () => {
  it('never lets two bodies (rings, moons, the Sun’s glow included) touch, 1800–2200, at any zoom', () => {
    let closest = { gap: Infinity, what: '' };
    for (let t = Date.UTC(1800, 0, 1); t < Date.UTC(2200, 0, 1); t += 30.44 * 86_400_000) {
      for (let level = 0; level <= 1.0001; level += 0.1) {
        const bodies = scene(t, level);
        for (let i = 0; i < bodies.length; i++)
          for (let j = i + 1; j < bodies.length; j++) {
            const [a, b] = [bodies[i], bodies[j]];
            if (BODIES.find((x) => x.id === a.id)?.parent === b.id || BODIES.find((x) => x.id === b.id)?.parent === a.id) continue; // a moon and its own planet: checked below
            const gap = sub(a.p, b.p) - a.r - b.r;
            if (gap < closest.gap) closest = { gap, what: `${a.id}–${b.id} ${new Date(t).toISOString().slice(0, 7)} level ${level.toFixed(1)}` };
          }
      }
    }
    expect(closest.gap, closest.what).toBeGreaterThan(0);
  });

  it('keeps moons clear of their grown planet (they move out by as much as it grows)', () => {
    for (const m of BODIES.filter((b) => b.kind === 'moon')) {
      const parent = BODIES.find((b) => b.id === m.parent)!;
      for (let level = 0; level <= 0.5; level += 0.05) {
        const s = boostScale(limits.get(parent.id)!, level);
        expect(m.orbitRadius + (s - 1) * reach(parent) - m.radius - reach(parent) * s, m.id).toBeGreaterThan(0);
      }
    }
  });

  it('changes smoothly with distance: true size up close, full boost in the overview, no jumps', () => {
    expect(boostLevel(10)).toBe(0);
    expect(boostLevel(BOOST.near)).toBe(0);
    expect(boostLevel(BOOST.far)).toBe(1);
    expect(boostLevel(260)).toBe(1);
    let worst = 0;
    for (let d = 0; d < 300; d += 0.1) worst = Math.max(worst, Math.abs(boostLevel(d + 0.1) - boostLevel(d)));
    expect(worst).toBeLessThan(0.0015); // ≤ 0.15% of the full boost per 0.1 unit of zoom
    expect(moonOpacity(0)).toBe(1);
    expect(moonOpacity(0.5)).toBe(0);
    expect(moonOpacity(0.25)).toBeGreaterThan(0.3);
  });

  it('grows the small inner planets most; Saturn’s rings and the crowded outer planets less', () => {
    expect(limits.get('earth')).toBeGreaterThan(1.7);
    expect(limits.get('jupiter')).toBeGreaterThan(1.6);
    expect(limits.get('neptune')).toBeGreaterThan(1.15);
    expect(limits.get('sun')).toBe(1);
    expect(limits.get('io')).toBe(1);
  });

  it('T toggles true scale', () => {
    expect(keyToIntent('t', config.keyboard)).toEqual({ type: 'toggleTrueScale' });
    expect(keyToIntent('T', config.keyboard)).toEqual({ type: 'toggleTrueScale' });
  });
});
