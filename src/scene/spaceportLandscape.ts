import * as THREE from 'three';
import {groundAt,type SpaceportSite} from './spaceportCollision';

export interface Plant {x:number;y:number;z:number;height:number;radius:number;yaw:number;}
/** Illustrative coastal groves, not a botanical/geographic reconstruction. */
export function plantingAllowed(site:SpaceportSite,x:number,z:number,radius:number) {
  if(x-radius< -780||x+radius>780||z-radius< -710||z+radius>175)return false;
  // The authored industrial apron, service roads and building gardens stay intact.
  if(x+radius> -285&&x-radius<285&&z+radius> -315&&z-radius<190)return false;
  const landing=site.landing;
  if(Math.hypot(x-landing.center[0],z-landing.center[2])<landing.radius+75+radius)return false;
  if(site.colliders.some(b=>x+radius>b.min[0]-12&&x-radius<b.max[0]+12&&z+radius>b.min[2]-12&&z-radius<b.max[2]+12))return false;
  return [[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius]].every(([dx,dz])=>groundAt(site,x+dx,z+dz)>3);
}

export function coastalPlants(site:SpaceportSite) {
  let seed=2126;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const groves=[[-430,-65,95,130],[-400,-425,120,95],[0,-520,200,85],[380,-390,105,120],[445,35,95,90]];
  const make=(count:number,shrub:boolean)=>{
    const plants:Plant[]=[];
    for(let attempt=0;plants.length<count&&attempt<10000;attempt++){
      const [cx,cz,rx,rz]=groves[attempt%groves.length],a=random()*Math.PI*2,r=Math.sqrt(random());
      const x=cx+Math.cos(a)*r*rx,z=cz+Math.sin(a)*r*rz;
      const height=shrub?1.4+random()*2.2:17+random()*13,radius=height*(shrub ? .6 : .38);
      if(!plantingAllowed(site,x,z,radius))continue;
      if(plants.some(p=>Math.hypot(p.x-x,p.z-z)<(shrub?2.5:8)))continue;
      plants.push({x,y:groundAt(site,x,z),z,height,radius,yaw:random()*Math.PI*2});
    }
    return plants;
  };
  return {trees:make(290,false),shrubs:make(200,true)};
}

/** Three instanced draws, no textures, animation, lights or per-frame allocations. */
export class SpaceportLandscape {
  readonly group=new THREE.Group();
  readonly plants:ReturnType<typeof coastalPlants>;
  private readonly stems:THREE.InstancedMesh;
  private readonly crowns:THREE.InstancedMesh;
  private readonly shrubs:THREE.InstancedMesh;
  private low:boolean|null=null;
  private disposed=false;
  constructor(site:SpaceportSite,low:boolean) {
    this.group.name='Japan | illustrative coastal groves';this.plants=coastalPlants(site);
    const trunk=new THREE.CylinderGeometry(.32,.52,1,5),leaf=new THREE.IcosahedronGeometry(1,0);
    const bark=new THREE.MeshStandardMaterial({color:0x71604a,roughness:1,metalness:0});
    const foliage=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0,flatShading:true});
    this.stems=new THREE.InstancedMesh(trunk,bark,this.plants.trees.length);
    this.crowns=new THREE.InstancedMesh(leaf,foliage,this.plants.trees.length*3);
    this.shrubs=new THREE.InstancedMesh(leaf,foliage,this.plants.shrubs.length);
    this.stems.name='Coastal tree trunks';this.crowns.name='Coastal broadleaf canopy';this.shrubs.name='Coastal scrub';
    const pose=new THREE.Object3D(),color=new THREE.Color(),greens=[0x496647,0x57744a,0x667c50,0x3e5b42];
    const matrix=(x:number,y:number,z:number,sx:number,sy:number,sz:number,yaw:number)=>{pose.position.set(x,y,z);pose.scale.set(sx,sy,sz);pose.rotation.set(0,yaw,0);pose.updateMatrix();return pose.matrix;};
    this.plants.trees.forEach((p,i)=>{
      this.stems.setMatrixAt(i,matrix(p.x,p.y+p.height*.28,p.z,p.radius*.15,p.height*.56,p.radius*.15,p.yaw));
      for(let j=0;j<3;j++){
        const angle=p.yaw+j*Math.PI*2/3;
        this.crowns.setMatrixAt(i*3+j,matrix(p.x+Math.cos(angle)*p.radius*.23,p.y+p.height*(.61+j*.055),p.z+Math.sin(angle)*p.radius*.23,p.radius,p.height*.3,p.radius*.82,angle));
        this.crowns.setColorAt(i*3+j,color.setHex(greens[(i+j)%greens.length]));
      }
    });
    this.plants.shrubs.forEach((p,i)=>{
      this.shrubs.setMatrixAt(i,matrix(p.x,p.y+p.height*.42,p.z,p.radius,p.height*.6,p.radius*.85,p.yaw));
      this.shrubs.setColorAt(i,color.setHex(greens[(i+1)%greens.length]));
    });
    for(const mesh of [this.stems,this.crowns,this.shrubs]){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();this.group.add(mesh);}
    this.setQuality(low);
  }
  setQuality(low:boolean){
    if(this.low===low)return;this.low=low;
    this.stems.count=Math.min(low?210:290,this.plants.trees.length);this.crowns.count=this.stems.count*3;
    this.shrubs.count=Math.min(low?120:200,this.plants.shrubs.length);
    this.stems.castShadow=this.crowns.castShadow=!low;this.shrubs.castShadow=false;
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;this.group.removeFromParent();
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
    for(const mesh of [this.stems,this.crowns,this.shrubs]){geometries.add(mesh.geometry);materials.add(mesh.material as THREE.Material);mesh.dispose();}
    for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();
  }
}
