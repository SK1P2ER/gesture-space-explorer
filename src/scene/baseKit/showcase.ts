import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeOwned } from './utilityGeometry';
import { STATUS, type MarsBaseOperationsController, type OperationalState } from './operations';
import { normalsFrom } from '../rocketKit';
import { garageParts, roverParts } from './roverGarageParts';
import { communicationsParts } from './communicationsParts';
import { solarArrayParts, solarPanelGeometry, solarSupportGeometry } from './solarArrayParts';
import { corridorParts, HABITAT_IDENTITIES, habitatParts, type HabitatIdentity } from './habitatParts';
import { along, onSphere, PANEL, pathLength, solarFieldSize, TUNNEL_RADIUS, type BaseLayout, type Module } from '../../data/baseLayout';

// The showcase base kit (v2.1): builds a declarative layout (data/baseLayout.ts)
// into a few draw calls. Static parts are merged per material; repeated parts
// (solar panels, rovers, astronauts, dust) are instanced. Everything stands on
// the curved ground of its world. Built lazily, disposed when you leave.

export type KitQuality = 'high' | 'low';

export interface ShowcaseOptions {
  quality: KitQuality;
  /** Experimental moving parts; default batching stays unchanged until hardware profiling. */
  operations?: boolean;
  /** Generated texture size (the quality profile's kitTexture). */
  textureSize?: number;
  /** The world's radius in base units (the ground curves away). */
  R: number;
  /** The base's spot on the unit sphere and the frame there (for the ground's texture coordinates). */
  site: { point: THREE.Vector3; quaternion: THREE.Quaternion; scale: number };
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The kit's materials. Rich (High, Ultra; v2.3): curved parts smooth-shaded, boxes flat; fabric,
 * ribbed-metal and solar-cell textures generated in code, with normal maps; dust grime in the
 * vertex colours. Plain (Low): the v2.1 look, all flat, no textures, no grime.
 */
function materials(rich: boolean, textureSize: number) {
  const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.1, flatShading: true, ...o });
  const lit = rich ? { vertexColors: true } : {};
  const fabric = rich ? kitTexture('fabric', textureSize) : null;
  const ribbed = rich ? kitTexture('ribbed', textureSize) : null;
  const cells = rich ? kitTexture('cells', textureSize / 2) : null;
  return {
    // The inflatables' fabric, smooth: domes, tunnels, the dish, the suits.
    hull: std(0xe9e3d6, { emissive: rich ? 0x000000 : 0x1c1a16, ...lit, flatShading: !rich, roughness: 0.85, ...(fabric ?? {}) }),
    // Flat white panels: the garage door, the rover bodies.
    hullFlat: std(0xe9e3d6, { emissive: rich ? 0x000000 : 0x1c1a16, ...lit, roughness: 0.6 }),
    dark: std(0x50555e, { metalness: 0.3, emissive: rich ? 0x000000 : 0x16181c, ...lit, ...(ribbed ?? {}) }),
    glass: std(0xbfe3ff, { roughness: 0.15, transparent: true, opacity: 0.45, depthWrite: false }),
    green: new THREE.MeshBasicMaterial({ color: 0x5cff7a }),
    window: new THREE.MeshBasicMaterial({ color: WINDOW_DAY }),
    red: std(0xc8372d, { side: THREE.DoubleSide, emissive: 0x2a0806 }),
    safety: std(0xe87536, { ...lit, roughness: 0.65, metalness: 0.2 }),
    // Panel vertex colours carry the original cell blue and technical frame colours in one batch.
    solar: std(0xffffff, { vertexColors: true, roughness: 0.35, metalness: 0.5, emissive: rich ? 0x000000 : 0x0b1a36, ...(cells ?? {}) }),
    visor: std(0xd9a441, { roughness: 0.2, metalness: 0.8 }),
  };
}
type MatKey = keyof ReturnType<typeof materials>;

// Lit windows read as dull panes by day and glow warm at night; the greenhouse glows brighter.
const WINDOW_DAY = 0x6f6a5e;
const WINDOW_NIGHT = 0xffd08a;
const GREEN_DAY = 0x4fd96a;
const GREEN_NIGHT = 0x7dff9a;
/** Materials lit by the Sun (the rest glow by themselves): they take the sky's reflections. */
const LIT = ['hull', 'hullFlat', 'dark', 'glass', 'red', 'safety', 'solar', 'visor'] as const;

/** Prevailing wind (stylized: Jezero's afternoon slope wind from the northwest), base frame, blowing toward. */
export const WIND_FROM = new THREE.Vector3(-1, 0, -1).normalize();
const DUST_TINT = new THREE.Color(0xb07a52);

