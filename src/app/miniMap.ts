// The mission HUD's map: the planets where they are now, the bases' worlds marked, the rocket and its route.
import * as THREE from 'three';
import { BASES } from '../data/bases';
import { BODIES, bodyById, bodyIndex } from '../data/bodies';
import type { MapView } from '../ui/missionHud';

export interface MiniMapInput {
  /** Where a body (by index) is in the scene now. */
  position: (index: number, out: THREE.Vector3) => THREE.Vector3;
  /** The body of the base the visitor is at, if any. */
  hereBody: string | null;
  /** The bodies of a trip's two bases, while one is on. */
  trip: { from: string; to: string } | null;
  /** The rocket, while it's flying. */
  rocket: THREE.Vector3 | null;
}

const MAP_BODIES = BODIES.map((b, i) => ({ b, i })).filter(({ b }) => b.kind === 'planet' || b.kind === 'dwarf');
const MAP_RADIUS = Math.max(...MAP_BODIES.map(({ b }) => b.orbitRadius));
const planetIndex = (bodyId: string) => {
  const b = bodyById(bodyId);
  return bodyIndex(b.parent ?? b.id);
};
const BASE_PLANETS = new Set(BASES.map((x) => planetIndex(x.body)));
const mapPos = new THREE.Vector3();
const flat = (v: THREE.Vector3) => ({ x: v.x, z: v.z });

export function miniMap({ position, hereBody, trip, rocket }: MiniMapInput): MapView {
  const here = hereBody ? planetIndex(hereBody) : -1;
  return {
    bodies: MAP_BODIES.map(({ b, i }) => ({ ...flat(position(i, mapPos)), color: `#${b.color.toString(16).padStart(6, '0')}`, base: BASE_PLANETS.has(i), here: i === here && !trip })),
    rocket: rocket ? flat(rocket) : null,
    route: trip ? [flat(position(planetIndex(trip.from), mapPos)), flat(position(planetIndex(trip.to), mapPos))] : null,
    maxRadius: MAP_RADIUS,
  };
}
