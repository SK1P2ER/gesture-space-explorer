import * as THREE from 'three';
import { P24_EXPOSURE, P24_WORLD, P24_SUN_COLOR, P24_SUN_DIRECTION } from './p24BlenderLook';

export type LightingMode = 'day' | 'sunset' | 'night';

interface LightingPreset {
  sun: readonly [number, number, number];
  sunColor: readonly [number, number, number];
  sunIntensity: number;
  horizon: readonly [number, number, number];
  mid: readonly [number, number, number];
  zenith: readonly [number, number, number];
  sky: number;
  hemiGround: number;
  hemi: number;
  hemiWhite: number;
  env: number;
  exposure: number;
  fog: readonly [number, number];
  landFade: readonly [number, number, number];
}

/** P2.4's warm low sun and AgX exposure, with hemispheric fill approximating Blender's area lights. */
export const PREVIEW_DAYLIGHT = {
  sun: P24_SUN_DIRECTION, sunColor: P24_SUN_COLOR, sunIntensity: 3,
  horizon: P24_WORLD.horizon, mid: P24_WORLD.mid, zenith: P24_WORLD.zenith, sky: P24_WORLD.strength,
  hemiGround: 0x777a76, hemi: .82, hemiWhite: .92, env: .72, exposure: P24_EXPOSURE, fog: [1600, 8500] as const,
  landFade: [.10, .09, .075] as const,
};

export const LIGHTING_PRESETS: Record<LightingMode, LightingPreset> = {
  day: PREVIEW_DAYLIGHT,
  sunset: {
    sun: [-0.84, 0.24, 0.48], sunColor: [1.0, 0.58, 0.28], sunIntensity: 2.7,
    horizon: [0.96, 0.52, 0.28], mid: [0.46, 0.28, 0.44], zenith: [0.09, 0.12, 0.28], sky: 0.92,
    hemiGround: 0x5c4738, hemi: 0.85, hemiWhite: 0.45, env: 0.95, exposure: 1.04, fog: [550, 3200],
    landFade: [0.06, 0.045, 0.035],
  },
  night: {
    sun: [-0.45, 0.65, 0.60], sunColor: [0.55, 0.72, 0.98], sunIntensity: 0.45,
    horizon: [0.04, 0.09, 0.17], mid: [0.018, 0.04, 0.09], zenith: [0.006, 0.014, 0.038], sky: 1.0,
    hemiGround: 0x101820, hemi: 0.45, hemiWhite: 0.25, env: 0.75, exposure: 1.15, fog: [500, 3000],
    landFade: [0.01, 0.018, 0.025],
  },
};

export const HEMI_SKY_FILL = 1.0;

const linear = (rgb: readonly [number, number, number]) => new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace);

