import { BODIES } from '../data/bodies';
import { heliocentric, longitude } from '../data/ephemeris';

// Launch windows (decision 23): when a Hohmann transfer from one planet to another can leave. A
// Hohmann transfer is half an ellipse touching both orbits; it arrives where the target will be
// if, at departure, the target leads the origin by the phase angle
//
//   φ = 180° − 360° · t / T₂        t = ½ · ((a₁ + a₂) / 2)^1.5 years (Kepler's third law), T₂ = a₂^1.5 years
//
// The planets' real longitudes come from the ephemeris (data/ephemeris.ts: JPL's approximate
// elements, valid 1800–2050, extrapolated beyond). Circular, coplanar orbits are assumed for φ, so a
// window found here can be weeks off a mission planner's minimum-energy date: good for a fictional
// 2126 timetable, not for flying. Pure, so it can be tested.

const DAY_MS = 86_400_000;
/** Earth's sidereal year, days: the unit of Kepler's third law in AU. */
const YEAR_DAYS = 365.256363;

const wrap180 = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** A Hohmann transfer between circular orbits of a₁ and a₂ AU: how long it takes, and the target's lead at departure. */
export function hohmann(a1: number, a2: number): { transferDays: number; phaseDeg: number } {
  const transferDays = 0.5 * ((a1 + a2) / 2) ** 1.5 * YEAR_DAYS;
  const phaseDeg = 180 - (360 * transferDays) / (a2 ** 1.5 * YEAR_DAYS);
  return { transferDays, phaseDeg };
}

export interface LaunchWindow {
  /** The departure (ms, UTC) when the target leads by exactly the Hohmann phase angle. */
  at: number;
  /** How long the Hohmann transfer takes, days. */
  transferDays: number;
  /** The phase angle it needs, degrees. */
  phaseDeg: number;
}

/** The target's lead over the origin (degrees), from the ephemeris. */
function lead(from: (typeof BODIES)[number], to: (typeof BODIES)[number], ms: number) {
  return (longitude(heliocentric(to.orbit!, ms)) - longitude(heliocentric(from.orbit!, ms))) * (180 / Math.PI);
}

/** How far the target leads the origin at a moment, degrees (−180…180); null for anything but two planets. */
export function targetLead(fromId: string, toId: string, ms: number): number | null {
  const from = BODIES.find((b) => b.id === fromId), to = BODIES.find((b) => b.id === toId);
  return from?.orbit && to?.orbit && !from.parent && !to.parent ? wrap180(lead(from, to, ms)) : null;
}

/**
 * The launch windows from one planet to another that open in a calendar year (UTC): none or one for
 * Earth → Mars (they come every 26 months or so). Planets only: moons and the Sun have no window.
 */
export function launchWindows(fromId: string, toId: string, year: number): LaunchWindow[] {
  const from = BODIES.find((b) => b.id === fromId), to = BODIES.find((b) => b.id === toId);
  if (!from?.orbit || !to?.orbit || from === to || from.parent || to.parent) return [];
  const { transferDays, phaseDeg } = hohmann(from.orbit.a[0], to.orbit.a[0]);
  const miss = (ms: number) => wrap180(lead(from, to, ms) - phaseDeg);
  const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1);
  const windows: LaunchWindow[] = [];
  for (let t0 = start, m0 = miss(t0); t0 < end; ) {
    const t1 = Math.min(t0 + DAY_MS, end), m1 = miss(t1);
    // A crossing, not the ±180° seam (where the miss jumps by ~360° in a day).
    if (Math.sign(m0) !== Math.sign(m1) && Math.abs(m1 - m0) < 90) {
      let [lo, hi, mLo] = [t0, t1, m0];
      while (hi - lo > 60_000) {
        const mid = (lo + hi) / 2, mMid = miss(mid);
        if (Math.sign(mMid) === Math.sign(mLo)) [lo, mLo] = [mid, mMid];
        else hi = mid;
      }
      const at = Math.round((lo + hi) / 2);
      if (at >= start && at < end) windows.push({ at, transferDays, phaseDeg });
    }
    [t0, m0] = [t1, m1];
  }
  return windows;
}

/**
 * The first window on or after a moment, looking a few years ahead (Earth → Mars comes every ~26
 * months, so a calendar year can have none: 2126 has none, between 2125-01 and 2127-03).
 */
export function nextLaunchWindow(fromId: string, toId: string, after: number, years = 4): LaunchWindow | null {
  const first = new Date(after).getUTCFullYear();
  for (let year = first; year < first + years; year++) {
    const found = launchWindows(fromId, toId, year).find((w) => w.at >= after);
    if (found) return found;
  }
  return null;
}
