import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Rocket } from '../src/scene/rocketKit';
import { loadShuttleDesign, ShuttleDesign } from '../src/scene/shuttleDesign';

vi.mock('../src/scene/shuttleDesign', async (original) => ({
  ...await original<typeof import('../src/scene/shuttleDesign')>(), loadShuttleDesign: vi.fn(),
}));

function template() {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: new THREE.Texture() });
  return {
    booster: new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.95, 0.2), material),
    orbiter: new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.66, 0.1), material),
    ground: 0.056, centerZ: 0.061, engineX: 0.099, engineZ: -0.071,
  };
}

describe('uploaded Blender shuttle', () => {
  it.each(['high', 'low'])('ships a self-contained %s asset with two stages and finite alignment', (quality) => {
    const buffer = readFileSync(new URL(`../public/rocket/shuttle-${quality}.glb`, import.meta.url));
    expect(buffer.readUInt32LE(0)).toBe(0x46546c67);
    const json = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString());
    expect(json.meshes).toHaveLength(2);
    expect(json.images).toHaveLength(2);
    for (const image of json.images) expect(image.bufferView).toBeTypeOf('number');
    const booster = json.nodes.find((n: { name: string }) => n.name === 'rocket_booster');
    const orbiter = json.nodes.find((n: { name: string }) => n.name === 'rocket_orbiter');
    expect(orbiter.extras.ground).toBeCloseTo(0.0560656);
    expect(orbiter.extras.centerZ).toBeCloseTo(0.0608026);
    expect(booster.extras.engineX).toBeGreaterThan(0.09);
    let triangles = 0;
    for (const mesh of json.meshes) {
      expect(mesh.primitives).toHaveLength(1); // one draw call per authored stage
      const primitive = mesh.primitives[0];
      triangles += json.accessors[primitive.indices].count / 3;
      expect(json.accessors[primitive.attributes.POSITION].min.every(Number.isFinite)).toBe(true);
      expect(json.accessors[primitive.attributes.POSITION].max.every(Number.isFinite)).toBe(true);
    }
    expect(triangles).toBeLessThanOrEqual(quality === 'high' ? 15000 : 5000);
  });

  it('owns every instance resource and keeps the cached template intact', () => {
    const source = template();
    const first = new ShuttleDesign(source), second = new ShuttleDesign(source);
    const mesh = first.booster as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const next = second.booster as typeof mesh;
    expect(mesh.geometry).not.toBe(source.booster.geometry);
    expect(mesh.material).not.toBe(next.material);
    expect(mesh.material.map).not.toBe(next.material.map);
    first.setNight(1, false);
    expect(mesh.material.color.r).toBeCloseTo(0.15);
    expect(next.material.color.r).toBe(1);
    const geometry = vi.spyOn(mesh.geometry, 'dispose'), material = vi.spyOn(mesh.material, 'dispose');
    const texture = vi.spyOn(mesh.material.map!, 'dispose');
    const other = vi.spyOn(next.geometry, 'dispose'), cached = vi.spyOn(source.booster.geometry, 'dispose');
    first.dispose(); first.dispose();
    for (const resource of [geometry, material, texture]) expect(resource).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled(); expect(cached).not.toHaveBeenCalled();
    second.dispose();
  });

  it('a late model inherits separation, landing, layers, shadows and current engine state', async () => {
    let finish!: (design: ShuttleDesign) => void;
    vi.mocked(loadShuttleDesign).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const rocket = new Rocket({ quality: 'high', textureSize: 16, design: 'shuttle' });
    rocket.group.traverse((o) => o.layers.set(1));
    rocket.separate(true);
    rocket.setLander(true);
    rocket.setLegs(1);
    expect(rocket.upper.getObjectByName('rocket:legs')!.visible).toBe(false);
    rocket.setNight(0.8, true);
    rocket.setShadows(true);
    rocket.setThrust(0.6, 2, 'none', true);
    const model = new ShuttleDesign(template());
    finish(model); await rocket.ready;
    expect(rocket.designLoaded).toBe(true);
    expect(rocket.upper.getObjectByName('rocket:legs')!.visible).toBe(false);
    expect(rocket.booster.visible).toBe(false);
    expect(rocket.upper.position.y).toBe(-model.ground);
    expect(rocket.upper.position.z).toBe(-model.centerZ);
    model.orbiter.traverse((o) => {
      expect(o.layers.mask).toBe(2);
      if (o instanceof THREE.Mesh) expect(o.castShadow && o.receiveShadow).toBe(true);
    });
    expect(rocket.upper.getObjectByName('flame:upper')!.visible).toBe(true);
    expect(rocket.booster.getObjectByName('flame:booster-right')!.visible).toBe(false);
    rocket.restack(); rocket.setLander(false);
    expect(rocket.upper.position.toArray()).toEqual([0, 0, 0]);
    expect(rocket.booster.visible).toBe(true);
    expect(rocket.upper.getObjectByName('rocket:legs')!.visible).toBe(false);
    rocket.dispose();
  });

  it('releases a model that finishes after its rocket was disposed', async () => {
    let finish!: (design: ShuttleDesign) => void;
    vi.mocked(loadShuttleDesign).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const rocket = new Rocket({ quality: 'low', textureSize: 16, design: 'shuttle' });
    rocket.dispose(); rocket.dispose();
    const model = new ShuttleDesign(template()), release = vi.spyOn(model, 'dispose');
    finish(model); await rocket.ready;
    expect(release).toHaveBeenCalledTimes(1);
    expect(rocket.designLoaded).toBe(false);
    expect(model.orbiter.parent).toBeNull();
  });

  it('keeps the existing procedural rocket usable when an asset cannot load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(loadShuttleDesign).mockRejectedValueOnce(new Error('offline'));
    const rocket = new Rocket({ quality: 'low', textureSize: 16, design: 'shuttle' });
    await rocket.ready;
    expect(rocket.designLoaded).toBe(false);
    expect(rocket.booster.getObjectByName('rocket:booster')!.visible).toBe(true);
    rocket.setThrust(1, 0, 'none'); rocket.separate(true); rocket.setLander(true);
    expect(rocket.upper.getObjectByName('flame:upper')).toBeDefined();
    rocket.dispose(); warn.mockRestore();
  });
});
