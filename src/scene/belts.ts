import * as THREE from 'three';
import { NEAR_CAMERA, sampleBelt, seeded, type BeltSpec } from '../data/belts';
import { patchShader, replaceOnce } from '../planets/shaderPatch';

/**
 * A belt of rocks as one InstancedMesh: one draw call however many rocks. The
 * instance matrices only hold each rock's size and tumble; where it is on its
 * orbit is worked out in the vertex shader from the date (uDays), so moving
 * thousands of rocks costs no CPU time. Lower quality draws fewer of them (count).
 * Rocks close to the camera shrink away (data/belts.ts nearCameraScale).
 */
export class Belt {
  readonly mesh: THREE.InstancedMesh;
  private readonly days = { value: 0 };

  constructor(spec: BeltSpec, maxCount: number, color: number, seed: number) {
    const sample = sampleBelt(spec, maxCount, seed);
    const geometry = makeRock(seed);
    geometry.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(sample.orbit, 4));
    geometry.setAttribute('aNode', new THREE.InstancedBufferAttribute(sample.node, 1));

    const material = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true });
    patchShader(material, 'belt-orbit', (shader) => {
      shader.uniforms.uDays = this.days;
      shader.uniforms.uNear = { value: new THREE.Vector2(NEAR_CAMERA.hidden, NEAR_CAMERA.full) };
      shader.vertexShader = replaceOnce(
        shader.vertexShader,
        'void main() {',
        /* glsl */ `
        uniform float uDays;
        uniform vec2 uNear; // distance from the camera: hidden below x, full size beyond y
        attribute vec4 aOrbit; // scene radius, angle at J2000 (rad), mean motion (rad/day), height amplitude
        attribute float aNode;
        vec3 beltOffset() {
          float angle = aOrbit.y + mod(aOrbit.z * uDays, 6.2831853);
          // Same sense as the planets: rotating (r, 0, 0) about +y.
          return vec3(cos(angle) * aOrbit.x, aOrbit.w * sin(angle - aNode), -sin(angle) * aOrbit.x);
        }
        void main() {`,
      );
      shader.vertexShader = replaceOnce(
        shader.vertexShader,
        'vec3 transformed = vec3( position );',
        `vec3 rockOffset = beltOffset();
	vec3 transformed = vec3( position ) * smoothstep( uNear.x, uNear.y, distance( ( modelMatrix * vec4( rockOffset, 1.0 ) ).xyz, cameraPosition ) );`,
      );
      shader.vertexShader = replaceOnce(
        shader.vertexShader,
        'mvPosition = instanceMatrix * mvPosition;',
        'mvPosition = instanceMatrix * mvPosition;\n\tmvPosition.xyz += rockOffset;',
      );
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, maxCount);
    // The rocks' real positions come from the shader, so three's bounds (from the matrices) would be wrong.
    this.mesh.frustumCulled = false;
    const rand = seeded(seed + 1);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const axis = new THREE.Vector3();
    for (let i = 0; i < maxCount; i++) {
      q.setFromAxisAngle(axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(), rand() * Math.PI * 2);
      const size = sample.size[i];
      m.compose(new THREE.Vector3(), q, s.set(size * (0.8 + 0.4 * rand()), size * (0.6 + 0.3 * rand()), size));
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** How many rocks to draw (the first `count` are a random subset). */
  setCount(count: number) {
    this.mesh.count = Math.min(count, this.mesh.instanceMatrix.count);
  }

  update(daysSinceJ2000: number) {
    this.days.value = daysSinceJ2000;
  }
}

/** A lumpy low-poly rock: an icosahedron with each corner pushed in or out. */
function makeRock(seed: number) {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const rand = seeded(seed + 2);
  const bumps = new Map<string, number>();
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // The geometry repeats each corner per face: corners in the same place must move together.
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!bumps.has(key)) bumps.set(key, 0.7 + 0.5 * rand());
    v.multiplyScalar(bumps.get(key)!);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}