function skyMaterial() {
  const p = PREVIEW_DAYLIGHT;
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      horizon: { value: linear(p.horizon) },
      mid: { value: linear(p.mid) },
      zenith: { value: linear(p.zenith) },
      strength: { value: p.sky },
      landFade: { value: new THREE.Vector3(...p.landFade) },
      starOpacity: { value: 0 },
      authoredWorld: { value: true },
    },
    vertexShader: `varying vec3 vDir;
      void main(){ vDir = normalize(position); vec4 q = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * q; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 horizon, mid, zenith, landFade; uniform float strength, starOpacity; uniform bool authoredWorld; varying vec3 vDir;
      float hashStar(vec3 p) {
        p = fract(p * vec3(443.8975, 397.2973, 491.1871));
        p += dot(p, p.yxz + 19.19);
        return fract((p.x + p.y) * p.z);
      }
      void main(){
        float h = clamp((authoredWorld ? abs(vDir.y) : max(vDir.y, 0.)) * 3.5, 0., 1.);
        vec3 c = h < .34 ? mix(horizon, mid, h / .34) : mix(mid, zenith, (h - .34) / .66);
        c *= strength;
        if (starOpacity > 0.001 && vDir.y > 0.03) {
          vec3 grid = floor(vDir * 240.0);
          float r = hashStar(grid);
          if (r > 0.9945) {
            vec3 cellCenter = normalize(grid + 0.5);
            float d = length(vDir - cellCenter) * 240.0;
            float sparkle = smoothstep(0.32, 0.04, d) * smoothstep(0.03, 0.22, vDir.y);
            float tint = fract(r * 73.1);
            vec3 starCol = mix(vec3(0.76, 0.86, 1.0), vec3(1.0, 0.94, 0.84), tint);
            c += starCol * sparkle * starOpacity * (0.45 + 0.55 * fract(r * 19.7));
          }
        }
        if (!authoredWorld) c = mix(c, landFade, 1. - smoothstep(-.035, 0., vDir.y));
        gl_FragColor = vec4(c, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function applyPreviewDaylight(renderer: THREE.WebGLRenderer, scene: THREE.Scene, hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight, sunTarget = new THREE.Vector3()) {
  const mat = skyMaterial();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(8000, 32, 16), mat);
  sky.name = 'Preview daylight sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
  scene.background = null;

  const reflected = new Set<THREE.MeshStandardMaterial>();
  const envCache: Partial<Record<LightingMode, THREE.WebGLRenderTarget>> = {};
  let currentMode: LightingMode = 'day';

  const getEnv = (mode: LightingMode) => {
    if (!envCache[mode]) {
      const prevStars = mat.uniforms.starOpacity.value;
      mat.uniforms.starOpacity.value = 0;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat);
      envScene.add(envSky);
      envCache[mode] = pmrem.fromScene(envScene, 0, 0.1, 100);
      envSky.geometry.dispose();
      pmrem.dispose();
      renderer.setRenderTarget(null);
      mat.uniforms.starOpacity.value = prevStars;
    }
    return envCache[mode]!;
  };

  const setMode = (mode: LightingMode) => {
    currentMode = mode;
    const p = LIGHTING_PRESETS[mode];
    mat.uniforms.horizon.value.copy(linear(p.horizon));
    mat.uniforms.mid.value.copy(linear(p.mid));
    mat.uniforms.zenith.value.copy(linear(p.zenith));
    mat.uniforms.strength.value = p.sky;
    mat.uniforms.landFade.value.set(...p.landFade);
    mat.uniforms.starOpacity.value = mode === 'night' ? 1.0 : 0.0;
    mat.uniforms.authoredWorld.value = mode === 'day';

    const fogColor = linear(p.horizon).multiplyScalar(p.sky);
    scene.fog = new THREE.Fog(fogColor, p.fog[0], p.fog[1]);

    const skyAverage = linear(p.horizon).lerp(linear(p.mid), 0.5).multiplyScalar(p.sky);
    const land = new THREE.Color(...p.landFade);
    hemi.color.copy(linear(p.mid)).lerp(new THREE.Color(0xffffff), p.hemiWhite).multiplyScalar(p.hemi).add(skyAverage.clone().multiplyScalar(HEMI_SKY_FILL));
    hemi.groundColor.setHex(p.hemiGround).multiplyScalar(p.hemi).add(land.clone().multiplyScalar(HEMI_SKY_FILL));
    hemi.intensity = 1;

    sun.color.copy(linear(p.sunColor));
    sun.intensity = p.sunIntensity;
    sun.position.copy(sunTarget).addScaledVector(new THREE.Vector3(...p.sun).normalize(), 800);
    renderer.toneMappingExposure = p.exposure;

    const env = getEnv(mode);
    for (const m of reflected) {
      m.envMap = env.texture;
      m.envMapIntensity = p.env;
      m.needsUpdate = true;
    }
  };

  setMode('day');

  const reflect = (material: THREE.Material) => {
    if (!(material instanceof THREE.MeshStandardMaterial)) return;
    reflected.add(material);
    material.envMap = getEnv(currentMode).texture;
    material.envMapIntensity = LIGHTING_PRESETS[currentMode].env;
    material.needsUpdate = true;
  };

  return {
    reflect,
    setMode,
    getMode: () => currentMode,
    dispose: () => {
      for (const rt of Object.values(envCache)) rt?.dispose();
      sky.geometry.dispose();
      mat.dispose();
      scene.remove(sky);
    },
  };
}
