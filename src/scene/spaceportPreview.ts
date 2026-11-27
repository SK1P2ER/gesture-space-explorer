import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SpaceportCollision, type SpaceportSite, type LandmarkId } from './spaceportCollision';
import { SpaceportMetrics } from './spaceportMetrics';
import { SpaceportTap } from './spaceportTap';
import { P24_BOARDING_CAMERA, P24_CAMERAS, addP24PracticalLights, applyP24ArrivalReview, frameP24Camera, type P24CameraName, p24BoardingPoints, p24CameraPose, p24VerticalFov } from './p24BlenderLook';
import { isRegionalSurface } from './japanSiteStyle';
import { CameraTween, FLIGHT_MS, PRESET_MS, smoothstep } from './cameraTween';
import { followEye } from './followPath';
import { applyPreviewDaylight, type LightingMode } from './previewDaylight';
import { enhanceCoastalWater, type CoastalWaterController } from './coastalWater';
import type { Bands } from './overviewFraming';
import { padPoints } from './padFraming';
import { terminalPoints } from './terminalFraming';
import { RocketShadow } from './rocketShadow';
import { applyLegacyArrivalVisibility, fetchSpceLineVehicle, loadSpceLineVehicle, type SpceLineVehicle } from './spceLineVehicle';

/** Launch shadow states (see the shadow note in the constructor). */
type ShadowState = 'rest' | 'retracted' | 'launched';
/** The service arms swing 0 -> 88 deg over 3.0-6.0 s: the rest map holds until mid-swing, the retracted one from then. */
const SHADOW_ARMS_SWITCH = 4.5;
/** A launch time with the arms fully retracted and the rocket still on the pad (it lifts off at about 9.1 s). */
const SHADOW_RETRACTED_AT = 6.5;

export type SpaceportCamera = 'overview' | 'terminal' | 'boarding' | 'deck' | 'garden' | 'launch' | LandmarkId;
export const LAUNCH_SECONDS = 479 / 24;
const ASSET_ROOT = `${import.meta.env.BASE_URL}spaceport/`;

