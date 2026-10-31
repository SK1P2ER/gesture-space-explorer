import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BODIES, type TextureTier } from '../src/data/bodies';
import { bodyLayers, hdLayers, layerTier } from '../src/planets/surface';

// Every file a body can request must ship in public/textures: a missing one
// would silently fall back to procedural textures in production.
describe('texture files', () => {
  // Base tiers per quality (Low = 1K, High = 2K) and their up-close tiers (2K, 4K).
  const requests: [TextureTier, TextureTier][] = [
    ['1k', '2k'],
    ['2k', '4k'],
  ];

  for (const body of BODIES) {
    it(`${body.id}: all tiers exist`, () => {
      const missing: string[] = [];
      for (const [base, hd] of requests) {
        for (const layer of bodyLayers(body)) {
          const file = `public/textures/${layerTier(body, layer, base)}/${body.textures[layer]}`;
          if (!existsSync(file)) missing.push(file);
        }
        for (const layer of hdLayers(body, hd)) {
          const file = `public/textures/${layerTier(body, layer, hd)}/${body.textures[layer]}`;
          if (!existsSync(file)) missing.push(file);
        }
      }
      expect(missing).toEqual([]);
    });
  }

  it('bodies without 4K sources never ask for it', () => {
    const uranus = BODIES.find((b) => b.id === 'uranus')!;
    expect(hdLayers(uranus, '4k')).toEqual([]);
    expect(layerTier(uranus, 'map', '4k')).toBe('2k');
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