/**
 * Dust grime as vertex colours: the lower third of a module darkens toward dust, more on the side
 * facing the wind. Heights and normals in the part's own frame (ground at y = 0).
 * @param windLocal the wind's source direction in the part's frame
 */
export function addGrime(g: THREE.BufferGeometry, windLocal: THREE.Vector3, height: number) {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const low = 1 - THREE.MathUtils.smoothstep(pos.getY(i), 0, height / 3);
    const facing = nor ? Math.max(0, nor.getX(i) * windLocal.x + nor.getZ(i) * windLocal.z) : 0;
    const k = low * (0.35 + 0.45 * facing);
    c.setRGB(1, 1, 1).lerp(DUST_TINT, k);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Fabric weave, ribbed metal or solar cells, as a colour map and a normal map (generated, no files). */
function kitTexture(kind: 'fabric' | 'ribbed' | 'cells', size: number): { map: THREE.DataTexture; normalMap: THREE.DataTexture } {
  const n = size * size;
  const col = new Uint8Array(n * 4);
  const h = new Float32Array(n);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [u, v] = [x / size, y / size];
      const i = y * size + x;
      let t = 1;
      let height = 0;
      if (kind === 'fabric') {
        // A fine weave, with a seam band every eighth of the way round and up.
        const weave = (Math.sin(u * size * 0.5 * Math.PI) * Math.sin(v * size * 0.5 * Math.PI)) * 0.5;
        const seam = Math.abs(((u * 8) % 1) - 0.5) > 0.46 || Math.abs(((v * 4) % 1) - 0.5) > 0.46;
        height = weave * 0.3 + (seam ? -1 : 0);
        t = 0.97 + weave * 0.04 - (seam ? 0.08 : 0);
      } else if (kind === 'ribbed') {
        const rib = Math.sin(u * 24 * Math.PI * 2);
        height = rib * 0.6;
        t = 0.92 + rib * 0.08;
      } else {
        const gap = Math.abs(((u * 6) % 1) - 0.5) > 0.44 || Math.abs(((v * 4) % 1) - 0.5) > 0.44;
        height = gap ? -1 : 0;
        t = gap ? 0.55 : 1;
      }
      const b = Math.round(255 * Math.min(1, t));
      col.set([b, b, b, 255], i * 4);
      h[i] = height;
    }
  const tex = (data: Uint8Array, srgb: boolean) => {
    const tx = new THREE.DataTexture(data, size, size);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.repeat.set(kind === 'fabric' ? 3 : 2, kind === 'fabric' ? 2 : 2);
    tx.generateMipmaps = true;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.anisotropy = 4;
    if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
    tx.needsUpdate = true;
    return tx;
  };
  return { map: tex(col, true), normalMap: tex(normalsFrom(h, size, kind === 'cells' ? 3 : 1.5), false) };
}
/** Solar trackers turn at most this far from flat toward the Sun, radians. */
export const TRACKER_LIMIT = 1.0;

/** A module-local transform: on the sphere at (x, z), upright there, turned by `rot` degrees. */
// Scratch objects: siteMatrix runs for every rover, astronaut and dust puff each frame.
const _q = new THREE.Quaternion();
const _turn = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _p = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

function siteMatrix(x: number, z: number, rotDeg: number, R: number, out = new THREE.Matrix4()) {
  const { y, up } = onSphere(x, z, R);
  _q.setFromUnitVectors(UP, _up.set(up[0], up[1], up[2]));
  _q.multiply(_turn.setFromAxisAngle(UP, (rotDeg * Math.PI) / 180));
  return out.compose(_p.set(x, y, z), _q, ONE);
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
const cyl = (r: number, h: number, seg = 10) => new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0);

