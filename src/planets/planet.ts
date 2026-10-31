import * as THREE from 'three';
import type { Body } from '../data/bodies';
import { cross, spinFrame, type Vec3 } from '../data/ephemeris';
import { addLimbHaze, makeAtmosphereHalo } from './atmosphere';
import { makeBodyTextures, makeRingTexture } from './proceduralTextures';
import { makeRing } from './ring';
import { patchShader, replaceOnce } from './shaderPatch';
import { makeCorona, makeSunMaterial } from './sun';
import { PlanetSurface, type Layers, type SurfaceMaterials, type TextureContext } from './surface';

export interface BodyNode {
  body: Body;
  /** Rotates around the Sun (to the planet's longitude on the shown date); carries it out at orbitRadius. Moons: unused. */
  pivot: THREE.Object3D;
  /** Where the body is: at orbitRadius on the pivot; moons are placed here directly, around their planet. */
  anchor: THREE.Object3D;
  /** Holds the planet, rings and clouds at the spin axis' orientation, which stays fixed in space. */
  tilt: THREE.Object3D;
  /** That orientation in the scene frame (from the IAU pole): the tilt group's world rotation. */
  axis: THREE.Quaternion;
  /** Spin angle shown last frame (see planets/spin.ts). */
  spinShown: number | null;
  /** Moons: angle along the orbit shown last frame (slowed like the spin when time runs fast). */
  orbitShown: number | null;
  /** The planet sphere itself (a unit sphere scaled to the radius); spins on its (tilted) axis. */
  mesh: THREE.Mesh;
  clouds?: THREE.Mesh;
  surface: PlanetSurface;
  /** Index into SPHERES: 0 = finest. */
  detail: number;
}

const CLOUD_HEIGHT = 1.008; // × radius
const CITY_LIGHTS = new THREE.Color(1.0, 0.85, 0.65);

// Shared unit spheres, scaled per body: dense geometry only where it can be seen.
const SPHERES = [128, 64, 32].map((segments) => {
  const geometry = new THREE.SphereGeometry(1, segments, segments / 2);
  // Textures are stored top row first (see textureLoader.ts): v must run north → south.
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  return geometry;
});

export function setDetail(node: BodyNode, detail: number) {
  if (node.detail === detail) return;
  node.detail = detail;
  node.mesh.geometry = SPHERES[detail];
  if (node.clouds) node.clouds.geometry = SPHERES[detail];
}

/** Ecliptic (x toward the March equinox, z north) → scene (y up). */
export const toScene = ([x, y, z]: Vec3, out = new THREE.Vector3()) => out.set(x, z, -y);

/**
 * The spin axis' fixed orientation: local x → the body's prime-meridian node,
 * local y → its north pole. Spinning the mesh about local y by the IAU angle W
 * then puts the texture's longitude 0 where it really is.
 */
function axisOrientation(body: Body): THREE.Quaternion {
  const frame = spinFrame(body, 0); // pole and node are constant here; only W changes with time
  const basis = new THREE.Matrix4().makeBasis(toScene(frame.node), toScene(frame.pole), toScene(cross(frame.node, frame.pole)));
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

/** Builds one body: pivot (orbit) → anchor (orbit radius) → tilt (spin axis) → mesh (spin). */
export function createBody(body: Body, textures: TextureContext): BodyNode {
  const isSun = body.orbitRadius === 0;
  const material = isSun ? makeSunMaterial() : makePlanetMaterial(body);
  const mesh = new THREE.Mesh(SPHERES[1], material);
  mesh.scale.setScalar(body.radius);
  mesh.userData.bodyId = body.id;

  const pivot = new THREE.Object3D();
  const anchor = new THREE.Object3D();
  anchor.position.x = body.orbitRadius;
  const tilt = new THREE.Object3D();
  const axis = axisOrientation(body);
  tilt.quaternion.copy(axis);
  pivot.add(anchor);
  anchor.add(tilt);
  tilt.add(mesh);

  const materials: SurfaceMaterials = { surface: material };

  let clouds: THREE.Mesh | undefined;
  if (body.textures.clouds) {
    // White, with the cloud texture as alpha; lit like the surface so the night side stays dark.
    materials.clouds = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
    clouds = new THREE.Mesh(SPHERES[1], materials.clouds);
    clouds.scale.setScalar(body.radius * CLOUD_HEIGHT);
    tilt.add(clouds); // shares the axis; drifts a little faster than the surface
  }

  if (body.ring) {
    const { ring, material: ringMaterial } = makeRing(body.ring.inner * body.radius, body.ring.outer * body.radius, mesh, body.radius);
    if (body.textures.ring) materials.ring = ringMaterial;
    else ringMaterial.map = makeRingTexture();
    tilt.add(ring);
  }

  if (isSun) anchor.add(makeCorona(body.radius));
  else if (body.atmosphere) tilt.add(makeAtmosphereHalo(body.radius, body.atmosphere.color, body.atmosphere.strength));

  const surface = new PlanetSurface(body, materials, textures, () => proceduralFallback(body, textures.anisotropy));
  return { body, pivot, anchor, tilt, axis, spinShown: null, orbitShown: null, mesh, clouds, detail: 1, surface };
}

function makePlanetMaterial(body: Body) {
  const material = new THREE.MeshStandardMaterial({
    // With a roughness map the map decides; otherwise gas giants are a touch glossier.
    roughness: body.textures.roughness ? 1 : body.radius > 2 ? 0.75 : 0.9,
    metalness: 0,
    color: body.textures.tint ?? 0xffffff, // grayscale maps (some moons) get their color here
    bumpScale: 2,
    // normalScale stays (1, 1): Earth's normal map encodes +red = east and
    // +green = south (checked on the Andes and the Himalayas), which is
    // exactly +u / +v on our north → south sphere UVs.
  });
  if (body.atmosphere) addLimbHaze(material, body.atmosphere.color, body.atmosphere.strength * 0.5);
  if (body.textures.night) {
    material.emissive.copy(CITY_LIGHTS);
    material.emissiveIntensity = 1.6;
    addNightSideMask(material);
  }
  return material;
}

/** City lights (the emissive map) only where the Sun has set, fading in across the terminator. */
function addNightSideMask(material: THREE.MeshStandardMaterial) {
  patchShader(material, 'night-side', (shader) => {
    shader.fragmentShader = replaceOnce(
      shader.fragmentShader,
      'void main() {',
      /* glsl */ `
      float nightSide() {
        vec3 toSun = normalize((viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz + vViewPosition);
        return 1.0 - smoothstep(-0.15, 0.12, dot(normalize(vNormal), toSun));
      }
      void main() {`,
    );
    shader.fragmentShader = replaceOnce(
      shader.fragmentShader,
      'totalEmissiveRadiance *= emissiveColor.rgb;',
      'totalEmissiveRadiance *= emissiveColor.rgb * nightSide();',
    );
  });
}

/** The pre-1.1 look, generated in code: used when the image textures can't be loaded. */
function proceduralFallback(body: Body, anisotropy: number): Layers {
  const tex = makeBodyTextures(body.id);
  const layers: Layers = { map: tex.map };
  if (tex.roughnessMap) layers.roughness = tex.roughnessMap;
  if (tex.clouds) layers.clouds = tex.clouds;
  if (body.ring) layers.ring = makeRingTexture();
  for (const t of Object.values(layers)) t.anisotropy = anisotropy;
  return layers;
}
