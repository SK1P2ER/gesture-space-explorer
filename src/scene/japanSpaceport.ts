import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Finish = 'ivory' | 'charcoal' | 'glass' | 'orange' | 'red';

/** A stylized coastal Japanese spaceport, not a scale reconstruction of JAXA's site.
 * The circular pad remains owned by bases.ts. Five merged meshes add no textures,
 * and every structure stands outside its landing footprint except the raised arm.
 */
export function createJapanSpaceport(curvatureRadius: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'spaceport:tanegashima';
  const parts: Record<Finish, THREE.BufferGeometry[]> = { ivory: [], charcoal: [], glass: [], orange: [], red: [] };
  const ground = (x: number, z: number) => Math.sqrt(Math.max(0, curvatureRadius ** 2 - x * x - z * z)) - curvatureRadius;
  const box = (finish: Finish, w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0) => {
    parts[finish].push(new THREE.BoxGeometry(w, h, d).rotateY(yaw).translate(x, y, z));
  };
  const cylinder = (finish: Finish, radius: number, height: number, x: number, y: number, z: number, segments = 10) => {
    parts[finish].push(new THREE.CylinderGeometry(radius, radius, height, segments).translate(x, y, z));
  };
  const beam = (finish: Finish, from: THREE.Vector3, to: THREE.Vector3, width: number) => {
    const midpoint = from.clone().add(to).multiplyScalar(0.5);
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    parts[finish].push(new THREE.BoxGeometry(width, from.distanceTo(to), width).applyQuaternion(rotation).translate(...midpoint.toArray()));
  };

  // White open service gantry: small cross-bracing reads clearly from the pad.
  const tx = 0.41, tz = -0.16, ty = ground(tx, tz);
  for (const x of [-0.024, 0.024]) for (const z of [-0.024, 0.024]) {
    box('ivory', 0.009, 0.42, 0.009, tx + x, ty + 0.21, tz + z);
  }
  for (let floor = 0; floor < 3; floor++) {
    const y = ty + 0.025 + floor * 0.125;
    for (const z of [-0.024, 0.024]) {
      beam('charcoal', new THREE.Vector3(tx - 0.024, y, tz + z), new THREE.Vector3(tx + 0.024, y + 0.11, tz + z), 0.005);
    }
    box('charcoal', 0.064, 0.008, 0.064, tx, y, tz);
    box('orange', 0.065, 0.004, 0.008, tx, y + 0.005, tz + 0.03);
  }
  box('ivory', 0.14, 0.014, 0.025, 0.34, ty + 0.32, tz);
  box('charcoal', 0.145, 0.005, 0.028, 0.34, ty + 0.309, tz);
  box('orange', 0.025, 0.02, 0.031, 0.275, ty + 0.32, tz);

  // Assembly/service hall and glazed flight-control building on the landward side.
  const hx = -0.37, hz = -0.32, hy = ground(hx, hz);
  box('ivory', 0.20, 0.095, 0.14, hx, hy + 0.0475, hz);
  box('charcoal', 0.214, 0.012, 0.152, hx, hy + 0.101, hz);
  box('charcoal', 0.114, 0.068, 0.003, hx, hy + 0.034, hz + 0.071);
  for (let i = 0; i < 4; i++) box('ivory', 0.118, 0.002, 0.004, hx, hy + 0.011 + i * 0.015, hz + 0.073);
  box('orange', 0.132, 0.006, 0.006, hx, hy + 0.073, hz + 0.074);

  const cx = -0.22, cz = 0.41, cy = ground(cx, cz);
  box('ivory', 0.22, 0.073, 0.12, cx, cy + 0.0365, cz);
  box('charcoal', 0.232, 0.011, 0.132, cx, cy + 0.079, cz);
  box('glass', 0.185, 0.018, 0.004, cx, cy + 0.058, cz + 0.061);
  box('glass', 0.004, 0.018, 0.087, cx + 0.111, cy + 0.058, cz);
  // A small Japanese flag on the facade is geometry, so it remains crisp offline.
  box('ivory', 0.060, 0.040, 0.003, cx, cy + 0.027, cz + 0.063);
  parts.red.push(new THREE.CircleGeometry(0.009, 16).translate(cx, cy + 0.027, cz + 0.065));

  // Two solar racks, a compact tracking antenna and cryogenic service tanks.
  for (const z of [0.01, 0.17]) {
    const x = -0.435, y = ground(x, z);
    box('charcoal', 0.012, 0.025, 0.09, x, y + 0.0125, z);
    box('glass', 0.075, 0.005, 0.12, x, y + 0.028, z);
    box('ivory', 0.002, 0.001, 0.12, x, y + 0.031, z);
    for (const dz of [-0.03, 0.03]) box('ivory', 0.075, 0.001, 0.002, x, y + 0.031, z + dz);
  }
  const ax = -0.12, az = -0.44, ay = ground(ax, az);
  cylinder('charcoal', 0.007, 0.105, ax, ay + 0.0525, az, 8);
  parts.ivory.push(new THREE.SphereGeometry(0.031, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2)
    .rotateX(-0.55).translate(ax, ay + 0.11, az));
  cylinder('orange', 0.003, 0.036, ax, ay + 0.136, az, 6);
  for (const z of [0.18, 0.255]) {
    const x = 0.425, y = ground(x, z);
    cylinder('ivory', 0.027, 0.075, x, y + 0.0375, z, 12);
    cylinder('orange', 0.028, 0.008, x, y + 0.06, z, 12);
  }

  // Narrow service walkway and ocean-side approach chevrons; no flat sea overlay.
  box('charcoal', 0.015, 0.003, 0.62, -0.48, ground(-0.48, 0.01) + 0.002, 0.01);
  for (const z of [0.40, 0.455]) for (const side of [-1, 1]) {
    const x = side * 0.018;
    box('orange', 0.045, 0.003, 0.008, x, ground(x, z) + 0.003, z, side * Math.PI / 5);
  }

  const materials: Record<Finish, THREE.MeshStandardMaterial> = {
    ivory: new THREE.MeshStandardMaterial({ color: 0xe3e9e8, roughness: 0.65, metalness: 0.18, emissive: 0x26323e }),
    charcoal: new THREE.MeshStandardMaterial({ color: 0x23313b, roughness: 0.65, metalness: 0.45, emissive: 0x162330 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x3a7184, roughness: 0.28, metalness: 0.5, emissive: 0x1c4657 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xf19a51, roughness: 0.6, metalness: 0.15, emissive: 0x5c3114 }),
    red: new THREE.MeshStandardMaterial({ color: 0xcd3443, roughness: 0.7, emissive: 0x46121b }),
  };
  for (const finish of Object.keys(parts) as Finish[]) {
    const geometry = mergeGeometries(parts[finish])!;
    for (const part of parts[finish]) part.dispose();
    const mesh = new THREE.Mesh(geometry, materials[finish]);
    mesh.name = `spaceport:${finish}`;
    group.add(mesh);
  }
  return group;
}
