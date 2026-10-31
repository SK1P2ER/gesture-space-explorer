import { BODIES, type Body } from '../data/bodies';
import { cross, dot, heliocentric, moonAngle, moonDirection, primeMeridian, spinFrame, type Vec3 } from '../data/ephemeris';
import type { SkyMoon } from '../data/skyMoons';

// The sky as seen from a spot on a world's surface (v2.1): where the Sun is,
// what local solar time it is, when the Sun rises and sets, and where Earth and
// the moons are. All from the ephemeris (J2000 ecliptic vectors), so it's the
// real sky for the shown date, independent of the scene's squeezed distances.
// Pure, so it can be checked against known days on Earth.

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
const byId = (id: string) => BODIES.find((b) => b.id === id)!;

/** Up, east and north at a site, and its world's pole (ecliptic unit vectors). */
export interface SiteFrame {
  up: Vec3;
  east: Vec3;
  north: Vec3;
  pole: Vec3;
}

/** The local frame at latitude / longitude (east-positive, as on the maps) on a body, at a time. */
export function siteFrame(body: Pick<Body, 'pole' | 'spin'>, latDeg: number, lonDeg: number, ms: number): SiteFrame {
  const f = spinFrame(body, ms);
  const pm = primeMeridian(f);
  const e90 = cross(f.pole, pm); // longitude 90° east
  const [lat, lon] = [rad(latDeg), rad(lonDeg)];
  const up = norm(add(add(scale(pm, Math.cos(lat) * Math.cos(lon)), e90, Math.cos(lat) * Math.sin(lon)), f.pole, Math.sin(lat)));
  let east = cross(f.pole, up);
  if (Math.hypot(...east) < 1e-9) east = e90; // at a pole
  east = norm(east);
  return { up, east, north: cross(up, east), pole: f.pole };
}

/** A direction (ecliptic) as seen from the site: elevation above the horizon and azimuth from north toward east, degrees. */
export function skyPosition(frame: SiteFrame, dir: Vec3): { elevation: number; azimuth: number } {
  const d = norm(dir);
  return { elevation: deg(Math.asin(Math.max(-1, Math.min(1, dot(d, frame.up))))), azimuth: (deg(Math.atan2(dot(d, frame.east), dot(d, frame.north))) + 360) % 360 };
}

/** The Sun's direction from a body (its planet's, for a moon). */
export function sunDirection(body: Body, ms: number): Vec3 {
  const planet = body.parent ? byId(body.parent) : body;
  return norm(scale(heliocentric(planet.orbit!, ms), -1));
}

/** Another planet's direction from this one. */
export function planetDirection(from: Body, to: Body, ms: number): Vec3 {
  return norm(add(heliocentric(to.orbit!, ms), heliocentric(from.orbit!, ms), -1));
}

/** Where a sky moon is from a site on its planet, km (parallax included: Phobos is close). */
export function skyMoonOffset(moon: SkyMoon, planet: Body, frame: SiteFrame, ms: number): Vec3 {
  const v = scale(moonDirection(moon.orbit, planet, moonAngle(moon.orbit, ms), ms), moon.orbit.aKm);
  return add(v, frame.up, -planet.facts.diameterKm / 2);
}

/** A sky moon's direction from a site on its planet. */
export const skyMoonDirection = (moon: SkyMoon, planet: Body, frame: SiteFrame, ms: number): Vec3 => norm(skyMoonOffset(moon, planet, frame, ms));

export interface SolarDay {
  /** Local solar time, 0–24 "hours" of the local day (noon = 12: the Sun highest). */
  hours: number;
  /** When the Sun's center crosses the horizon, local solar hours; null when it doesn't today. */
  sunrise: number | null;
  sunset: number | null;
  /** Midnight sun or polar night. */
  polar: 'day' | 'night' | null;
  /** The Sun's elevation now, degrees. */
  elevation: number;
}

