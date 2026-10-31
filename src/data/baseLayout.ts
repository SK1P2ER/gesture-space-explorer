// Declarative base layouts (v2.1): what stands where around a base's landing
// pad, so a base is a data change, not code. Units are the base's own: the
// footprint the v2.0 bases were drawn in is 1, the pad sits at the origin with
// radius 0.35 (scene/bases.ts PAD_RADIUS); x is east, z is south.
// Pure (no three.js), so layouts can be checked in tests.

export type ModuleKind = 'habitat' | 'greenhouse' | 'garage' | 'antenna' | 'flag' | 'solarField';

export interface Module {
  id: string;
  kind: ModuleKind;
  x: number;
  z: number;
  /** Turn about the local up, degrees (counterclockwise seen from above). */
  rot?: number;
  /** Solar fields: panels across and along. */
  cols?: number;
  rows?: number;
}

/** A pressurized tube between two modules (by id). */
export interface Tunnel {
  from: string;
  to: string;
}

export type Point = [x: number, z: number];

export interface BaseLayout {
  modules: Module[];
  tunnels: Tunnel[];
  /** Rovers drive these closed loops. */
  roverLoops: Point[][];
  /** Astronauts walk these back and forth. */
  walks: Point[][];
  /** The ground patch's radius (it fades out at its rim). */
  terrainRadius: number;
  /** How much of the base BaseView frames (× the v2.0 footprint). */
  frame: number;
}

export const PAD_CLEARANCE = 0.35 + 0.1;
export const TUNNEL_RADIUS = 0.035;
/** Astronauts are thinner than rovers. */
export const WALKER_HALF_WIDTH = 0.015;
/** A rover, wheels included (scene/baseKit/showcase.ts builds it to this), base units. */
export const ROVER = { length: 0.08, width: 0.064 };
/** Half the strip a rover sweeps as it turns along its loop: its half-diagonal. */
export const ROVER_SWEEP = Math.hypot(ROVER.length, ROVER.width) / 2;
/** Solar panels: size and spacing in a field. */
export const PANEL = { w: 0.12, d: 0.08, gapX: 0.04, gapZ: 0.06 };

/** Half sizes (x, z) of each kind's footprint before rotation; round kinds use `r`. */
const SHAPE: Record<Exclude<ModuleKind, 'solarField'>, { r: number } | { hw: number; hd: number }> = {
  habitat: { r: 0.16 },
  greenhouse: { hw: 0.21, hd: 0.08 },
  garage: { hw: 0.13, hd: 0.1 },
  antenna: { r: 0.09 },
  flag: { r: 0.02 },
};

export function solarFieldSize(m: Module) {
  const [cols, rows] = [m.cols ?? 3, m.rows ?? 4];
  return { w: cols * PANEL.w + (cols - 1) * PANEL.gapX, d: rows * PANEL.d + (rows - 1) * PANEL.gapZ };
}

/** The module's footprint as a convex polygon (circles as 16-gons), in layout coordinates. */
export function footprint(m: Module): Point[] {
  const shape = m.kind === 'solarField' ? { hw: solarFieldSize(m).w / 2, hd: solarFieldSize(m).d / 2 } : SHAPE[m.kind];
  if ('r' in shape) return Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return [m.x + Math.cos(a) * shape.r, m.z + Math.sin(a) * shape.r] as Point;
  });
  const a = ((m.rot ?? 0) * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sz]) => {
    const [lx, lz] = [sx * shape.hw, sz * shape.hd];
    return [m.x + lx * c + lz * s, m.z - lx * s + lz * c] as Point;
  });
}

/** A tunnel's footprint: a thin rectangle between its two modules' centers. */
export function tunnelFootprint(a: Module, b: Module): Point[] {
  const [dx, dz] = [b.x - a.x, b.z - a.z];
  const len = Math.hypot(dx, dz) || 1;
  const [nx, nz] = [(-dz / len) * TUNNEL_RADIUS, (dx / len) * TUNNEL_RADIUS];
  return [[a.x + nx, a.z + nz], [b.x + nx, b.z + nz], [b.x - nx, b.z - nz], [a.x - nx, a.z - nz]];
}

/** Separating-axis test for two convex polygons: true if they overlap (touching counts as apart). */
export function polygonsOverlap(p: Point[], q: Point[]): boolean {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, z1] = poly[i];
      const [x2, z2] = poly[(i + 1) % poly.length];
      const [ax, az] = [z1 - z2, x2 - x1];
      const proj = (pts: Point[]) => pts.map(([x, z]) => x * ax + z * az);
      const [pa, qa] = [proj(p), proj(q)];
      if (Math.max(...pa) <= Math.min(...qa) || Math.max(...qa) <= Math.min(...pa)) return false;
    }
  }
  return true;
}