/** Each kind's parts, in its own frame (y up from the ground at its center). */
function moduleParts(m: Module, quality: KitQuality, ports: readonly number[], operations = false): [MatKey, THREE.BufferGeometry][] {
  switch (m.kind) {
    case 'habitat': return habitatParts({ quality, identifier: HABITAT_IDENTITIES[m.id]?.identifier ?? 'HAB-01', ports });
    case 'greenhouse': {
      const shell = new THREE.CylinderGeometry(0.08, 0.08, 0.42, 12, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
      const parts: [MatKey, THREE.BufferGeometry][] = [
        ['glass', shell],
        ['green', at(new THREE.BoxGeometry(0.38, 0.035, 0.11), 0, 0.02, 0)],
        ['dark', at(box(0.42, 0.012, 0.16), 0, 0, 0)],
      ];
      for (const x of [-0.2, -0.07, 0.07, 0.2]) parts.push(['dark', at(new THREE.TorusGeometry(0.08, 0.004, 3, 8, Math.PI).rotateY(Math.PI / 2), x, 0, 0)]);
      return parts;
    }
    case 'garage': return garageParts(quality, operations);
    case 'antenna': return communicationsParts(quality);
    case 'flag':
      return [
        ['dark', cyl(0.004, 0.12, 5)],
        ['red', at(new THREE.PlaneGeometry(0.06, 0.038), 0.03, 0.1, 0)],
      ];
    case 'solarField':
      return solarArrayParts(m, quality); // panels remain instanced below
  }
}

/** A tunnel: a tube from one module's center to the other's, low over the ground. */
function tunnelParts(a: Module, b: Module, R: number, quality: KitQuality): [MatKey, THREE.BufferGeometry][] {
  const [mx, mz] = [(a.x + b.x) / 2, (a.z + b.z) / 2];
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const heading = -Math.atan2(b.z - a.z, b.x - a.x);
  const matrix = siteMatrix(mx, mz, (heading * 180) / Math.PI, R);
  return corridorParts(len, quality).map(([key, g]) => [key, addGrime(g, WIND_FROM, TUNNEL_RADIUS * 2).applyMatrix4(matrix)]);
}

/** The planet texture's coordinates under a point of the base's ground (base units). */
export function siteUv(site: ShowcaseOptions['site'], x: number, z: number, out = new THREE.Vector3()): [number, number] {
  out.set(x, 0, z).multiplyScalar(site.scale).applyQuaternion(site.quaternion).add(site.point).normalize();
  const phi = Math.atan2(out.z, -out.x);
  return [(((phi / (Math.PI * 2)) % 1) + 1) % 1, 0.5 + Math.asin(out.y) / Math.PI];
}

/** A radial patch of ground on the sphere, textured like the planet beneath and fading out at its rim. */
function terrainGeometry(radius: number, R: number, rings: number, segments: number, site: ShowcaseOptions['site']) {
  const pos: number[] = [];
  const uv: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const m = new THREE.Vector3();
  const lift = 0.004;
  for (let i = 0; i <= rings; i++) {
    const r = (i / rings) * radius;
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const [x, z] = [Math.cos(a) * r, Math.sin(a) * r];
      // Gentle bumps away from the pad, flattening out toward the rim so it meets the sphere exactly.
      const t = r / radius;
      const bump = r < 0.5 ? 0 : 0.012 * Math.sin(x * 7.1 + 1.3) * Math.cos(z * 6.3) * Math.min(1, (r - 0.5) * 3) * (1 - t) ** 2;
      const { y } = onSphere(x, z, R);
      pos.push(x, y + lift + bump, z);
      // Its spot on the unit sphere, for the planet's own texture there.
      uv.push(...siteUv(site, x, z, m));
      const fade = THREE.MathUtils.smoothstep(t, 0.65, 1);
      color.push(1, 1, 1, 1 - fade);
      if (i === 0) break; // one center vertex
    }
  }
  for (let j = 0; j < segments; j++) index.push(0, 1 + ((j + 1) % segments), 1 + j);
  for (let i = 1; i < rings; i++) {
    const [a, b] = [1 + (i - 1) * segments, 1 + i * segments];
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      index.push(a + j, a + j1, b + j, a + j1, b + j1, b + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 4));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A soft round dust puff (made in code: no image to load), in a given colour (white: tint it per instance). */
export function puffTexture(rgb: [number, number, number] = [200, 150, 105]) {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
      const i = (y * n + x) * 4;
      data.set([...rgb, Math.round(255 * Math.max(0, 1 - d) ** 2)], i);
    }
  const t = new THREE.DataTexture(data, n, n);
  t.needsUpdate = true;
  return t;
}

const DUST_PUFFS = 40;
/** A dust devil crosses every so often: this many seconds per cycle, of which it's out for `DUST_ON`. */
const DUST_CYCLE = 30;
const DUST_ON = 12;

/** Deterministic 0…1 from an integer (the dust devil's route each cycle). */
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export interface HabitatAnchor extends HabitatIdentity {
  readonly layoutId: string;
  /** Module-local → showcase-local. Consumers borrow this immutable-in-use metadata. */
  readonly matrix: THREE.Matrix4;
  /** Inspection/picking envelope in module-local coordinates; contains no owned GPU resource. */
  readonly bounds: THREE.Box3;
}

