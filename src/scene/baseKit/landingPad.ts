import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANDING_ANCHORS, landingPadParts, type LandingQuality, type LandingSlot } from './landingPadParts';
import { STATUS, type OperationalState } from './operations';

/** Entry-owned additive art; never owns BaseNode.pad, its shared material or Mission's rocket. */
export class LandingPad {
  readonly group = new THREE.Group();
  readonly anchors: ReadonlyMap<string, { readonly identifier: string; readonly position: THREE.Vector3; readonly radius: number }>;
  private disposed = false;
  private operationalState: OperationalState = 'active';

  setOperationalState(state: OperationalState) {
    if (!this.disposed) this.operationalState = state;
  }
  private readonly materials = {
    metal: new THREE.MeshStandardMaterial({ color: 0xc5c3bd, metalness: 0.55, roughness: 0.68 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x252b32, metalness: 0.25, roughness: 0.85 }),
    safety: new THREE.MeshStandardMaterial({ color: 0xe87536, metalness: 0.15, roughness: 0.7 }),
    // Unlit markers, not point lights. Steady at all motion preferences.
    guidance: new THREE.MeshBasicMaterial({ color: 0xffe5af, toneMapped: true }),
  };
  private readonly dayColors = Object.values(this.materials).map((material) => material.color.clone());

  constructor(readonly quality: LandingQuality) {
    this.group.name = 'landing:LZ-01';
    this.anchors = new Map(Object.entries(LANDING_ANCHORS).map(([identifier, anchor]) => [identifier, {
      identifier, position: new THREE.Vector3(...anchor.position), radius: anchor.radius,
    }]));
    const buckets = new Map<LandingSlot, THREE.BufferGeometry[]>();
    for (const [slot, source] of landingPadParts(quality)) {
      const geometry = source.index ? source.toNonIndexed() : source;
      if (geometry !== source) source.dispose();
      const list = buckets.get(slot) ?? [];
      list.push(geometry); buckets.set(slot, list);
    }
    for (const [slot, geometries] of buckets) {
      const geometry = mergeGeometries(geometries)!;
      for (const source of geometries) source.dispose();
      const mesh = new THREE.Mesh(geometry, this.materials[slot]);
      mesh.name = `landing:${slot}`;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** Borrowed environment, owned by BaseLighting. No texture allocation here. */
  setEnvironment(map: THREE.Texture | null) {
    for (const material of [this.materials.metal, this.materials.dark, this.materials.safety]) material.envMap = map;
  }

  setDaylight(night: number, ownSun: boolean) {
    // Low's point Sun can light from below: use the existing kit dimming convention.
    let n = 0;
    for (const material of Object.values(this.materials)) {
      material.color.copy(this.dayColors[n++]);
      if (material instanceof THREE.MeshStandardMaterial) {
        if (!ownSun) material.color.multiplyScalar(1 - 0.75 * night);
        material.envMapIntensity = 0.7 * (1 - night);
      }
    }
    this.materials.guidance.color.setHex(STATUS[this.operationalState].guidance);
  }

  stats() {
    let triangles = 0;
    for (const object of this.group.children) {
      const geometry = (object as THREE.Mesh).geometry;
      triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
    }
    return { meshes: this.group.children.length, triangles };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const object of this.group.children) (object as THREE.Mesh).geometry.dispose();
    this.setEnvironment(null);
    for (const material of Object.values(this.materials)) material.dispose();
    this.group.removeFromParent();
  }
}
