import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FOLLOW_STOPS, LEGACY_FOLLOW_STOPS, followEye, type FollowStop } from '../src/scene/followPath';

/**
 * Passenger Campus (P2.5): the Follow camera must see the launch through the whole run. Every half frame (1…480),
 * the line of sight from the Follow eye to the pad axis — at the heights the rocket target passes, 41 m (on the pad,
 * rocket + 28) up to 300 m (late ascent) — must not cross any site collider, and the eye must never be inside one.
 * The colliders are the exporter's bounds of the campus buildings (terminal roof, concourse, tower, collar, dome).
 */
type Box = { min: number[]; max: number[] };
const site = JSON.parse(readFileSync('public/spaceport/site.json', 'utf8')) as { colliders: Box[] };
const HEIGHTS = [41, 80, 160, 300];

/** Does the segment p→q cross the box (slab test)? */
function crosses(p: number[], q: number[], box: Box) {
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = q[i] - p[i];
    if (Math.abs(d) < 1e-9) { if (p[i] < box.min[i] || p[i] > box.max[i]) return false; continue; }
    let a = (box.min[i] - p[i]) / d, b = (box.max[i] - p[i]) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}
const inside = (p: number[], box: Box, margin = 2) => p.every((v, i) => v >= box.min[i] - margin && v <= box.max[i] + margin);

function problems(stops: readonly FollowStop[]) {
  const found: string[] = [];
  for (let frame = 1; frame <= 480; frame += 0.5) {
    const eye = followEye(frame, stops);
    site.colliders.forEach((box, c) => {
      if (inside(eye, box)) found.push(`frame ${frame}: eye inside collider ${c}`);
      for (const h of HEIGHTS) if (crosses(eye, [0, h, 0], box)) found.push(`frame ${frame}: collider ${c} blocks the view to the pad at ${h} m`);
    });
  }
  return found;
}

describe('Follow camera path over the Passenger Campus', () => {
  it('has a clear line of sight to the launch in every frame, and never enters a building', () => {
    expect(problems(FOLLOW_STOPS)).toEqual([]);
  });
  it('(regression) the previous path ran into the terminal', () => {
    const old = problems(LEGACY_FOLLOW_STOPS);
    expect(old.length).toBeGreaterThan(0);
    expect(old.some(p => /collider 0|collider 1/.test(p))).toBe(true); // terminal roof / concourse glazing
  });
  it('starts where the app starts it and keeps the stops in order', () => {
    expect(followEye(1)).toEqual([-28, 28, -201]);
    expect(followEye(480)).toEqual([-37, 300, -276]);
    for (let i = 1; i < FOLLOW_STOPS.length; i++) expect(FOLLOW_STOPS[i][0]).toBeGreaterThan(FOLLOW_STOPS[i - 1][0]);
  });
});
