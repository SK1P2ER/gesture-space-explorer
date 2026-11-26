import { describe, expect, it } from 'vitest';
import { COUNTDOWN, CountdownGesture, fingerCount } from '../src/gestures/countdown';
import type { Fingers } from '../src/gestures/perception';
import { arcBetween, arcClearsBody, bezier, bezierTangent, flightProgress, flightSide, SKIP_TO, travelSeconds, warpLevel, type FlightBody, type V3 } from '../src/sim/travel';

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('the rocket’s arc', () => {
  const start: V3 = [36, 0, 0];
  const end: V3 = [-44, 0, 10];
  const arc = arcBetween(start, [1, 0, 0], end, [-1, 0, 0]);

  it('starts on one pad and ends on the other', () => {
    expect(dist(bezier(arc, 0), start)).toBeCloseTo(0, 9);
    expect(dist(bezier(arc, 1), end)).toBeCloseTo(0, 9);
  });

  it('leaves straight up from the start pad and comes straight down onto the far one', () => {
    const t0 = bezierTangent(arc, 0);
    const t1 = bezierTangent(arc, 1);
    expect(dot(t0, [1, 0, 0]) / Math.hypot(...t0)).toBeGreaterThan(0.9); // along the start normal
    expect(dot(t1, [-1, 0, 0]) / Math.hypot(...t1)).toBeLessThan(-0.9); // against the end normal: descending onto it
  });

  it('is smooth: no jumps between frames', () => {
    let worst = 0;
    for (let t = 0; t < 1; t += 0.001) worst = Math.max(worst, dist(bezier(arc, t), bezier(arc, t + 0.001)));
    expect(worst).toBeLessThan(dist(start, end) * 0.005);
  });

  it('arcs above the plane of the orbits', () => {
    expect(bezier(arc, 0.5)[1]).toBeGreaterThan(5);
  });

  it('takes 5–14 s, longer for farther trips; starts and ends gently; warp only mid-flight', () => {
    expect(travelSeconds(1)).toBeGreaterThanOrEqual(5);
    expect(travelSeconds(100)).toBeLessThanOrEqual(14);
    expect(travelSeconds(80)).toBeGreaterThan(travelSeconds(10));
    expect(flightProgress(0)).toBe(0);
    expect(flightProgress(1)).toBe(1);
    expect(flightProgress(0.02)).toBeLessThan(0.001);
    expect(warpLevel(0.05)).toBe(0);
    expect(warpLevel(0.5)).toBeCloseTo(1, 9);
    expect(warpLevel(SKIP_TO)).toBeLessThan(0.3); // skipping lands you in the calm approach
  });
});

