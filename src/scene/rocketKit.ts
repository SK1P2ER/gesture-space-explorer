import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLAME, type Atmosphere } from '../data/atmosphere';

// The rocket (v2.2): a two-stage launcher with a crew capsule, built in code from
// lathe profiles; no image files. Its panels, seams, rivets, paint bands, soot and
// windows are painted into generated textures (colour, normal and glow), sized by
// the quality setting. Nose along +y, the engine bells' rims at y = 0, about one
// unit tall (the mission scales it to the base), like the v2.0 rocket it replaces.
//
// The upper stage is the lander: the booster drops away mid-trip (separate()), and
// the upper stage comes down on its own legs. Draw calls: booster hull, booster
// engines and fins, upper hull (with its vacuum bell), legs (instanced), and a
// flame per stage: 6.

export const ROCKET = {
  height: 0.95,
  radius: 0.13,
  /** Where the booster ends and the upper stage begins (stage separation, v2.2 step 3). */
  split: 0.53,
  engineRing: 0.075,
  bell: { height: 0.08, rim: 0.032, throat: 0.014 },
  /** The upper stage (the lander). */
  upperRadius: 0.112,
  /** Landing legs, on the upper stage: hinged this high above its base; folded up in flight, out and down on the ground. */
  leg: { hingeY: 0.12, length: 0.17, foot: 0.018 },
  /** The upper stage's own engine: a vacuum bell below its base (hidden in the interstage while stacked). */
  vacuumBell: { height: 0.06, rim: 0.045, throat: 0.016 },
};

/** The trip's share at which the booster separates (stacked launches only). */
export const SEPARATE_AT = 0.35;

/** Where the engine bells sit (x, z), for 4–9 engines: a ring, with one in the middle from 5 up. */
export function engineLayout(count: number): [number, number][] {
  const n = Math.max(4, Math.min(9, Math.round(count)));
  const ring = n >= 5 ? n - 1 : n;
  const out: [number, number][] = n >= 5 ? [[0, 0]] : [];
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + Math.PI / 4;
    out.push([Math.cos(a) * ROCKET.engineRing, Math.sin(a) * ROCKET.engineRing]);
  }
  return out;
}

/**
 * A leg's swing from folded (0: lying up along the upper stage) to deployed (1: out and
 * down, its foot pad resting level with the stage's base, i.e. the ground when it stands).
 * Returns the angle from straight up, radians, and where the foot ends up (radius out
 * from the axis, height above the stage's base).
 */
export function legPose(deploy: number): { angle: number; foot: [number, number] } {
  const t = Math.max(0, Math.min(1, deploy));
  const e = t * t * (3 - 2 * t);
  const { hingeY, length, foot } = ROCKET.leg;
  const down = Math.acos(-(hingeY - foot) / length); // the foot's center a pad-radius up: the tilted pad's edge meets y = 0
  const angle = 0.06 + (down - 0.06) * e;
  return { angle, foot: [ROCKET.upperRadius + Math.sin(angle) * length, hingeY + Math.cos(angle) * length] };
}

// ------------------------------------------------------------------ textures ----

