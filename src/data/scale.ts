// Scene scale: real sizes and distances, compressed so the whole system fits
// on screen and every planet is clearly visible from the overview.
//
// - Radius ∝ diameter^0.38, with Earth = 2 units: size order stays right
//   (Mercury < Mars < Venus < Earth < … < Jupiter) while small planets stay
//   readable next to the giants. The Sun gets a fixed size.
// - Orbits are log-compressed: the gaps between Mercury, Venus, Earth, Mars
//   and Jupiter follow ln(real distance in AU) exactly. A minimum clearance
//   keeps neighbours — their rings, and their moons — from overlapping when
//   they line up. Earth's Moon nudges Earth and Mars out a little; Jupiter's
//   moons and Saturn's rings push Saturn, Uranus and Neptune out.
// - Moons follow the same size law at half scale (moonRadius), so they stay
//   comparable with each other and smaller than any planet on screen. Their
//   distances get their own compression (sceneMoonOrbits): the innermost just
//   outside the planet's rings or atmosphere, the rest spaced by log distance
//   like the planets, with a minimum gap. Real moon distances (60 Earth radii
//   for the Moon) would put them off screen, or into the neighbours' orbits.

export const SCALE = {
  sunRadius: 8,
  earthRadius: 2,
  radiusExponent: 0.38,
  unitsPerLn: 20, // orbit spacing per e-fold of real distance
  clearance: 2, // minimum gap between neighbours' outer edges
};

export const MOON_SCALE = {
  size: 0.5, // × the planets' size law
  unitsPerLn: 4, // spacing per e-fold of real distance
  gap: 0.5, // minimum gap: planet (rings, atmosphere) → first moon, and between moons
};

/** Atmosphere halo radius, × planet radius. */
export const ATMOSPHERE_SHELL = 1.06;

const EARTH_DIAMETER_KM = 12_742;
const MERCURY_AU = 0.387;
const SUN_GLOW = 1.6; // × sun radius kept clear of planets (corona + bloom)

export function sceneRadius(diameterKm: number): number {
  return SCALE.earthRadius * (diameterKm / EARTH_DIAMETER_KM) ** SCALE.radiusExponent;
}

export const moonRadius = (diameterKm: number) => sceneRadius(diameterKm) * MOON_SCALE.size;

export interface OrbitInput {
  orbitAU: number;
  radius: number;
  /** How far the body reaches out from its center (rings, atmosphere), × radius. */
  extent: number;
  /** How far its moons reach, from its center (scene units); 0 if it has none. */
  moonReach?: number;
}

/** Everything that moves with a planet: its rings or atmosphere, and its moons. */
const systemReach = (p: OrbitInput) => Math.max(p.radius * p.extent, p.moonReach ?? 0);

/**
 * Orbit radii (scene units) for planets sorted by distance from the Sun: on the
 * log scale (by the planet's own reach), unless a neighbour's system needs more room.
 */
export function sceneOrbits(planets: OrbitInput[]): number[] {
  const orbits: number[] = [];
  planets.forEach((p, i) => {
    const onLogScale = SCALE.sunRadius * SUN_GLOW + SCALE.clearance + p.radius * p.extent + SCALE.unitsPerLn * Math.log(p.orbitAU / MERCURY_AU);
    const clear = i === 0 ? 0 : orbits[i - 1] + systemReach(planets[i - 1]) + systemReach(p) + SCALE.clearance;
    orbits.push(Math.max(onLogScale, clear));
  });
  return orbits;
}

/**
 * Scene distance for a real one, between known points (AU, scene radius) sorted by
 * distance: log-interpolated between them, extended past the ends at the planets' log spacing.
 */
export function logInterpolate(anchors: [number, number][], au: number): number {
  const x = Math.log(au);
  const points = anchors.map(([a, r]) => [Math.log(a), r] as const);
  if (x <= points[0][0]) return points[0][1] + SCALE.unitsPerLn * (x - points[0][0]);
  for (let i = 1; i < points.length; i++) {
    const [[x0, r0], [x1, r1]] = [points[i - 1], points[i]];
    if (x <= x1) return r0 + ((x - x0) / (x1 - x0)) * (r1 - r0);
  }
  const [xn, rn] = points[points.length - 1];
  return rn + SCALE.unitsPerLn * (x - xn);
}

export interface MoonInput {
  aKm: number;
  radius: number;
}

/**
 * Moon orbit radii (scene units, from the planet's center) for moons sorted by
 * distance: the first just clear of the planet's reach, then log-spaced by real
 * distance, never closer than `gap` to the previous moon.
 */
export function sceneMoonOrbits(planetReach: number, moons: MoonInput[]): number[] {
  const orbits: number[] = [];
  moons.forEach((m, i) => {
    if (i === 0) return orbits.push(planetReach + MOON_SCALE.gap + m.radius);
    const prev = moons[i - 1];
    const onLogScale = orbits[i - 1] + MOON_SCALE.unitsPerLn * Math.log(m.aKm / prev.aKm);
    orbits.push(Math.max(onLogScale, orbits[i - 1] + prev.radius + MOON_SCALE.gap + m.radius));
  });
  return orbits;
}
