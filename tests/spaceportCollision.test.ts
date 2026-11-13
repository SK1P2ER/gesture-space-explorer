import * as THREE from 'three';
import { describe,it,expect } from 'vitest';
import { groundAt,SpaceportCollision,type SpaceportSite } from '../src/scene/spaceportCollision';
import { SpaceportMetrics } from '../src/scene/spaceportMetrics';
const site: SpaceportSite = {
  version:1, terrain:{x:-100,z:-100,dx:100,dz:100,columns:3,rows:3,heights:[0,0,0,0,10,0,0,0,0]},
  colliders:[{min:[10,0,-5],max:[20,30,5]}],
  landmarks:[{id:'control',bounds:{min:[10,0,-5],max:[20,30,5]},eye:[0,20,0],target:[15,15,0]}],
  landing:{center:[-175,7.025,85],radius:32,approach_seconds:8},
};
describe('spaceport camera safety',()=>{
  it('samples sloped terrain and handles the edge/outside of the coastal grid',()=>{
    expect(groundAt(site,0,0)).toBe(10); expect(groundAt(site,50,0)).toBe(5);
    expect(groundAt(site,100,100)).toBe(0); expect(groundAt(site,1000,0)).toBe(0);
  });
  it('sweeps a large camera movement so it cannot tunnel through a whole building',()=>{
    const safety = new SpaceportCollision(site);
    const result = safety.constrain(new THREE.Vector3(-10,20,0),new THREE.Vector3(40,20,0));
    expect(result.x).toBeLessThan(7); expect(result.x).toBeGreaterThan(6.8);
    expect(safety.constrain(result,new THREE.Vector3(40,20,0)).x).toBeLessThan(7);
  });
  it('recovers a restored camera inside a wall or below the terrain',()=>{
    const safety = new SpaceportCollision(site);
    const result = safety.constrain(new THREE.Vector3(15,15,0),new THREE.Vector3(15,15,0));
    expect(new THREE.Box3(new THREE.Vector3(7,-3,-8),new THREE.Vector3(23,33,8)).containsPoint(result)).toBe(false);
    const under = safety.constrain(new THREE.Vector3(0,15,0),new THREE.Vector3(0,-30,0));
    expect(under.y).toBeGreaterThanOrEqual(13);
  });
  it('picks visible building bounds and leaves empty sky unselected',()=>{
    const safety = new SpaceportCollision(site);
    expect(safety.pick(new THREE.Ray(new THREE.Vector3(0,15,0),new THREE.Vector3(1,0,0)))).toBe('control');
    expect(safety.pick(new THREE.Ray(new THREE.Vector3(0,40,0),new THREE.Vector3(1,0,0)))).toBeNull();
  });
});
it('keeps a bounded performance window and records measured frame time rather than clamped simulation dt',()=>{
  const metrics = new SpaceportMetrics();
  for(let i=0;i<300;i++)metrics.add(1000/30,4,70,350000);
  metrics.add(2000,0,0,0);
  const report = metrics.snapshot();
  expect(report.samples).toBe(240); expect(report.totalFrames).toBe(300);
  expect(report.fps).toBeCloseTo(30); expect(report.cpuP95Ms).toBe(4);
  metrics.reset(); expect(metrics.snapshot().samples).toBe(0);
});
