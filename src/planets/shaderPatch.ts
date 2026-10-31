import * as THREE from 'three';

type Patch = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

const INCLUDE = /^[ \t]*#include +<([\w\d./]+)>/gm;

/** Inlines three's `#include <chunk>` directives so patches can edit any line. */
export function resolveIncludes(source: string): string {
  return source.replace(INCLUDE, (_, name: string) => {
    const chunk = THREE.ShaderChunk[name as keyof typeof THREE.ShaderChunk];
    if (chunk === undefined) throw new Error(`Unknown shader chunk: ${name}`);
    return resolveIncludes(chunk);
  });
}

const patches = new WeakMap<THREE.Material, { keys: string[]; fns: Patch[] }>();

/**
 * Adds a shader edit to a built-in material. Several edits can stack on one
 * material; `key` must describe what the edit does so three.js only shares a
 * compiled program between materials that were patched the same way.
 */
export function patchShader(material: THREE.Material, key: string, fn: Patch) {
  let entry = patches.get(material);
  if (!entry) {
    const e = (entry = { keys: [] as string[], fns: [] as Patch[] });
    patches.set(material, e);
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = resolveIncludes(shader.vertexShader);
      shader.fragmentShader = resolveIncludes(shader.fragmentShader);
      for (const f of e.fns) f(shader);
    };
    material.customProgramCacheKey = () => e.keys.join('|');
  }
  entry.keys.push(key);
  entry.fns.push(fn);
  material.needsUpdate = true;
}

/** Replaces `search` (which must occur) in a shader source. */
export function replaceOnce(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) throw new Error(`Shader patch target not found: ${search}`);
  return source.replace(search, replacement);
}
