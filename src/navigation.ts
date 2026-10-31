import type { Body } from './data/bodies';

// Where ← → (and ✌️), M, pointing and clicking can take you. Pure, so it can be tested.
//
// ← → step through the Sun and the planets. Moons are reached from their
// planet: M steps planet → its moons → back to the planet, and while a planet
// (or one of its moons) is focused, its moons can be pointed at or clicked.

/** The planet a body belongs to: its own id, or its parent's for a moon. */
export const systemOf = (body: Body) => body.parent ?? body.id;

/** ← → from `index`: the next top-level body (a moon counts as its planet). */
export function step(bodies: Body[], index: number, dir: 1 | -1): number {
  const top = bodies.flatMap((b, i) => (b.kind === 'moon' ? [] : [i]));
  const here = bodies[index].parent ? bodies.findIndex((b) => b.id === bodies[index].parent) : index;
  return top[(top.indexOf(here) + dir + top.length) % top.length];
}

/** M from `index`: planet → first moon → … → last moon → planet. Null when the system has no moons. */
export function nextInSystem(bodies: Body[], index: number): number | null {
  const system = systemOf(bodies[index]);
  const moons = bodies.flatMap((b, i) => (b.parent === system ? [i] : []));
  if (!moons.length) return null;
  const cycle = [bodies.findIndex((b) => b.id === system), ...moons];
  return cycle[(cycle.indexOf(index) + 1) % cycle.length];
}

/** What pointing and clicking can pick: every top-level body, plus the moons of the system in focus. */
export const pickable = (focused: Body) => (body: Body) => body.kind !== 'moon' || body.parent === systemOf(focused);
