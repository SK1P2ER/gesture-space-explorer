import * as THREE from 'three';
import { ATMOSPHERE_SHELL as SHELL } from '../data/scale';
import { patchShader, replaceOnce } from './shaderPatch';

/**
 * Atmosphere halo: a back-side shell around the planet. Each fragment's view
 * ray is tested against the planet: the closer it passes to the surface, the
 * more air it crosses and the brighter it glows (Fresnel-like falloff toward
 * the shell's edge). Lit only on the sun-facing limb, plus forward scattering
 * when looking toward the Sun through it (a backlit planet gets a bright ring).
 */
export function makeAtmosphereHalo(radius: number, color: number, strength: number) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(color) },
      strength: { value: strength },
      radius: { value: radius },
      shellRadius: { value: radius * SHELL },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vCenter;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 glowColor;
      uniform float strength;
      uniform float radius;
      uniform float shellRadius;
      varying vec3 vWorldPos;
      varying vec3 vCenter;
      void main() {
        vec3 ray = normalize(vWorldPos - cameraPosition);
        // Point on the view ray closest to the planet's center.
        vec3 closest = cameraPosition + ray * dot(vCenter - cameraPosition, ray);
        vec3 radial = closest - vCenter;
        float d = length(radial);
        float height = clamp((d - radius) / (shellRadius - radius), 0.0, 1.0); // 0 at the surface → 1 at the shell
        float density = pow(1.0 - height, 2.2);

        vec3 limbNormal = radial / max(d, 1e-5);
        vec3 toSun = normalize(-closest); // the Sun is at the origin
        float lit = smoothstep(-0.25, 0.55, dot(limbNormal, toSun));
        float forward = pow(max(dot(ray, toSun), 0.0), 6.0);

        gl_FragColor = vec4(glowColor * density * (lit + 1.5 * forward) * strength, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius * SHELL, 64, 32), material);
}

/**
 * The same air seen against the planet's disk: a Fresnel haze on the lit limb,
 * so the surface fades into the halo instead of ending at a hard edge.
 */
export function addLimbHaze(material: THREE.MeshStandardMaterial, color: number, strength: number) {
  const uniforms = { hazeColor: { value: new THREE.Color(color) }, hazeStrength: { value: strength } };
  patchShader(material, 'limb-haze', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = replaceOnce(
      shader.fragmentShader,
      'void main() {',
      /* glsl */ `
      uniform vec3 hazeColor;
      uniform float hazeStrength;
      vec3 limbHaze() {
        vec3 n = normalize(vNormal);
        vec3 toCamera = normalize(vViewPosition);
        vec3 toSun = normalize((viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz + vViewPosition);
        float fresnel = pow(clamp(1.0 - dot(n, toCamera), 0.0, 1.0), 3.0); // pow() of a negative is NaN
        return hazeColor * fresnel * smoothstep(-0.2, 0.5, dot(n, toSun)) * hazeStrength;
      }
      void main() {`,
    );
    shader.fragmentShader = replaceOnce(
      shader.fragmentShader,
      'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
      'outgoingLight += limbHaze();\ngl_FragColor = vec4( outgoingLight, diffuseColor.a );',
    );
  });
}
