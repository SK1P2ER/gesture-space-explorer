import * as THREE from 'three';
import type {Lang} from '../data/bodies';

export interface ClearZone { left:number; top:number; right:number; bottom:number }
/** The margin kept clear around a control the label must never cover. */
export const KEEP_CLEAR_PX=12;
/** Whether the label's box enters the zone (grown by the margin): then the label yields, the control stays put. */
export function entersZone(label:ClearZone,zone:ClearZone,margin=KEEP_CLEAR_PX){
  return label.left<zone.right+margin&&label.right>zone.left-margin&&label.top<zone.bottom+margin&&label.bottom>zone.top-margin;
}

export class ActiveVehicle {
  private readonly label=document.createElement('span');
  private readonly point=new THREE.Vector3();
  constructor(){this.label.className='active-vehicle-label';this.label.hidden=true;document.body.append(this.label);}
  /** keepClear: an HTML control the label yields to (hidden for as long as it would overlap it); null keeps the baseline. */
  update(rocket:THREE.Object3D|null,camera:THREE.Camera,visible:boolean,lang:Lang,keepClear:ClearZone|null=null) {
    if(!visible||!rocket){this.label.hidden=true;return;}
    const point=rocket.getWorldPosition(this.point).project(camera);
    this.label.hidden=!visible||point.z< -1||point.z>1||Math.abs(point.x)>1||Math.abs(point.y)>1;
    if(this.label.hidden)return;
    this.label.textContent={en:'● Your vehicle',my:'● သင့်ယာဉ်',ja:'● 操作中の機体'}[lang];
    this.label.style.left=`${(point.x+1)*innerWidth/2}px`;this.label.style.top=`${(1-point.y)*innerHeight/2}px`;
    // Measured where it now is (visibility:hidden still lays out, so yielding does not change the measurement).
    const yields=!!keepClear&&entersZone(this.label.getBoundingClientRect(),keepClear);
    if(yields!==('yield' in this.label.dataset)){if(yields)this.label.dataset.yield='';else delete this.label.dataset.yield;}
  }
}
