import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { BuildView } from '../src/scene/baseKit/buildView';
import { Showcase } from '../src/scene/baseKit/showcase';
import { BUILD_KINDS } from '../src/sim/buildRules';
import { Showcases } from '../src/scene/baseKit/showcases';
import { landingBases } from './helpers/landingBase';

describe('Mars base architecture ownership contracts', () => {
  it('refreshes terrain and horizon borrowers after the planet replaces a surface map', () => {
    const fixture = landingBases(), manager = new Showcases(fixture.bases);
    const material = fixture.jezero.body.mesh.material as THREE.MeshStandardMaterial;
    const oldMap = new THREE.Texture(), nextMap = new THREE.Texture();
    const oldDispose = vi.spyOn(oldMap, 'dispose'), nextDispose = vi.spyOn(nextMap, 'dispose');
    fixture.jezero.group.visible = true;
    manager.textureSize = 16;
    const frame = (active: boolean) => manager.update(() => active, 'low', 0, new THREE.PerspectiveCamera(), true, 'jezero', () => null, new THREE.Vector3(), {} as THREE.WebGLRenderer);
    try {
      material.map = oldMap; frame(true);
      const terrain = manager.get('jezero')!.terrain;
      const skySync = vi.spyOn(manager.sky('jezero')!, 'syncMap');
      expect(terrain.material.map).toBe(oldMap);
      material.map = nextMap; // A surface fade finishes after the early showcase update.
      manager.syncMaps();
      expect(terrain.material.map).toBe(nextMap);
      expect(skySync).toHaveBeenLastCalledWith(nextMap);
      expect(oldDispose).not.toHaveBeenCalled(); expect(nextDispose).not.toHaveBeenCalled();
      frame(false); manager.syncMaps();
      expect(nextDispose).not.toHaveBeenCalled();
    } finally {
      frame(false); material.map = null; oldMap.dispose(); nextMap.dispose(); fixture.dispose();
    }
  });

  it('the builder ghost borrows each instanced kind geometry until its owner is disposed', () => {
    const view = new BuildView(5.6);
    try {
      const geometries = BUILD_KINDS.map((kind) =>
        (view.group.getObjectByName(`build:${kind}`) as THREE.InstancedMesh).geometry);
      const disposed = geometries.map((geometry) => vi.spyOn(geometry, 'dispose'));
      const ghost = view.group.getObjectByName('build:ghost') as THREE.Mesh;
      BUILD_KINDS.forEach((kind, n) => {
        view.setGuides({ layout: JEZERO, placed: [], version: 1,
          held: { kind, i: 0, j: 0, rot: 0 }, cursor: [0, 0], ok: false });
        expect(ghost.geometry).toBe(geometries[n]);
      });
      view.setGuides(null);
      for (const spy of disposed) expect(spy).not.toHaveBeenCalled();
      view.dispose();
      view.dispose();
      for (const spy of disposed) expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      view.dispose();
    }
  });

  it('the showcase borrows planet and environment maps without taking disposal ownership', () => {
    const planet = new THREE.Texture();
    const environment = new THREE.Texture();
    const planetDispose = vi.spyOn(planet, 'dispose');
    const environmentDispose = vi.spyOn(environment, 'dispose');
    const showcase = new Showcase(JEZERO, { quality: 'high', textureSize: 16, R: 5.6,
      site: { point: new THREE.Vector3(0, 1, 0), quaternion: new THREE.Quaternion(), scale: 1 / 5.6 } });
    try {
      showcase.syncMap(planet);
      showcase.setEnvironment(environment);
      expect(showcase.terrain.material.map).toBe(planet);
      const hull = showcase.group.getObjectByName('kit:hull') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      expect(hull.material.envMap).toBe(environment);
      showcase.dispose();
      expect(planetDispose).not.toHaveBeenCalled();
      expect(environmentDispose).not.toHaveBeenCalled();
    } finally {
      planet.dispose();
      environment.dispose();
    }
  });
});
