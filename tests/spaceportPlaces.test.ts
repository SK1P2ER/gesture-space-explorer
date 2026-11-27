import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPACEPORT_PLACES, isShownPlace, shownPlaces } from '../src/scene/spaceportPlaces';

type Box = { min: number[]; max: number[] };
// SPACEPORT_ASSET_ROOT=<folder> checks another export (same layout: assets/spaceport-m03, public/spaceport) against this table.
const at = (path: string) => join(process.env.SPACEPORT_ASSET_ROOT ?? '.', path);
const authoring = JSON.parse(readFileSync(at('assets/spaceport-m03/site-authoring.json'), 'utf8')) as { landmarks: { id: string; objects?: string[] }[]; collision_objects: string[] };
const site = JSON.parse(readFileSync(at('public/spaceport/site.json'), 'utf8')) as { landmarks: { id: string; bounds: Box }[]; colliders: Box[]; landing: { center: number[]; radius: number } };
const glbBytes = readFileSync(at('public/spaceport/tanegashima-m03.glb'));
const gltf = JSON.parse(glbBytes.subarray(20, 20 + glbBytes.readUInt32LE(12)).toString()) as {
  nodes: { name?: string; mesh?: number; translation?: number[]; rotation?: number[]; children?: number[] }[];
  meshes: { primitives: { attributes: { POSITION: number }; material?: number }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
  materials: { name?: string }[];
};
const roots = new Set(gltf.nodes.map((_, i) => i));
for (const node of gltf.nodes) for (const child of node.children ?? []) roots.delete(child);
const inside = (p: number[], b: Box) => p.every((v, i) => v >= b.min[i] && v <= b.max[i]);
const overlaps = (a: Box, b: Box) => a.min.every((_, i) => a.min[i] <= b.max[i] && a.max[i] >= b.min[i]);
const bounds = (id: string) => site.landmarks.find(item => item.id === id)!.bounds;

describe('spaceport places: every shown label matches what its camera shows', () => {
  it('lists each site landmark exactly once', () => {
    expect(SPACEPORT_PLACES.map(place => place.id).sort()).toEqual(site.landmarks.map(item => item.id).sort());
  });

  // The place → expected main object table, as the owner asked for it (2026-11-20).
  it.each(SPACEPORT_PLACES.map(place => [place.id, place.mainObject, place] as const))('%s → %s', (id, _main, place) => {
    if (!place.shown) { expect(isShownPlace(id)).toBe(false); return; }
    const evidence = place.evidence;
    if (evidence.kind === 'authoringObject') {
      expect(authoring.landmarks.find(item => item.id === id)?.objects ?? []).toContain(evidence.object);
    } else if (evidence.kind === 'exportedObject') {
      expect(authoring.landmarks.find(item => item.id === id)?.objects ?? []).toContain(evidence.object);
      expect(authoring.collision_objects).toContain(evidence.object);
      expect(site.colliders.some(box => overlaps(box, bounds(id))), `an exported collider inside the ${id} bounds`).toBe(true);
    } else if (evidence.kind === 'nodeInBounds') {
      // root-level control nodes carry their own translation; batches below them are local to it
      const node = gltf.nodes.find((item, i) => item.name === evidence.node && roots.has(i));
      expect(node, `GLB node ${evidence.node}`).toBeDefined();
      expect(inside(node!.translation ?? [0, 0, 0], bounds(id))).toBe(true);
    } else {
      const hits = gltf.nodes.filter((node, i) => roots.has(i) && node.mesh !== undefined && !node.translation && !node.rotation)
        .flatMap(node => gltf.meshes[node.mesh!].primitives)
        .filter(p => (gltf.materials[p.material ?? -1]?.name ?? '').includes(evidence.material))
        .map(p => gltf.accessors[p.attributes.POSITION] as Box)
        .filter(box => overlaps(box, bounds(id)));
      expect(hits.length, `geometry with material "${evidence.material}" inside the ${id} bounds`).toBeGreaterThan(0);
    }
  });

  it('keeps the mission landing anchor even while the landing chip is hidden', () => {
    expect(site.landing.center).toEqual([-175, 7.025, 85]);
    expect(site.landing.radius).toBe(32);
  });

  it('every exported collider belongs to a current collision object (none left from removed buildings)', () => {
    expect(site.colliders).toHaveLength(authoring.collision_objects.length);
    for (const gone of ['VAB | high bay', 'VAB | lower service wing', 'Command_Building_Main', 'Command_Building_Roof', 'Utility_Shed'])
      expect(authoring.collision_objects).not.toContain(gone);
  });

  it('shows only the places that pass, in the button order', () => {
    expect(shownPlaces()).toEqual(SPACEPORT_PLACES.filter(place => place.shown).map(place => place.id));
  });
});