/** An isolated close-up scene: the application's globe, docking datum and mission stay intact. */
export class SpaceportPreview {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, .4, 15000);
  readonly controls: OrbitControls;
  playing = false;
  time = 0;
  /** How many times playback itself has run to the end (a seek to the end, even mid-run, doesn't count). */
  completions = 0;
  view: SpaceportCamera = 'overview';
  readonly metrics = new SpaceportMetrics();
  private collision: SpaceportCollision | null = null;
  private terminalCollision: SpaceportCollision | null = null;
  private readonly previousEye = new THREE.Vector3();
  private readonly pointer = new THREE.Vector2();
  private readonly tap = new SpaceportTap();
  private readonly picker = new THREE.Raycaster();
  /** The camera move under way: a preset switch, a place flight or Reset. Follow's destination moves with the rocket. */
  private transition: { tween: CameraTween; eye: THREE.Vector3; target: THREE.Vector3; follow: boolean } | null = null;
  /** Launch-state shadow maps still to draw: one per frame, each in a frame of its own (see the constructor's note). */
  private shadowQueue: ShadowState[] = [];
  private readonly shadowMaps = new Map<ShadowState, THREE.WebGLRenderTarget>();
  /** Launch parts that cast into the state maps (rocket stack, service arms; jets never), and which are the rocket's. */
  private readonly launchCasters: THREE.Mesh[] = [];
  private readonly rocketCasters = new Set<THREE.Mesh>();
  private rocketRestY = 13;
  /** The rocket's height on the pad, read from the loaded animation (every quality; the shadow path keeps its own). */
  private liftRestY: number | null = null;
  /**
   * A mission departure (SpaceportView.startLaunch): the pad and rocket are framed together until the rocket really
   * rises, then the camera eases onto Follow. Null outside a mission departure (the preview is unchanged).
   */
  private departure: { reduced: boolean; liftoffAt: number | null } | null = null;
  /** Resolves load() once the shadow maps are drawn, so the preview never shows a frame without its model. */
  private shadowsReady: (() => void) | null = null;
  private readonly sun: THREE.DirectionalLight;
  private readonly padGlow = new THREE.PointLight(0xff9f40, 0, 220, 1.35);
  private readonly apronFill = new THREE.SpotLight(0xa6ccff, 0, 185, Math.PI / 3.4, .68, 1.85);
  private water: CoastalWaterController | null = null;
  private waterTime = 0;
  private deckBaseTargetY = 48;
  /** The moving rocket's shadow (High quality): a flat outline on the deck instead of a shadow-map redraw. */
  private rocketShadow: RocketShadow | null = null;
  private lastFrame = 0;
  private warmUntil = Infinity;
  private adjustAt = 0;
  private readonly ratioCap: number;
  private model: THREE.Group | null = null;
  private spceLine: SpceLineVehicle | null = null;
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
  private readonly daylight: ReturnType<typeof applyPreviewDaylight>;
  /** The UI's top bar and dock, as fractions of the canvas height (the Overview frames the campus between them). */
  private bands: Bands = { top: 0, bottom: 0 };
  /** The camera sits on the framed Overview (not moved by the user since): a resize or new bands re-frame it. */
  private framed = false;
  /** A preset owns the camera only until the user starts an orbit/zoom. */
  private presetActive = true;

  constructor(private readonly host: HTMLElement, low: boolean, private readonly onInspect: (id: LandmarkId) => void = () => {}) {
    this.ratioCap = Math.min(devicePixelRatio, low ? 1 : 1.5);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.shadowMap.enabled = !low;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Shadows within the 400k-triangle frame budget: the sun and its shadow camera never move, and the launch has three
    // shadow states: rest (rocket and arms on the pad), arms retracted, launched (no rocket). One shadow map per state is
    // drawn once after loading, each in a frame of its own whose main pass draws nothing (renderShadowState), and
    // seek() only swaps which map the sun uses (selectShadowMap). Once the rocket lifts off, its shadow is a flat outline on
    // the deck (RocketShadow, a few dozen triangles) that slides and fades as it climbs. Redrawing the shadow map whenever
    // the time changed drew the scene twice, ~775k triangles a frame.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);
    // Day follows the P2.4 lighting reference. Sunset and Night remain available for exploration.
    const hemi = new THREE.HemisphereLight();
    const sun = this.sun = new THREE.DirectionalLight();
    sun.castShadow = !low;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -450, right: 450, top: 450, bottom: -450, near: 1, far: 1600 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.6;
    this.scene.add(hemi, sun, this.padGlow, this.apronFill, this.apronFill.target);
    this.padGlow.position.set(0, 15, 0);
    this.apronFill.position.set(44, 38, 49);
    this.apronFill.target.position.set(4, 25, 0);
    this.daylight = applyPreviewDaylight(this.renderer, this.scene, hemi, sun);
    addP24PracticalLights(this.scene);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 2200;
    this.controls.maxPolarAngle = Math.PI * 0.58;
    // Any manual drag or zoom (wheel, pinch) hands the camera back to the user at once: no move finishes behind them.
    this.controls.addEventListener('start', () => {
      this.following = false;
      this.transition = null;
      this.framed = false;
      this.presetActive = false;
    });
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
    this.setView('overview', { animate: false });
  }

  private get cameraCollision() { return this.view === 'terminal' || this.view === 'boarding' ? this.terminalCollision : this.collision; }

  showBlenderReview(view: P24CameraName) {
    this.setView(view, { animate: false });
    if (this.mixer) applyP24ArrivalReview(this.mixer, this.actions);
  }

  /** A camera move is under way (tests and the view read it). */
  get moving() { return this.transition !== null; }
  get activePreset() { return this.presetActive ? this.view : null; }
  get boardingAvailable() { return this.spceLine !== null; }
  get lighting(): LightingMode { return this.daylight.getMode(); }
  setLighting(mode: LightingMode) {
    this.daylight.setMode(mode);
    this.effects();
  }
  /** Stops any camera move where it is (Close, a new owner of the camera). */
  stopMoving() { this.transition = null; }

  async load(signal: AbortSignal) {
    this.loading = true;
    const started = performance.now();
    try {
      this.draco.setDecoderPath(`${ASSET_ROOT}draco/`).setWorkerLimit(1);
      const [response, metadata, vehicleData] = await Promise.all([
        fetch(`${ASSET_ROOT}tanegashima-m03.glb`, { signal }), fetch(`${ASSET_ROOT}site.json`, { signal }), fetchSpceLineVehicle(ASSET_ROOT, signal),
      ]);
      if (!response.ok) throw new Error(`Spaceport asset: HTTP ${response.status}`);
      if (!metadata.ok) throw new Error(`Spaceport navigation: HTTP ${metadata.status}`);
      const site = await metadata.json() as SpaceportSite;
      this.collision = new SpaceportCollision(site);
      // The Blender terminal camera sits 32 cm below the broad roof collider.
      this.terminalCollision = new SpaceportCollision(site, .2);
      const data = await response.arrayBuffer();
      if (signal.aborted) return;
      const gltf = await new GLTFLoader().setDRACOLoader(this.draco).parseAsync(data, ASSET_ROOT);
      if (signal.aborted || this.disposed) { disposeTree(gltf.scene); return; }
      const spceLine = await loadSpceLineVehicle(ASSET_ROOT, this.draco, signal, vehicleData, (m) => this.daylight.reflect(m));
      if (signal.aborted || this.disposed) {
        spceLine?.dispose();
        disposeTree(gltf.scene);
        return;
      }
      // Attach the campus only after its materials and vehicle are ready in the same frame.
      this.model = gltf.scene;
      this.spceLine = spceLine;
      if (spceLine) {
        applyLegacyArrivalVisibility(gltf.scene, spceLine);
        spceLine.updateLod(this.camera);
        this.scene.add(spceLine.root);
      }
      this.scene.add(gltf.scene);
      const authoredMaterials = new Set<THREE.Material>();
      gltf.scene.traverse(object => {
        if (object.name === 'CTRL_|_Shuttle_ascent' || object.userData.name === 'CTRL | Shuttle ascent') this.rocket = object;
        if (object instanceof THREE.Mesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          // The broad terrain/ocean/road receivers need no self-shadow map. Excluding
          // them also avoids acne on shallow graded ground with a compact shadow map.
          // Launch parts (anything under a CTRL node: rocket stack, service arms, jets) move, so they stay out of the static
          // shadow map; the rocket gets its deck shadow from RocketShadow.
          let launchPart = false;
          let arrivalPart = false;
          for (let node: THREE.Object3D | null = object; node; node = node.parent) {
            if (/^CTRL[_ |]/.test(node.name)) launchPart = true;
            if (node.userData.arrivalActor === true) arrivalPart = true;
          }
          const caster = !object.name.startsWith('FX') && !materials.some(material => isRegionalSurface(material.name) || /Asphalt|Road_Charcoal|Road paint/i.test(material.name));
          object.castShadow = caster && !launchPart && !arrivalPart; // moving arrivals never leave a frozen shadow
          if (object instanceof THREE.SkinnedMesh && arrivalPart) {
            const min = object.userData.arrivalBoundsMin, max = object.userData.arrivalBoundsMax;
            // Exported union over the complete authored arrival, in mesh-local app axes. First-frame actors may be
            // scaled to zero; a first-frame bound would make them disappear later, while disabling culling wastes tris.
            if (Array.isArray(min) && Array.isArray(max) && object.userData.arrivalBoundsSpace === 'mesh-local-three-y-up') {
              object.boundingBox = new THREE.Box3(new THREE.Vector3().fromArray(min), new THREE.Vector3().fromArray(max));
              object.boundingSphere = object.boundingBox.getBoundingSphere(new THREE.Sphere());
            } else object.frustumCulled = false;
          }
          if (caster && launchPart) {
            this.launchCasters.push(object);
            for (let node: THREE.Object3D | null = object; node; node = node.parent) if (/^CTRL[_ |]+Shuttle/.test(node.name)) this.rocketCasters.add(object);
          }
          object.receiveShadow = true;
          for (const material of materials) authoredMaterials.add(material);
        }
      });
      for (const material of authoredMaterials) {
        if (material.name === 'PAL_Glass') this.daylight.reflect(material);
        if (material.name === 'Web open ocean') this.water = enhanceCoastalWater(material, this.sun.position);
      }
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) {
        const action = this.mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        this.actions.push(action);
      }
      this.seek(0);
      if (this.rocket) this.liftRestY = this.rocket.position.y;
      if (this.renderer.shadowMap.enabled) {
        if (this.rocket) {
          this.rocketRestY = this.rocket.position.y;
          this.rocketShadow = this.buildRocketShadow(this.rocket, gltf.scene);
          if (this.rocketShadow) { this.scene.add(this.rocketShadow.mesh); this.rocketShadow.update(this.rocket.position.y); }
        }
        this.shadowQueue = ['rest', 'retracted', 'launched'];
      }
      this.renderer.compile(this.scene, this.camera);
      // The shadow-map frames run in the next update() calls; 'loading' lasts until they are done.
      if (this.shadowQueue.length) await new Promise<void>(resolve => { this.shadowsReady = resolve; });
      if (signal.aborted || this.disposed) return;
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
    if (this.presetActive) this.updateLens();
    else if (this.camera.view?.enabled) {
      // An orbit keeps its zoom and the current lens shift when the window changes.
      const { height: previousHeight, offsetY } = this.camera.view;
      this.camera.setViewOffset(width, height, 0, offsetY / previousHeight * height, width, height);
    } else this.camera.updateProjectionMatrix();
    this.reframe();
  }

  private updateLens() {
    this.camera.clearViewOffset();
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(15)) / Math.min(1, this.camera.aspect / 1.5)));
    this.camera.updateProjectionMatrix();
  }

  /** The view's top bar and dock heights (px). The Overview keeps the campus in the screen area between them. */
  setBands(top: number, bottom: number) {
    const height = this.host.getBoundingClientRect().height;
    if (!height) return;
    const next = { top: top / height, bottom: bottom / height };
    if (Math.abs(next.top - this.bands.top) < 1e-4 && Math.abs(next.bottom - this.bands.bottom) < 1e-4) return;
    this.bands = next;
    this.reframe();
  }

  /**
   * A resize or new bands: if the camera rests on the Overview, put it on the Overview for the new screen; if it is
   * on its way there (Overview button, Reset), the move ends on the Overview for the new screen.
   */
  private reframe() {
    if (!this.framed) return;
    if (!this.transition) this.setView(this.view, { animate: false });
    else if (!this.transition.follow) this.presetPose(this.view, this.transition.eye, this.transition.target);
  }

  /**
   * Switches the camera preset. The preset's final pose is unchanged; it is reached by a short eased move from wherever
   * the camera is now (also mid-way through another move). Reduced motion, or `animate: false`, switches directly.
   * Follow eases onto the rocket-tracking pose (which keeps moving during playback), then tracks it as before.
   */
  setView(view: SpaceportCamera, { reduced = false, animate = true }: { reduced?: boolean; animate?: boolean } = {}) {
    this.spendMomentum();
    this.view = view;
    this.controls.minDistance = view === 'boarding' ? 2.5 : 10;
    this.updateLens();
    this.presetActive = true;
    this.following = view === 'launch';
    this.framed = view === 'overview' || view === 'terminal' || view === 'boarding' || view === 'pad' || view === 'deck';
    const eye = new THREE.Vector3(), target = new THREE.Vector3();
    if (!this.presetPose(view, eye, target)) { this.transition = null; return; }
    if (!animate || reduced) {
      this.transition = null;
      this.camera.position.copy(this.cameraCollision?.constrain(eye, eye) ?? eye);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    const arc = this.cameraCollision?.blocked(this.camera.position, eye) ?? false;
    this.transition = { tween: new CameraTween(this.camera.position, this.controls.target, { durationMs: PRESET_MS, arc }), eye, target, follow: view === 'launch' };
  }

  /** A preset's final pose (Follow: where the rocket-tracking camera is at the current time). */
  private presetPose(view: SpaceportCamera, eye: THREE.Vector3, target: THREE.Vector3) {
    if (view === 'boarding') {
      p24CameraPose(P24_BOARDING_CAMERA, eye, target);
      // The authored eye lands on the edge of the broad terminal collider. Leave a small orbit clearance.
      if (this.cameraCollision) {
        const safe = this.cameraCollision.constrain(eye, eye);
        target.add(safe.clone().sub(eye));
        eye.copy(safe);
      }
      const shortLandscape = this.camera.aspect > 1.55 && this.bands.top + this.bands.bottom > 0.42;
      frameP24Camera(this.camera, P24_BOARDING_CAMERA, eye, target, this.bands, p24BoardingPoints(shortLandscape), shortLandscape ? 2.6 : 1.25);
    }
    else if (view === 'overview' || view === 'terminal' || view === 'pad' || view === 'deck') {
      const shot = P24_CAMERAS[view];
      p24CameraPose(shot, eye, target);
      if (view === 'terminal' || view === 'pad') {
        const phonePad = view === 'pad' && this.camera.aspect < .8;
        frameP24Camera(this.camera, shot, eye, target, this.bands, view === 'terminal' ? terminalPoints() : padPoints(), phonePad ? 2 : 1);
      } else {
        const height = 1000, width = height * this.camera.aspect;
        this.camera.fov = p24VerticalFov(shot, this.camera.aspect, Math.max(.46, 1 - this.bands.top - this.bands.bottom));
        this.camera.setViewOffset(width, height, 0, (this.bands.bottom - this.bands.top) * height / 2, width, height);
      }
      if (view === 'deck') this.deckBaseTargetY = target.y;
    }
    else if (view === 'garden') { eye.set(-120, 60, 60); target.set(-215, 8, -25); }
    else if (view === 'launch') this.followPose(eye, target);
    else {
      const landmark = this.collision?.site.landmarks.find(item=>item.id===view);
      if (!landmark) return false;
      eye.set(...landmark.eye); target.set(...landmark.target);
    }
    return true;
  }

  inspect(id: LandmarkId, reducedMotion: boolean) {
    const landmark = this.collision?.site.landmarks.find(item=>item.id===id);
    if (!landmark) return;
    this.playing = false; this.following = false; this.framed = false; this.view = id; this.presetActive = true;
    this.controls.minDistance = 10;
    this.updateLens();
    this.flyTo(new THREE.Vector3(...landmark.eye),new THREE.Vector3(...landmark.target),reducedMotion);
  }

  resetView(reducedMotion: boolean) {
    this.playing = false; this.seek(0);
    this.following = false; this.view = 'overview'; this.framed = true; this.presetActive = true;
    this.controls.minDistance = 10;
    this.updateLens();
    const eye = new THREE.Vector3(), target = new THREE.Vector3();
    this.presetPose('overview', eye, target);
    this.flyTo(eye, target, reducedMotion);
  }

  private flyTo(eye: THREE.Vector3, target: THREE.Vector3, reduced: boolean) {
    this.spendMomentum();
    if (reduced) { this.camera.position.copy(eye); this.controls.target.copy(target); this.transition = null; }
    else this.transition = { tween: new CameraTween(this.camera.position, this.controls.target, { durationMs: FLIGHT_MS, ease: smoothstep, arc: true }), eye, target, follow: false };
  }

  /**
   * Spends any leftover drag momentum (OrbitControls damping) at once, as Ground View's restoreView does, so a preset,
   * place flight or Reset starts from where the camera really is and ends exactly on its pose (slow frames otherwise
   * keep turning the camera after the move has finished).
   */
  private spendMomentum() {
    const eye = this.camera.position.clone(), target = this.controls.target.clone(), damping = this.controls.enableDamping;
    this.controls.enableDamping = false; this.controls.update(); this.controls.enableDamping = damping;
    // No momentum left: keep the exact pose (update() would otherwise re-derive it with float rounding).
    if (this.camera.position.distanceToSquared(eye) < 1e-10 && this.controls.target.distanceToSquared(target) < 1e-10) { this.camera.position.copy(eye); this.controls.target.copy(target); }
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

  /** True once the rocket has actually risen off the pad at the current launch time (the animation, not the clock). */
  get liftedOff() {
    return this.rocket !== null && this.liftRestY !== null && this.rocket.position.y > this.liftRestY + 0.05;
  }
  /** A mission departure: the launch time the rocket was first seen off the pad (null: not yet, or not a departure). */
  get liftoffAt() { return this.departure?.liftoffAt ?? null; }
  /** The camera of a mission departure: 'pad' before liftoff, 'follow' after (null outside a departure). */
  get departureShot(): 'pad' | 'follow' | null { return this.departure ? (this.departure.liftoffAt === null ? 'pad' : 'follow') : null; }
  get easing() { return this.transition !== null; }

  /**
   * Starts a mission departure at `from` seconds: the Launch Pad framing (pad, gantry and rocket, between the bars)
   * holds until the rocket rises, then Follow takes over with a short eased move (a cut with reduced motion).
   * `play: false` holds the frame (reduced motion's still departure).
   */
  presentDeparture({ from, reduced = false, play = true }: { from: number; reduced?: boolean; play?: boolean }) {
    this.departure = null;
    this.seek(from);
    this.departure = { reduced, liftoffAt: null };
    this.setView('pad', { animate: false });
    this.watchLiftoff();
    this.playing = play;
  }

  private watchLiftoff() {
    const d = this.departure;
    if (!d || d.liftoffAt !== null || !this.liftedOff) return;
    d.liftoffAt = this.time;
    this.setView('launch', { reduced: d.reduced, animate: !d.reduced });
  }

  play({ reduced = false, animate = true, preserveView = false }: { reduced?: boolean; animate?: boolean; preserveView?: boolean } = {}) {
    if (this.time >= LAUNCH_SECONDS - 0.01) this.seek(0);
    if (!preserveView) this.setView('launch', { reduced, animate });
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
    this.spceLine?.setTime(this.time);
    this.effects();
    if (this.rocket) this.rocketShadow?.update(this.rocket.position.y);
    this.selectShadowMap();
    this.watchLiftoff();
    if (this.following && !this.transition) this.trackLaunch(); // while easing onto Follow, the move owns the camera
    else if (this.view === 'deck' && this.presetActive && !this.transition && this.rocket) {
      // Gentle spectator head-tilt upward from the Observation Deck as the shuttle climbs past liftoff.
      const climb = Math.max(0, this.rocket.position.y - this.rocketRestY);
      this.controls.target.y = this.deckBaseTargetY + Math.min(55, climb * 0.42);
    }
  }

  update(dt: number, reducedMotion: boolean) {
    if (this.disposed) return;
    const started = performance.now();
    this.previousEye.copy(this.camera.position);
    this.waterTime += dt;
    this.water?.update(this.waterTime, reducedMotion);
    if (this.playing) {
      this.seek(this.time + dt);
      if (this.time >= LAUNCH_SECONDS) { this.playing = false; this.completions++; }
    }
    const transitioning = !!this.transition;
    if (this.transition) {
      const move = this.transition;
      if (move.follow) this.followPose(move.eye, move.target); // the rocket moves on during playback
      if (move.tween.step(reducedMotion ? Infinity : dt * 1000, move.eye, move.target, this.camera.position, this.controls.target)) this.transition = null;
    }
    this.controls.enableDamping = !reducedMotion;
    this.controls.update();
    const collision = this.cameraCollision;
    if (collision) {
      // Scripted preset/place transitions arc over intermediate buildings; only manual motion is wall-swept.
      if (transitioning) this.camera.position.y = Math.max(this.camera.position.y, collision.floorAt(this.camera.position.x, this.camera.position.z));
      else this.camera.position.copy(collision.constrain(this.previousEye, this.camera.position));
    }
    this.spceLine?.updateLod(this.camera);
    if (this.shadowQueue.length) { // this frame draws one shadow map only
      this.renderShadowState(this.shadowQueue.shift()!);
      if (!this.shadowQueue.length) { this.shadowsReady?.(); this.shadowsReady = null; }
    }
    else this.renderer.render(this.scene, this.camera);
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

  /**
   * Draws one launch state's shadow map in a frame of its own, into a 1x1 target that never reaches the screen. Its main
   * pass draws (almost) nothing: the camera's tiny frustum, far below the world, holds no object, so only the few
   * never-culled ones (smoke, sky) are drawn. Layers can't be used for this: three.js tests shadow casters against the MAIN
   * camera's layers too. The launch parts are posed for the state and cast only during this frame.
   */
  private renderShadowState(state: ShadowState) {
    const time = this.time;
    this.mixer?.setTime(state === 'rest' ? 0 : SHADOW_RETRACTED_AT);
    for (const mesh of this.launchCasters) mesh.castShadow = state !== 'launched' || !this.rocketCasters.has(mesh);
    const camera = new THREE.PerspectiveCamera(1, 1, 0.1, 0.2), target = new THREE.WebGLRenderTarget(1, 1);
    camera.position.set(0, -1e5, 0); camera.lookAt(0, -2e5, 0); camera.updateMatrixWorld();
    this.sun.shadow.map = null; // a render target of its own for this state
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, camera);
    this.renderer.setRenderTarget(null);
    target.dispose();
    if (this.sun.shadow.map) this.shadowMaps.set(state, this.sun.shadow.map);
    for (const mesh of this.launchCasters) mesh.castShadow = false;
    this.seek(time); // back to the launch time (also picks the map for it)
  }

  /** The state map for the current launch time: rest until mid-swing of the arms, then retracted, then launched. */
  private selectShadowMap() {
    if (!this.shadowMaps.size) return;
    const lifted = (this.rocket?.position.y ?? this.rocketRestY) > this.rocketRestY + 0.01;
    const map = this.shadowMaps.get(lifted ? 'launched' : this.time < SHADOW_ARMS_SWITCH ? 'rest' : 'retracted');
    if (map) this.sun.shadow.map = map;
  }

  /** The rocket stack's deck shadow, from its rest pose. The deck height is ray-cast where the shadow falls. */
  private buildRocketShadow(rocket: THREE.Object3D, model: THREE.Object3D) {
    this.sun.updateMatrixWorld(); this.sun.target.updateMatrixWorld();
    const dir = new THREE.Vector3().subVectors(this.sun.target.getWorldPosition(new THREE.Vector3()), this.sun.getWorldPosition(new THREE.Vector3())).normalize();
    if (dir.y > -0.1) return null;
    const base = rocket.getWorldPosition(new THREE.Vector3());
    const along = new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(12);
    const static_: THREE.Object3D[] = [];
    model.traverse(object => { if (object instanceof THREE.Mesh && object.castShadow) static_.push(object); });
    const ray = new THREE.Raycaster(new THREE.Vector3(base.x + along.x, base.y + 200, base.z + along.z), new THREE.Vector3(0, -1, 0));
    // The first surface below the rocket's root (the deck), not a gantry platform the ray may pass first.
    const hit = ray.intersectObjects(static_, false).find(h => h.point.y < base.y);
    return new RocketShadow(rocket, dir, hit ? hit.point.y : base.y - 6, rocket.position.y);
  }

  private trackLaunch() { this.followPose(this.camera.position, this.controls.target); }

  /** Where the rocket-following camera is at the current time (the existing tracking path, unchanged). */
  private followPose(eye: THREE.Vector3, target: THREE.Vector3) {
    // The path itself lives in followPath.ts (Passenger Campus stops, checked against the site colliders by
    // tests/spaceportFollowPath.test.ts); the target follows the rocket as before.
    eye.set(...followEye(this.time * 24 + 1));
    target.set(0, (this.rocket?.position.y ?? 13) + 28, 0);
  }


  private effects() {
    const frame = this.time * 24 + 1;
    const power = THREE.MathUtils.smoothstep(frame, 145, 192);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(frame, 290, 390);
    const ignition = power * fadeOut;
    const night = this.lighting === 'night';
    this.padGlow.intensity = ignition * (night ? 920 : 420);
    // Cool night fill separates the shuttle and gantry from the dark skyline; brief lift during ignition/liftoff.
    this.apronFill.intensity = night ? 2200 + ignition * 950 : 0;
    this.smokeMaterial.color.setHex(night ? 0xf2c89c : 0xd5e0e5);
    this.smokeMaterial.opacity = power * (night ? 0.28 : 0.22);
    this.water?.setLighting(this.lighting, ignition, this.sun.position);
    for (let i = 0; i < 25; i++) {
      const age = Math.max(0, (frame - 151 - i * 3) / 85);
      const radius = Math.max(0.001, Math.min(2.4, age * 1.15) * (3.4 + i % 3));
      this.transform.position.set((i % 2 ? 1 : -1) * (3 + age * (18 + i % 7)), 7.8 + age * 3.8, 4 + age * (14 + i % 4));
      this.transform.scale.set(radius * 1.65, radius * 0.78, radius);
      this.transform.updateMatrix();
      this.smoke.setMatrixAt(i, this.transform.matrix);
    }
    this.smoke.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.shadowsReady?.(); this.shadowsReady = null; // an unfinished load() returns (it checks disposed)
    this.resize.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown',this.pointerDown);
    this.renderer.domElement.removeEventListener('pointermove',this.pointerMove);
    this.renderer.domElement.removeEventListener('pointerup',this.pointerUp);
    this.renderer.domElement.removeEventListener('pointercancel',this.pointerCancel);
    this.spceLine?.dispose(); this.spceLine = null;
    this.mixer?.stopAllAction();
    this.rocketShadow?.dispose();this.rocketShadow=null;
    for (const map of this.shadowMaps.values()) map.dispose();
    this.shadowMaps.clear(); this.sun.shadow.map = null;
    if (this.model) this.mixer?.uncacheRoot(this.model);
    this.daylight.dispose();
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
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  for (const geometry of geometries) geometry.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) { texture.dispose(); if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close(); }
}