/** Deterministic pseudo-random 0–1 per integer. */
const hash = (n: number) => {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export interface HullPaint {
  /** RGBA, size×size. */
  color: Uint8Array;
  /** RGBA normal map (tangent space). */
  normal: Uint8Array;
  /** RGBA glow mask: the windows. */
  glow: Uint8Array;
  size: number;
}

/**
 * The hull's paint, as pixels: u around the rocket, v up it (v = height / ROCKET.height).
 * Panel seams (rings and staves) and rivet rows (as grooves and bumps in the normal map),
 * two red bands, the interstage and heat shield in dark grey, soot rising from the base,
 * a mission-patch square, and the capsule's two windows (lit cabins; brighter at night). The glow
 * map also holds a faint cool lift for the whole hull, so its shaded side never goes black.
 */
export function paintHull(size: number): HullPaint {
  const n = size * size;
  const color = new Uint8Array(n * 4);
  const height = new Float32Array(n);
  const glow = new Uint8Array(n * 4);
  const vOf = (y: number) => y / ROCKET.height;
  const band = (v: number, a: number, b: number) => v >= vOf(a) && v <= vOf(b);
  for (let py = 0; py < size; py++) {
    // DataTexture rows run bottom to top (v = 0 at row 0).
    const v = (py + 0.5) / size;
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size;
      const i = py * size + px;
      let [r, g, b] = [236, 239, 244];
      const grain = (hash(px * 7 + py * 131) - 0.5) * 8;
      if (band(v, 0.5, 0.545)) [r, g, b] = [74, 79, 88]; // interstage
      else if (band(v, 0.745, 0.765)) [r, g, b] = [58, 60, 66]; // heat shield edge
      else if (band(v, 0.4, 0.44) || band(v, 0.66, 0.69)) [r, g, b] = [200, 62, 44]; // paint bands
      // Mission patch on one side of the upper stage.
      if (Math.abs(u - 0.25) < 0.035 && band(v, 0.58, 0.63)) [r, g, b] = Math.abs(u - 0.25) < 0.015 && band(v, 0.595, 0.615) ? [255, 200, 69] : [32, 54, 110];
      // The capsule's windows: two dark panes.
      const win = (Math.abs(u - 0.2) < 0.02 || Math.abs(u - 0.3) < 0.02) && band(v, 0.8, 0.835);
      if (win) {
        [r, g, b] = [30, 44, 64];
        glow.set([200, 168, 110, 255], i * 4); // cabin light
      }
      // Soot from the engines, rising up the booster.
      const soot = Math.max(0, 1 - v / vOf(0.2)) * 0.75 * (0.85 + 0.3 * hash(px * 3 + 17));
      r = r * (1 - soot) + 30 * soot + grain;
      g = g * (1 - soot) + 28 * soot + grain;
      b = b * (1 - soot) + 26 * soot + grain;
      color.set([clampByte(r), clampByte(g), clampByte(b), 255], i * 4);
      if (!win) glow.set([46, 50, 58, 255], i * 4); // a faint cool lift: the shaded side never goes black
      // Height: seams are grooves, rivets bumps.
      // At least about a pixel wide at any texture size.
      const ringSeam = Math.abs(((v * 24) % 1) - 0.5) > 0.5 - Math.max(0.03, 0.6 / (size / 24));
      const staveSeam = Math.abs(((u * 16) % 1) - 0.5) > 0.5 - Math.max(0.03, 0.6 / (size / 16));
      const rivet = Math.abs(((v * 24) % 1) - 0.5) > 0.4 && Math.abs(((u * 64) % 1) - 0.5) < 0.12;
      height[i] = (ringSeam || staveSeam ? -1 : 0) + (rivet && !ringSeam ? 0.6 : 0) + (win ? -0.5 : 0);
    }
  }
  return { color, normal: normalsFrom(height, size, 2.5), glow, size };
}

const clampByte = (x: number) => Math.max(0, Math.min(255, Math.round(x)));

/** A tangent-space normal map from a height field (Sobel), wrapping in u. */
export function normalsFrom(h: Float32Array, size: number, strength: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => h[Math.max(0, Math.min(size - 1, y)) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8;
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8;
      const nx = -dx * strength;
      const ny = -dy * strength;
      const len = Math.hypot(nx, ny, 1);
      out.set([clampByte((nx / len) * 127.5 + 127.5), clampByte((ny / len) * 127.5 + 127.5), clampByte((1 / len) * 127.5 + 127.5), 255], (y * size + x) * 4);
    }
  return out;
}

function texture(data: Uint8Array, size: number, srgb: boolean) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ geometry ----

/** A lathe from (radius, height) points, with v set to height / ROCKET.height so the paint lines up. */
function hull(points: [number, number][], segments: number) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setY(i, pos.getY(i) / ROCKET.height);
  return g;
}

