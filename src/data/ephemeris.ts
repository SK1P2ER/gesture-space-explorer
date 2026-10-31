import type { Body, CometElements, MoonOrbit, OrbitElements } from './bodies';

// Where the planets are, and which way they face, on a given date.
// Pure math on the data in bodies.ts (sources listed there). Vectors are in
// the J2000 ecliptic frame: x toward the March equinox, z toward ecliptic north.

export type Vec3 = [number, number, number];

/** J2000.0 = 2000-01-01 12:00 TT. TT runs ~69 s ahead of UTC; ignored (≈0.3° of Earth's spin). */
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const DAY_MS = 86_400_000;
const OBLIQUITY = (23.43928 * Math.PI) / 180; // Earth's axial tilt at J2000: equator ↔ ecliptic
/** Light from the Sun takes this long to cross 1 AU. */
export const LIGHT_SECONDS_PER_AU = 499.004784;

const rad = (deg: number) => (deg * Math.PI) / 180;

export const daysSinceJ2000 = (ms: number) => (ms - J2000_MS) / DAY_MS;

/** Heliocentric position of a planet, in AU, from its Keplerian elements. */
export function heliocentric(orbit: OrbitElements, ms: number): Vec3 {
  const T = daysSinceJ2000(ms) / 36_525; // Julian centuries
  const at = ([value, rate]: [number, number]) => value + rate * T;
  const [a, e] = [at(orbit.a), at(orbit.e)];
  const [I, L, peri, node] = [rad(at(orbit.i)), at(orbit.L), at(orbit.peri), at(orbit.node)];
  const argPeri = rad(peri - node);
  const asc = rad(node);

  // Mean anomaly in (-180°, 180°].
  const M = rad((((L - peri + 180) % 360) + 360) % 360 - 180);
  return inEcliptic(a, e, eccentricAnomaly(M, e), argPeri, asc, I);
}

