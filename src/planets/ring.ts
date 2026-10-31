import * as THREE from 'three';
import { patchShader, replaceOnce } from './shaderPatch';

/**
 * A planetary ring with radial texture coordinates (u = inner → outer edge)
 * that receives the planet's shadow. The shadow is computed analytically
 * (does the ray to the Sun hit the planet's sphere?) rather than with a shadow
 * map, which for a point light would mean six extra render passes per frame.
 */
export function makeRing(inner: number, outer: number, planet: THREE.Mesh, planetRadius: number) {
  const geo = new THREE.RingGeometry(inner, outer, 128, 1);
  // RingGeometry's UVs are planar; remap u to radius so the texture is radial bands.
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (r - inner) / (outer - inner), 0.5);
  }
  const material = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    roughness: 0.9,
  });
  const ring = new THREE.Mesh(geo, material);
  ring.rotation.x = -Math.PI / 2; // into the equatorial plane; the tilt group adds the axial tilt

  const uniforms = {
    planetCenter: { value: new THREE.Vector3() },
    planetRadius: { value: planetRadius },
  };
  ring.onBeforeRender = () => uniforms.planetCenter.value.setFromMatrixPosition(planet.matrixWorld);

  patchShader(material, 'ring-shadow', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = replaceOnce(
      'varying vec3 vRingWorld;\n' + shader.vertexShader,
      'gl_Position = projectionMatrix * mvPosition;',
      'gl_Position = projectionMatrix * mvPosition;\nvRingWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    shader.fragmentShader = replaceOnce(
      shader.fragmentShader,
      'void main() {',
      /* glsl */ `
      uniform vec3 planetCenter;
      uniform float planetRadius;
      varying vec3 vRingWorld;
      float planetShadow() {
        vec3 toSun = normalize(-vRingWorld); // the Sun is at the origin
        vec3 toPlanet = planetCenter - vRingWorld;
        float along = dot(toPlanet, toSun);
        if (along <= 0.0) return 1.0; // the planet is behind this point, seen from the Sun
        float miss = length(toPlanet - toSun * along);
        return smoothstep(planetRadius * 0.97, planetRadius * 1.02, miss); // soft penumbra edge
      }
      void main() {`,
    );
    // Lighting: plain Lambert leaves the ring nearly black whenever the Sun is
    // low over the ring plane (most of the time) and fully black from below.
    // Real rings are a cloud of ice particles that scatter light both ways, so
    // use a softened, two-sided term instead (and no specular).
    shader.fragmentShader = replaceOnce(
      shader.fragmentShader,
      'vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;',
      /* glsl */ `
      vec3 toSunView = normalize((viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz + vViewPosition);
      float facing = abs(dot(normalize(vNormal), toSunView));
      reflectedLight.directDiffuse = BRDF_Lambert(diffuseColor.rgb) * pointLights[0].color
        * (0.35 + 0.65 * facing) * planetShadow();
      reflectedLight.directSpecular = vec3(0.0);
      vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;`,
    );
  });

  return { ring, material };
}
