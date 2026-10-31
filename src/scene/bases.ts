import * as THREE from 'three';
import { BASES, surfacePoint, type Base, type BaseTheme } from '../data/bases';
import type { BodyNode } from '../planets/planet';

/** A base's footprint in scene units: the pad is 0.35 of it. Smaller on small moons. */
export const baseSize = (bodyRadius: number) => Math.min(0.28, bodyRadius * 0.22);
/** The landing pad's radius in the base's own units (its footprint is 1). */
export const PAD_RADIUS = 0.35;

export interface BaseNode {
  base: Base;
  body: BodyNode;
  /** Sits on the surface, y = the local up; child of the body's mesh, so it turns with it. */
  group: THREE.Group;
  pad: THREE.Object3D;
  lights: THREE.MeshBasicMaterial[];
  /** The simple v2.0 buildings (hidden while a showcase stands there instead). */
  buildings: THREE.Object3D[];
}

// A faint glow of their own (lit windows, floodlit pads), so bases read on the night side too.
const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.6, metalness: 0.3, emissive: 0x3a4250 });
const dark = new THREE.MeshStandardMaterial({ color: 0x4a4f58, roughness: 0.8, metalness: 0.2, emissive: 0x6a5020 });
const padMat = new THREE.MeshStandardMaterial({ color: 0x6d7380, roughness: 0.9, emissive: 0x2a2e36 });

function box(w: number, h: number, d: number, m = metal) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.y = h / 2;
  return mesh;
}

function cylinder(r: number, h: number, m = metal, segments = 8) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), m);
  mesh.position.y = h / 2;
  return mesh;
}

/** The buildings for each kind of base: a few primitives, flat-shaded and cheap. */
function buildings(theme: BaseTheme): THREE.Object3D[] {
  const at = (o: THREE.Object3D, x: number, z: number) => (o.position.set(x, o.position.y, z), o);
  switch (theme) {
    case 'launch': {
      const tower = at(box(0.06, 0.42, 0.06), 0.28, -0.05);
      const arm = at(box(0.14, 0.02, 0.02), 0.22, -0.05);
      arm.position.y = 0.34;
      return [tower, arm, at(box(0.22, 0.08, 0.14, dark), -0.25, 0.25), at(cylinder(0.05, 0.12), -0.3, -0.25)];
    }
    case 'crater':
      return [at(cylinder(0.07, 0.07), -0.28, 0.22), at(cylinder(0.07, 0.07), -0.12, 0.3), at(box(0.12, 0.05, 0.05, dark), -0.2, 0.26)];
    case 'dome': {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xbfe3ff, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 }),
      );
      return [at(dome, -0.24, 0.18), at(cylinder(0.03, 0.18, dark), -0.24, 0.18)];
    }
    case 'ice': {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.08, 12), new THREE.MeshBasicMaterial({ color: 0x3fb6ff }));
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(-0.26, 0.004, 0.2);
      return [hole, at(box(0.04, 0.3, 0.04), -0.26, 0.2), at(box(0.16, 0.06, 0.1, dark), -0.05, 0.32)];
    }
    case 'shore':
      return [at(cylinder(0.06, 0.09), -0.26, 0.24), at(box(0.015, 0.36, 0.015), -0.1, 0.32), at(box(0.12, 0.05, 0.08, dark), -0.3, 0.02)];
  }
}

/** Builds every base and puts it on its body's mesh. Hidden until the camera is close. */
export function createBases(nodes: BodyNode[]): BaseNode[] {
  return BASES.map((base) => {
    const body = nodes.find((n) => n.body.id === base.body)!;
    const group = new THREE.Group();
    group.name = `base:${base.id}`;
    const pad = cylinder(PAD_RADIUS, 0.015, padMat, 20);
    const ring = new THREE.Mesh(new THREE.RingGeometry(PAD_RADIUS * 0.8, PAD_RADIUS * 0.9, 24), new THREE.MeshBasicMaterial({ color: 0xffc845, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.017;
    const lights: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0xff5040 });
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), m);
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      light.position.set(Math.cos(a) * PAD_RADIUS, 0.03, Math.sin(a) * PAD_RADIUS);
      lights.push(m);
      group.add(light);
    }
    const built = buildings(base.theme);
    group.add(pad, ring, ...built);

    // On the unit sphere in the mesh's frame (the mesh is scaled by the radius), up = the surface normal.
    const p = new THREE.Vector3(...surfacePoint(base.lat, base.lon));
    group.position.copy(p);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p);
    group.scale.setScalar(baseSize(body.body.radius) / body.body.radius);
    group.visible = false;
    body.mesh.add(group);
    return { base, body, group, pad, lights, buildings: built };
  });
}

const tmp = new THREE.Vector3();

/** Per frame: shown only when the camera is near its body; lights blink. */
export function updateBases(bases: BaseNode[], camera: THREE.Camera, seconds: number) {
  const on = Math.sin(seconds * Math.PI * 2) > 0;
  for (const b of bases) {
    const near = b.body.mesh.getWorldPosition(tmp).distanceTo(camera.position) < b.body.body.radius * 14;
    b.group.visible = near && b.body.anchor.visible;
    if (b.group.visible) for (const m of b.lights) m.color.setHex(on ? 0xff5040 : 0x401010);
  }
}

/** The pad's center and the surface normal there, in the scene. */
export function padFrame(b: BaseNode, center = new THREE.Vector3(), normal = new THREE.Vector3()) {
  b.group.updateWorldMatrix(true, false);
  b.group.getWorldPosition(center);
  normal.copy(center).sub(b.body.mesh.getWorldPosition(tmp)).normalize();
  return { center, normal, size: baseSize(b.body.body.radius) * b.body.tilt.scale.x };
}
