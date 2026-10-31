// The sky map: NASA/Goddard SVS Deep Star Maps 2020 (Gaia DR2 + Hipparcos/Tycho),
// plate carrée in J2000 celestial coordinates — RA 0h in the middle, RA increasing
// to the left (the sky seen from inside), north at the top. These helpers say where
// a direction in the scene lands on it; scene/sky.ts does the same per pixel.

import { eclipticFromEquatorial, type Vec3 } from './ephemeris';

const OBLIQUITY = (23.43928 * Math.PI) / 180;
const [C, S] = [Math.cos(OBLIQUITY), Math.sin(OBLIQUITY)];

/**
 * Scene direction → J2000 equatorial (x → RA 0h, z → celestial north), row-major.
 * Scene (x, y, z) is ecliptic (x, −z, y) — see planets/planet.ts toScene — then
 * tilted from the ecliptic to Earth's equator.
 */
export const SCENE_TO_EQUATORIAL = [1, 0, 0, 0, -S, -C, 0, C, -S] as const;

export function sceneToEquatorial([x, y, z]: Vec3): Vec3 {
  const m = SCENE_TO_EQUATORIAL;
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

/** A direction in the scene for a point on the sky (right ascension and declination, degrees). */
export function skyDirection(raDeg: number, decDeg: number): Vec3 {
  const [ra, dec] = [(raDeg * Math.PI) / 180, (decDeg * Math.PI) / 180];
  const [x, y, z] = eclipticFromEquatorial([Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]);
  return [x, z, -y];
}

/** Where a scene direction lands on the sky map: (u, v), v = 0 at the top (north). The shader does the same. */
export function skyUv(dir: Vec3): [number, number] {
  const [x, y, z] = sceneToEquatorial(dir);
  const l = Math.hypot(x, y, z);
  const u = 0.5 - Math.atan2(y, x) / (2 * Math.PI);
  const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, z / l))) / Math.PI;
  return [((u % 1) + 1) % 1, v];
}

// ------------------------------------------------------- shooting stars ----

export interface ShootingStarConfig {
  /** Seconds between streaks: random in [min, max]. */
  gap: [number, number];
  /** How long one streak takes, seconds. */
  duration: number;
}

export const SHOOTING_STARS: ShootingStarConfig = { gap: [6, 15], duration: 0.7 };

/** When the next streak starts and how far along the current one is. Never any with reduced motion. */
export class ShootingStarTimer {
  private wait: number;
  private t = -1;

  constructor(
    private readonly rand: () => number,
    private readonly cfg = SHOOTING_STARS,
  ) {
    this.wait = this.gap();
  }

  private gap() {
    return this.cfg.gap[0] + (this.cfg.gap[1] - this.cfg.gap[0]) * this.rand();
  }

  /**
   * @returns 'start' on the frame a streak begins, then its progress 0 → 1, or null between streaks
   */
  update(dt: number, reducedMotion: boolean): 'start' | number | null {
    if (reducedMotion) {
      this.t = -1;
      return null;
    }
    if (this.t >= 0) {
      this.t += dt / this.cfg.duration;
      if (this.t < 1) return this.t;
      this.t = -1;
      this.wait = this.gap();
      return null;
    }
    this.wait -= dt;
    if (this.wait > 0) return null;
    this.t = 0;
    return 'start';
  }
}