export interface InfrastructureAnchor {
  readonly identifier: 'ROV-01' | 'PWR-01' | 'COM-01';
  readonly layoutId: string;
  readonly role: 'maintenance' | 'power' | 'communications';
  /** Module-local to showcase-local; borrowed metadata, independent of merged mesh order. */
  readonly matrix: THREE.Matrix4;
  readonly bounds: THREE.Box3;
}

export class Showcase {
  readonly group = new THREE.Group();
  readonly terrain: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly mats: ReturnType<typeof materials>;
  private readonly habitatRegistry = new Map<string, HabitatAnchor>();
  readonly habitatAnchors: ReadonlyMap<string, HabitatAnchor> = this.habitatRegistry;
  private readonly infrastructureRegistry = new Map<string, InfrastructureAnchor>();
  readonly infrastructureAnchors: ReadonlyMap<string, InfrastructureAnchor> = this.infrastructureRegistry;
  private disposed = false;
  private doorPivot: THREE.Group | null = null;
  private dishPivot: THREE.Group | null = null;
  private operationalState: OperationalState = 'active';
  private readonly antennaTip: THREE.MeshBasicMaterial;
  private readonly rovers: THREE.InstancedMesh[] = [];
  private readonly walkers: THREE.InstancedMesh[] = [];
  private readonly dust: THREE.InstancedMesh | null = null;
  private readonly loops: { pts: [number, number][]; length: number }[];
  private readonly walks: { pts: [number, number][]; length: number }[];
  private readonly m = new THREE.Matrix4();
  private readonly contact: THREE.InstancedMesh;
  private readonly contactMaterial: THREE.MeshBasicMaterial;
  private readonly blobStatics: number;
  private panelSites: THREE.Matrix4[] = [];
  private plates: THREE.InstancedMesh | null = null;
  /** The trackers' current tilt (radians, + toward local east), eased toward the Sun. */
  tilt = 0;
  private readonly tiltM = new THREE.Matrix4();
  private readonly lift = new THREE.Matrix4();
  private readonly camQ = new THREE.Quaternion();
  private readonly face = new THREE.Quaternion();
  private readonly puff = new THREE.Vector3();
  private readonly puffSize = new THREE.Vector3();
  private readonly upV = new THREE.Vector3();

