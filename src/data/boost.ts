// Overview boost: as the camera pulls back, bodies are drawn larger (up to BOOST.max ×)
// so the overview stays readable; up close they're true size. Each body's growth is
// capped so that, grown, it can never touch a neighbour, even when they line up.
// "True scale" (T) turns it off. Pure, so the no-overlap guarantee can be tested.

import { reachFactor, type Body } from './bodies';
import { SCALE } from './scale';

export const BOOST = {
  max: 1.8,
  /** Camera distance (scene units, without the fly-in "hop"): true size below, full boost above. */
  near: 40,
  far: 160,
  /** Space kept between grown neighbours. */
  gap: 0.5,
};

const reach = (b: Body) => b.radius * reachFactor(b);

/** The most each body may grow. Planets: limited by both neighbours (and Mercury by the Sun's glow). Pluto: free (it never comes near). Others: 1. */
export function boostLimits(bodies: Body[]): Map<string, number> {
  const planets = bodies.filter((b) => b.kind === 'planet');
  const pair = planets.map((b, i) =>
    i + 1 < planets.length ? (planets[i + 1].orbitRadius - b.orbitRadius - BOOST.gap) / (reach(b) + reach(planets[i + 1])) : Infinity,
  );
  const sun = (planets[0].orbitRadius - SCALE.sunRadius * 1.6 - BOOST.gap) / reach(planets[0]);
  const limits = new Map<string, number>();
  for (const b of bodies) {
    const i = planets.indexOf(b);
    const limit = b.kind === 'planet' ? Math.min(i === 0 ? sun : pair[i - 1], pair[i]) : b.kind === 'dwarf' ? Infinity : 1;
    limits.set(b.id, Math.max(1, Math.min(BOOST.max, limit)));
  }
  return limits;
}

/** 0 up close → 1 in the overview: smooth in the camera's distance, so zooming never jumps. */
export function boostLevel(distance: number): number {
  const x = Math.min(1, Math.max(0, (distance - BOOST.near) / (BOOST.far - BOOST.near)));
  return x * x * (3 - 2 * x);
}

export const boostScale = (limit: number, level: number) => 1 + (limit - 1) * level;

/** Moons fade out as the boost comes in (gone by half way): they'd crowd their grown planet. */
export const moonOpacity = (level: number) => {
  const x = Math.min(1, Math.max(0, 1 - level / 0.5));
  return x * x * (3 - 2 * x);
};