const BOOSTER: [number, number][] = [[0.105, ROCKET.bell.height - 0.005], [0.14, 0.085], [0.135, 0.11], [0.13, 0.13], [0.13, 0.47], [0.128, 0.5], [0.122, 0.53]];
// The upper stage starts at its vacuum bell's rim, below its base: paint there clamps to the
// soot-dark bottom row, so the bell needs no material (or draw call) of its own.
const VB = ROCKET.vacuumBell;
const UPPER: [number, number][] = [[VB.rim, ROCKET.split - VB.height], [VB.rim * 0.7, ROCKET.split - VB.height * 0.55], [VB.throat, ROCKET.split - 0.006], [0.122, ROCKET.split], [0.115, 0.55], [0.112, 0.57], [0.112, 0.74], [0.116, 0.75], [0.112, 0.765], [0.09, 0.82], [0.05, 0.89], [0.022, 0.93], [0.0, ROCKET.height]];

export interface RocketOptions {
  /** 4–9 (default 5). */
  engines?: number;
  /** Generated texture size (the quality profile's kitTexture: 256 / 512 / 1024). */
  textureSize: number;
  /** Fewer facets and no normal map on Low. */
  quality: 'low' | 'high';
}

export class Rocket {
  readonly group = new THREE.Group();
  readonly booster = new THREE.Group();
  readonly upper = new THREE.Group();
  private readonly legs: THREE.InstancedMesh;
  private readonly textures: THREE.Texture[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly hullMaterial: THREE.MeshStandardMaterial;
  private readonly legMatrix = new THREE.Matrix4();
  deploy = -1;

  constructor(opts: RocketOptions) {
    const segments = opts.quality === 'high' ? 28 : 14;
    const paint = paintHull(opts.textureSize);
    const map = texture(paint.color, paint.size, true);
    const glow = texture(paint.glow, paint.size, true);
    this.textures.push(map, glow);
    this.hullMaterial = new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.25, emissiveMap: glow, emissive: new THREE.Color(0xffffff), emissiveIntensity: 1 });
    if (opts.quality === 'high') {
      const normal = texture(paint.normal, paint.size, false);
      this.textures.push(normal);
      this.hullMaterial.normalMap = normal;
      this.hullMaterial.normalScale.set(0.8, 0.8);
    }
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3e46, roughness: 0.4, metalness: 0.75 });
    this.materials.push(this.hullMaterial, dark);

    const boosterHull = new THREE.Mesh(hull(BOOSTER, segments), this.hullMaterial);
    boosterHull.name = 'rocket:booster';
    const upperHull = new THREE.Mesh(hull(UPPER, segments), this.hullMaterial);
    upperHull.name = 'rocket:upper';

    // Engines (bells with a heat-tinted inside), grid fins and the thrust plate: one dark mesh.
    const { height: bh, rim, throat } = ROCKET.bell;
    const bellProfile = [new THREE.Vector2(rim, 0), new THREE.Vector2(rim * 0.8, bh * 0.4), new THREE.Vector2(throat, bh * 0.85), new THREE.Vector2(throat * 1.3, bh)];
    const parts: THREE.BufferGeometry[] = [];
    for (const [x, z] of engineLayout(opts.engines ?? 5)) parts.push(new THREE.LatheGeometry(bellProfile, opts.quality === 'high' ? 14 : 8).translate(x, 0, z).toNonIndexed());
    parts.push(new THREE.CylinderGeometry(0.108, 0.108, 0.01, segments).translate(0, bh, 0).toNonIndexed());
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      parts.push(new THREE.BoxGeometry(0.05, 0.004, 0.035).translate(ROCKET.radius + 0.02, 0.48, 0).rotateY(a).toNonIndexed()); // grid fins
    }
    for (const p of parts) p.deleteAttribute('uv');
    const engines = new THREE.Mesh(mergeGeometries(parts)!, dark);
    for (const p of parts) p.dispose();
    engines.name = 'rocket:engines';

    // Landing legs: a strut and a foot pad each, instanced (one draw call), posed by setLegs().
    const { length } = ROCKET.leg;
    const leg = mergeGeometries([
      new THREE.BoxGeometry(0.016, length, 0.012).translate(0, length / 2, 0).toNonIndexed(),
      new THREE.CylinderGeometry(0.022, 0.026, 0.008, 8).translate(0, length, 0).toNonIndexed(),
    ].map((g) => (g.deleteAttribute('uv'), g)))!;
    this.legs = new THREE.InstancedMesh(leg, dark, 4);
    this.legs.name = 'rocket:legs';

    this.booster.add(boosterHull, engines);
    this.booster.name = 'booster';
    this.upper.add(upperHull, this.legs);
    this.upper.name = 'upper';

    // A flame per stage: the booster's under all its engines, the upper stage's under its vacuum bell.
    this.boosterFlame = new Flame(0.11, 0.45, opts.quality);
    this.boosterFlame.mesh.name = 'flame';
    this.booster.add(this.boosterFlame.mesh);
    this.upperFlame = new Flame(VB.rim * 0.9, 0.42, opts.quality);
    this.upperFlame.mesh.position.y = ROCKET.split - VB.height;
    this.upperFlame.mesh.name = 'flame:upper';
    this.upper.add(this.upperFlame.mesh);

    this.group.add(this.booster, this.upper);
    this.group.visible = false;
    this.setLegs(0);
  }

  private readonly boosterFlame: Flame;
  private readonly upperFlame: Flame;
  /** Stage separation in progress: seconds since, and how the booster tumbles (null: not separating). */
  private parting: { t: number; spin: THREE.Vector3; drift: THREE.Vector3 } | null = null;
  /** The booster is attached (a full stack). */
  stacked = true;

  /** Thrust 0–1 from whichever stage is firing, in this air; flickering unless `steady` (reduced motion). */
  setThrust(level: number, seconds: number, air: Atmosphere, steady = false) {
    const firing = this.stacked ? this.boosterFlame : this.upperFlame;
    const idle = this.stacked ? this.upperFlame : this.boosterFlame;
    firing.set(level, seconds, air, steady);
    idle.set(0, seconds, air, steady);
  }

  /** Drop the booster: it falls back and tumbles away (or just goes, with reduced motion). */
  separate(reducedMotion: boolean) {
    if (!this.stacked) return;
    this.stacked = false;
    this.boosterFlame.set(0, 0, 'none', true);
    if (reducedMotion) {
      this.booster.visible = false;
      return;
    }
    this.parting = { t: 0, spin: new THREE.Vector3(0.9, 0.2, 0.6), drift: new THREE.Vector3(0.08, -0.55, 0.05) };
  }

  /** A fresh full stack on the pad (a base visited with V). */
  restack() {
    this.stacked = true;
    this.parting = null;
    this.booster.visible = true;
    this.booster.position.set(0, 0, 0);
    this.booster.rotation.set(0, 0, 0);
    this.upper.position.y = 0;
  }

  /**
   * Standing or landing as the lander (no booster): the upper stage's base at the origin, the pad.
   * Off: where it sits on the stack.
   */
  setLander(on: boolean) {
    this.upper.position.y = on ? -ROCKET.split : 0;
    if (on && !this.parting) this.booster.visible = false;
  }

  /** Per frame: the separating booster drifts back and tumbles, then is gone. */
  update(dt: number) {
    const p = this.parting;
    if (!p) return;
    p.t += dt;
    this.booster.position.addScaledVector(p.drift, dt);
    this.booster.rotation.x += p.spin.x * dt;
    this.booster.rotation.z += p.spin.z * dt;
    if (p.t > 3) {
      this.parting = null;
      this.booster.visible = false;
    }
  }

  /** Landing legs: 0 folded up along the hull, 1 out and down (standing). */
  setLegs(deploy: number) {
    if (Math.abs(deploy - this.deploy) < 1e-4) return;
    this.deploy = deploy;
    const { angle } = legPose(deploy);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      // Hinge on the upper stage, swing outward about the tangent: rotate about z (outward = +x), then around the axis.
      this.legMatrix.makeRotationY(-a).multiply(new THREE.Matrix4().makeTranslation(ROCKET.upperRadius, ROCKET.split + ROCKET.leg.hingeY, 0)).multiply(new THREE.Matrix4().makeRotationZ(-angle));
      this.legs.setMatrixAt(i, this.legMatrix);
    }
    this.legs.instanceMatrix.needsUpdate = true;
    this.legs.computeBoundingSphere();
  }

  /**
   * After dark (0 day … 1 night): the windows glow brighter, and the sunlit surfaces go dark.
   * The scene's Sun is a point light with no planet in the way, so it would light the rocket
   * from below the horizon: dim the paint, and go fully metallic so its glints dim with it.
   */
  setNight(night: number, ownSun = false) {
    this.hullMaterial.emissiveIntensity = 1 + 0.8 * night;
    // At a showcase base (v2.3) the rocket is lit by the base's own Sun, which sets: no dimming needed.
    const dim = ownSun ? 0 : night;
    this.hullMaterial.color.setScalar(1 - 0.85 * dim);
    this.hullMaterial.metalness = 0.25 + 0.75 * dim;
    for (const m of this.materials) if (m !== this.hullMaterial && m instanceof THREE.MeshStandardMaterial) m.color.setHex(0x3a3e46).multiplyScalar(1 - 0.85 * dim);
  }

  /** Cast and receive the base Sun's shadows (at a showcase base, High and Ultra). */
  setShadows(on: boolean) {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.name.startsWith('flame')) o.castShadow = o.receiveShadow = on;
    });
  }

  /** Draw calls and triangles (for the budget). */
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

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.boosterFlame.dispose();
    this.upperFlame.dispose();
    this.group.removeFromParent();
  }
}

