import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SpaceportCollision, type SpaceportSite, type LandmarkId } from './spaceportCollision';
import { SpaceportMetrics } from './spaceportMetrics';
import { SpaceportTap } from './spaceportTap';
import {SpaceportLandscape} from './spaceportLandscape';
import {isParkedVehicle,isRegionalSurface,siteFinish,lightSiteFinish,softenCoastalMeadow} from './japanSiteStyle';

export type SpaceportCamera = 'overview' | 'garden' | 'launch' | LandmarkId;
export const LAUNCH_SECONDS = 479 / 24;
const ASSET_ROOT = `${import.meta.env.BASE_URL}spaceport/`;

/** An isolated close-up scene: the application's globe, docking datum and mission stay intact. */
export class SpaceportPreview {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 2, 15000);
  readonly controls: OrbitControls;
  playing = false;
  time = 0;
  view: SpaceportCamera = 'overview';
  readonly metrics = new SpaceportMetrics();
  private collision: SpaceportCollision | null = null;
  private readonly previousEye = new THREE.Vector3();
  private readonly pointer = new THREE.Vector2();
  private readonly tap = new SpaceportTap();
  private readonly picker = new THREE.Raycaster();
  private transition: { from: THREE.Vector3; to: THREE.Vector3; targetFrom: THREE.Vector3; targetTo: THREE.Vector3; elapsed: number } | null = null;
  private lastFrame = 0;
  private warmUntil = Infinity;
  private adjustAt = 0;
  private readonly ratioCap: number;
  private model: THREE.Group | null = null;
  private landscape:SpaceportLandscape|null=null;
  private mixer: THREE.AnimationMixer | null = null;
  private rocket: THREE.Object3D | null = null;
  private readonly actions: THREE.AnimationAction[] = [];
  private readonly smoke: THREE.InstancedMesh;
  private readonly smokeMaterial: THREE.MeshBasicMaterial;
  private readonly resize: ResizeObserver;
  private readonly draco = new DRACOLoader();
  private disposed = false;
  private loading = false;
  private following = false;
  private readonly transform = new THREE.Object3D();

  constructor(private readonly host: HTMLElement, private readonly low: boolean, private readonly onInspect: (id: LandmarkId) => void = () => {}) {
    this.ratioCap = Math.min(devicePixelRatio, low ? 1 : 1.5);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = !low;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x9fc7df);
    this.scene.fog = new THREE.Fog(0x9fc7df, 2200, 9500);
    this.scene.add(new THREE.HemisphereLight(0xdceeff, 0x657a48, 2));
    const sun = new THREE.DirectionalLight(0xfff1d8, 3.2);
    sun.position.set(-350, 650, 300);
    sun.castShadow = !low;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -450, right: 450, top: 450, bottom: -450, near: 1, far: 1600 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 2200;
    this.controls.maxPolarAngle = Math.PI * 0.58;
    this.controls.addEventListener('start', () => { this.following = false; });
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.pointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.pointerCancel);
    this.smokeMaterial = new THREE.MeshBasicMaterial({ color: 0xd5e0e5, transparent: true, opacity: 0, depthWrite: false });
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.smokeMaterial, 25);
    this.smoke.frustumCulled = false;
    this.scene.add(this.smoke);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
    this.setView('overview');
  }

  async load(signal: AbortSignal) {
    this.loading = true;
    const started = performance.now();
    try {
      this.draco.setDecoderPath(`${ASSET_ROOT}draco/`).setWorkerLimit(1);
      const [response, metadata] = await Promise.all([fetch(`${ASSET_ROOT}tanegashima-m03.glb`, { signal }), fetch(`${ASSET_ROOT}site.json`, { signal })]);
      if (!response.ok) throw new Error(`Spaceport asset: HTTP ${response.status}`);
      if (!metadata.ok) throw new Error(`Spaceport navigation: HTTP ${metadata.status}`);
      this.collision = new SpaceportCollision(await metadata.json() as SpaceportSite);
      const data = await response.arrayBuffer();
      if (signal.aborted) return;
      const gltf = await new GLTFLoader().setDRACOLoader(this.draco).parseAsync(data, ASSET_ROOT);
      if (signal.aborted || this.disposed) { disposeTree(gltf.scene); return; }
      this.model = gltf.scene;
      this.scene.add(gltf.scene);
      const finishes=new Map<THREE.Material,THREE.Material>();
      gltf.scene.traverse(object => {
        if (object.name === 'CTRL_|_Shuttle_ascent' || object.userData.name === 'CTRL | Shuttle ascent') this.rocket = object;
        if (object instanceof THREE.Mesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          // The broad terrain/ocean/road receivers need no self-shadow map. Excluding
          // them also avoids acne on shallow graded ground with a compact shadow map.
          object.castShadow = !object.name.startsWith('FX') && !materials.some(material => /vegetation and beach|Pacific|shelf|surf|Asphalt|Road_Charcoal|Road paint/i.test(material.name));
          object.receiveShadow = true;
          let vehicle=false;
          for(let node:THREE.Object3D|null=object;node;node=node.parent)if(isParkedVehicle(node.name))vehicle=true;
          if(!vehicle){
            if(materials.some(m=>/vegetation and beach/i.test(m.name)))softenCoastalMeadow(object.geometry);
            const convert=(source:THREE.Material)=>{
              if(isRegionalSurface(source.name))return source;
              if(!finishes.has(source)){const finish=siteFinish(source);lightSiteFinish(finish,0);finishes.set(source,finish);}
              return finishes.get(source)!;
            };
            object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);
          }
        }
      });
      const retained=new Set<THREE.Material>();
      gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])retained.add(m);});
      for(const source of finishes.keys())if(!retained.has(source))source.dispose();
      this.landscape=new SpaceportLandscape(this.collision.site,this.low);this.scene.add(this.landscape.group);
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) {
        const action = this.mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        this.actions.push(action);
      }
      this.seek(0);
      this.renderer.compile(this.scene, this.camera);
      this.metrics.loadMs = performance.now() - started;
      this.warmUntil = performance.now()+2000;
      this.lastFrame = performance.now();
    } finally {
      this.loading = false;
      // Let in-flight decoder tasks settle so a closed dialog cannot strand their promises.
      if (this.disposed) this.draco.dispose();
    }
  }

  private fit() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height || this.disposed) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Keep the same horizontal framing on narrow phones.
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(30 / 2)) / Math.min(1, this.camera.aspect / 1.5)));
    this.camera.updateProjectionMatrix();
  }

  setView(view: SpaceportCamera) {
    this.transition = null;
    this.view = view;
    this.following = view === 'launch';
    if (view === 'overview') {
      this.camera.position.set(-420, 270, -440);
      this.controls.target.set(0, 20, -30);
    } else if (view === 'garden') {
      this.camera.position.set(245, 80, -55);
      this.controls.target.set(168, 8, -145);
    } else if (view === 'launch') this.trackLaunch();
    else {
      const landmark = this.collision?.site.landmarks.find(item=>item.id===view);
      if (landmark) { this.camera.position.set(...landmark.eye); this.controls.target.set(...landmark.target); }
    }
    this.camera.position.copy(this.collision?.constrain(this.camera.position,this.camera.position) ?? this.camera.position);
    this.controls.update();
  }

  inspect(id: LandmarkId, reducedMotion: boolean) {
    const landmark = this.collision?.site.landmarks.find(item=>item.id===id);
    if (!landmark) return;
    this.playing = false; this.following = false; this.view = id;
    this.flyTo(new THREE.Vector3(...landmark.eye),new THREE.Vector3(...landmark.target),reducedMotion);
  }

  resetView(reducedMotion: boolean) {
    this.playing = false; this.seek(0);
    this.following = false; this.view = 'overview';
    this.flyTo(new THREE.Vector3(-420,270,-440),new THREE.Vector3(0,20,-30),reducedMotion);
  }

  private flyTo(eye: THREE.Vector3, target: THREE.Vector3, reduced: boolean) {
    if (reduced) { this.camera.position.copy(eye); this.controls.target.copy(target); this.transition = null; }
    else this.transition = { from:this.camera.position.clone(),to:eye,targetFrom:this.controls.target.clone(),targetTo:target,elapsed:0 };
  }

  private readonly pointerDown = (event: PointerEvent) => { this.tap.down(event); this.transition = null; };
  private readonly pointerMove = (event: PointerEvent) => { this.tap.move(event); };
  private readonly pointerCancel = () => { this.tap.cancel(); };
  private readonly pointerUp = (event: PointerEvent) => {
    if (!this.tap.up(event) || !this.controls.enabled) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
    this.picker.setFromCamera(this.pointer,this.camera);
    const id = this.collision?.pick(this.picker.ray);
    if (id) this.onInspect(id);
  };

  play() {
    if (this.time >= LAUNCH_SECONDS - 0.01) this.seek(0);
    this.setView('launch');
    this.playing = true;
  }

  seek(seconds: number) {
    this.time = THREE.MathUtils.clamp(seconds, 0, LAUNCH_SECONDS);
    // LoopOnce actions become paused on the end frame; re-enable them for replay/scrubbing.
    if (this.mixer && this.model) {
      for (const action of this.actions) {
        action.paused = false;
        action.enabled = true;
      }
      this.mixer.setTime(this.time);
    }
    this.effects();
    if (this.following) this.trackLaunch();
  }

  update(dt: number, reducedMotion: boolean) {
    if (this.disposed) return;
    const started = performance.now();
    this.previousEye.copy(this.camera.position);
    if (this.playing) {
      this.seek(this.time + dt);
      if (this.time >= LAUNCH_SECONDS) this.playing = false;
    }
    if (this.transition) {
      const flight = this.transition; flight.elapsed += dt;
      const t = reducedMotion ? 1 : THREE.MathUtils.smoothstep(flight.elapsed,0,.9);
      this.camera.position.lerpVectors(flight.from,flight.to,t);
      this.camera.position.y += 4*t*(1-t)*Math.max(0,120-Math.min(flight.from.y,flight.to.y));
      this.controls.target.lerpVectors(flight.targetFrom,flight.targetTo,t);
      if (t === 1) this.transition = null;
    }
    this.controls.enableDamping = !reducedMotion;
    this.controls.update();
    this.camera.position.copy(this.collision?.constrain(this.previousEye,this.camera.position) ?? this.camera.position);
    this.renderer.render(this.scene, this.camera);
    const ended = performance.now();
    if (started >= this.warmUntil && this.lastFrame) this.metrics.add(started-this.lastFrame,ended-started,this.renderer.info.render.calls,this.renderer.info.render.triangles);
    this.lastFrame = started;
    if (started > this.adjustAt && this.metrics.snapshot().samples>=90) {
      const report = this.metrics.snapshot(), target = matchMedia('(pointer: coarse)').matches ? 30 : 60;
      const ratio = this.renderer.getPixelRatio();
      const next = report.frameP95Ms > 1000/target*1.35 ? Math.max(.6,ratio*.85) : report.fps > target*1.1 ? Math.min(this.ratioCap,ratio*1.08) : ratio;
      if (Math.abs(next-ratio)>.02) { this.renderer.setPixelRatio(next); this.fit(); }
      this.adjustAt = started+4000;
    }
  }

  performanceReport() {
    const geometries = new Set<THREE.BufferGeometry>(), textures = new Set<THREE.Texture>(), buffers = new Set<ArrayBufferLike>();
    let geometryBytes = 0, textureBytes = 0;
    this.scene.traverse(object=>{
      if (!(object instanceof THREE.Mesh)) return;
      if (!geometries.has(object.geometry)) {
        geometries.add(object.geometry);
        for (const attribute of [...Object.values(object.geometry.attributes),...(object.geometry.index?[object.geometry.index]:[])]) {
          const array = 'data' in attribute ? attribute.data.array : attribute.array;
          if (!buffers.has(array.buffer)) { buffers.add(array.buffer); geometryBytes += array.byteLength; }
        }
      }
      for (const material of Array.isArray(object.material)?object.material:[object.material]) for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    });
    for (const texture of textures) {
      const image = texture.image as {width?:number;height?:number} | undefined;
      textureBytes += (image?.width??0)*(image?.height??0)*4*(texture.generateMipmaps?4/3:1);
    }
    const gl = this.renderer.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
    return { ...this.metrics.snapshot(),pixelRatio:this.renderer.getPixelRatio(),geometryBytes,textureBytes,estimatedGpuBytes:geometryBytes+textureBytes,rendererMemory:{...this.renderer.info.memory},gpu:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),viewport:[this.host.clientWidth,this.host.clientHeight],mode:'launch',device:navigator.userAgent,memoryNote:'Geometry and texture allocation estimate; not measured total GPU VRAM.' };
  }

  private trackLaunch() {
    const frame = this.time * 24 + 1;
    const stops = [[1, -125, 28, -160], [144, -110, 24, -145], [240, -110, 24, -145], [288, -120, 42, -165], [384, -145, 120, -190], [480, -170, 300, -220]];
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1], b = stops[i];
      if (frame <= b[0]) {
        const t = THREE.MathUtils.smoothstep(frame, a[0], b[0]);
        this.camera.position.set(THREE.MathUtils.lerp(a[1], b[1], t), THREE.MathUtils.lerp(a[2], b[2], t), THREE.MathUtils.lerp(a[3], b[3], t));
        break;
      }
    }
    this.controls.target.set(0, (this.rocket?.position.y ?? 13) + 28, 0);
  }

  private effects() {
    const frame = this.time * 24 + 1;
    const power = THREE.MathUtils.smoothstep(frame, 145, 192);
    this.smokeMaterial.opacity = power * 0.14;
    for (let i = 0; i < 25; i++) {
      const age = Math.max(0, (frame - 151 - i * 3) / 85);
      const radius = Math.max(0.001, Math.min(2, age) * (3 + i % 3));
      this.transform.position.set((i % 2 ? 1 : -1) * (3 + age * (16 + i % 7)), 7.5 + age * 3, 4 + age * (12 + i % 4));
      this.transform.scale.set(radius * 1.6, radius * 0.7, radius);
      this.transform.updateMatrix();
      this.smoke.setMatrixAt(i, this.transform.matrix);
    }
    this.smoke.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resize.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown',this.pointerDown);
    this.renderer.domElement.removeEventListener('pointermove',this.pointerMove);
    this.renderer.domElement.removeEventListener('pointerup',this.pointerUp);
    this.renderer.domElement.removeEventListener('pointercancel',this.pointerCancel);
    this.mixer?.stopAllAction();
    this.landscape?.dispose();this.landscape=null;
    if (this.model) this.mixer?.uncacheRoot(this.model);
    disposeTree(this.scene);
    if (!this.loading) this.draco.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

function disposeTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) { texture.dispose(); if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close(); }
}
