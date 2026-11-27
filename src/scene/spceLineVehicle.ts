import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export interface SpceLineFetchData {
  readonly carBuf: ArrayBuffer | null;
  readonly paxBuf: ArrayBuffer | null;
}

export interface SpceLineVehicle {
  readonly root: THREE.Group;
  readonly hasVehicle: boolean;
  readonly hasPassengers: boolean;
  setTime(seconds: number): void;
  updateLod(camera: THREE.Camera): void;
  dispose(): void;
}

/** Hides ONLY the legacy curbside vehicle pod from tanegashima-m03.glb. */
export function hideLegacyCurbsideVehicle(scene: THREE.Object3D) {
  scene.traverse((object) => {
    const name = object.name || '';
    const source = typeof object.userData?.sourceObject === 'string' ? object.userData.sourceObject : '';
    if (source === 'AERO-01 | Curbside service' || /Arrival[_ |]+pod\b/i.test(name)) {
      object.visible = false;
    }
  });
}

/** Hides ONLY the legacy rigid passengers from tanegashima-m03.glb (call only after replacement passengers parse & attach). */
export function hideLegacyArrivalPassengers(scene: THREE.Object3D) {
  scene.traverse((object) => {
    const name = object.name || '';
    const source = typeof object.userData?.sourceObject === 'string' ? object.userData.sourceObject : '';
    if (source === 'Passenger 01' || source === 'Passenger 02' || /Arrival[_ |]+passenger/i.test(name)) {
      object.visible = false;
    }
  });
}

/** Applies legacy visibility hiding matching what actually loaded and attached. */
export function applyLegacyArrivalVisibility(scene: THREE.Object3D, spceLine: Pick<SpceLineVehicle, 'hasVehicle' | 'hasPassengers'>) {
  if (spceLine.hasVehicle) hideLegacyCurbsideVehicle(scene);
  if (spceLine.hasPassengers) hideLegacyArrivalPassengers(scene);
}

/** Fetches both SPCE-LINE vehicle and IK passenger drop-off GLBs in parallel alongside the campus asset. */
export async function fetchSpceLineVehicle(
  assetRoot: string,
  signal: AbortSignal,
): Promise<SpceLineFetchData> {
  if (import.meta.env.VITE_SPCE_LINE_ARRIVAL !== '1') return { carBuf: null, paxBuf: null };
  const [carRes, paxRes] = await Promise.all([
    fetch(`${assetRoot}spce-line.glb`, { signal }).catch(() => null),
    fetch(`${assetRoot}spce-line-passengers.glb`, { signal }).catch(() => null),
  ]);
  const [carBuf, paxBuf] = await Promise.all([
    carRes && carRes.ok ? carRes.arrayBuffer().catch(() => null) : Promise.resolve(null),
    paxRes && paxRes.ok ? paxRes.arrayBuffer().catch(() => null) : Promise.resolve(null),
  ]);
  return { carBuf, paxBuf };
}

/**
 * Parses the web-optimized SPCE-LINE curbside vehicle GLB and continuous-skinned
 * IK passenger drop-off GLB independently so a passenger 404 or parse failure
 * keeps the SPCE-LINE vehicle and falls back cleanly to the legacy passengers.
 */
