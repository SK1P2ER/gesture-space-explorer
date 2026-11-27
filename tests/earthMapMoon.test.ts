import * as THREE from 'three';
import {expect,it} from 'vitest';
import {BODIES} from '../src/data/bodies';
import type {BodyNode} from '../src/planets/planet';
import {EarthMapMoon,MAP_MOON_DIAMETER_DEG} from '../src/scene/earthMapMoon';
import {pickBody} from '../src/scene/picking';

it('caps the map Moon at natural angular size without changing gameplay coordinates or allocating surface resources',()=>{
 const body=BODIES.find(b=>b.id==='moon')!,anchor=new THREE.Group(),tilt=new THREE.Group();
 const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,8,4),new THREE.MeshBasicMaterial());
 mesh.scale.setScalar(body.radius);anchor.add(tilt);tilt.add(mesh);anchor.position.set(0,0,-2);
 const source={body,anchor,tilt,mesh} as unknown as BodyNode,camera=new THREE.PerspectiveCamera(50,1,.1,2000),view=new EarthMapMoon(source);
 const position=anchor.position.clone(),radius=mesh.scale.x;
 try {
  for(const z of [0,1,20]) {
   camera.position.z=z;camera.updateMatrixWorld();view.update(camera,true);
   const distance=view.mesh.position.distanceTo(camera.position),diameter=2*THREE.MathUtils.radToDeg(Math.asin(view.mesh.scale.x/distance));
   expect(diameter).toBeCloseTo(MAP_MOON_DIAMETER_DEG);expect(anchor.position.equals(position)).toBe(true);expect(mesh.scale.x).toBe(radius);
   expect(view.mesh.geometry).toBe(mesh.geometry);expect(view.mesh.material).toBe(mesh.material);
  }
  camera.position.z=0;camera.updateMatrixWorld();view.update(camera,true);anchor.visible=false;
  expect(pickBody([source],camera,{x:.5,y:.5},1000,1000,0)).toBe('moon');
  expect(pickBody([source],camera,{x:.7,y:.5},1000,1000,0)).toBeNull();
  view.update(camera,false);expect(view.mesh.visible).toBe(false);expect(source.presentation).toBeUndefined();
 } finally {mesh.geometry.dispose();mesh.material.dispose();}
});
