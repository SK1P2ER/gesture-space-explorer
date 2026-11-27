import * as THREE from 'three';
import type { Bands } from './overviewFraming';

type Vector = readonly [number, number, number];
interface BlenderCamera {
  eye: Vector;
  forward: Vector;
  horizontalFov: number;
  orbitDistance: number;
}

/** Evaluated P2.4 cameras at the saved review frame, in glTF axes (Blender x, z, -y). */
export const P24_CAMERAS = {
  overview: { eye: [-282, 220, 482], forward: [.57209, -.33621, -.74812], horizontalFov: 1.080839, orbitDistance: 620 },
  // Curb-side three-quarter angle past SPCE-LINE's nose at normal focal length so P1/P2 step & sidewalk foot contacts fill the frame clearly.
  terminal: { eye: [-160.2, 13.3, -106.4], forward: [.945, -.180, -.270], horizontalFov: .58, orbitDistance: 11.0 },
  deck: { eye: [300, 106, 407], forward: [-.52029, -.36420, -.77243], horizontalFov: 1.080839, orbitDistance: 255 },
  pad: { eye: [-152, 82, -108], forward: [.75425, -.23570, .61283], horizontalFov: .792883, orbitDistance: 196 },
} satisfies Record<string, BlenderCamera>;

export type P24CameraName = keyof typeof P24_CAMERAS;

// Telephoto aft-curbside close-up (~60 mm lens) framing the deployed anti-slip step, P1/P2 planted shoes, sidewalk, suitcase wheels, and open canopy cleanly across 390x844, 844x390, and desktop.
const boardingEye = new THREE.Vector3(-147.35, 11.62, -109.70);
const boardingTarget = new THREE.Vector3(-149.70, 10.90, -107.80);
const boardingDirection = boardingTarget.clone().sub(boardingEye);
export const P24_BOARDING_CAMERA: BlenderCamera = {
  eye: boardingEye.toArray(),
  forward: boardingDirection.toArray(),
  horizontalFov: 0.56, // ~60 mm telephoto lens: ~1.7x larger native shoe-to-step detail without wide-angle distortion
  orbitDistance: boardingDirection.length(),
};
export const P24_BOARDING_TIME = 10.5;

export function p24BoardingPoints(shortLandscape = false) {
  const maxY = shortLandscape ? 11.72 : 12.12;
  return Array.from({ length: 8 }, (_, i) => new THREE.Vector3(
    i & 1 ? -148.95 : -150.55, i & 2 ? maxY : 10.30, i & 4 ? -107.45 : -108.85,
  ));
}

// The saved Blender review is frame 254. The arrival clip maps frames 145–385 to the full app timeline.
export const P24_REVIEW_ARRIVAL_TIME = (254 - 145) / (385 - 145) * (479 / 24);

export function applyP24ArrivalReview(mixer: THREE.AnimationMixer, actions: THREE.AnimationAction[]) {
  const arrival = actions.find(action => action.getClip().name === 'Arrival | authored terminal sequence');
  if (arrival) {
    arrival.time = P24_REVIEW_ARRIVAL_TIME;
    mixer.update(0);
  }
}

// Blender Sun points along local -Z. Three's directional light sits on the opposite side of its target.
export const P24_SUN_DIRECTION = [-.87026, .24007, .43013] as const;
export const P24_SUN_COLOR = [1, .71, .45] as const;
export const P24_EXPOSURE = 2 ** .19;
// P2.4 World: abs(direction.up) * 3.5 feeds this linear Blender color ramp.
export const P24_WORLD = {
  horizon: [1, .45, .21],
  mid: [.38, .38, .48],
  zenith: [.106, .23, .43],
  strength: .42,
} as const;
export const P24_SKY = new THREE.Color(...P24_WORLD.horizon).multiplyScalar(P24_WORLD.strength);

export function p24CameraPose(shot: BlenderCamera, eye: THREE.Vector3, target: THREE.Vector3) {
  eye.set(...shot.eye);
  target.set(...shot.forward).normalize().multiplyScalar(shot.orbitDistance).add(eye);
}

/** Fit the 16:9 source camera in the area clear of controls, keeping its optical axis and eye. */
export function p24VerticalFov(shot: BlenderCamera, aspect: number, availableHeight = 1, availableWidth = 1) {
  const fittedAspect = Math.min(aspect * availableWidth, 16 / 9 * availableHeight);
  return Math.min(125, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(shot.horizontalFov / 2) / fittedAspect)));
}


/** Frame the relevant visible geometry while retaining the Blender eye and direction. */
export function frameP24Camera(
  camera: THREE.PerspectiveCamera, shot: BlenderCamera, eye: THREE.Vector3, target: THREE.Vector3,
  bands: Bands, subjects: THREE.Vector3[], maxZoom = 1,
) {
  const { aspect } = camera;
  const fov = p24VerticalFov(shot, aspect, Math.max(.36, 1 - bands.top - bands.bottom));
  const source = new THREE.PerspectiveCamera(fov, aspect, camera.near, camera.far);
  source.position.copy(eye);
  source.lookAt(target);
  source.updateMatrixWorld();
  const projected = new THREE.Box3().setFromPoints(subjects.map(point => point.project(source)));
  const { min, max } = projected;
  const top = 1 - 2 * bands.top - .075, bottom = -1 + 2 * bands.bottom + .075;
  const zoom = Math.min(maxZoom, 1.8 / (max.x - min.x), Math.max(.16, top - bottom) / (max.y - min.y));
  const shiftX = THREE.MathUtils.clamp(0, -.9 - min.x * zoom, .9 - max.x * zoom);
  const shiftY = THREE.MathUtils.clamp(bands.bottom - bands.top, bottom - min.y * zoom, top - max.y * zoom);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) / zoom));
  const height = 1000, width = height * aspect;
  camera.setViewOffset(width, height, -shiftX * width / 2, shiftY * height / 2, width, height);
}

/** Nearest authored lamp pools, approximated as short-range point lights in the web renderer. */
export function addP24PracticalLights(scene: THREE.Scene) {
  const pools = [
    { eye: [71.139, 9.5, -29.467], color: 0xffdabb, power: 110 },
    { eye: [-29.467, 9.5, -71.139], color: 0xffdabb, power: 110 },
    { eye: [-71.139, 9.5, 29.467], color: 0xffdabb, power: 110 },
    { eye: [-164, 13.1, -99.4], color: 0xffdfc0, power: 78 },
    { eye: [-140, 13.1, -99.4], color: 0xffdfc0, power: 78 },
    { eye: [186, 11.4, 289], color: 0xcde2ff, power: 120 },
  ] as const;
  for (const { eye, color, power } of pools) {
    const lamp = new THREE.PointLight(color, power, 24);
    lamp.position.fromArray(eye);
    scene.add(lamp);
  }
}
