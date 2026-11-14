import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionHud, type MapView, type MissionReadout } from '../src/ui/missionHud';

let clear: ReturnType<typeof vi.fn>;
let fill: { style: { width: string }; classList: { toggle: ReturnType<typeof vi.fn> } };
let root: { hidden: boolean; querySelector: ReturnType<typeof vi.fn> };
let hud: MissionHud;
const readout: MissionReadout = { base: 'Cape', fuel: 1, km: null, eta: null };
const map: MapView = { bodies: [], rocket: null, route: null, maxRadius: 100 };

beforeEach(() => {
  clear = vi.fn();
  const context = new Proxy({ clearRect: clear }, { get: (target, key) => key in target ? target[key as keyof typeof target] : vi.fn() });
  const canvas = { clientWidth: 140, width: 140, height: 140, getContext: () => context, setAttribute: vi.fn() };
  fill = { style: { width: '' }, classList: { toggle: vi.fn() } };
  root = { hidden: false, querySelector: vi.fn((selector) => selector === 'dl' ? { replaceChildren: vi.fn() } : fill) };
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('document', {
    querySelector: (selector: string) => selector.endsWith('canvas') ? canvas : root,
    createElement: () => ({ textContent: '' }),
  });
  hud = new MissionHud();
});
afterEach(() => vi.unstubAllGlobals());

describe('mission HUD map cadence', () => {
  it('redraws the decorative map at 15 Hz while fuel and ETA still update between draws', () => {
    for (let frame = 0; frame < 60; frame++) hud.render(readout, map, 'en', frame * 1000 / 60);
    expect(clear).toHaveBeenCalledTimes(15);
    hud.render({ ...readout, fuel: 0.63, km: 1000, eta: 4 }, map, 'en', 990);
    expect(fill.style.width).toBe('63%');
    expect(clear).toHaveBeenCalledTimes(15);
  });

  it('draws immediately on departure, arrival, a different base, and reopening', () => {
    hud.render(readout, map, 'en', 0);
    hud.render(readout, { ...map, rocket: { x: 0, z: 0 } }, 'en', 1);
    hud.render(readout, map, 'en', 2);
    hud.render({ ...readout, base: 'Jezero' }, map, 'en', 3);
    expect(clear).toHaveBeenCalledTimes(4);
    hud.render(null, null, 'en', 4);
    expect(root.hidden).toBe(true);
    hud.render(readout, map, 'en', 5);
    expect(root.hidden).toBe(false);
    expect(clear).toHaveBeenCalledTimes(5);
  });
});
