import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {coastalPlants,plantingAllowed,SpaceportLandscape} from '../src/scene/spaceportLandscape';
import {groundAt,type SpaceportSite} from '../src/scene/spaceportCollision';

const site:SpaceportSite=JSON.parse(readFileSync(new URL('../public/spaceport/site.json',import.meta.url),'utf8'));
it('places repeatable groves on actual terrain away from roads, buildings and landing approaches',()=>{
  const plants=coastalPlants(site);expect(plants).toEqual(coastalPlants(site));
  expect(plants.trees).toHaveLength(290);expect(plants.shrubs).toHaveLength(200);
  for(const p of [...plants.trees,...plants.shrubs]){
    expect(plantingAllowed(site,p.x,p.z,p.radius)).toBe(true);
    expect(p.y).toBe(groundAt(site,p.x,p.z));
    expect(Math.hypot(p.x-site.landing.center[0],p.z-site.landing.center[2])).toBeGreaterThan(site.landing.radius+75+p.radius);
  }
  expect(plantingAllowed(site,0,-100,5)).toBe(false);
  expect(plantingAllowed(site,-175,85,5)).toBe(false);
  expect(plantingAllowed(site,0,500,5)).toBe(false);
});
it('uses three instanced meshes, switches quality without reallocating and releases shared resources once',()=>{
  const landscape=new SpaceportLandscape(site,true),scene=new THREE.Scene();scene.add(landscape.group);
  const meshes=landscape.group.children as THREE.InstancedMesh[];
  expect(meshes.map(m=>m.count)).toEqual([210,630,120]);
  const geometries=[...new Set(meshes.map(m=>m.geometry))],materials=[...new Set(meshes.map(m=>m.material as THREE.Material))];
  expect(geometries).toHaveLength(2);expect(materials).toHaveLength(2);
  expect(materials.every(m=>!m.transparent)).toBe(true);
  const disposals=[...geometries,...materials,...meshes].map(resource=>vi.spyOn(resource,'dispose'));
  landscape.setQuality(false);expect(meshes.map(m=>m.count)).toEqual([290,870,200]);
  expect(meshes.map(m=>m.geometry)).toEqual([geometries[0],geometries[1],geometries[1]]);
  landscape.dispose();landscape.dispose();expect(scene.children).toHaveLength(0);
  for(const dispose of disposals)expect(dispose).toHaveBeenCalledTimes(1);
});
