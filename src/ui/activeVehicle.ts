import * as THREE from 'three';
import type {Lang} from '../data/bodies';

export class ActiveVehicle {
  private readonly label=document.createElement('span');
  private readonly point=new THREE.Vector3();
  constructor(){this.label.className='active-vehicle-label';this.label.hidden=true;document.body.append(this.label);}
  update(rocket:THREE.Object3D|null,camera:THREE.Camera,visible:boolean,lang:Lang) {
    if(!visible||!rocket){this.label.hidden=true;return;}
    const point=rocket.getWorldPosition(this.point).project(camera);
    this.label.hidden=!visible||point.z< -1||point.z>1||Math.abs(point.x)>1||Math.abs(point.y)>1;
    if(this.label.hidden)return;
    this.label.textContent={en:'● Your vehicle',my:'● သင့်ယာဉ်',ja:'● 操作中の機体'}[lang];
    this.label.style.left=`${(point.x+1)*innerWidth/2}px`;this.label.style.top=`${(1-point.y)*innerHeight/2}px`;
  }
}
