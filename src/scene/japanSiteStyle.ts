import * as THREE from 'three';

/** Globe scenery uses individual structures, never the authored regional land/sea sheets. */
export const isRegionalSurface=(name:string)=>/Pacific|vegetation and beach|shelf|surf|Basalt|Mown berm|exhaust/i.test(name);
export const isParkedVehicle=(name:string)=>/Shuttle[ _]ascent|Exhaust|FX/i.test(name);

export function siteFinish(source:THREE.Material):THREE.Material {
  const material=source.clone();
  if(!(material instanceof THREE.MeshStandardMaterial))return material;
  const name=source.name;
  material.metalness=Math.min(material.metalness,.35);
  material.roughness=Math.max(material.roughness,.68);
  if(/concrete|ceramic|pavers|kerb/i.test(name)){material.color.setHex(0xbfc3c1);material.roughness=.94;material.metalness=0;}
  if(/asphalt|road.charcoal|charcoal.structure/i.test(name)){material.color.setHex(0x41494c);material.roughness=.96;material.metalness=0;}
  if(/safety.orange|safety.amber/i.test(name))material.color.setHex(0xc98240);
  if(/glass|glazing/i.test(name)){material.color.setHex(0x344c60);material.roughness=.55;}
  if(/leaves/i.test(name)){material.roughness=1;material.metalness=0;}
  if(/bark|mulch/i.test(name)){material.roughness=1;material.metalness=0;}
  material.emissive.setHex(0);material.emissiveIntensity=1;
  return material;
}

export function lightSiteFinish(material:THREE.Material,night:number) {
  if(!(material instanceof THREE.MeshStandardMaterial))return;
  const name=material.name;
  if(/lamp|guidance|warm.windows/i.test(name)){
    material.emissive.setHex(0xffd3a0);material.emissiveIntensity=.03+night*.28;
  }else {material.emissive.setHex(0);material.emissiveIntensity=1;}
}

/** Keep the authored beach mask; vary only green turf, using metre-space coordinates. */
export function softenCoastalMeadow(geometry:THREE.BufferGeometry) {
  const colors=geometry.getAttribute('color'),positions=geometry.getAttribute('position');
  if(!colors||!positions)return;
  const base=new THREE.Color(0x637c50),shade=new THREE.Color();
  for(let i=0;i<colors.count;i++){
    if(colors.getY(i)<=colors.getX(i)*1.12)continue;
    const x=positions.getX(i),z=positions.getZ(i);
    const variation=.92+.07*Math.sin(x*.037)*Math.cos(z*.029)+.025*Math.sin((x+z)*.11);
    shade.copy(base).multiplyScalar(variation);colors.setXYZ(i,shade.r,shade.g,shade.b);
  }
  colors.needsUpdate=true;
}
