import * as THREE from 'three';
import type {BodyNode} from '../planets/planet';

/** Map-only angular-size cap. Compressed gameplay coordinates remain untouched. */
export const MAP_MOON_DIAMETER_DEG=.6;
export class EarthMapMoon {
  readonly mesh:THREE.Mesh;
  constructor(private readonly source:BodyNode) {
    // Borrow the surface resources: no second texture load or geometry allocation.
    this.mesh=new THREE.Mesh(source.mesh.geometry,source.mesh.material);
    this.mesh.name='earth-map-moon';this.mesh.visible=false;
  }
  update(camera:THREE.Camera,active:boolean) {
    this.mesh.visible=active;
    this.source.presentation=active?this.mesh:undefined;
    if(!active)return;
    this.mesh.geometry=this.source.mesh.geometry;this.mesh.material=this.source.mesh.material;
    this.source.mesh.getWorldPosition(this.mesh.position);
    this.source.mesh.getWorldQuaternion(this.mesh.quaternion);
    const distance=this.mesh.position.distanceTo(camera.position);
    const radius=Math.min(this.source.body.radius,distance*Math.sin(THREE.MathUtils.degToRad(MAP_MOON_DIAMETER_DEG/2)));
    this.mesh.scale.setScalar(radius);this.mesh.updateMatrixWorld(true);
  }
}
