import type { BaseLayout } from '../baseLayout';

// Jezero Dome, the showcase base (v2.1): three inflatable habitats joined by
// tunnels, a greenhouse, a solar field, a rover garage, a comms antenna and a
// flag around the landing pad. See data/baseLayout.ts for the units.
export const JEZERO: BaseLayout = {
  modules: [
    { id: 'habA', kind: 'habitat', x: -0.75, z: -0.25 },
    { id: 'habB', kind: 'habitat', x: -0.75, z: 0.25 },
    { id: 'habC', kind: 'habitat', x: -1.15, z: 0 },
    { id: 'greenhouse', kind: 'greenhouse', x: -0.6, z: 0.75 },
    { id: 'solar', kind: 'solarField', x: 0.925, z: 0.7, cols: 3, rows: 4 },
    { id: 'garage', kind: 'garage', x: 0.75, z: -0.6 },
    { id: 'antenna', kind: 'antenna', x: -1.2, z: -0.65 },
    { id: 'flag', kind: 'flag', x: 0.35, z: 0.55 },
  ],
  tunnels: [
    { from: 'habA', to: 'habB' },
    { from: 'habA', to: 'habC' },
    { from: 'habB', to: 'habC' },
    { from: 'habB', to: 'greenhouse' },
  ],
  roverLoops: [
    // East: past the garage, round the solar field.
    [[0.45, -0.85], [1.35, -0.85], [1.45, 0.3], [1.4, 1.15], [0.55, 1.15], [0.52, -0.3]],
    // West: round the habitats, the greenhouse and the antenna.
    [[-0.5, -0.55], [-0.5, 0.5], [-0.3, 0.6], [-0.3, 1.0], [-0.95, 1.05], [-1.55, 0.6], [-1.6, -0.4], [-1.45, -0.95], [-0.9, -1.0]],
  ],
  walks: [
    [[-0.55, -0.3], [0, -0.55], [0.58, -0.62]], // habitat A ↔ garage
    [[-0.35, 0.75], [0.3, 0.56]], // greenhouse ↔ the flag
    [[0.62, 0.5], [0.62, 0.95]], // along the solar panels
    [[-1.1, -0.75], [-0.95, -0.45]], // antenna ↔ habitat A
  ],
  terrainRadius: 2.4,
  frame: 1.4,
};
