import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { onSphere, type BaseLayout } from '../../data/baseLayout';
import { BUILD_KINDS, BUILD_RADIUS, CELL, cellBlocked, cellCenter, MAX_MODULES, type BuildKind, type Placed } from '../../sim/buildRules';

// Build mode's scene (v2.1): the modules you've built, one instanced mesh per kind
// (vertex-coloured, so one draw call each: the +5 budget); and in Build mode a grid
// of the cells you may build on, a ghost of the module in your hand and its cell,
// green where it can go, red where it can't. Stands on the curved ground (or flat,
// in the horizon view). Disposed with the showcase.

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _turn = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _p = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

function cellMatrix(i: number, j: number, rot: number, R: number, out = new THREE.Matrix4(), lift = 0) {
  const [x, z] = cellCenter(i, j);
  const { y, up } = onSphere(x, z, R);
  _q.setFromUnitVectors(UP, _up.set(up[0], up[1], up[2])).multiply(_turn.setFromAxisAngle(UP, (rot * Math.PI) / 2));
  return out.compose(_p.set(x, y + lift, z), _q, ONE);
}

/** One geometry, every vertex one colour (so kinds share a material). */
function tint(g: THREE.BufferGeometry, hex: number) {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  geo.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const colors = new Float32Array(geo.getAttribute('position').count * 3);
  for (let k = 0; k < colors.length; k += 3) colors.set([c.r, c.g, c.b], k);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}
const lift = (g: THREE.BufferGeometry, y: number) => g.translate(0, y, 0);

/** The five modules, each fitting one 0.25 cell. */
export function moduleGeometry(kind: BuildKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  switch (kind) {
    case 'habitat': {
      const profile = [new THREE.Vector2(0, 0), new THREE.Vector2(0.095, 0), new THREE.Vector2(0.095, 0.03)];
      for (let i = 1; i <= 4; i++) {
        const a = (i / 4) * (Math.PI / 2);
        profile.push(new THREE.Vector2(0.095 * Math.cos(a), 0.03 + 0.05 * Math.sin(a)));
      }
      parts.push(tint(new THREE.LatheGeometry(profile, 10), 0xe9e3d6), tint(lift(new THREE.CylinderGeometry(0.097, 0.097, 0.01, 10, 1, true), 0.025), 0x50555e));
      parts.push(tint(new THREE.BoxGeometry(0.035, 0.012, 0.01).translate(0, 0.045, 0.092), 0xffd08a));
      break;
    }
    case 'solar':
      parts.push(tint(lift(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 5), 0.025), 0x50555e));
      parts.push(tint(new THREE.BoxGeometry(0.2, 0.006, 0.13).rotateX(-0.4).translate(0, 0.055, 0), 0x34558f));
      break;
    case 'battery':
      parts.push(tint(lift(new THREE.BoxGeometry(0.16, 0.06, 0.12), 0.03), 0x3d4148));
      parts.push(tint(lift(new THREE.BoxGeometry(0.16, 0.008, 0.02), 0.064), 0x5fd38d));
      break;
    case 'oxygen':
      parts.push(tint(lift(new THREE.CylinderGeometry(0.045, 0.05, 0.11, 10), 0.055), 0xd9dde3));
      parts.push(tint(new THREE.BoxGeometry(0.09, 0.045, 0.07).translate(0.06, 0.0225, 0), 0x6f7680));
      parts.push(tint(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 5).translate(-0.02, 0.13, 0), 0x6fb6ff));
      break;
    case 'greenhouse':
      parts.push(tint(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2), 0x9ee8b0));
      parts.push(tint(lift(new THREE.BoxGeometry(0.2, 0.01, 0.14), 0.005), 0x3f8f52));
      break;
  }
  const merged = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