/** Shortest distance from a point to a segment. */
export function pointSegmentDistance([px, pz]: Point, [ax, az]: Point, [bx, bz]: Point): number {
  const [dx, dz] = [bx - ax, bz - az];
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Does the segment, thickened by `half` each side, cross the polygon? */
export function segmentHitsPolygon(a: Point, b: Point, half: number, poly: Point[]): boolean {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(dx, dz) || 1;
  const [nx, nz] = [(-dz / len) * half, (dx / len) * half];
  return polygonsOverlap([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]], poly);
}

/** Every reason a layout is unsound (empty when it's fine). */
export function layoutProblems(layout: BaseLayout, moverHalfWidth = 0.04): string[] {
  const problems: string[] = [];
  const byId = new Map(layout.modules.map((m) => [m.id, m]));
  const shapes = layout.modules.map((m) => ({ id: m.id, poly: footprint(m) }));
  const tunnels = layout.tunnels.map((t) => {
    const [a, b] = [byId.get(t.from), byId.get(t.to)];
    if (!a || !b) problems.push(`tunnel ${t.from}–${t.to}: unknown module`);
    return { id: `tunnel ${t.from}–${t.to}`, ends: [t.from, t.to], poly: a && b ? tunnelFootprint(a, b) : [] };
  });
  const near = (poly: Point[]) => Math.min(...poly.map((p) => Math.hypot(...p)));
  const far = (poly: Point[]) => Math.max(...poly.map((p) => Math.hypot(...p)));

  for (const s of shapes) {
    if (near(s.poly) < PAD_CLEARANCE) problems.push(`${s.id}: too close to the landing pad`);
    if (far(s.poly) > layout.terrainRadius * 0.8) problems.push(`${s.id}: off the ground patch`);
  }
  for (let i = 0; i < shapes.length; i++)
    for (let j = i + 1; j < shapes.length; j++)
      if (polygonsOverlap(shapes[i].poly, shapes[j].poly)) problems.push(`${shapes[i].id} overlaps ${shapes[j].id}`);
  for (const t of tunnels) {
    if (!t.poly.length) continue;
    const [a, b] = [byId.get(t.ends[0])!, byId.get(t.ends[1])!];
    if (pointSegmentDistance([0, 0], [a.x, a.z], [b.x, b.z]) < PAD_CLEARANCE) problems.push(`${t.id}: crosses the landing pad`);
    for (const s of shapes) if (!t.ends.includes(s.id) && polygonsOverlap(t.poly, s.poly)) problems.push(`${t.id} runs through ${s.id}`);
  }
  const obstacles = [...shapes, ...tunnels.filter((t) => t.poly.length)];
  const checkPath = (name: string, pts: Point[], closed: boolean, half: number) => {
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
      if (pointSegmentDistance([0, 0], a, b) < PAD_CLEARANCE + half) problems.push(`${name}: leg ${i} crosses the landing pad`);
      for (const o of obstacles) if (segmentHitsPolygon(a, b, half, o.poly)) problems.push(`${name}: leg ${i} runs through ${o.id}`);
      if (Math.max(Math.hypot(...a), Math.hypot(...b)) > layout.terrainRadius * 0.8) problems.push(`${name}: leg ${i} leaves the ground patch`);
    }
  };
  layout.roverLoops.forEach((l, i) => checkPath(`rover loop ${i}`, l, true, moverHalfWidth));
  layout.walks.forEach((w, i) => checkPath(`walk ${i}`, w, false, WALKER_HALF_WIDTH));
  return problems;
}

/**
 * Where a point of the layout sits on a round world: the base's frame has y up at
 * the pad, but the ground falls away with the curvature (radius R in base units).
 * Returns the height below the pad's plane and the local up there.
 */
export function onSphere(x: number, z: number, R: number): { y: number; up: [number, number, number] } {
  const d2 = x * x + z * z;
  const y = Math.sqrt(Math.max(0, R * R - d2)) - R;
  const len = Math.sqrt(d2 + (y + R) ** 2);
  return { y, up: [x / len, (y + R) / len, z / len] };
}

/** Length of a polyline (closed: back to the start). */
export function pathLength(pts: Point[], closed: boolean): number {
  let L = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) L += Math.hypot(pts[(i + 1) % pts.length][0] - pts[i][0], pts[(i + 1) % pts.length][1] - pts[i][1]);
  return L;
}

/** The point at distance `s` along a polyline, and the heading there (radians from +x toward +z). */
export function along(pts: Point[], closed: boolean, s: number): { p: Point; heading: number } {
  const n = closed ? pts.length : pts.length - 1;
  let left = s;
  for (let i = 0; i < n; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= len || i === n - 1) {
      const t = len ? Math.min(1, Math.max(0, left / len)) : 0;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    }
    left -= len;
  }
  return { p: pts[0], heading: 0 };
}