const wrap24 = (h: number) => ((h % 24) + 24) % 24;

/** Local solar time and today's sunrise and sunset at the site, from the Sun's direction. */
export function solarDay(frame: SiteFrame, sun: Vec3): SolarDay {
  const s = norm(sun);
  const { pole, up } = frame;
  // Hour angle: the Sun's angle west of the local meridian, around the pole.
  const meridian = norm(add(up, pole, -dot(up, pole)));
  const eastEq = cross(pole, meridian);
  const H = deg(Math.atan2(-dot(s, eastEq), dot(s, meridian)));
  const lat = Math.asin(dot(up, pole));
  const dec = Math.asin(dot(s, pole));
  const c = -Math.tan(lat) * Math.tan(dec);
  const elevation = skyPosition(frame, s).elevation;
  if (c <= -1) return { hours: wrap24(12 + H / 15), sunrise: null, sunset: null, polar: 'day', elevation };
  if (c >= 1) return { hours: wrap24(12 + H / 15), sunrise: null, sunset: null, polar: 'night', elevation };
  const H0 = deg(Math.acos(c)) / 15;
  return { hours: wrap24(12 + H / 15), sunrise: 12 - H0, sunset: 12 + H0, polar: null, elevation };
}

/** "09:41" from local solar hours. */
export function clockLabel(hours: number): string {
  const m = Math.round(wrap24(hours) * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** How dark the sky is for lights and stars: 0 in daylight, 1 once the Sun is 6° below the horizon. */
export const nightness = (sunElevation: number) => Math.max(0, Math.min(1, (3 - sunElevation) / 9));

/**
 * The season on a planet: the solar longitude Ls (degrees), the Sun's angle along its
 * yearly path measured from the planet's northern spring equinox (Ls 0, 90 summer
 * solstice, 180, 270). From the real orbit plane and spin axis.
 */
export function solarLongitude(body: Body, ms: number): number {
  const pole = spinFrame(body, ms).pole;
  const here = heliocentric(body.orbit!, ms);
  const normal = norm(cross(here, heliocentric(body.orbit!, ms + 86_400_000)));
  const equinox = norm(cross(pole, normal)); // where the Sun crosses the equator heading north
  const s = norm(scale(here, -1));
  return (deg(Math.atan2(dot(s, cross(normal, equinox)), dot(s, equinox))) + 360) % 360;
}

/** Latitude of the site and the Sun's declination there (degrees): what the Sun's daily path needs. */
export function sunPath(frame: SiteFrame, sun: Vec3): { latDeg: number; decDeg: number } {
  return { latDeg: deg(Math.asin(dot(frame.up, frame.pole))), decDeg: deg(Math.asin(dot(norm(sun), frame.pole))) };
}

/** The golden hour starts when the setting Sun is this high (degrees). */
export const GOLDEN_ELEVATION = 6;

/**
 * The next time after `from` that the Sun, setting, sinks through `elevationDeg` at a site
 * (ms), within `maxDays`; null if it doesn't (polar day or night). 10-minute steps, then
 * bisection to about a second.
 */
export function nextSetting(body: Body, latDeg: number, lonDeg: number, from: number, elevationDeg = GOLDEN_ELEVATION, maxDays = 3): number | null {
  const elev = (ms: number) => skyPosition(siteFrame(body, latDeg, lonDeg, ms), sunDirection(body, ms)).elevation;
  const step = 10 * 60e3;
  let t = from;
  let e = elev(t);
  for (let k = 0; k < (maxDays * 86_400e3) / step; k++) {
    const t2 = t + step;
    const e2 = elev(t2);
    if (e >= elevationDeg && e2 < elevationDeg) {
      let [a, b] = [t, t2];
      while (b - a > 1000) {
        const m = (a + b) / 2;
        if (elev(m) >= elevationDeg) a = m;
        else b = m;
      }
      return a;
    }
    [t, e] = [t2, e2];
  }
  return null;
}
