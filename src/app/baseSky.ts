import * as THREE from 'three';
import { BODIES, type Lang } from '../data/bodies';
import { heliocentric, type Vec3 } from '../data/ephemeris';
import { SKY_MOONS } from '../data/skyMoons';
import type { SkyObject } from '../scene/baseKit/horizon';
import type { BaseSky } from '../scene/baseKit/showcases';
import type { BaseNode } from '../scene/bases';
import { toScene } from '../planets/planet';
import { nightness, planetDirection, siteFrame, skyMoonOffset, skyPosition, solarDay, solarLongitude, sunDirection, sunPath, type SolarDay } from '../sim/localSky';
import { dustFactor, type SolConditions } from '../sim/buildRules';

/** The sky over a base right now: in its own frame (for the scene), and as numbers (for the panel). */
export interface SkyReport {
  local: BaseSky;
  day: SolarDay;
  /** What's above the horizon besides the Sun, with its elevation (degrees). */
  up: { id: string; name: Record<Lang, string>; elevation: number; approximate?: boolean }[];
  /** For base building: the Sun's daily path and today's dust (Mars' dust season; clear elsewhere). */
  sol: SolConditions;
}

const earth = BODIES.find((b) => b.id === 'earth')!;
const q = new THREE.Quaternion();

/** From the ephemeris at `ms`: the Sun, the sky moons and Earth over a base, turned into the base's frame. */
export function skyOver(node: BaseNode, ms: number): SkyReport {
  const body = node.body.body;
  const frame = siteFrame(body, node.base.lat, node.base.lon, ms);
  const sun = sunDirection(body, ms);
  const day = solarDay(frame, sun);
  node.group.getWorldQuaternion(q).invert();
  const toBase = (v: Vec3) => toScene(v, new THREE.Vector3()).normalize().applyQuaternion(q);

  const objects: SkyObject[] = [];
  const up: SkyReport['up'] = [];
  for (const moon of SKY_MOONS.filter((m) => m.parent === body.id)) {
    const off = skyMoonOffset(moon, body, frame, ms);
    const km = Math.hypot(...off);
    objects.push({ id: moon.id, dir: toBase(off), angularRadius: moon.radiusKm / km });
    const { elevation } = skyPosition(frame, off);
    const year = new Date(ms).getUTCFullYear();
    const approximate = moon.validYears !== undefined && (year < moon.validYears[0] || year > moon.validYears[1]);
    if (elevation > 0) up.push({ id: moon.id, name: moon.name, elevation, approximate });
  }
  if (body.orbit && body.id !== 'earth') {
    const d = planetDirection(body, earth, ms);
    objects.push({ id: 'earth', dir: toBase(d), angularRadius: 0 });
    const { elevation } = skyPosition(frame, d);
    if (elevation > 0) up.push({ id: 'earth', name: earth.name, elevation });
  }
  const sol = { ...sunPath(frame, sun), dust: body.id === 'mars' ? dustFactor(solarLongitude(body, ms)) : 1 };
  const planet = body.parent ? BODIES.find((b) => b.id === body.parent)! : body;
  const rAU = Math.hypot(...heliocentric(planet.orbit!, ms));
  return { local: { sun: toBase(sun), sunElevation: day.elevation, night: nightness(day.elevation), objects, rAU, dust: sol.dust }, day, up, sol };
}
