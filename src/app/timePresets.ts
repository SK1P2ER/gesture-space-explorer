// Jezero Dome lighting presets: Day, Golden Hour and Night as moments on the base's own local clock. Pure: no DOM, no
// clock of its own. The scene's lighting (Sun, sky, fill, window glow) already follows the simulation time, so a preset
// is only a time to jump to.
//
// Times, all anchored to ONE moment (the original time saved before the first preset), so the presets are
// deterministic and never drift however often they are switched:
// - Day: local solar noon (12:00 local solar time) of the sol that contains the anchor.
// - Golden Hour: the existing near-sunset calculation (nextSetting, GOLDEN_ELEVATION) from that noon.
// - Night: local solar midnight (00:00) after that sunset.
// A site whose Sun does not set in the next few days (polar day or night) has no Golden Hour (null); Night then falls
// back to the midnight after noon.

import type { Body } from '../data/bodies';
import { GOLDEN_ELEVATION, nextSetting, siteFrame, solarDay, sunDirection } from '../sim/localSky';

export type TimePreset = 'day' | 'golden' | 'night';
export const TIME_PRESETS: readonly TimePreset[] = ['day', 'golden', 'night'];

export interface PresetSite { body: Body; lat: number; lon: number }
export interface PresetTimes { day: number; golden: number | null; night: number }

/** Local solar hours (0–24) at a site and time. */
export function localHours(site: PresetSite, ms: number) {
  return solarDay(siteFrame(site.body, site.lat, site.lon, ms), sunDirection(site.body, ms)).hours;
}
/** The Sun's elevation (degrees) at a site and time. */
export function sunElevation(site: PresetSite, ms: number) {
  return solarDay(siteFrame(site.body, site.lat, site.lon, ms), sunDirection(site.body, ms)).elevation;
}

/** About one local hour in ms (the sidereal spin / 24; the Newton steps absorb the small solar-day difference). */
function hourMs(site: PresetSite) {
  const degPerDay = Math.abs(site.body.spin?.degPerDay ?? 360);
  return ((360 / degPerDay) * 86_400e3) / 24;
}

/**
 * The time near `guess` at which local solar time reads `hour` (Newton steps on the local clock, to about a second).
 * @param direction 0: the nearest such time; 1: the first one at or after `guess`
 */
export function atLocalHour(site: PresetSite, guess: number, hour: number, direction: 0 | 1 = 0) {
  const h = hourMs(site);
  const diff = (ms: number) => ((hour - localHours(site, ms) + 36) % 24) - 12; // −12…12 local hours
  let t = guess;
  if (direction === 1) { const d = diff(t); t += (d < 0 ? d + 24 : d) * h; }
  else t += diff(t) * h;
  for (let i = 0; i < 8; i++) {
    const d = diff(t);
    if (Math.abs(d) * h < 500) break;
    t += d * h;
  }
  return Math.round(t);
}

/** Day, Golden Hour and Night for the sol containing `anchor`. */
export function presetTimes(site: PresetSite, anchor: number): PresetTimes {
  const day = atLocalHour(site, anchor, 12, 0);
  const golden = nextSetting(site.body, site.lat, site.lon, day, GOLDEN_ELEVATION);
  const night = atLocalHour(site, golden ?? day, 0, 1);
  return { day, golden, night };
}
