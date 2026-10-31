import * as THREE from 'three';
import { makeGlowTexture } from './proceduralTextures';
import { patchShader, replaceOnce } from './shaderPatch';

// The Sun's texture is deep orange; pushed past 1.0 it reads as a hot yellow-white
// surface through ACES tone mapping (and feeds the bloom pass) instead of a flat red disk.
const SUN_COLOR = new THREE.Color().setRGB(1.7, 1.45, 1.1);

export function makeSunMaterial() {
  const material = new THREE.MeshBasicMaterial({ color: SUN_COLOR });
  // Limb darkening: the Sun's edge is visibly dimmer and redder than its center,
  // which is what makes it read as a ball rather than a disk.
  patchShader(material, 'limb-darkening', (shader) => {
    shader.vertexShader = replaceOnce(
      'varying float vMu;\n' + shader.vertexShader,
      'gl_Position = projectionMatrix * mvPosition;',
      'gl_Position = projectionMatrix * mvPosition;\nvMu = max(dot(normalize(normalMatrix * normal), normalize(-mvPosition.xyz)), 0.0);',
    );
    shader.fragmentShader = replaceOnce(
      'varying float vMu;\n' + shader.fragmentShader,
      'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
      // I(μ) ≈ 0.4 + 0.6·μ^0.6, with the edge shifted toward red.
      // The clamp matters: with MSAA, edge pixels are shaded outside the triangle,
      // vMu extrapolates below 0, pow() returns NaN — and bloom smears a single
      // NaN pixel over the whole frame.
      'float mu = clamp(vMu, 0.0, 1.0);\n' +
        'outgoingLight *= (0.4 + 0.6 * pow(mu, 0.6)) * mix(vec3(1.0, 0.8, 0.6), vec3(1.0), sqrt(mu));\n' +
        'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
    );
  });
  return material;
}

/** Soft corona sprite. With bloom on it's a faint outer halo; without bloom it is the glow. */
export function makeCorona(radius: number) {
  const corona = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: makeGlowTexture(), blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  corona.scale.setScalar(radius * 3.6);
  return corona;
}