export class BuildView {
  readonly group = new THREE.Group();
  readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1, flatShading: true });
  private readonly meshes = new Map<BuildKind, THREE.InstancedMesh>();
  private readonly geometries = new Map<BuildKind, THREE.BufferGeometry>();
  private grid: THREE.LineSegments | null = null;
  /** Owned for this view's lifetime; grid replacements only dispose their geometry. */
  private readonly gridMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false });
  private readonly ghost: THREE.Mesh;
  // Drawn over everything, so a red cell under a building (or a ghost inside one) still shows.
  private readonly ghostMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, depthTest: false });
  private readonly cell: THREE.Mesh;
  private readonly cellMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  private version = -1;
  private disposed = false;
  private readonly m = new THREE.Matrix4();

  constructor(private readonly R: number) {
    this.group.name = 'build';
    for (const kind of BUILD_KINDS) {
      const g = moduleGeometry(kind);
      this.geometries.set(kind, g);
      const mesh = new THREE.InstancedMesh(g, this.material, MAX_MODULES);
      mesh.count = 0;
      mesh.name = `build:${kind}`;
      this.meshes.set(kind, mesh);
      this.group.add(mesh);
    }
    this.ghost = new THREE.Mesh(this.geometries.get('solar'), this.ghostMaterial);
    this.ghost.name = 'build:ghost';
    this.ghost.renderOrder = 3;
    this.cell = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92).rotateX(-Math.PI / 2), this.cellMaterial);
    this.cell.name = 'build:cell';
    this.cell.renderOrder = 2;
    this.group.add(this.ghost, this.cell);
  }

  /** The built modules (rebuilt only when the layout's version changes). */
  setPlaced(placed: readonly Placed[], version: number) {
    if (version === this.version) return;
    this.version = version;
    for (const kind of BUILD_KINDS) {
      const mesh = this.meshes.get(kind)!;
      const mine = placed.filter((p) => p.kind === kind);
      mine.forEach((p, n) => mesh.setMatrixAt(n, cellMatrix(p.i, p.j, p.rot, this.R, this.m)));
      mesh.count = mine.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  /**
   * Build mode's guides: the grid of free cells (rebuilt when the layout changes), and the
   * module in your hand at the cursor, green if it can go there, red if not. Null: hide them.
   */
  setGuides(guides: { layout: BaseLayout; placed: readonly Placed[]; version: number; held: Placed | null; cursor: [number, number] | null; ok: boolean } | null) {
    const on = guides !== null;
    if (on && (!this.grid || this.grid.userData.version !== guides.version)) this.buildGrid(guides.layout, guides.placed, guides.version);
    if (this.grid) this.grid.visible = on;
    this.ghost.visible = on && guides.held !== null && guides.cursor !== null;
    this.cell.visible = on && guides.cursor !== null;
    if (!on || !guides.cursor) return;
    const color = guides.held ? (guides.ok ? 0x5fd38d : 0xff5a4a) : 0xffffff;
    this.cellMaterial.color.setHex(color);
    this.cell.matrix.copy(cellMatrix(...guides.cursor, 0, this.R, this.m, 0.006));
    this.cell.matrixAutoUpdate = false;
    if (guides.held) {
      this.ghost.geometry = this.geometries.get(guides.held.kind)!;
      this.ghostMaterial.color.setHex(guides.ok ? 0x9cf0b6 : 0xff8a7a);
      this.ghost.matrix.copy(cellMatrix(...guides.cursor, guides.held.rot, this.R, this.m, 0.004));
      this.ghost.matrixAutoUpdate = false;
    }
  }

  private buildGrid(layout: BaseLayout, placed: readonly Placed[], version: number) {
    this.grid?.geometry.dispose();
    if (this.grid) this.group.remove(this.grid);
    const pts: number[] = [];
    const n = Math.ceil(BUILD_RADIUS / CELL);
    const h = CELL / 2;
    const vertex = (x: number, z: number) => pts.push(x, onSphere(x, z, this.R).y + 0.02, z); // above the ground's bumps
    for (let i = -n; i <= n; i++)
      for (let j = -n; j <= n; j++) {
        const why = cellBlocked(layout, placed, i, j);
        if (why && why !== 'occupied') continue; // only cells you could build on
        const [x, z] = cellCenter(i, j);
        const c: [number, number][] = [[x - h, z - h], [x + h, z - h], [x + h, z + h], [x - h, z + h]];
        for (let k = 0; k < 4; k++) {
          vertex(...c[k]);
          vertex(...c[(k + 1) % 4]);
        }
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(g, this.gridMaterial);
    this.grid.name = 'build:grid';
    this.grid.userData.version = version;
    this.group.add(this.grid);
  }

  /** Low (no base Sun): darken with the night, the v2.2 way. */
  dimForNight(night: number) {
    this.baseColor ??= this.material.color.clone();
    this.material.color.copy(this.baseColor).multiplyScalar(1 - 0.88 * night);
  }

  private baseColor: THREE.Color | null = null;

  /** Built modules cast and receive the base Sun's shadows (v2.3, High and Ultra); guides don't. */
  setShadows(on: boolean) {
    for (const m of this.meshes.values()) m.castShadow = m.receiveShadow = on;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.meshes.values()) m.dispose();
    this.material.dispose();
    this.ghostMaterial.dispose();
    this.cellMaterial.dispose();
    this.cell.geometry.dispose();
    this.grid?.geometry.dispose();
    this.gridMaterial.dispose();
    this.group.removeFromParent();
  }
}
