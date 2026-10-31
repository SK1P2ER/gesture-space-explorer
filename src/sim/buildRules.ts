import { footprint, PAD_CLEARANCE, ROVER_SWEEP, WALKER_HALF_WIDTH, polygonsOverlap, segmentHitsPolygon, tunnelFootprint, type BaseLayout, type Point } from '../data/baseLayout';

// Base building (v2.1, behind ?flags=build): the rules, pure and deterministic,
// so the renderer only shows their state and tests can check every claim.
//
// - Modules sit on a grid of square cells round the base (one module per cell).
// - Power over a whole sol, hour by hour of local solar time: solar arrays make
//   power from the Sun's height and the season's dust; habitats, oxygen plants
//   and greenhouses use it; batteries store it. The base is powered if the
//   batteries never run empty across the sol (from a steady state).
// - Oxygen: plants make it, greenhouses make it if a habitat is near, habitats
//   use it. It needs power: an unpowered base makes none.
// - Levels 1 → 3 as the base grows; once earned, a level is kept (see best()).
//
// Stylized numbers (a game, not an engineering model): "kW" and "kWh" per local
// hour (1/24 sol).

export type BuildKind = 'habitat' | 'solar' | 'battery' | 'oxygen' | 'greenhouse';
export const BUILD_KINDS: readonly BuildKind[] = ['habitat', 'solar', 'battery', 'oxygen', 'greenhouse'];

export interface Placed {
  kind: BuildKind;
  /** Grid cell (i east, j south). */
  i: number;
  j: number;
  /** Quarter turns (looks only). */
  rot: 0 | 1 | 2 | 3;
}

/** Cell size in base units (the v2.0 footprint is 1), and how far out you may build. */
export const CELL = 0.25;
export const BUILD_RADIUS = 1.85;
export const MAX_MODULES = 24;
/** Room kept clear either side of a rover's or astronaut's path, beyond its own width. */
export const PATH_MARGIN = 0.02;

export const SPEC: Record<BuildKind, { power: number; oxygen: number; storage: number }> = {
  habitat: { power: -1, oxygen: -1, storage: 0 },
  solar: { power: 4, oxygen: 0, storage: 0 }, // at the Sun overhead in clear air
  battery: { power: 0, oxygen: 0, storage: 20 },
  oxygen: { power: -1.5, oxygen: 2, storage: 0 },
  greenhouse: { power: -0.5, oxygen: 1, storage: 0 },
};
/** A greenhouse needs a habitat within this many cells (or one of the base's own). */
export const GREENHOUSE_REACH = 2;

export const cellCenter = (i: number, j: number): Point => [i * CELL, j * CELL];
export const cellAt = (x: number, z: number): [number, number] => [Math.round(x / CELL), Math.round(z / CELL)];

export function cellSquare(i: number, j: number, shrink = 0.02): Point[] {
  const [x, z] = cellCenter(i, j);
  const h = CELL / 2 - shrink;
  return [[x - h, z - h], [x + h, z - h], [x + h, z + h], [x - h, z + h]];
}

/** Why a cell can't take a module (null: it can). Occupied cells count unless `ignore` is that module. */
export function cellBlocked(base: BaseLayout, placed: readonly Placed[], i: number, j: number, ignore?: Placed): 'outside' | 'pad' | 'building' | 'path' | 'occupied' | null {
  const [x, z] = cellCenter(i, j);
  if (Math.hypot(x, z) > BUILD_RADIUS) return 'outside';
  if (Math.hypot(x, z) < PAD_CLEARANCE + CELL * 0.71) return 'pad';
  const sq = cellSquare(i, j);
  const byId = new Map(base.modules.map((m) => [m.id, m]));
  for (const m of base.modules) if (polygonsOverlap(sq, footprint(m))) return 'building';
  for (const t of base.tunnels) if (polygonsOverlap(sq, tunnelFootprint(byId.get(t.from)!, byId.get(t.to)!))) return 'building';
  // Rovers sweep their full width (and a margin) along their loops; astronauts a narrow strip.
  const full = cellSquare(i, j, 0); // paths: the whole cell (a module may fill it)
  const paths = [
    ...base.roverLoops.map((l) => ({ pts: l, closed: true, half: ROVER_SWEEP + PATH_MARGIN })),
    ...base.walks.map((w) => ({ pts: w, closed: false, half: WALKER_HALF_WIDTH + PATH_MARGIN })),
  ];
  for (const { pts, closed, half } of paths) {
    const n = closed ? pts.length : pts.length - 1;
    for (let k = 0; k < n; k++) if (segmentHitsPolygon(pts[k], pts[(k + 1) % pts.length], half, full)) return 'path';
  }
  if (placed.some((p) => p !== ignore && p.i === i && p.j === j)) return 'occupied';
  return null;
}

// ---------------------------------------------------------------- the Sun and dust ----

/** The Sun's height (sine) at a local solar hour, from latitude and the Sun's declination (degrees). */
export function sunSine(hour: number, latDeg: number, decDeg: number): number {
  const r = Math.PI / 180;
  const H = (hour - 12) * 15 * r;
  return Math.sin(latDeg * r) * Math.sin(decDeg * r) + Math.cos(latDeg * r) * Math.cos(decDeg * r) * Math.cos(H);
}

