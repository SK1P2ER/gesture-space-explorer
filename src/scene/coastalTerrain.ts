import * as THREE from 'three';

/**
 * Enhances the exported "Web coastal ground" / "Web wooded skyline" terrain materials in-place
 * with zero extra triangles and zero extra textures:
 * - Multi-octave world-space coastal meadow & dry-grass variation (breaks up uniform green lawn)
 * - Wet-sand shoreline darkening near sea level (Y < 2.2 m)
 * - Steep coastal bluff basalt rock tinting (worldNormal.y < 0.88)
 */
export function enhanceCoastalTerrain(material: THREE.Material): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) return;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vTerrainWorldPos;\nvarying vec3 vTerrainWorldNormal;',
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTerrainWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vTerrainWorldPos;\nvarying vec3 vTerrainWorldNormal;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
vec2 tp = vTerrainWorldPos.xz;
// Multi-scale organic coastal meadow & dry-grass breakup
float n1 = sin(tp.x * 0.023 + tp.y * 0.017) * cos(tp.x * 0.013 - tp.y * 0.029);
float n2 = sin(tp.x * 0.071 - tp.y * 0.053) * cos(tp.x * 0.047 + tp.y * 0.061);
float meadowVar = n1 * 0.65 + n2 * 0.35;
float isGrass = smoothstep(2.6, 5.5, vTerrainWorldPos.y);
// Warm dry coastal grass patches & deeper coastal pine-shadow greens
vec3 warmGrass = diffuseColor.rgb * vec3(1.12, 1.04, 0.84);
vec3 deepGrass = diffuseColor.rgb * vec3(0.84, 0.90, 0.86);
diffuseColor.rgb = mix(diffuseColor.rgb, mix(deepGrass, warmGrass, smoothstep(-0.65, 0.65, meadowVar)), isGrass * 0.42);
// Steep coastal bluff basalt rock tinting
float slope = 1.0 - clamp(vTerrainWorldNormal.y, 0.0, 1.0);
float cliffMask = smoothstep(0.08, 0.28, slope) * smoothstep(1.2, 4.0, vTerrainWorldPos.y);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.14, 0.15, 0.145), cliffMask * 0.58);
// Wet-sand shoreline darkening just above water level
float wetSand = (1.0 - smoothstep(0.1, 2.1, vTerrainWorldPos.y)) * smoothstep(-1.2, 0.1, vTerrainWorldPos.y);
diffuseColor.rgb *= mix(1.0, 0.68, wetSand);`,
      );
  };
  material.customProgramCacheKey = () => 'coastal-terrain-p35';
  material.needsUpdate = true;
}