// ------------------------------------------------------------------ the flame ----

const FLAME_VERTEX = /* glsl */ `
uniform float spread;
uniform float len;
varying float vT;
varying float vAround;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vT = clamp(-position.y / len, 0.0, 1.0);
  vAround = atan(position.z, position.x);
  // The plume widens with distance from the nozzle, more in thin air and vacuum.
  vec3 p = position;
  p.xz *= mix(1.0, spread, vT);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const FLAME_FRAGMENT = /* glsl */ `
uniform float time;
uniform float level;
uniform float flicker;
uniform float shocks;
uniform vec3 core;
uniform vec3 edge;
varying float vT;
varying float vAround;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float t = vT;
  // Bright where the surface faces you (the plume's middle), fading along its length.
  float face = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.4);
  float n = 0.5 + 0.5 * sin(vAround * 7.0 + time * 38.0 + t * 19.0) * sin(time * 23.0 + t * 11.0);
  float body = (1.0 - t) * (1.0 - t);
  // Shock diamonds: bright knots near the nozzle (High only).
  float diamonds = shocks * pow(0.5 + 0.5 * cos(t * 42.0), 10.0) * (1.0 - t * 1.6);
  // A glow from every angle (seen from behind, as the chase camera does, nothing faces you), brighter where it does.
  float a = level * (body * (0.45 + 0.55 * face) * mix(1.0, 0.65 + 0.7 * n, flicker) + max(0.0, diamonds) * 0.8);
  vec3 c = mix(edge, core, clamp(face * (1.0 - t) * 1.2 + diamonds, 0.0, 1.0));
  gl_FragColor = vec4(c * a * 2.4, a);
}`;

/** One engine plume: an open cone pointing down from the nozzle, drawn additively by a shader. */
export class Flame {
  readonly mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;

  constructor(nozzle: number, length: number, quality: 'low' | 'high') {
    const g = new THREE.CylinderGeometry(nozzle, nozzle * 0.25, length, quality === 'high' ? 18 : 10, quality === 'high' ? 10 : 4, true).translate(0, -length / 2, 0);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: FLAME_VERTEX,
      fragmentShader: FLAME_FRAGMENT,
      uniforms: {
        time: { value: 0 }, level: { value: 0 }, flicker: { value: 1 }, shocks: { value: quality === 'high' ? 1 : 0 },
        spread: { value: 1 }, len: { value: length },
        core: { value: new THREE.Color() }, edge: { value: new THREE.Color() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }));
    this.mesh.visible = false;
    this.mesh.frustumCulled = false; // the shader widens it beyond the geometry's bounds
  }

  set(level: number, seconds: number, air: Atmosphere, steady: boolean) {
    this.mesh.visible = level > 0.01;
    if (!this.mesh.visible) return;
    const u = this.mesh.material.uniforms;
    const f = FLAME[air];
    u.level.value = level;
    u.time.value = steady ? 0 : seconds;
    u.flicker.value = steady ? 0 : 1;
    u.spread.value = f.spread;
    (u.core.value as THREE.Color).setRGB(...f.core);
    (u.edge.value as THREE.Color).setRGB(...f.edge);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
