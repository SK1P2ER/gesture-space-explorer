import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BODIES, type TextureSize } from '../src/data/bodies';
import { bodyLayers, hdLayers, layerSize } from '../src/planets/surface';

// Every file a body can request must ship in public/textures: a missing one
// would silently fall back to procedural textures in production.
describe('texture files', () => {
  // Standard sizes per quality tier (Low = 1K, High = 2K) and their up-close sizes (2K, 4K).
  const requests: [TextureSize, TextureSize][] = [
    ['1k', '2k'],
    ['2k', '4k'],
  ];

  for (const body of BODIES) {
    it(`${body.id}: all sizes exist`, () => {
      const missing: string[] = [];
      for (const [standard, hd] of requests) {
        for (const layer of bodyLayers(body)) {
          const file = `public/textures/${layerSize(body, layer, standard)}/${body.textures[layer]}`;
          if (!existsSync(file)) missing.push(file);
        }
        for (const layer of hdLayers(body, hd)) {
          const file = `public/textures/${layerSize(body, layer, hd)}/${body.textures[layer]}`;
          if (!existsSync(file)) missing.push(file);
        }
      }
      expect(missing).toEqual([]);
    });
  }

  it('bodies without 4K sources never ask for it', () => {
    const uranus = BODIES.find((b) => b.id === 'uranus')!;
    expect(hdLayers(uranus, '4k')).toEqual([]);
    expect(layerSize(uranus, 'map', '4k')).toBe('2k');
  });
});

describe('texture sources', () => {
  it('keeps the downloaded sources (~1 GB) out of git', () => {
    const script: string = JSON.parse(readFileSync('package.json', 'utf8')).scripts['textures:build'];
    const sourceDir = script.split(/\s+/)[2]; // node scripts/build-textures.mjs <source-dir> --download
    const ignored = readFileSync('.gitignore', 'utf8').split(/\r?\n/).map((l) => l.trim());
    expect(sourceDir).toBe('.texture-sources');
    expect(ignored).toContain(`${sourceDir}/`);
  });
});
