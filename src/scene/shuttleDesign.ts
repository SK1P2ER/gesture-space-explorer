import * as THREE from 'three';

// The two baked meshes come directly from rocket-launch.blend. Cache the CPU
// template; every live rocket owns its geometry, materials and texture handles.
// Leaving a base, changing quality, or a late download cannot dispose another
// rocket's resources. The template's embedded images stay reusable on return.
interface Template {
  booster: THREE.Object3D;
  orbiter: THREE.Object3D;
  ground: number;
  centerZ: number;
  engineX: number;
  engineZ: number;
}

const templates = new Map<'low' | 'high', Promise<Template>>();

export async function loadShuttleDesign(quality: 'low' | 'high'): Promise<ShuttleDesign> {
  let pending = templates.get(quality);
  if (!pending) {
    pending = import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) =>
      new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}rocket/shuttle-${quality}.glb`),
    ).then(({ scene }) => {
      const booster = scene.getObjectByName('rocket_booster');
      const orbiter = scene.getObjectByName('rocket_orbiter');
      if (!booster || !orbiter) throw new Error('Shuttle asset is missing its stages');
      const { ground, centerZ } = orbiter.userData;
      const { engineX, engineZ } = booster.userData;
      if (![ground, centerZ, engineX, engineZ].every((n) => typeof n === 'number' && Number.isFinite(n))) {
        throw new Error('Shuttle asset is missing its alignment metadata');
      }
      return { booster, orbiter, ground, centerZ, engineX, engineZ };
    }).catch((error: unknown) => {
      templates.delete(quality); // a failed request can be retried on the next visit
      throw error;
    });
    templates.set(quality, pending);
  }
  return new ShuttleDesign(await pending);
}

export class ShuttleDesign {
  readonly booster: THREE.Object3D;
  readonly orbiter: THREE.Object3D;
  readonly ground: number;
  readonly centerZ: number;
  readonly engineX: number;
  readonly engineZ: number;
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Map<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>();
  private readonly textures = new Map<THREE.Texture, THREE.Texture>();
  private disposed = false;

  constructor(template: Template) {
    this.ground = template.ground;
    this.centerZ = template.centerZ;
    this.engineX = template.engineX;
    this.engineZ = template.engineZ;
    const clone = (root: THREE.Object3D) => {
      const copy = root.clone(true);
      copy.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry = object.geometry.clone();
        this.geometries.add(object.geometry);
        const material = (source: THREE.MeshStandardMaterial) => {
          let owned = this.materials.get(source);
          if (!owned) {
            owned = source.clone();
            if (source.map) {
              let map = this.textures.get(source.map);
              if (!map) { map = source.map.clone(); this.textures.set(source.map, map); }
              owned.map = owned.emissiveMap = map;
            }
            owned.emissive.setHex(0xffffff);
            owned.emissiveIntensity = 0.06;
            this.materials.set(source, owned);
          }
          return owned;
        };
        object.material = Array.isArray(object.material) ? object.material.map(material) : material(object.material);
      });
      return copy;
    };
    this.booster = clone(template.booster);
    this.orbiter = clone(template.orbiter);
  }

  setNight(night: number, ownSun: boolean) {
    const dim = ownSun ? 0 : night;
    for (const [source, owned] of this.materials) {
      owned.color.copy(source.color).multiplyScalar(1 - 0.85 * dim);
      owned.metalness = source.metalness + (1 - source.metalness) * dim;
      owned.emissiveIntensity = 0.06 + 0.04 * night;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.booster.removeFromParent();
    this.orbiter.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    for (const texture of this.textures.values()) texture.dispose();
  }
}
