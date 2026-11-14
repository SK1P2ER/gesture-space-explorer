import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Rocket} from './rocketKit';
import {SpaceportCollision,type SpaceportSite} from './spaceportCollision';
import {isParkedVehicle,isRegionalSurface,siteFinish,lightSiteFinish,softenCoastalMeadow} from './japanSiteStyle';
import {SpaceportLandscape} from './spaceportLandscape';
import {spaceportPose,type SpaceportVehicle} from '../sim/spaceportView';
import type {Insets} from './cameraRig';
import {atmosphereOf} from '../data/atmosphere';

const ROOT=`${import.meta.env.BASE_URL}spaceport/`;
/** Metre-coordinate gameplay scene. It never owns a timer, trip, docking attempt or RAF. */
export class LocalSpaceportScene {
  readonly scene=new THREE.Scene();
  readonly camera=new THREE.PerspectiveCamera(40,1,.4,18000);
  readonly renderer:THREE.WebGLRenderer;
  private readonly controls:OrbitControls;
  private readonly sun=new THREE.DirectionalLight(0xfff1dc,3);
  private readonly ambient=new THREE.HemisphereLight(0xcfe5f2,0x52614d,1.5);
  private readonly draco=new DRACOLoader().setDecoderPath(`${ROOT}draco/`).setWorkerLimit(1);
  private readonly materials=new Set<THREE.Material>();
  private model:THREE.Group|null=null;
  private landscape:SpaceportLandscape|null=null;
  private mixer:THREE.AnimationMixer|null=null;
  private collision:SpaceportCollision|null=null;
  private vehicle:Rocket;
  private pendingVehicle:Rocket|null=null;
  private low:boolean;
  private docking=false;
  private disposed=false;
  private width=0;private height=0;private ratio=0;
  private resolutionScale=1;
  private readonly previousEye=new THREE.Vector3();
  private readonly resize:ResizeObserver;
  private readonly stars:THREE.Points;
  constructor(private readonly host:HTMLElement,low:boolean,private readonly steer:(x:number,y:number)=>void) {
    this.low=low;
    this.renderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});
    this.renderer.domElement.id='spaceport-ground-canvas';this.renderer.domElement.tabIndex=0;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.sun.shadow.mapSize.set(1024,1024);this.sun.shadow.normalBias=.4;this.sun.shadow.bias=-.0005;
    Object.assign(this.sun.shadow.camera,{left:-600,right:600,top:600,bottom:-600,near:1,far:2000});
    host.append(this.renderer.domElement);
    this.scene.add(this.sun,this.ambient);this.sun.position.set(-350,650,300);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.minDistance=35;this.controls.maxDistance=1400;this.controls.maxPolarAngle=Math.PI*.48;
    this.controls.enableDamping=true;
    this.vehicle=this.makeVehicle(low);this.scene.add(this.vehicle.group);
    const points=new Float32Array(600*3);
    for(let i=0;i<600;i++){const a=i*2.399963,b=(i+.5)/600,y=.1+.9*b,r=Math.sqrt(1-y*y);points.set([6500*r*Math.cos(a),6500*y,6500*r*Math.sin(a)],i*3);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(points,3));
    this.stars=new THREE.Points(geometry,new THREE.PointsMaterial({color:0xd4e2ef,size:5,depthWrite:false}));this.scene.add(this.stars);
    this.renderer.domElement.addEventListener('pointermove',this.onPointer);
    this.resize=new ResizeObserver(()=>this.fit());this.resize.observe(host);this.fit();this.reset();
  }
  private makeVehicle(low:boolean){return new Rocket({design:'shuttle',engines:5,quality:low?'low':'high',textureSize:low?64:512});}
  async load(signal:AbortSignal) {
    try {
      const [asset,metadata]=await Promise.all([fetch(`${ROOT}tanegashima-m03.glb`,{signal}),fetch(`${ROOT}site.json`,{signal})]);
      if(!asset.ok||!metadata.ok)throw new Error('Spaceport assets unavailable');
      const site=await metadata.json() as SpaceportSite;
      const gltf=await new GLTFLoader().setDRACOLoader(this.draco).parseAsync(await asset.arrayBuffer(),ROOT);
      this.model=gltf.scene;
      if(signal.aborted||this.disposed){this.disposeModel();return;}
      this.collision=new SpaceportCollision(site);
      this.mixer=new THREE.AnimationMixer(gltf.scene);
      const actions=gltf.animations.map(clip=>this.mixer!.clipAction(clip).play());
      this.mixer.setTime(0);for(const action of actions)action.paused=true;
      const finishes=new Map<THREE.Material,THREE.Material>();
      gltf.scene.traverse(object=>{
        for(let node:THREE.Object3D|null=object;node;node=node.parent)if(isParkedVehicle(node.name)){object.visible=false;return;}
        if(!(object instanceof THREE.Mesh))return;
        const sourceMaterials=Array.isArray(object.material)?object.material:[object.material];
        if(sourceMaterials.some(material=>/vegetation and beach/i.test(material.name)))softenCoastalMeadow(object.geometry);
        object.castShadow=!sourceMaterials.some(material=>isRegionalSurface(material.name)||/asphalt|road.paint|pavers/i.test(material.name));object.receiveShadow=true;
        const convert=(source:THREE.Material)=>{
          if(isRegionalSurface(source.name)){this.materials.add(source);return source;}
          if(!finishes.has(source)){const material=siteFinish(source);finishes.set(source,material);this.materials.add(source);this.materials.add(material);}
          return finishes.get(source)!;
        };
        object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);
      });
      this.scene.add(gltf.scene);
      this.landscape=new SpaceportLandscape(site,this.low);this.scene.add(this.landscape.group);
      await this.vehicle.ready;
    } finally {this.draco.dispose();if(signal.aborted||this.disposed)this.dispose();}
  }
  private fit(){const {width,height}=this.host.getBoundingClientRect(),ratio=Math.min(devicePixelRatio,this.low?1:1.5)*this.resolutionScale;if(!width||!height||(width===this.width&&height===this.height&&ratio===this.ratio))return;this.width=width;this.height=height;this.ratio=ratio;this.camera.aspect=width/height;this.camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(20))/Math.min(1,this.camera.aspect/1.45)));this.camera.updateProjectionMatrix();this.renderer.setPixelRatio(ratio);this.renderer.setSize(width,height,false);}
  reset(){if(this.docking)return;this.camera.position.set(-410,180,320);this.controls.target.set(-60,22,-65);this.controls.update();}
  rotate(dx:number,dy:number){if(this.docking)return;const offset=this.camera.position.clone().sub(this.controls.target),s=new THREE.Spherical().setFromVector3(offset);s.theta+=dx;s.phi=THREE.MathUtils.clamp(s.phi+dy,.15,Math.PI*.48);this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(s));this.controls.update();}
  zoom(factor:number){if(this.docking)return;const offset=this.camera.position.clone().sub(this.controls.target);offset.setLength(THREE.MathUtils.clamp(offset.length()*factor,35,1400));this.camera.position.copy(this.controls.target).add(offset);this.controls.update();}
  private readonly onPointer=(event:PointerEvent)=>{if(this.docking&&(event.pointerType==='mouse'||event.buttons)){const rect=this.renderer.domElement.getBoundingClientRect();this.steer((event.clientX-rect.left)/rect.width*2-1,(event.clientY-rect.top)/rect.height*2-1);}};
  private setQuality(low:boolean){
    if(this.low===low)return;this.low=low;this.landscape?.setQuality(low);this.pendingVehicle?.dispose();
    const next=this.pendingVehicle=this.makeVehicle(low);
    void next.ready.then(()=>{if(this.disposed||this.pendingVehicle!==next){next.dispose();return;}this.pendingVehicle=null;this.vehicle.dispose();this.vehicle=next;this.scene.add(next.group);});
  }
  render(state:SpaceportVehicle,dt:number,low:boolean,night:number,insets:Readonly<Insets>,reduced:boolean,resolutionScale=1) {
    if(this.disposed||!this.collision)return;
    this.resolutionScale=Math.max(.6,resolutionScale);
    this.setQuality(low);this.fit();this.renderer.shadowMap.enabled=!low;this.sun.castShadow=!low;this.vehicle.setShadows(!low);
    const landing=this.collision.site.landing,pose=spaceportPose(state,landing);
    if(!state.stacked)this.vehicle.separate(true);else this.vehicle.restack();
    this.vehicle.setLander(!state.stacked);this.vehicle.group.visible=true;this.vehicle.group.scale.setScalar(landing.radius/.35*.5);
    this.vehicle.setNight(night,false);
    this.vehicle.group.position.set(pose.x,pose.y,pose.z);this.vehicle.setThrust(pose.thrust,state.docking?.t??0,atmosphereOf('earth'),reduced);this.vehicle.update(dt);
    this.previousEye.copy(this.camera.position);
    const wasDocking=this.docking;this.docking=state.phase==='docking';this.controls.enabled=!this.docking;
    if(this.docking){const height=(state.docking?.alt??0)*landing.radius,look=new THREE.Vector3(landing.center[0],landing.center[1]+height*.62+12,landing.center[2]);this.camera.position.copy(look).add(new THREE.Vector3(-.6*(180+height*.5),95+height*.45,.8*(180+height*.5)));this.controls.target.copy(look);}
    else if(wasDocking)this.controls.target.set(pose.x,pose.y+15,pose.z);
    this.controls.enableDamping=!reduced;this.controls.update();
    this.camera.position.copy(this.collision.constrain(this.previousEye,this.camera.position));
    const sky=new THREE.Color(0x9fc7df).lerp(new THREE.Color(0x101c2d),night);
    this.scene.background=sky;this.scene.fog=new THREE.Fog(sky,2500,9000);
    this.sun.intensity=3*(1-night)+.08;this.ambient.intensity=1.5-night*.7;this.stars.visible=night>.5;
    for(const material of this.materials)if(!isRegionalSurface(material.name))lightSiteFinish(material,night);
    this.renderer.toneMappingExposure=1.05+night*.15;
    const {width,height}=this.host.getBoundingClientRect();
    this.camera.setViewOffset(width,height,(insets.right-insets.left)*width/2,(insets.bottom-insets.top)*height/2,width,height);
    this.camera.updateMatrixWorld();this.renderer.render(this.scene,this.camera);
  }
  get vehicleObject(){return this.vehicle.group;}
  private disposeModel(){
    this.landscape?.dispose();this.landscape=null;
    this.mixer?.stopAllAction();if(this.model)this.mixer?.uncacheRoot(this.model);
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(this.materials),textures=new Set<THREE.Texture>();
    this.model?.traverse(node=>{if(node instanceof THREE.Mesh){geometries.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material])materials.add(material);}});
    for(const geometry of geometries)geometry.dispose();for(const material of materials){for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);material.dispose();}
    for(const texture of textures){texture.dispose();if(typeof ImageBitmap!=='undefined'&&texture.image instanceof ImageBitmap)texture.image.close();}
    this.model=null;this.materials.clear();
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;this.resize.disconnect();this.controls.dispose();this.renderer.domElement.removeEventListener('pointermove',this.onPointer);
    this.vehicle.dispose();this.pendingVehicle?.dispose();this.disposeModel();
    this.stars.geometry.dispose();(this.stars.material as THREE.Material).dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();
  }
}
