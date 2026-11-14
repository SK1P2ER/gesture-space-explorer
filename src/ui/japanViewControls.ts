import * as THREE from 'three';
import type {Lang} from '../data/bodies';
const TEXT={
 enter:{en:'Enter spaceport',my:'စခန်းထဲ ဝင်ရန်',ja:'宇宙港に入る'},
 map:{en:'Earth map',my:'ကမ္ဘာ့မြေပုံ',ja:'地球マップ'},
 reset:{en:'Reset view',my:'မြင်ကွင်း ပြန်ချိန်ရန်',ja:'視点をリセット'},
 marker:{en:'Tanegashima · Enter',my:'တနီဂါရှီမာ · ဝင်ရန်',ja:'種子島 · 入場'},
 ground:{en:'Japan spaceport · Ground view',my:'ဂျပန်စခန်း · မြေပြင်မြင်ကွင်း',ja:'日本の宇宙港 · 地上ビュー'},
 globe:{en:'Earth map · Japan',my:'ကမ္ဘာ့မြေပုံ · ဂျပန်',ja:'地球マップ · 日本'},
 loading:{en:'Opening spaceport…',my:'စခန်း ဖွင့်နေပါသည်…',ja:'宇宙港を読み込み中…'},
 failed:{en:'Ground view unavailable · retry Enter spaceport',my:'မြေပြင်မြင်ကွင်း ဖွင့်မရပါ · ပြန်ဝင်ကြည့်ပါ',ja:'地上ビューを読み込めません・もう一度入場してください'},
};
export class JapanViewControls {
 readonly root=document.createElement('div');
 private readonly enter=document.createElement('button');private readonly map=document.createElement('button');private readonly reset=document.createElement('button');
 private readonly caption=document.createElement('p');private readonly marker=document.createElement('button');private readonly floating=document.createElement('div');private readonly toggle=document.createElement('button');
 private readonly point=new THREE.Vector3();private requested=false;
 constructor(enter:()=>void,map:()=>void,reset:()=>void){
  this.root.className='japan-view-controls';this.caption.className='spaceport-view-caption';this.caption.setAttribute('role','status');
  this.enter.id='enter-spaceport';this.map.id='earth-map';this.reset.id='reset-spaceport';this.marker.id='japan-site-marker';this.marker.className='japan-site-marker';this.marker.hidden=true;
  this.floating.className='spaceport-navigation';this.floating.hidden=true;this.toggle.id='spaceport-view-toggle';
  for(const [button,handler]of [[this.enter,enter],[this.marker,enter],[this.map,map],[this.reset,reset],[this.toggle,()=>this.requested?map():enter()]] as const){button.type='button';button.classList.add('chip');button.addEventListener('click',()=>{handler();button.blur();});}
  this.root.append(this.caption,this.enter,this.map,this.reset);this.floating.append(this.toggle);document.body.append(this.marker,this.floating);
 }
 render(lang:Lang,active:boolean,requested:boolean,status:string,docking:boolean){
  this.requested=requested;
  this.enter.textContent=TEXT[status==='loading'&&requested?'loading':'enter'][lang];this.enter.disabled=requested&&status==='loading';this.enter.hidden=active;
  this.map.textContent=TEXT.map[lang];this.map.hidden=!requested;this.reset.textContent=TEXT.reset[lang];
  this.caption.textContent=TEXT[requested&&status==='failed'?'failed':requested&&status==='loading'?'loading':active?'ground':'globe'][lang];
  this.marker.textContent=TEXT.marker[lang];this.floating.hidden=!docking;this.toggle.textContent=TEXT[requested?'map':'enter'][lang];
 }
 update(base:THREE.Object3D,camera:THREE.Camera,visible:boolean){
  const world=base.getWorldPosition(new THREE.Vector3());
  this.point.copy(world).project(camera);
  const forward=world.clone().sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3()))>0;
  const front=!base.parent||world.clone().sub(base.parent.getWorldPosition(new THREE.Vector3())).dot(camera.position.clone().sub(world))>0;
  this.marker.hidden=!visible||!forward||!front||this.point.z< -1||this.point.z>1||Math.abs(this.point.x)>1||Math.abs(this.point.y)>1;
  if(!this.marker.hidden){this.marker.style.left=`${(this.point.x+1)*innerWidth/2}px`;this.marker.style.top=`${(1-this.point.y)*innerHeight/2}px`;}
 }
 dispose(){this.marker.remove();this.root.remove();this.floating.remove();}
}