export async function loadSpceLineVehicle(
  assetRoot: string,
  draco: DRACOLoader,
  signal: AbortSignal,
  prefetched?: SpceLineFetchData | null,
  reflect?: (material: THREE.Material) => void,
): Promise<SpceLineVehicle | null> {
  const data = prefetched ?? await fetchSpceLineVehicle(assetRoot, signal);
  if (!data.carBuf || signal.aborted) return null;

  const loader = new GLTFLoader().setDRACOLoader(draco);
  let carGltf: { scene: THREE.Group; animations: THREE.AnimationClip[] } | null = null;
  try {
    carGltf = await loader.parseAsync(data.carBuf, assetRoot);
  } catch {
    return null;
  }
  if (signal.aborted) {
    disposeSpceLine(carGltf.scene);
    return null;
  }

  let paxGltf: { scene: THREE.Group; animations: THREE.AnimationClip[] } | null = null;
  if (data.paxBuf && !signal.aborted) {
    try {
      const parsed = await loader.parseAsync(data.paxBuf, assetRoot);
      if (signal.aborted) {
        disposeSpceLine(parsed.scene);
      } else {
        paxGltf = parsed;
      }
    } catch {
      // Graceful fallback: keep SPCE-LINE car and let caller retain legacy passengers.
      paxGltf = null;
    }
  }

  if (signal.aborted) {
    disposeSpceLine(carGltf.scene);
    if (paxGltf) disposeSpceLine(paxGltf.scene);
    return null;
  }

  const root = new THREE.Group();
  root.name = 'SPCE-LINE | Curbside vehicle and passengers';
  carGltf.scene.name = 'SPCE-LINE | Curbside vehicle';
  root.add(carGltf.scene);
  if (paxGltf) {
    paxGltf.scene.name = 'SPCE-LINE | Drop-off passengers';
    root.add(paxGltf.scene);
  }

  const configureScene = (group: THREE.Object3D, isPassenger: boolean) => {
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = false;
      object.receiveShadow = true;
      object.frustumCulled = !isPassenger;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!isPassenger && reflect && /Smoked graphite canopy|Pearl ceramic|Pearl shell/i.test(material.name)) {
          reflect(material);
        }
        if (material instanceof THREE.MeshStandardMaterial) {
          if (/Smoked graphite canopy/i.test(material.name)) {
            material.roughness = Math.min(material.roughness, 0.12);
            material.metalness = Math.max(material.metalness, 0.15);
            material.transparent = true;
            material.opacity = 0.86;
            material.depthWrite = true;
          } else if (isPassenger && /amber luggage tag/i.test(material.name)) {
            // Subtle warm self-illumination on the step anti-slip safety strip so shoe-to-step contact reads in Day/Sunset/Night (0 extra tris/calls).
            material.emissive.setHex(0x4a2f08);
            material.emissiveIntensity = 0.55;
            material.roughness = 0.55;
          } else if (isPassenger && /ivory shoe rubber/i.test(material.name)) {
            // Crisp sole edge contrast against the dark step pad and sidewalk across all lighting modes.
            material.emissive.setHex(0x222428);
            material.emissiveIntensity = 0.35;
          }
        }
      }
    });
  };

  configureScene(carGltf.scene, false);
  if (paxGltf) configureScene(paxGltf.scene, true);

  const mixers: { mixer: THREE.AnimationMixer; actions: THREE.AnimationAction[]; root: THREE.Object3D }[] = [];
  const bindClips = (gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }) => {
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const actions: THREE.AnimationAction[] = [];
    for (const clip of gltf.animations) {
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      actions.push(action);
    }
    mixer.setTime(0);
    mixers.push({ mixer, actions, root: gltf.scene });
  };

  bindClips(carGltf);
  if (paxGltf) bindClips(paxGltf);

  const grounding = paxGltf ? buildContactGrounding(paxGltf.scene) : null;
  if (grounding) root.add(grounding.group);

  const curbCenter = new THREE.Vector3(-150.5, 11.2, -108.5);

  return {
    root,
    hasVehicle: true,
    hasPassengers: paxGltf !== null,
    setTime(seconds: number) {
      for (const entry of mixers) {
        for (const action of entry.actions) {
          action.paused = false;
          action.enabled = true;
        }
        entry.mixer.setTime(seconds);
      }
      grounding?.update();
    },
    updateLod(camera: THREE.Camera) {
      const visible = camera.position.distanceTo(curbCenter) < 900;
      if (paxGltf) paxGltf.scene.visible = visible;
      if (grounding) grounding.group.visible = visible;
    },
    dispose() {
      for (const entry of mixers) {
        entry.mixer.stopAllAction();
        entry.mixer.uncacheRoot(entry.root);
      }
      grounding?.dispose();
      disposeSpceLine(root);
    },
  };
}

function sidewalkGroundY(z: number): number {
  const by = -z;
  if (by <= 108.15) return 10.314;
  if (by <= 108.50) return 10.314 + ((by - 108.15) / 0.35) * (10.358 - 10.314);
  return 10.358 + (by - 108.50) * 0.02765;
}

/** Lightweight radial contact shadows (12 triangles total, 0 extra shadow passes) grounding shoes & suitcase wheels in Day/Sunset/Night. */
function buildContactGrounding(paxScene: THREE.Object3D) {
  const group = new THREE.Group();
  group.name = 'SPCE-LINE | Contact grounding';

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.48);
    g.addColorStop(0, 'rgba(6, 10, 16, 0.72)');
    g.addColorStop(0.55, 'rgba(6, 10, 16, 0.32)');
    g.addColorStop(1, 'rgba(6, 10, 16, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const quadGeo = new THREE.PlaneGeometry(1, 1);
  quadGeo.rotateX(-Math.PI / 2);

  interface Tracker {
    source: THREE.Object3D;
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    isSuitcase: boolean;
    radiusX: number;
    radiusZ: number;
  }
  const trackers: Tracker[] = [];
  const makeTracker = (source: THREE.Object3D, isSuitcase: boolean) => {
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(quadGeo, material);
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    group.add(mesh);
    trackers.push({
      source,
      mesh,
      material,
      isSuitcase,
      radiusX: isSuitcase ? 0.38 : 0.24,
      radiusZ: isSuitcase ? 0.34 : 0.28,
    });
  };

  paxScene.traverse((obj) => {
    if (/^Foot[._][LR]/i.test(obj.name)) makeTracker(obj, false);
    else if (/Suitcase/i.test(obj.name) && obj instanceof THREE.Mesh) makeTracker(obj, true);
  });

  const pos = new THREE.Vector3();
  const update = () => {
    paxScene.updateMatrixWorld(true);
    for (const t of trackers) {
      t.source.getWorldPosition(pos);
      // Only show grounding when outside the cabin (curbside step z <= -107.35 or sidewalk z <= -108.0)
      if (pos.z > -107.35) { t.mesh.visible = false; continue; }
      const onStep = !t.isSuitcase && pos.z > -107.92 && pos.y > 10.75;
      const surfaceY = onStep ? 10.945 : sidewalkGroundY(pos.z) + 0.005;
      const clearance = Math.max(0, pos.y - surfaceY);
      const fade = THREE.MathUtils.clamp(1 - clearance / 0.38, 0, 1);
      t.mesh.visible = fade > 0.04;
      if (!t.mesh.visible) continue;
      const spread = 1 + clearance * 0.45;
      t.mesh.position.set(pos.x, surfaceY, pos.z);
      t.mesh.scale.set(t.radiusX * spread, 1, t.radiusZ * spread);
      t.material.opacity = (t.isSuitcase ? 0.44 : 0.48) * fade;
    }
  };
  update();

  return {
    group,
    update,
    dispose() {
      quadGeo.dispose();
      texture.dispose();
      for (const t of trackers) t.material.dispose();
    },
  };
}

function disposeSpceLine(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