/** Kepler's equation M = E − e·sin E, by Newton's method (robust up to e ≈ 0.99, for comets). */
function eccentricAnomaly(M: number, e: number): number {
  let E = e < 0.8 ? M + e * Math.sin(M) : Math.PI * Math.sign(Math.sin(M)) || Math.PI;
  for (let k = 0; k < 50; k++) {
    const step = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return E;
}

/** A point of an ellipse (eccentric anomaly E), rotated from the orbit's plane into the ecliptic. */
function inEcliptic(a: number, e: number, E: number, argPeri: number, asc: number, I: number): Vec3 {
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const [cw, sw, co, so, ci, si] = [
    Math.cos(argPeri), Math.sin(argPeri), Math.cos(asc), Math.sin(asc), Math.cos(I), Math.sin(I),
  ];
  return [
    (cw * co - sw * so * ci) * xp + (-sw * co - cw * so * ci) * yp,
    (cw * so + sw * co * ci) * xp + (-sw * so + cw * co * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

const JD_UNIX_EPOCH = 2_440_587.5;

/** A comet's semi-major axis (AU) and eccentricity, from its perihelion distance and period. */
export function cometShape(c: CometElements) {
  const a = (c.periodDays / 365.25) ** (2 / 3);
  return { a, e: 1 - c.q / a };
}

/** Heliocentric position of a comet, in AU. */
export function cometPosition(c: CometElements, ms: number): Vec3 {
  const { a, e } = cometShape(c);
  const sinceTp = ms / DAY_MS + JD_UNIX_EPOCH - c.tp;
  const M = (((sinceTp / c.periodDays) % 1) + 1.5) % 1 - 0.5; // (-½, ½] of an orbit
  return inEcliptic(a, e, eccentricAnomaly(M * 2 * Math.PI, e), rad(c.peri), rad(c.node), rad(c.i));
}

/** The first perihelion of a comet after `ms` (Unix ms). */
export function nextPerihelion(c: CometElements, ms: number): number {
  const tpMs = (c.tp - JD_UNIX_EPOCH) * DAY_MS;
  const periodMs = c.periodDays * DAY_MS;
  return tpMs + Math.ceil((ms - tpMs) / periodMs) * periodMs;
}

/** Heliocentric position of a planet, dwarf planet or comet, in AU. */
export function sunCentered(body: Pick<Body, 'orbit' | 'comet'>, ms: number): Vec3 {
  return body.orbit ? heliocentric(body.orbit, ms) : cometPosition(body.comet!, ms);
}

/**
 * Points around a whole orbit (heliocentric, AU), spaced by eccentric anomaly so
 * the tight turn near perihelion stays smooth. Elements as at `ms`.
 */
export function orbitPath(body: Pick<Body, 'orbit' | 'comet'>, ms: number, count = 360): Vec3[] {
  let a: number, e: number, argPeri: number, asc: number, I: number;
  if (body.orbit) {
    const T = daysSinceJ2000(ms) / 36_525;
    const at = ([value, rate]: [number, number]) => value + rate * T;
    [a, e] = [at(body.orbit.a), at(body.orbit.e)];
    [argPeri, asc, I] = [rad(at(body.orbit.peri) - at(body.orbit.node)), rad(at(body.orbit.node)), rad(at(body.orbit.i))];
  } else {
    const c = body.comet!;
    ({ a, e } = cometShape(c));
    [argPeri, asc, I] = [rad(c.peri), rad(c.node), rad(c.i)];
  }
  return Array.from({ length: count + 1 }, (_, k) => inEcliptic(a, e, (k / count) * 2 * Math.PI, argPeri, asc, I));
}

/** Ecliptic longitude, radians. */
export const longitude = (v: Vec3) => Math.atan2(v[1], v[0]);
export const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

/** Seconds sunlight takes to reach a planet at this date. */
export const lightSeconds = (orbit: OrbitElements, ms: number) => length(heliocentric(orbit, ms)) * LIGHT_SECONDS_PER_AU;

/** J2000 equatorial → J2000 ecliptic. */
export function eclipticFromEquatorial([x, y, z]: Vec3): Vec3 {
  const [c, s] = [Math.cos(OBLIQUITY), Math.sin(OBLIQUITY)];
  return [x, c * y + s * z, -s * y + c * z];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export interface SpinFrame {
  /** North pole (unit vector). */
  pole: Vec3;
  /** Where the prime meridian points when W = 0: the node of the body's equator on Earth's J2000 equator (IAU). */
  node: Vec3;
  /** Prime meridian angle W at this time, radians, measured east from `node`. */
  w: number;
}

/** A body's orientation at a time (IAU convention). */
export function spinFrame(body: Pick<Body, 'pole' | 'spin'>, ms: number): SpinFrame {
  const [ra, dec] = [rad(body.pole.ra), rad(body.pole.dec)];
  return {
    pole: eclipticFromEquatorial([Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]),
    node: eclipticFromEquatorial([-Math.sin(ra), Math.cos(ra), 0]),
    w: rad(body.spin.w0 + body.spin.degPerDay * daysSinceJ2000(ms)),
  };
}

/** The prime meridian (longitude 0) direction at this time. */
export function primeMeridian(frame: SpinFrame): Vec3 {
  const east = cross(frame.pole, frame.node);
  const [c, s] = [Math.cos(frame.w), Math.sin(frame.w)];
  return [0, 1, 2].map((k) => frame.node[k] * c + east[k] * s) as Vec3;
}

// ------------------------------------------------------------------ moons ----
//
// A moon's position is an angle along its orbit (moonAngle) and the direction
// that angle points from its planet (moonDirection). The scene may show the
// angle running slower than real when time is fast-forwarded, so the two are
// kept apart.
//
// - Galilean moons and Titan: circles in the planet's equatorial plane at mean
//   longitude L0 + n·days, measured from the IAU node of that plane (like the
//   planet's spin). L0 and n were fitted to JPL Horizons, 1950–2100: within
//   1.2° for the Galilean moons, and 0.1° for Titan with its eccentricity term.
// - The Moon: Meeus, Astronomical Algorithms, ch. 47 — the six largest terms in
//   longitude, referred to the J2000 equinox (within 0.3° of Horizons), and an
//   orbit tilted 5.145° to the ecliptic about its regressing node.

const PRECESSION_PER_CENTURY = 1.3969713; // general precession in longitude, degrees: of-date → J2000

/** The Moon's mean arguments (degrees) at `T` Julian centuries from J2000. */
function lunarArguments(T: number) {
  return {
    L: 218.3164477 + 481267.88123421 * T - PRECESSION_PER_CENTURY * T, // mean longitude, J2000 equinox
    D: 297.8501921 + 445267.1114034 * T, // mean elongation from the Sun
    M: 357.5291092 + 35999.0502909 * T, // Sun's mean anomaly
    Mp: 134.9633964 + 477198.8675055 * T, // Moon's mean anomaly
    F: 93.272095 + 483202.0175233 * T, // argument of latitude
  };
}

const LUNAR_INCLINATION = 5.145;

/** Exact angle along the orbit at this time, radians: in-plane longitude (equator model) or ecliptic longitude (the Moon). */
export function moonAngle(orbit: MoonOrbit, ms: number): number {
  const d = daysSinceJ2000(ms);
  if (orbit.model === 'lunar') {
    const { L, D, M, Mp, F } = lunarArguments(d / 36_525);
    const s = (deg: number) => Math.sin(rad(deg));
    return rad(L + 6.288774 * s(Mp) + 1.274027 * s(2 * D - Mp) + 0.658314 * s(2 * D) + 0.213618 * s(2 * Mp) - 0.185116 * s(M) - 0.114332 * s(2 * F));
  }
  let L = orbit.L0! + orbit.n * d;
  if (orbit.center) {
    const peri = orbit.center.peri0 + orbit.center.periRate * (d / 365.25);
    L += orbit.center.amplitude * Math.sin(rad(L - peri));
  }
  return rad(L);
}

/** Direction from the planet to the moon (unit vector, J2000 ecliptic) for an angle along its orbit. */
export function moonDirection(orbit: MoonOrbit, planet: Pick<Body, 'pole' | 'spin'>, angle: number, ms: number): Vec3 {
  if (orbit.model === 'lunar') {
    const { L, F } = lunarArguments(daysSinceJ2000(ms) / 36_525);
    const node = rad(L - F); // ascending node, J2000 equinox
    const lat = rad(LUNAR_INCLINATION) * Math.sin(angle - node);
    return [Math.cos(lat) * Math.cos(angle), Math.cos(lat) * Math.sin(angle), Math.sin(lat)];
  }
  const { pole, node } = spinFrame(planet, 0);
  const east = cross(pole, node);
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return [0, 1, 2].map((k) => node[k] * c + east[k] * s) as Vec3;
}

/** The pole of a moon's orbit plane (J2000 ecliptic), for drawing its orbit. */
export function moonOrbitPole(orbit: MoonOrbit, planet: Pick<Body, 'pole' | 'spin'>, ms: number): Vec3 {
  if (orbit.model === 'lunar') {
    const { L, F } = lunarArguments(daysSinceJ2000(ms) / 36_525);
    const node = rad(L - F);
    const i = rad(LUNAR_INCLINATION);
    return [Math.sin(i) * Math.sin(node), -Math.sin(i) * Math.cos(node), Math.cos(i)];
  }
  return spinFrame(planet, 0).pole;
}
