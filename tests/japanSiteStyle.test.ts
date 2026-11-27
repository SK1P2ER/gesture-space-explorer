import {expect,it} from 'vitest';
import * as THREE from 'three';
import {isRegionalSurface,isParkedVehicle,siteFinish,lightSiteFinish,softenCoastalMeadow} from '../src/scene/japanSiteStyle';
it('excludes regional terrain and water while retaining gardens and foundations',()=>{
  for(const name of ['M02 | Continuous coastal vegetation and beach','M02 | Pacific deep blue','M02 | Mown berm'])expect(isRegionalSurface(name)).toBe(true);
  for(const name of ['Leaves_NormalTree','M03 | Mulch','MAT_Concrete_WarmGrey','M03 | Garden kerb'])expect(isRegionalSurface(name)).toBe(false);
  expect(isParkedVehicle('CTRL_|_Shuttle_ascent')).toBe(true);
});
it('uses matte construction materials and confines warm night lighting to fixtures',()=>{
  const source=new THREE.MeshStandardMaterial({color:0xffffff,metalness:1,roughness:.1});source.name='MAT_Concrete_WarmGrey';
  const material=siteFinish(source) as THREE.MeshStandardMaterial;
  expect(material.roughness).toBe(.94);expect(material.metalness).toBe(0);expect(source.metalness).toBe(1);
  material.name='M02 | Warm windows';lightSiteFinish(material,1);expect(material.emissiveIntensity).toBeCloseTo(.31);
  material.name='MAT_Concrete_WarmGrey';lightSiteFinish(material,1);expect(material.emissive.getHex()).toBe(0);
  material.name='Leaves_NormalTree';lightSiteFinish(material,1);expect(material.emissive.getHex()).toBe(0);
  material.dispose();source.dispose();
});
it('varies meadow greens without changing beach colours or terrain positions',()=>{
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,30,0,50,60,0,90],3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute([.2,.5,.1,.2,.5,.1,.7,.6,.4],3));
  const positions=Array.from(geometry.getAttribute('position').array),beach=Array.from(geometry.getAttribute('color').array).slice(6);
  softenCoastalMeadow(geometry);
  const colors=geometry.getAttribute('color');
  expect(Array.from(colors.array).slice(6)).toEqual(beach);
  expect(colors.getY(0)).not.toBe(colors.getY(1));
  expect(Array.from(geometry.getAttribute('position').array)).toEqual(positions);
  expect(Array.from(colors.array).every(Number.isFinite)).toBe(true);geometry.dispose();
});
