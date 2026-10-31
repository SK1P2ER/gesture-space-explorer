import * as THREE from 'three';

// The horizon view at a base (v2.1): standing on the ground, looking along it.
// The world is only a few base-widths across at this scale, so instead of its
// curvature you see a flat plain (the planet's own texture) fading into a sky
// dome. The dome is butterscotch by day with a blue glow round a low Sun (as on
// Mars) and clears at night to the real stars; the sky moons and Earth hang in
// it at their real directions. All in the base's own units and frame.
//
// Budget: 5 draw calls (plain, dome, Phobos, Deimos, Earth), only while the
// horizon view is on (tests/horizon.test.ts).

export const HORIZON = {
  /** The plain reaches past the dome so its edge never shows. */
  plainRadius: 8,
  domeRadius: 7.5,
  /** Sky objects sit just inside the dome. */
  skyDistance: 7,
  /** Sky moons are drawn this many times their real angular size, so they're visible at all. */
  moonMagnify: 6,
};

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 sunDir;
uniform float night;
uniform float sunElevation;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  // Butterscotch: dust-laden air, a little darker overhead.
  vec3 horizon = vec3(0.74, 0.55, 0.36);
  vec3 zenith = vec3(0.50, 0.34, 0.22);
  vec3 sky = mix(horizon, zenith, pow(h, 0.6));
  float toSun = max(dot(d, normalize(sunDir)), 0.0);
  // Mars' sunsets are blue around the Sun (fine dust scatters blue forward).
  float low = 1.0 - smoothstep(0.0, 18.0, sunElevation);
  sky = mix(sky, vec3(0.24, 0.40, 0.68), low * pow(toSun, 3.0) * 0.9);
  // The Sun itself (small: it's farther than from Earth), and a soft glare.
  float up = step(-1.0, sunElevation);
  sky += up * (vec3(1.0, 0.97, 0.92) * pow(toSun, 3000.0) * 1.2 + vec3(0.05, 0.05, 0.06) * pow(toSun, 80.0));
  // Twilight darkens toward night, when the dome clears to the stars.
  sky *= mix(1.0, 0.25, night);
  gl_FragColor = vec4(sky, 1.0 - night);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * The Mars sky shader (base frame: y up). The horizon dome draws it transparent (night clears to
 * the stars behind); the environment cube (v2.3) draws it opaque, as what the base reflects.
 */
export function makeSkyMaterial(opaque: boolean) {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: { sunDir: { value: new THREE.Vector3(0, 1, 0) }, night: { value: 0 }, sunElevation: { value: 45 } },
    side: THREE.BackSide,
    transparent: !opaque,
    depthWrite: false,
  });
}

export interface SkyObject {
  id: string;
  /** Direction from the site, in the base's frame (unit). */
  dir: THREE.Vector3;
  /** Real angular radius, radians. */
  angularRadius: number;
}

export class HorizonSky {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly plain: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
  private readonly moons = new Map<string, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>();
  private readonly earth: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;

  /** @param uvAt the planet texture's coordinates under a point of the plain (base units) */
  constructor(uvAt: (x: number, z: number) => [number, number]) {
    this.group.name = 'horizon';
    // The plain: flat, the planet's own map projected from the sphere below, fading into the haze far out.
    const g = new THREE.CircleGeometry(HORIZON.plainRadius, 64, 0, Math.PI * 2);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const color = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const [x, z] = [pos.getX(i), pos.getZ(i)];
      const [u, v] = uvAt(x, z);
      uv.setXY(i, u, v);
      const r = Math.hypot(x, z) / HORIZON.plainRadius;
      const haze = THREE.MathUtils.smoothstep(r, 0.35, 0.95);
      color.set([1 - haze * 0.15, 1 - haze * 0.3, 1 - haze * 0.45, 1], i * 4);
    }
    g.setAttribute('color', new THREE.BufferAttribute(color, 4));
    g.translate(0, 0.001, 0);
    this.plain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    this.plain.name = 'horizon:plain';

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(HORIZON.domeRadius, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55),
      makeSkyMaterial(false),
    );
    this.dome.name = 'horizon:sky';
    this.dome.renderOrder = 1;

    // Sky moons: small lit spheres (their phases come from the real Sun light); drawn over the day sky.
    for (const id of ['phobos', 'deimos']) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshStandardMaterial({ color: 0x9a8f86, roughness: 1, transparent: true }));
      m.name = `horizon:${id}`;
      m.renderOrder = 2;
      this.moons.set(id, m);
    }
    // Earth: a bright blue-white star once the sky is dark.
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xcfe4ff, transparent: true, depthWrite: false }));
    this.earth.name = 'horizon:earth';
    this.earth.renderOrder = 2;
    this.group.add(this.plain, this.dome, ...this.moons.values(), this.earth);
  }

  syncMap(map: THREE.Texture | null) {
    if (this.plain.material.map !== map) {
      this.plain.material.map = map;
      this.plain.material.needsUpdate = true;
    }
  }

  /**
   * @param sun the Sun's direction (base frame), its elevation (degrees) and how dark it is (0–1)
   * @param objects sky moons and Earth: direction and real angular radius
   * @param eye where the viewer stands (base frame): the sky is centered on them
   */
  update(sun: { dir: THREE.Vector3; elevation: number; night: number }, objects: readonly SkyObject[], eye: THREE.Vector3, magnify = HORIZON.moonMagnify) {
    const u = this.dome.material.uniforms;
    u.sunDir.value.copy(sun.dir);
    u.night.value = sun.night;
    u.sunElevation.value = sun.elevation;
    this.dome.position.set(eye.x, 0, eye.z);
    for (const o of objects) {
      const above = o.dir.y > 0;
      const at = (m: THREE.Object3D) => m.position.copy(o.dir).multiplyScalar(HORIZON.skyDistance).add(this.dome.position);
      if (o.id === 'earth') {
        at(this.earth);
        this.earth.visible = above && sun.night > 0.05;
        this.earth.material.opacity = sun.night;
        continue;
      }
      const m = this.moons.get(o.id);
      if (!m) continue;
      at(m);
      m.visible = above;
      m.scale.setScalar(o.angularRadius * magnify * HORIZON.skyDistance);
    }
  }

  /** Where the sky moons and Earth are now (scene), for their name labels; only those showing. */
  labelPoints(): { id: string; world: THREE.Vector3 }[] {
    const out: { id: string; world: THREE.Vector3 }[] = [];
    for (const m of [...this.moons.values(), this.earth]) {
      if (!m.visible) continue;
      out.push({ id: m.name.slice('horizon:'.length), world: m.getWorldPosition(new THREE.Vector3()) });
    }
    return out;
  }

  dispose() {
    this.plain.material.map = null;
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    });
    this.group.removeFromParent();
  }
}
