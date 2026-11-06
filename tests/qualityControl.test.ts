import { describe, expect, it, vi } from 'vitest';
import { QualityControl } from '../src/app/qualityControl';
import type { QualitySetting, QualityTier } from '../src/quality';

const VERSION = '9.9.9';
const NOW = 1_000_000;
const desktop = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 };
const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 };
const memory = (entries: Record<string, string> = {}) => {
  const data = new Map(Object.entries(entries));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

function control(setting: QualitySetting, tier: QualityTier, options: { device?: typeof desktop; storage?: ReturnType<typeof memory>; dpr?: number } = {}) {
  const state = { qualitySetting: setting, qualityTier: tier };
  const storage = options.storage ?? memory();
  const applyTier = vi.fn();
  const resize = vi.fn();
  const quality = new QualityControl({
    state, storage, device: options.device ?? desktop, version: VERSION, now: () => NOW,
    devicePixelRatio: () => options.dpr ?? 2, applyTier, resize,
  });
  return { quality, state, storage, applyTier, resize };
}

describe('QualityControl: the setting, the tier in effect and Auto', () => {
  it('Auto starts on the tier this device learned before', () => {
    const storage = memory({ 'gse.autoTier': JSON.stringify({ tier: 'low', version: VERSION, at: NOW }) });
    const { quality, state } = control('auto', 'high', { storage });
    expect(state.qualityTier).toBe('low');
    expect(quality.autoTier?.tier).toBe('low');
  });

  it('a fixed setting has no Auto and keeps its tier', () => {
    const { quality, state } = control('ultra', 'ultra');
    expect(quality.autoTier).toBeNull();
    expect(state.qualityTier).toBe('ultra');
  });

  it('a new setting is saved and applied; Auto comes and goes with it', () => {
    const { quality, state, storage, applyTier } = control('auto', 'high');
    quality.setSetting('ultra');
    expect([state.qualitySetting, state.qualityTier, storage.data.get('gse.quality')]).toEqual(['ultra', 'ultra', 'ultra']);
    expect(quality.autoTier).toBeNull();
    expect(applyTier).toHaveBeenLastCalledWith('ultra');
    quality.setSetting('auto');
    expect(quality.autoTier).not.toBeNull();
    expect(applyTier).toHaveBeenLastCalledWith('high'); // a desktop with nothing learned starts on High
  });

  it('the button cycles the settings; phones and tablets skip Ultra', () => {
    const seen = (device: typeof desktop) => {
      const { quality, state } = control('auto', 'high', { device });
      return Array.from({ length: 4 }, () => (quality.cycleSetting(), state.qualitySetting));
    };
    expect(seen(desktop)).toEqual(['low', 'high', 'ultra', 'auto']);
    expect(seen(iphone)).toEqual(['low', 'high', 'auto', 'low']);
  });
});

describe('QualityControl: once a frame', () => {
  it('Ultra that cannot keep up gives way to High, once, and says so', () => {
    const { quality, state } = control('ultra', 'ultra');
    let gaveWay = 0;
    for (let i = 0; i < 200; i++) if (quality.frame(25, () => true)) gaveWay++;
    expect(gaveWay).toBe(1);
    expect([state.qualitySetting, state.qualityTier]).toEqual(['high', 'high']);
  });

  it('a resolution step resizes; a photo takes the tier back to full resolution', () => {
    const { quality, resize } = control('high', 'high');
    for (let i = 0; i < 120; i++) quality.frame(1000 / 60, () => false); // learns the display: 60 Hz
    expect(resize).not.toHaveBeenCalled();
    for (let i = 0; i < 100 && quality.governor.scale === 1; i++) quality.frame(40, () => false);
    expect(quality.governor.scale).toBeLessThan(1);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(quality.pixelRatio()).toBeLessThan(quality.fullPixelRatio());
    quality.fullResolution();
    expect(quality.governor.scale).toBe(1);
    expect(resize).toHaveBeenCalledTimes(2);
    quality.fullResolution(); // already full: nothing to do
    expect(resize).toHaveBeenCalledTimes(2);
  });

  it('a new tier starts at full resolution and asks for a shader warm-up when the scene allows', () => {
    const { quality, state, applyTier } = control('high', 'high');
    quality.setTier('low');
    expect(state.qualityTier).toBe('low');
    expect(applyTier).toHaveBeenCalledWith('low');
    expect(quality.takePrewarm(false)).toBe(false); // not now: kept for later
    expect(quality.takePrewarm(true)).toBe(true);
    expect(quality.takePrewarm(true)).toBe(false); // once
    quality.requestPrewarm();
    expect(quality.takePrewarm(true)).toBe(true);
  });

  it('Auto tries High only with headroom, counting the frame CPU time, and only when it may switch', () => {
    const run = (cpuMs: number, canSwitch: boolean) => {
      const { quality, state, applyTier } = control('auto', 'low', { device: iphone });
      for (let t = 0; t < 10_000; t += 1000 / 60) {
        quality.frame(1000 / 60, () => canSwitch);
        quality.endFrame(cpuMs);
      }
      return { tier: state.qualityTier, applied: applyTier.mock.calls.map(([tier]) => tier) };
    };
    expect(run(2, true)).toEqual({ tier: 'high', applied: ['high'] });
    expect(run(12, true)).toEqual({ tier: 'low', applied: [] }); // over half the frame is the app's own work
    expect(run(2, false)).toEqual({ tier: 'low', applied: [] }); // decided, but waits until it may switch
  });

  it('pixel ratios: capped by the tier, never under 1 on desktop', () => {
    expect(control('low', 'low', { dpr: 2 }).quality.fullPixelRatio()).toBe(1);
    expect(control('high', 'high', { dpr: 3 }).quality.fullPixelRatio()).toBe(2);
    expect(control('high', 'high', { dpr: 1.5 }).quality.pixelRatio()).toBe(1.5);
  });

  it('describes itself for ?debug', () => {
    const fixed = control('low', 'low').quality;
    expect(fixed.describeTier()).toBe('low (fixed)');
    expect(fixed.describeResolution(1)).toBe('100% · 1.00x · holds — fps');
    const auto = control('auto', 'high').quality;
    expect(auto.describeTier()).toBe(`Auto: ${auto.autoTier!.describe()}`);
  });
});