  constructor(readonly layout: BaseLayout, private readonly opts: ShowcaseOptions) {
    const { R, quality } = opts;
    this.group.name = 'showcase';
    const rich = quality === 'high';
    this.mats = materials(rich, opts.textureSize ?? 512);
    const byId = new Map(layout.modules.map((m) => [m.id, m]));

    // Static modules and tunnels: one merged mesh per material.
    const buckets = new Map<MatKey, THREE.BufferGeometry[]>();
    const put = (key: MatKey, g: THREE.BufferGeometry) => {
      const nonIndexed = g.index ? g.toNonIndexed() : g;
      if (nonIndexed !== g) g.dispose();
      if (!nonIndexed.getAttribute('uv')) nonIndexed.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nonIndexed.getAttribute('position').count * 2), 2));
      if (!nonIndexed.getAttribute('color')) addGrime(nonIndexed, WIND_FROM, 1e-6); // no grime (still mergeable)
      buckets.set(key, [...(buckets.get(key) ?? []), nonIndexed]);
    };
    for (const m of layout.modules) {
      const site = siteMatrix(m.x, m.z, m.rot ?? 0, R);
      // The wind in the module's own frame (it may be turned).
      const wind = WIND_FROM.clone().applyAxisAngle(UP, (-(m.rot ?? 0) * Math.PI) / 180);
      const ports = layout.tunnels.filter((t) => t.from === m.id || t.to === m.id).map((t) => {
        const other = byId.get(t.from === m.id ? t.to : t.from)!;
        return Math.atan2(other.x - m.x, other.z - m.z) - (m.rot ?? 0) * Math.PI / 180;
      });
      if (m.kind === 'habitat') this.habitatRegistry.set(m.id, {
        layoutId: m.id, ...(HABITAT_IDENTITIES[m.id] ?? { identifier: m.id, role: 'habitat' }),
        matrix: site.clone(), bounds: new THREE.Box3(new THREE.Vector3(-0.163, 0, -0.163), new THREE.Vector3(0.163, 0.13, 0.163)),
      });
      const moving = !!opts.operations && rich;
      const parts = moduleParts(m, quality, ports, moving);
      if (m.kind === 'garage' || m.kind === 'solarField' || m.kind === 'antenna') {
        const identifier = m.kind === 'garage' ? 'ROV-01' : m.kind === 'solarField' ? 'PWR-01' : 'COM-01';
        const role = m.kind === 'garage' ? 'maintenance' : m.kind === 'solarField' ? 'power' : 'communications';
        const bounds = new THREE.Box3();
        for (const [, geometry] of parts) { geometry.computeBoundingBox(); bounds.union(geometry.boundingBox!); }
        if (m.kind === 'solarField') {
          const { w, d } = solarFieldSize(m);
          bounds.expandByPoint(new THREE.Vector3(-w / 2, 0, -d / 2));
          bounds.expandByPoint(new THREE.Vector3(w / 2, 0.12, d / 2));
        }
        this.infrastructureRegistry.set(identifier, { identifier, layoutId: m.id, role, matrix: site.clone(), bounds });
      }
      const height = Math.max(0.05, ...parts.map(([, g]) => (g.computeBoundingBox(), g.boundingBox!.max.y)));
      const door: THREE.BufferGeometry[] = [];
      for (const [key, g] of parts) {
        const geometry = g.index ? g.toNonIndexed() : g;
        if (geometry !== g) g.dispose(); // factory output is consumed here, never borrowed
        addGrime(geometry, wind, height);
        if (moving && g.userData.feature === 'garage-door') {
          door.push(geometry.translate(0, -0.075, -0.101));
        } else if (moving && (g.userData.feature === 'dish' || g.userData.feature === 'dish-rim')) {
          if (!this.dishPivot) {
            this.dishPivot = new THREE.Group();
            const root = new THREE.Group(); root.applyMatrix4(site); root.add(this.dishPivot);
            this.dishPivot.position.y = 0.38;
            this.group.add(root);
          }
          const mesh = new THREE.Mesh(geometry.translate(0, -0.38, 0), this.mats[key]);
          mesh.name = `kit:operations:${g.userData.feature}`;
          this.dishPivot.add(mesh);
        } else put(key, geometry.applyMatrix4(site));
      }
      if (door.length) {
        const root = new THREE.Group(); root.applyMatrix4(site);
        this.doorPivot = new THREE.Group(); this.doorPivot.position.set(0, 0.075, 0.101);
        const mesh = new THREE.Mesh(mergeOwned(door), this.mats.hullFlat);
        mesh.name = 'kit:operations:door';
        this.doorPivot.add(mesh); root.add(this.doorPivot); this.group.add(root);
      }
    }
    for (const t of layout.tunnels) for (const [key, geometry] of tunnelParts(byId.get(t.from)!, byId.get(t.to)!, R, quality)) put(key, geometry);
    for (const [key, list] of buckets) {
      const merged = mergeGeometries(list)!;
      for (const g of list) g.dispose();
      const mesh = new THREE.Mesh(merged, this.mats[key]);
      mesh.name = `kit:${key}`;
      this.group.add(mesh);
    }

    // The antenna's blinking tip.
    this.antennaTip = new THREE.MeshBasicMaterial({ color: 0xff4030 });
    const antenna = layout.modules.find((m) => m.kind === 'antenna');
    if (antenna) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4).translate(0, 0.41, 0), this.antennaTip);
      tip.applyMatrix4(siteMatrix(antenna.x, antenna.z, 0, R));
      tip.name = 'kit:tip';
      this.group.add(tip);
    }

    // Solar panels: instanced, a post and a tilted plate each.
    const fields = layout.modules.filter((m) => m.kind === 'solarField');
    const panelSites: THREE.Matrix4[] = [];
    for (const f of fields) {
      const { w, d } = solarFieldSize(f);
      const [cols, rows] = [f.cols ?? 3, f.rows ?? 4];
      for (let c = 0; c < cols; c++)
        for (let r = 0; r < rows; r++) {
          const x = f.x - w / 2 + PANEL.w / 2 + c * (PANEL.w + PANEL.gapX);
          const z = f.z - d / 2 + PANEL.d / 2 + r * (PANEL.d + PANEL.gapZ);
          panelSites.push(siteMatrix(x, z, f.rot ?? 0, R));
        }
    }
    this.panelSites = panelSites;
    if (panelSites.length) {
      // The plate pivots about its north–south axis (a single-axis tracker); setDaylight turns it.
      const plate = solarPanelGeometry(quality);
      const post = solarSupportGeometry(quality);
      for (const [g, key] of [[plate, 'solar'], [addGrime(post, WIND_FROM, 0.05), 'dark']] as const) {
        const inst = new THREE.InstancedMesh(g, this.mats[key], panelSites.length);
        panelSites.forEach((s, i) => inst.setMatrixAt(i, s));
        inst.name = `kit:panels:${key}`;
        if (key === 'solar') this.plates = inst;
        this.group.add(inst);
      }
    }

    // Rovers: body and wheels, instanced; driven along their loops in update().
    this.loops = layout.roverLoops.map((pts) => ({ pts, length: pathLength(pts, true) }));
    if (this.loops.length) {
      // Sized to ROVER (data/baseLayout.ts), wheels included: building keeps clear of the strip it sweeps.
      for (const [key, geometry] of roverParts(quality)) {
        const g = addGrime(geometry, WIND_FROM, 0.04);
        const inst = new THREE.InstancedMesh(g, this.mats[key], this.loops.length);
        inst.name = `kit:rovers:${key}`;
        this.rovers.push(inst);
        this.group.add(inst);
      }
    }

    // Astronauts: suit and visor, instanced; walking back and forth in update().
    this.walks = layout.walks.map((pts) => ({ pts, length: pathLength(pts, false) }));
    if (this.walks.length) {
      const suit = mergeGeometries([new THREE.CapsuleGeometry(0.007, 0.022, 2, 6).translate(0, 0.02, 0).toNonIndexed(), at(box(0.01, 0.014, 0.006), 0, 0.02, -0.008).toNonIndexed()])!;
      const visor = new THREE.SphereGeometry(0.006, 6, 4).scale(1, 0.8, 0.6).translate(0, 0.035, 0.004);
      for (const [g, key] of [[addGrime(suit, WIND_FROM, 0.04), 'hull'], [visor, 'visor']] as const) {
        const inst = new THREE.InstancedMesh(g, this.mats[key], this.walks.length);
        inst.name = `kit:astronauts:${key}`;
        this.walkers.push(inst);
        this.group.add(inst);
      }
    }

    // Contact shadows (v2.3, every quality): a soft dark blob under each module and each mover.
    const statics = layout.modules.flatMap((m) => {
      const r = m.kind === 'habitat' ? 0.2 : m.kind === 'greenhouse' ? 0.24 : m.kind === 'garage' ? 0.18 : m.kind === 'solarField' ? 0 : m.kind === 'antenna' ? 0.08 : 0.03;
      return r ? [{ x: m.x, z: m.z, r }] : [];
    });
    this.blobStatics = statics.length;
    this.contactMaterial = new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, depthWrite: false, opacity: quality === 'high' ? 0.35 : 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.contact = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.contactMaterial, statics.length + this.loops.length + this.walks.length);
    this.contact.name = 'kit:contact';
    this.contact.renderOrder = -0.5; // over the ground patch, under everything else
    this.contact.frustumCulled = false;
    statics.forEach((b, i) => this.contact.setMatrixAt(i, blobMatrix(b.x, b.z, b.r * 2.2, R, this.m)));
    this.group.add(this.contact);

    // The ground patch, in the planet's own texture (set by syncMap), fading at its rim.
    const [rings, segments] = quality === 'high' ? [24, 48] : [12, 24];
    const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.terrain = new THREE.Mesh(terrainGeometry(layout.terrainRadius, R, rings, segments, opts.site), terrainMat);
    this.terrain.name = 'kit:terrain';
    this.terrain.renderOrder = -1; // under the transparent greenhouse glass
    this.terrain.visible = false; // until the planet's texture is there
    this.group.add(this.terrain);

    // An occasional dust devil (High only; never with reduced motion).
    if (quality === 'high') {
      const puff = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({ map: puffTexture(), transparent: true, depthWrite: false, opacity: 0.55 });
      this.dust = new THREE.InstancedMesh(puff, mat, DUST_PUFFS);
      this.dust.name = 'kit:dust';
      this.dust.visible = false;
      this.dust.frustumCulled = false;
      this.group.add(this.dust);
    }
    this.setDaylight(0, new THREE.Vector3(0, 1, 0), 1);
    this.update(0, null, false);
  }

  /**
   * Day and night at the base: windows and the greenhouse light up as it gets dark,
   * and the solar panels track the Sun (stowed flat at night).
   * @param night 0 in daylight … 1 in full dark (localSky.nightness)
   * @param sun the Sun's direction in the base's frame
   * @param ease 0–1: how far to turn the panels toward their target this call
   */
  setDaylight(night: number, sun: THREE.Vector3, ease = 0.05) {
    // (v2.3: lit by the base's own Sun, which sets with the real Sun: night needs no dimming.)
    this.mats.window.color.lerpColors(new THREE.Color(WINDOW_DAY), new THREE.Color(WINDOW_NIGHT), night);
    this.mats.green.color.lerpColors(new THREE.Color(GREEN_DAY), new THREE.Color(GREEN_NIGHT), night);
    this.mats.window.color.multiplyScalar(STATUS[this.operationalState].brightness);
    this.mats.green.color.multiplyScalar(STATUS[this.operationalState].brightness);
    if (this.dust) (this.dust.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - night); // dust shows only in sunlight
    const target = night >= 1 || sun.y <= 0 ? 0 : THREE.MathUtils.clamp(Math.atan2(sun.x, sun.y), -TRACKER_LIMIT, TRACKER_LIMIT);
    if (ease > 0) this.setPanelTilt(this.tilt + (target - this.tilt) * ease);
  }

  private setPanelTilt(angle: number) {
    this.tilt = angle;
    if (!this.plates) return;
    // About the north–south axis (local z): positive tilt turns the plate's face toward +x (east).
    this.tiltM.makeRotationZ(-this.tilt).setPosition(0, 0.05, 0);
    this.panelSites.forEach((site, i) => this.plates!.setMatrixAt(i, this.m.multiplyMatrices(site, this.tiltM)));
    this.plates.instanceMatrix.needsUpdate = true;
  }

  /** Borrows numeric controller state, never resources. No allocations or callbacks. */
  applyOperations(operations: MarsBaseOperationsController) {
    if (this.disposed) return;
    this.operationalState = operations.state;
    if (this.doorPivot) this.doorPivot.rotation.x = operations.doorAngle;
    if (this.dishPivot) this.dishPivot.rotation.y = operations.dishAngle;
    if (this.tilt !== operations.solarAngle) this.setPanelTilt(operations.solarAngle);
    this.antennaTip.color.setHex(STATUS[operations.state].beacon);
  }

  /**
   * Low (no base pass, no base Sun): the scene's point-light Sun shines through the planet, so
   * darken the lit materials as night falls instead (the v2.2 way). 0 with a base Sun of its own.
   */
  dimForNight(night: number) {
    for (const key of LIT) {
      const m = this.mats[key];
      this.baseColors[key] ??= m.color.clone();
      m.color.copy(this.baseColors[key]!).multiplyScalar(1 - 0.88 * night);
    }
  }

  private readonly baseColors: Partial<Record<MatKey, THREE.Color>> = {};

  /** The sky's reflections (High, Ultra; v2.3). */
  setEnvironment(env: THREE.Texture | null) {
    for (const key of LIT) {
      const m = this.mats[key];
      if (m.envMap === env) continue;
      m.envMap = env;
      m.envMapIntensity = 0.7;
      m.needsUpdate = true;
    }
  }

  setEnvironmentStrength(k: number) {
    for (const key of LIT) this.mats[key].envMapIntensity = k;
  }

  /** Which parts cast and receive the base Sun's shadows (v2.3, High and Ultra); small movers only get contact blobs. */
  setShadows(on: boolean) {
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mover = o.name.startsWith('kit:operations:') || o.name.startsWith('kit:rovers') || o.name.startsWith('kit:astronauts') || o.name === 'kit:dust' || o.name === 'kit:contact';
      o.castShadow = on && !mover && o.name !== 'kit:terrain';
      o.receiveShadow = on && o.name !== 'kit:dust' && o.name !== 'kit:contact';
    });
  }

  /** Use the planet's current map (it may still be loading, or switch to a sharper one). */
  syncMap(map: THREE.Texture | null) {
    const mat = this.terrain.material;
    if (mat.map !== map) {
      mat.map = map;
      mat.needsUpdate = true;
    }
    this.terrain.visible = map !== null;
  }

  /** Per frame: rovers drive, astronauts walk, the antenna blinks, now and then a dust devil. */
  update(seconds: number, camera: THREE.Camera | null, reducedMotion: boolean) {
    const { R } = this.opts;
    const place = (x: number, z: number, heading: number, lift = 0) => {
      siteMatrix(x, z, (-heading * 180) / Math.PI, R, this.m);
      if (lift) this.m.multiply(this.lift.makeTranslation(0, lift, 0));
      return this.m;
    };
    this.loops.forEach((loop, i) => {
      const speed = 0.05 + 0.015 * i;
      const s = (seconds * speed + i * loop.length * 0.37) % loop.length;
      const { p, heading } = along(loop.pts, true, s);
      for (const inst of this.rovers) inst.setMatrixAt(i, place(p[0], p[1], heading));
    });
    for (const inst of this.rovers) inst.instanceMatrix.needsUpdate = true;
    this.loops.forEach((loop, i) => {
      const s = (seconds * (0.05 + 0.015 * i) + i * loop.length * 0.37) % loop.length;
      const { p } = along(loop.pts, true, s);
      this.contact.setMatrixAt(this.blobStatics + i, blobMatrix(p[0], p[1], 0.11, R, this.m));
    });

    this.walks.forEach((walk, i) => {
      const speed = 0.025;
      const period = (2 * walk.length) / speed + 4; // a 2 s pause at each end
      const t = (seconds + i * 7.3) % period;
      const half = period / 2;
      const leg = t < half ? t : t - half;
      const s = Math.min(walk.length, Math.max(0, (leg - 1) * speed));
      const back = t >= half;
      const { p, heading } = along(walk.pts, false, back ? walk.length - s : s);
      const bob = 0.002 * Math.abs(Math.sin(seconds * 6 + i));
      for (const inst of this.walkers) inst.setMatrixAt(i, place(p[0], p[1], heading + (back ? Math.PI : 0) + Math.PI / 2, bob));
    });
    for (const inst of this.walkers) inst.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.walks.length; i++) {
      const w = new THREE.Matrix4();
      this.walkers[0]?.getMatrixAt(i, w);
      const p = new THREE.Vector3().setFromMatrixPosition(w);
      this.contact.setMatrixAt(this.blobStatics + this.loops.length + i, blobMatrix(p.x, p.z, 0.035, R, this.m));
    }
    this.contact.instanceMatrix.needsUpdate = true;

    this.antennaTip.color.setHex(STATUS[this.operationalState].beacon);

    if (this.dust) {
      const cycle = Math.floor(seconds / DUST_CYCLE);
      const t = seconds - cycle * DUST_CYCLE;
      const on = !reducedMotion && camera !== null && t < DUST_ON;
      this.dust.visible = on;
      if (on) {
        // A straight run across the plain, well outside the buildings.
        const a = hash(cycle) * Math.PI * 2;
        const r = 1.8 + 0.5 * hash(cycle + 99);
        const [x0, z0] = [Math.cos(a) * r, Math.sin(a) * r];
        const [x1, z1] = [Math.cos(a + 1.4) * r, Math.sin(a + 1.4) * r];
        const k = t / DUST_ON;
        const [cx, cz] = [x0 + (x1 - x0) * k, z0 + (z1 - z0) * k];
        const fade = Math.min(1, k * 5, (1 - k) * 5);
        camera.getWorldQuaternion(this.camQ);
        const face = this.group.getWorldQuaternion(this.face).invert().multiply(this.camQ); // billboards: face the camera, in the group's frame
        const { y, up } = onSphere(cx, cz, R);
        const upV = this.upV.set(up[0], up[1], up[2]);
        for (let i = 0; i < DUST_PUFFS; i++) {
          const h = i / DUST_PUFFS;
          const spin = seconds * 4 + i * 2.4;
          const rad = 0.03 + 0.12 * h;
          const pos = this.puff.set(cx + Math.cos(spin) * rad, y, cz + Math.sin(spin) * rad).addScaledVector(upV, h * 0.6);
          const size = (0.05 + 0.1 * h) * fade;
          this.m.compose(pos, face, this.puffSize.setScalar(size));
          this.dust.setMatrixAt(i, this.m);
        }
        this.dust.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /** Draw calls and triangles this adds (for the budget). */
  stats() {
    let meshes = 0;
    let triangles = 0;
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      meshes++;
      const g = o.geometry as THREE.BufferGeometry;
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      triangles += tris * (o instanceof THREE.InstancedMesh ? o.count : 1);
    });
    return { meshes, triangles };
  }

  /** Free everything it made (not the planet's texture it borrowed). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.terrain.material.map = null;
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    for (const m of Object.values(this.mats)) {
      if ('map' in m) m.map?.dispose();
      if ('normalMap' in m) m.normalMap?.dispose();
      m.dispose();
    }
    this.contactMaterial.map?.dispose();
    this.contactMaterial.dispose();
    this.antennaTip.dispose();
    this.terrain.material.dispose();
    if (this.dust) {
      const mat = this.dust.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    this.group.removeFromParent();
    this.habitatRegistry.clear();
    this.infrastructureRegistry.clear();
  }
}

/** A blob on the ground at (x, z), diameter d (base units), lying on the curved ground. */
function blobMatrix(x: number, z: number, d: number, R: number, out: THREE.Matrix4) {
  const { y, up } = onSphere(x, z, R);
  _q.setFromUnitVectors(UP, _up.set(up[0], up[1], up[2]));
  return out.compose(_p.set(x, y + 0.003, z), _q, new THREE.Vector3(d, 1, d));
}

/** A soft round shadow: opaque in the middle, fading to nothing (alpha only; the material is black). */
function blobTexture() {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
      data.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - d * d) ** 1.5)], (y * n + x) * 4);
    }
  const t = new THREE.DataTexture(data, n, n);
  t.needsUpdate = true;
  return t;
}
