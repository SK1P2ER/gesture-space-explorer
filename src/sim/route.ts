import { BODIES, type Body } from '../data/bodies';
import { heliocentric, length } from '../data/ephemeris';

// The numbers on the mission HUD: how far a trip really is (from the ephemeris,
// not the squeezed scene), how much fuel it takes, and the mini-map's layout.
// Pure, so they can be tested.

export const KM_PER_AU = 149_597_870.7;

const byId = (id: string) => BODIES.find((b) => b.id === id)!;
/** The planet a body belongs to (itself, or a moon's parent). */
const planetOf = (b: Body) => (b.parent ? byId(b.parent) : b);

/**
 * Straight-line distance between two bodies on a date, km. Moons count as their
 * planet, plus their orbit's size when the trip stays in one planet's system.
 */
export function routeKm(fromId: string, toId: string, ms: number): number {
  const [a, b] = [byId(fromId), byId(toId)];
  const [pa, pb] = [planetOf(a), planetOf(b)];
  if (pa === pb) return Math.abs((a.moon?.aKm ?? 0) - (b.moon?.aKm ?? 0)) || (a.moon ?? b.moon)?.aKm || 0;
  const [ha, hb] = [heliocentric(pa.orbit!, ms), heliocentric(pb.orbit!, ms)];
  return length([ha[0] - hb[0], ha[1] - hb[1], ha[2] - hb[2]]) * KM_PER_AU;
}

/** The share of a full tank a trip burns: a hop to the Moon a little, out to Saturn most of it. */
export function tripFuel(km: number): number {
  return Math.min(0.85, 0.12 + 0.12 * Math.sqrt(km / KM_PER_AU));
}

/** Fuel left (0 … 1) partway through a trip that burns `cost` (bases refuel you to full). */
export const fuelLeft = (progress: number, cost: number) => 1 - cost * Math.min(1, Math.max(0, progress));

/**
 * Mini-map: a point in the orbit plane (scene x, z) → map coordinates in −1 … 1.
 * Distance from the Sun goes on a log scale, so Mercury and Neptune both fit.
 */
export function mapPoint(x: number, z: number, maxRadius: number): [number, number] {
  const r = Math.hypot(x, z);
  if (r === 0) return [0, 0];
  const s = Math.log1p(r) / Math.log1p(maxRadius) / r;
  return [x * s, z * s];
}

