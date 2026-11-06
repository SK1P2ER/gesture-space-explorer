import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { miniMap } from '../src/app/miniMap';
import { BASES } from '../src/data/bases';
import { BODIES, bodyById, bodyIndex } from '../src/data/bodies';

// Each body sits on the x axis at its index, so a map dot says which body it is.
const position = (index: number, out: THREE.Vector3) => out.set(index, 7, -index);
const at = (id: string) => ({ x: bodyIndex(id), z: -bodyIndex(id) });
const planetOf = (id: string) => bodyById(id).parent ?? id;

describe('the mission HUD map', () => {
  it('shows the planets and dwarf planets, flattened, with the worlds that have bases marked', () => {
    const map = miniMap({ position, hereBody: null, trip: null, rocket: null });
    const shown = BODIES.filter((b) => b.kind === 'planet' || b.kind === 'dwarf');
    expect(map.bodies.map(({ x, z }) => ({ x, z }))).toEqual(shown.map((b) => at(b.id)));
    expect(map.bodies.map((d) => d.color)).toEqual(shown.map((b) => `#${b.color.toString(16).padStart(6, '0')}`));
    const withBases = new Set(BASES.map((b) => planetOf(b.body)));
    expect(map.bodies.map((d) => d.base)).toEqual(shown.map((b) => withBases.has(b.id)));
    expect(map.maxRadius).toBe(Math.max(...shown.map((b) => b.orbitRadius)));
    expect(map.bodies.some((d) => d.here)).toBe(false);
    expect([map.rocket, map.route]).toEqual([null, null]);
  });

  it('marks the planet of the base the visitor is at (a moon base marks its planet)', () => {
    const moonBase = BASES.find((b) => bodyById(b.body).parent)!;
    const map = miniMap({ position, hereBody: moonBase.body, trip: null, rocket: null });
    const here = map.bodies.filter((d) => d.here);
    expect(here).toEqual([expect.objectContaining(at(planetOf(moonBase.body)))]);
  });

  it('on a trip: the route between the two planets and the rocket, and no "here"', () => {
    const [from, to] = [BASES[0].body, BASES[1].body];
    const map = miniMap({ position, hereBody: from, trip: { from, to }, rocket: new THREE.Vector3(1, 2, 3) });
    expect(map.route).toEqual([at(planetOf(from)), at(planetOf(to))]);
    expect(map.rocket).toEqual({ x: 1, z: 3 });
    expect(map.bodies.some((d) => d.here)).toBe(false);
  });
});
