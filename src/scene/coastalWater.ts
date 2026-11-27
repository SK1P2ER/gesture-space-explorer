import * as THREE from 'three';

export interface CoastalWaterController {
  update(timeSec: number, reducedMotion: boolean): void;
  setLighting(mode: 'day' | 'sunset' | 'night', launchGlow?: number, sunDirection?: THREE.Vector3): void;
}

/**
 * Enhances the exported "Web open ocean" MeshStandardMaterial in-place with zero extra triangles:
 * - 2-octave procedural world-space wave normal perturbation
 * - Fresnel coastal sky reflection & subtle sunlit water glint
 * - Mode-matched sunset/night reflection tint & subtle warm launch shimmer on the harbor
 * - Feathered sandy shallows and broken surf on steeper stretches of the baked coastline
 */
export function enhanceCoastalWater(
  material: THREE.Material,
  sunDirection = new THREE.Vector3(-0.53, 0.78, 0.48).normalize(),
): CoastalWaterController | null {
  if (!(material instanceof THREE.MeshStandardMaterial)) return null;
  const uniforms = {
    uWaterTime: { value: 0 },
    uSunDir: { value: sunDirection.clone().normalize() },
    uSkyTint: { value: new THREE.Vector3(0.19, 0.32, 0.47) },
    uSpecColor: { value: new THREE.Vector3(1.0, 0.94, 0.82) },
    uSpecStrength: { value: 0.16 },
    uLaunchGlow: { value: 0 },
    uNightMode: { value: 0 },
  };
  material.roughness = 0.28;
  material.metalness = 0.08;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = uniforms.uWaterTime;
    shader.uniforms.uSunDir = uniforms.uSunDir;
    shader.uniforms.uSkyTint = uniforms.uSkyTint;
    shader.uniforms.uSpecColor = uniforms.uSpecColor;
    shader.uniforms.uSpecStrength = uniforms.uSpecStrength;
    shader.uniforms.uLaunchGlow = uniforms.uLaunchGlow;
    shader.uniforms.uNightMode = uniforms.uNightMode;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCoastalWorldPos;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvCoastalWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uWaterTime;
uniform vec3 uSunDir;
uniform vec3 uSkyTint;
uniform vec3 uSpecColor;
uniform float uSpecStrength;
uniform float uLaunchGlow;
uniform float uNightMode;
varying vec3 vCoastalWorldPos;`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vec3(0.84, 0.70, 1.0);')
      .replace(
        '#include <opaque_fragment>',
        `
vec2 wp = vCoastalWorldPos.xz;
float t = uWaterTime;
// Dual-octave coastal swell & capillary ripple gradients
float w1 = sin(wp.x * 0.065 + wp.y * 0.045 + t * 1.15);
float w2 = cos(wp.x * 0.14 - wp.y * 0.11 + t * 1.65);
float w3 = sin(wp.x * 0.31 + wp.y * 0.27 - t * 2.1);
vec3 rippleN = normalize(vec3((w1 * 0.035 + w2 * 0.025 + w3 * 0.015), 1.0, (w2 * 0.035 - w1 * 0.025 + w3 * 0.015)));
vec3 viewDirW = normalize(cameraPosition - vCoastalWorldPos);
float fresnel = pow(1.0 - max(dot(rippleN, viewDirW), 0.0), 3.6);
// Follow the scene's actual light level so night water does not pick up a daylight sheen.
vec3 luma = vec3(0.2126, 0.7152, 0.0722);
float lightLevel = clamp(dot(totalDiffuse, luma) / max(dot(diffuseColor.rgb, luma), 0.01), 0.0, 1.3);
vec3 skyTint = uSkyTint * max(lightLevel, uNightMode * 0.35);
outgoingLight = mix(outgoingLight, skyTint, fresnel * 0.18);
// Subtle sunlit / moonlit specular sparkle across wave crests
vec3 halfV = normalize(uSunDir + viewDirW);
float spec = pow(max(dot(rippleN, halfV), 0.0), 96.0);
outgoingLight += uSpecColor * spec * max(lightLevel, uNightMode * 0.22) * uSpecStrength;
// Warm harbor shimmer during ignition & liftoff at night
if (uLaunchGlow > 0.001 && uNightMode > 0.01) {
  float padDist = length(wp);
  float padReach = exp(-padDist * 0.0055);
  vec3 toPad = normalize(vec3(-wp.x, 38.0, -wp.y));
  vec3 launchHalf = normalize(toPad + viewDirW);
  float shimmer = pow(max(dot(rippleN, launchHalf), 0.0), 22.0);
  outgoingLight += vec3(1.0, 0.56, 0.20) * (0.045 + shimmer * 0.28) * padReach * uLaunchGlow * uNightMode;
}
#if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
  // The export blends linear green from .097 offshore to .33 at the waterline.
  float shallow = clamp((vColor.g - 0.097) / (0.33 - 0.097), 0.0, 1.0);
  vec2 dx = dFdx(wp);
  vec2 dy = dFdy(wp);
  vec2 slope = vec2(dFdx(shallow) * dy.y - dFdy(shallow) * dx.y,
                    dFdy(shallow) * dx.x - dFdx(shallow) * dy.x);
  float depthGradient = length(slope) / max(abs(dx.x * dy.y - dx.y * dy.x), 0.0001);
  float steep = smoothstep(0.025, 0.075, depthGradient);
  float wash = smoothstep(0.21, 0.94, shallow) * (1.0 - steep);
  outgoingLight = mix(outgoingLight, vec3(0.29, 0.33, 0.25) * lightLevel, wash * 0.08);

  // Restrict surf to the shallow edge and break it up where depth changes quickly.
  float waterline = mix(0.67, 0.84, steep);
  float pulse = 0.5 + 0.5 * sin(shallow * 22.0 + wp.x * 0.05 + wp.y * 0.03 - t * 1.25);
  float shoreEdge = smoothstep(waterline, min(waterline + 0.14, 0.99), shallow);
  float breaks = smoothstep(-0.18, 0.46, sin(wp.x * 0.21 + wp.y * 0.12) * cos(wp.y * 0.16));
  float foam = shoreEdge * smoothstep(0.56, 0.96, pulse) * mix(1.0, breaks, steep) * 0.08;
  outgoingLight = mix(outgoingLight, vec3(0.70, 0.78, 0.80) * lightLevel, foam);
#endif
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'coastal-water-depth-surf';
  material.needsUpdate = true;
  return {
    update(timeSec: number, reducedMotion: boolean) {
      uniforms.uWaterTime.value = reducedMotion ? 0 : timeSec;
    },
    setLighting(mode: 'day' | 'sunset' | 'night', launchGlow = 0, sunDirection?: THREE.Vector3) {
      if (mode === 'sunset') {
        uniforms.uSkyTint.value.set(0.56, 0.28, 0.22);
        uniforms.uSpecColor.value.set(1.0, 0.60, 0.28);
        uniforms.uSpecStrength.value = 0.26;
        uniforms.uNightMode.value = 0;
      } else if (mode === 'night') {
        uniforms.uSkyTint.value.set(0.05, 0.10, 0.22);
        uniforms.uSpecColor.value.set(0.55, 0.74, 1.0);
        uniforms.uSpecStrength.value = 0.14;
        uniforms.uNightMode.value = 1;
      } else {
        uniforms.uSkyTint.value.set(0.19, 0.32, 0.47);
        uniforms.uSpecColor.value.set(1.0, 0.94, 0.82);
        uniforms.uSpecStrength.value = 0.16;
        uniforms.uNightMode.value = 0;
      }
      uniforms.uLaunchGlow.value = launchGlow;
      if (sunDirection) uniforms.uSunDir.value.copy(sunDirection).normalize();
    },
  };
}