describe('solid-body flight clearance', () => {
  const norm = (a: V3): V3 => a.map(v => v / Math.hypot(...a)) as V3;
  const offset = (center: V3, normal: V3, radius: number): V3 => center.map((v, i) => v + normal[i] * radius) as V3;
  const assertClear = (arc: ReturnType<typeof arcBetween>, bodies: FlightBody[]) => {
    for (const body of bodies) {
      expect(arcClearsBody(arc, body)).toBe(true);
      // Independent dense samples also check the evaluator against the hull check.
      for (let i = 0; i <= 1000; i++) expect(dist(bezier(arc, i / 1000), body.center)).toBeGreaterThanOrEqual(body.radius - 1e-9);
    }
  };

  it.each([1, 1.8])('bypasses Earth and Moon in both directions at size boost %s, including far-side pads', boost => {
    const earth: FlightBody = { center: [30, -4, 12], radius: 2 * boost + 0.14 * boost };
    const moon: FlightBody = { center: [30 + 5 * boost, -4, 12], radius: 0.62 + 0.14 * boost };
    for (let rotation = 0; rotation < 16; rotation++) {
      const angle = rotation * Math.PI / 8;
      const normal: V3 = norm([Math.cos(angle), 0.5, Math.sin(angle)]);
      const moonNormal: V3 = norm([-Math.cos(angle), 0.01, Math.sin(angle)]);
      const start = offset(earth.center, normal, 2 * boost + 0.168 * boost);
      const end = offset(moon.center, moonNormal, 0.62 + 0.41);
      for (const reverse of [false, true]) {
        const a = reverse ? end : start, b = reverse ? start : end;
        const na = reverse ? moonNormal : normal, nb = reverse ? normal : moonNormal;
        const arc = arcBetween(a, na, b, nb, [earth, moon]);
        assertClear(arc, [earth, moon]);
        expect(dist(bezier(arc, 0), a)).toBeLessThan(1e-9);
        expect(dist(bezier(arc, 1), b)).toBeLessThan(1e-9);
        expect(dot(norm(bezierTangent(arc, 0)), na)).toBeCloseTo(1, 9);
        expect(dot(norm(bezierTangent(arc, 1)), nb)).toBeCloseTo(-1, 9);
      }
    }
  });

  it('detects a collision between endpoints and bends around an intervening body', () => {
    const body: FlightBody = { center: [0, 0, 0], radius: 3 };
    const unsafe = arcBetween([-6, 0, 0], [1, 0, 0], [6, 0, 0], [-1, 0, 0]);
    expect(arcClearsBody(unsafe, body)).toBe(false);
    const safe = arcBetween([-6, 0, 0], [1, 0, 0], [6, 0, 0], [-1, 0, 0], [body]);
    assertClear(safe, [body]);
    // The rocket points along the corrected curve, including the bypass displacement.
    for (const t of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const epsilon = 1e-6;
      const before = bezier(safe, t - epsilon), after = bezier(safe, t + epsilon);
      const numerical = after.map((v, k) => (v - before[k]) / (2 * epsilon)) as V3;
      expect(dist(numerical, bezierTangent(safe, t))).toBeLessThan(1e-7);
    }
  });

  it('keeps the bypass continuous as rotating pad normals cross the route-side sign boundary', () => {
    const startNormal: V3 = [-1, 0, 0];
    const side = flightSide(startNormal, [0, 0, 1]);
    const body: FlightBody = { center: [0, 0, 0], radius: 2.1 };
    const positions: V3[] = [];
    for (const epsilon of [-1e-5, 0, 1e-5]) {
      const arc = arcBetween([-2.2, 0, 0], startNormal, [5, 0, 0], norm([1, epsilon, 0]), [body], side);
      positions.push(bezier(arc, 0.5));
      expect(arcClearsBody(arc, body)).toBe(true);
    }
    expect(dist(positions[0], positions[2])).toBeLessThan(0.001);
  });
});

describe('the launch countdown gesture', () => {
  const hand = (n: 0 | 1 | 2 | 3, extra: Partial<Fingers> = {}): Fingers => ({
    thumb: false, index: n >= 1, middle: n >= 2, ring: n >= 3, pinky: false, ...extra,
  });
  const run = (sequence: [number, Fingers | null][]) => {
    const g = new CountdownGesture();
    const out: number[] = [];
    let t = 0;
    for (const [ms, f] of sequence) for (const end = t + ms; t < end; t += 33) for (const i of g.update(t, f)) if (i.type === 'countdown') out.push(i.n);
    return out;
  };

  it('counts fingers from the index side; the thumb doesn’t matter, the pinky spoils it', () => {
    expect(fingerCount(hand(3))).toBe(3);
    expect(fingerCount(hand(3, { thumb: true }))).toBe(3);
    expect(fingerCount(hand(2))).toBe(2);
    expect(fingerCount(hand(1))).toBe(1);
    expect(fingerCount(hand(3, { pinky: true }))).toBe(0); // an open palm isn't 3
    expect(fingerCount(null)).toBe(0);
  });

  it('3 → 2 → 1, each held a moment, counts down once each', () => {
    expect(run([[400, hand(3)], [400, hand(2)], [400, hand(1)]])).toEqual([3, 2, 1]);
  });

  it('ignores a flicker shorter than the hold, and counts out of order', () => {
    expect(run([[COUNTDOWN.holdMs - 60, hand(3)], [300, null]])).toEqual([]);
    expect(run([[400, hand(2)], [400, hand(1)]])).toEqual([]); // must start at 3
    expect(run([[400, hand(3)], [400, hand(1)]])).toEqual([3]); // skipped 2
  });

  it('starts over if the next count is too slow', () => {
    expect(run([[400, hand(3)], [COUNTDOWN.stepTimeoutMs + 500, null], [400, hand(2)], [400, hand(3)]])).toEqual([3, 3]);
  });

  it('holding a count longer doesn’t repeat it', () => {
    expect(run([[3000, hand(3)]])).toEqual([3]);
  });
});