/**
 * How much sunlight the dust lets through, by season (Ls, degrees): clear for most of the
 * year, worst around Ls 255° (southern summer, the dust-storm season) at 0.6. Stylized.
 */
export function dustFactor(lsDeg: number): number {
  const d = ((lsDeg - 255 + 540) % 360) - 180; // −180 … 180 around the peak
  return Math.abs(d) >= 75 ? 1 : 1 - 0.4 * Math.cos((d / 75) * (Math.PI / 2));
}

export interface SolConditions {
  latDeg: number;
  decDeg: number;
  /** 0–1: sunlight let through by dust. */
  dust: number;
}

// ---------------------------------------------------------------- the balance ----

export interface BaseStatus {
  modules: number;
  /** Power left over each local hour 0…23 (kW), and the batteries' charge at the end of it (kWh). */
  net: number[];
  charge: number[];
  capacity: number;
  /** Batteries never run empty across the sol. */
  powered: boolean;
  /** Hours when the base runs out of power. */
  shortHours: number[];
  /** Oxygen made minus used (units); 0 or more is enough. Nothing is made without power. */
  oxygen: number;
  /** Greenhouses with no habitat near: they make no oxygen. */
  idleGreenhouses: number;
  /** The level the base qualifies for right now (1–3). */
  level: 1 | 2 | 3;
}

/** Does this greenhouse have a habitat within reach (a placed one, or one of the base's own)? */
function greenhouseWorks(g: Placed, placed: readonly Placed[], base: BaseLayout): boolean {
  if (placed.some((p) => p.kind === 'habitat' && Math.max(Math.abs(p.i - g.i), Math.abs(p.j - g.j)) <= GREENHOUSE_REACH)) return true;
  const [x, z] = cellCenter(g.i, g.j);
  return base.modules.some((m) => m.kind === 'habitat' && Math.hypot(m.x - x, m.z - z) <= GREENHOUSE_REACH * CELL + 0.16);
}

/** The base over one sol: power hour by hour, oxygen, and the level it qualifies for. */
export function evaluate(base: BaseLayout, placed: readonly Placed[], sol: SolConditions): BaseStatus {
  const count = (k: BuildKind) => placed.filter((p) => p.kind === k).length;
  const load = placed.reduce((s, p) => s + Math.min(0, SPEC[p.kind].power), 0); // negative
  const solarPeak = count('solar') * SPEC.solar.power * sol.dust;
  const capacity = count('battery') * SPEC.battery.storage;
  const net = Array.from({ length: 24 }, (_, h) => solarPeak * Math.max(0, sunSine(h + 0.5, sol.latDeg, sol.decDeg)) + load);
  // Run the sol three times from half full, so the batteries reach their daily rhythm; judge the last.
  let c = capacity / 2;
  const charge: number[] = [];
  const shortHours: number[] = [];
  for (let pass = 0; pass < 3; pass++) {
    for (let h = 0; h < 24; h++) {
      c += net[h];
      if (c < -1e-9) {
        if (pass === 2) shortHours.push(h);
        c = 0;
      }
      c = Math.min(capacity, c);
      if (pass === 2) charge.push(c);
    }
  }
  const powered = shortHours.length === 0;
  const idleGreenhouses = placed.filter((p) => p.kind === 'greenhouse' && !greenhouseWorks(p, placed, base)).length;
  const made = powered ? count('oxygen') * SPEC.oxygen.oxygen + (count('greenhouse') - idleGreenhouses) * SPEC.greenhouse.oxygen : 0;
  const oxygen = made + count('habitat') * SPEC.habitat.oxygen;
  const working = powered && oxygen >= 0;
  const workingGreenhouse = count('greenhouse') - idleGreenhouses > 0;
  const level: 1 | 2 | 3 = working && placed.length >= 8 && workingGreenhouse ? 3 : working && placed.length >= 3 ? 2 : 1;
  return { modules: placed.length, net, charge, capacity, powered, shortHours, oxygen, idleGreenhouses, level };
}

/** Levels are kept once earned: the best of what was stored and what the base qualifies for now. */
export const best = (stored: number | undefined, now: 1 | 2 | 3): 1 | 2 | 3 => Math.max(stored ?? 1, now) as 1 | 2 | 3;

// ---------------------------------------------------------------- undo / redo ----

/** A layout history: every change is a new layout; undo and redo step through them. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(public present: T, private readonly limit = 100) {}

  push(next: T) {
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (prev === undefined) return false;
    this.future.push(this.present);
    this.present = prev;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.present);
    this.present = next;
    return true;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }
}

// ---------------------------------------------------------------- storage ----

/** Whatever was stored → a layout (anything malformed dropped, never thrown). */
export function parsePlaced(text: string | null | undefined, base: BaseLayout): Placed[] {
  if (!text) return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: Placed[] = [];
  for (const d of data) {
    if (!d || typeof d !== 'object') continue;
    const { kind, i, j, rot } = d as Record<string, unknown>;
    if (!BUILD_KINDS.includes(kind as BuildKind) || !Number.isInteger(i) || !Number.isInteger(j)) continue;
    const p: Placed = { kind: kind as BuildKind, i: i as number, j: j as number, rot: ([0, 1, 2, 3].includes(rot as number) ? rot : 0) as Placed['rot'] };
    if (out.length < MAX_MODULES && !cellBlocked(base, out, p.i, p.j)) out.push(p);
  }
  return out;
}
