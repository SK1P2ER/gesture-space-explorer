import { describe, expect, it } from 'vitest';
import {
  AutoTier, autoStartTier, initialQualitySetting, isMobile, nextQualitySetting, PROFILES, readAutoMemory, renderPixelRatio,
  ResolutionGovernor, saveQuality, UltraGuard, writeAutoMemory, type AutoMemory, type AutoTierChoice,
} from '../src/quality';

const desktop = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36', maxTouchPoints: 0 };
const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', maxTouchPoints: 5 };
const ipad = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', maxTouchPoints: 5 };
const mac = { ...ipad, maxTouchPoints: 0 };
const android = { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36', maxTouchPoints: 5 };

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), data };
};

describe('quality', () => {
  it('detects phones and tablets, including iPadOS posing as a Mac', () => {
    expect(isMobile(desktop)).toBe(false);
    expect(isMobile(mac)).toBe(false);
    expect(isMobile(iphone)).toBe(true);
    expect(isMobile(android)).toBe(true);
    expect(isMobile(ipad)).toBe(true);
    expect(isMobile({ ...desktop, uaMobile: true })).toBe(true);
  });

  it('defaults to Auto, which starts phones and tablets on Low and desktops on High', () => {
    expect(initialQualitySetting(iphone, memory())).toBe('auto');
    expect(initialQualitySetting(desktop, memory())).toBe('auto');
    expect([autoStartTier(iphone), autoStartTier(ipad), autoStartTier(android), autoStartTier(desktop)]).toEqual(['low', 'low', 'low', 'high']);
  });

  it("keeps the user's own choice, Auto included", () => {
    for (const setting of ['low', 'high', 'auto'] as const) {
      const storage = memory();
      saveQuality(setting, storage);
      expect(initialQualitySetting(desktop, storage)).toBe(setting);
    }
    expect(initialQualitySetting(desktop, memory({ 'gse.quality': 'nonsense' }))).toBe('auto');
  });

  it('survives blocked storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(initialQualitySetting(android, blocked)).toBe('auto');
    expect(() => saveQuality('high', blocked)).not.toThrow();
    expect(readAutoMemory(blocked)).toBeNull();
    expect(() => writeAutoMemory({ tier: 'high', version: '2.4.0', at: 0 }, blocked)).not.toThrow();
  });

  it('Low is cheaper on every axis', () => {
    expect(PROFILES.low.pixelRatio).toBeLessThan(PROFILES.high.pixelRatio);
    expect(PROFILES.low.bloom).toBe(false);
    expect([PROFILES.low.baseTier, PROFILES.low.hdTier]).toEqual(['1k', '2k']);
  });
});

describe('Ultra (desktop only)', () => {
  it('a stall is not a frame rate: a tab switch or the switch to Ultra itself does not drop it', () => {
    const guard = new UltraGuard();
    expect(guard.frame(60_000, 'ultra')).toBe(false); // back after a minute in another tab
    expect(guard.frame(3_500, 'ultra')).toBe(false); // MSAA targets and shaders on the first Ultra frame
    for (let i = 0; i < 120; i++) expect(guard.frame(1000 / 60, 'ultra')).toBe(false);
    // Real slow frames still trip it, once.
    let tripped = 0;
    for (let i = 0; i < 200; i++) if (guard.frame(25, 'ultra')) tripped++;
    expect(tripped).toBe(1);
  });

  it('the button cycles Auto → Low → High → Ultra → Auto on desktop; phones and tablets skip Ultra', () => {
    expect(['auto', 'low', 'high', 'ultra'].map((s) => nextQualitySetting(s as 'auto', false))).toEqual(['low', 'high', 'ultra', 'auto']);
    expect(['auto', 'low', 'high', 'ultra'].map((s) => nextQualitySetting(s as 'auto', true))).toEqual(['low', 'high', 'auto', 'auto']);
  });

  it('is never picked by itself, and a saved Ultra never applies on a phone or tablet', () => {
    expect(initialQualitySetting(desktop, memory())).toBe('auto');
    expect(autoStartTier(desktop)).toBe('high');
    expect(initialQualitySetting(desktop, memory({ 'gse.quality': 'ultra' }))).toBe('ultra');
    for (const d of [iphone, ipad, android]) expect(initialQualitySetting(d, memory({ 'gse.quality': 'ultra' }))).toBe('high');
  });

  it('is sharper than High: pixel ratio, MSAA and generated textures; planet textures stay', () => {
    expect(PROFILES.ultra.pixelRatio).toBeGreaterThan(PROFILES.high.pixelRatio);
    expect(PROFILES.ultra.msaa).toBeGreaterThan(PROFILES.high.msaa);
    expect(PROFILES.ultra.kitTexture).toBeGreaterThan(PROFILES.high.kitTexture);
    expect(PROFILES.ultra.hdTier).toBe(PROFILES.high.hdTier);
    expect(PROFILES.low.particles).toBe('few');
  });

  it('gives way to High once if frames stay slow for 3 s; one hitch does nothing; re-arms when chosen again', () => {
    const g = new UltraGuard();
    expect(g.frame(200, 'ultra')).toBe(false); // a hitch
    for (let t = 0; t < 120; t++) expect(g.frame(16, 'ultra')).toBe(false); // smooth again
    let tripped = 0;
    for (let t = 0; t < 200; t++) if (g.frame(25, 'ultra')) tripped++; // 40 fps for 5 s
    expect(tripped).toBe(1);
    for (let t = 0; t < 200; t++) expect(g.frame(25, 'ultra')).toBe(false); // only once
    g.rearm();
    expect(g.frame(25, 'high')).toBe(false); // only ever acts on Ultra
  });
});

describe('auto-quality: the resolution governor', () => {
  const HZ60 = 1000 / 60;
  /** Feed `seconds` of frames whose time comes from `dt` (which may depend on the current scale). */
  function run(g: ResolutionGovernor, seconds: number, dt: (scale: number) => number) {
    const scales: number[] = [];
    for (let t = 0; t < seconds * 1000;) {
      const ms = dt(g.scale);
      if (g.frame(ms)) scales.push(g.scale);
      t += ms;
    }
    return scales;
  }
  /** A GPU-bound scene: frame time grows with the pixels drawn (scale²). 25 ms at full resolution. */
  const gpuBound = (scale: number) => 10 + 15 * scale * scale;

  it('aims for the display refresh it sees, snapped to a real rate, never below 60 Hz', () => {
    for (const [ms, target] of [[1000 / 60, 1000 / 60], [1000 / 120, 1000 / 120], [1000 / 144, 1000 / 144], [1000 / 90 + 0.2, 1000 / 90], [33.3, HZ60]]) {
      const g = new ResolutionGovernor();
      run(g, 1, () => ms);
      expect(g.targetMs).toBeCloseTo(target, 5);
    }
    expect(new ResolutionGovernor().targetMs).toBeNull();
  });

  it('a hitch, a stall or a tab switch never changes anything', () => {
    const g = new ResolutionGovernor();
    run(g, 2, () => HZ60);
    for (const ms of [90, 240, 5000, 0, Number.NaN, -3]) expect(g.frame(ms)).toBe(false);
    run(g, 3, () => HZ60);
    expect(g.scale).toBe(1);
  });

  it('steps down while the GPU is the bottleneck, settles, and does not oscillate', () => {
    const g = new ResolutionGovernor();
    run(g, 1, () => HZ60); // the display: 60 Hz
    const steps = run(g, 60, gpuBound);
    expect(steps).toEqual([0.9, 0.8]); // 25 → 22.2 → 19.6 ms: under 1.3 × 16.7 ms, so it holds there
    expect(g.scale).toBe(0.8);
  });

  it('never goes below its floor', () => {
    const g = new ResolutionGovernor();
    run(g, 1, () => HZ60);
    run(g, 120, (scale) => 30 + 30 * scale * scale); // too slow at any resolution, but each step helps
    expect(g.scale).toBe(0.6);
  });

  it('undoes a step that did not help (CPU-bound frames) and then leaves resolution alone', () => {
    const g = new ResolutionGovernor();
    run(g, 1, () => HZ60);
    expect(run(g, 5, () => 25)).toEqual([0.9, 1]); // tried, no gain, reverted
    expect(run(g, 25, () => 25)).toEqual([]); // cooling down: the tracker or the CPU, not pixels
  });

  it('comes back up to full resolution once frames have headroom again', () => {
    const g = new ResolutionGovernor();
    run(g, 1, () => HZ60);
    run(g, 30, gpuBound);
    expect(g.scale).toBe(0.8);
    const steps = run(g, 40, () => HZ60); // the heavy view is gone
    expect(steps).toEqual([0.9, 1]);
  });

  it('reset (a new tier, a photo) goes back to full resolution', () => {
    const g = new ResolutionGovernor();
    run(g, 1, () => HZ60);
    run(g, 30, gpuBound);
    g.reset();
    expect(g.scale).toBe(1);
  });

  it('renders at the tier cap times the scale, never under 1 on desktop', () => {
    expect(renderPixelRatio(2, PROFILES.high.pixelRatio, 1, false)).toBe(2);
    expect(renderPixelRatio(2, PROFILES.high.pixelRatio, 0.6, false)).toBeCloseTo(1.2);
    expect(renderPixelRatio(3, PROFILES.ultra.pixelRatio, 0.6, false)).toBeCloseTo(1.8);
    expect(renderPixelRatio(1, PROFILES.high.pixelRatio, 0.6, false)).toBe(1); // a 1080p monitor: already 1
    expect(renderPixelRatio(1.25, PROFILES.high.pixelRatio, 0.6, false)).toBe(1);
    expect(renderPixelRatio(3, PROFILES.low.pixelRatio, 0.6, true)).toBeCloseTo(0.6); // phones may go lower
    expect(renderPixelRatio(3, PROFILES.high.pixelRatio, 0.7, true)).toBeCloseTo(1.4);
  });
});

describe('auto-quality: Auto picks the tier (capable phones get High, weak devices stay smooth)', () => {
  const HZ60 = 1000 / 60;
  const VERSION = '2.4.0';
  const DAY = 86_400_000;
  function auto(start: AutoTierChoice, memory: AutoMemory | null = null, now = 100 * DAY) {
    const remembered: AutoMemory[] = [];
    const tier = new AutoTier(start, memory, { version: VERSION, now: () => now, remember: (m) => remembered.push(m) });
    return { tier, remembered };
  }
  /** `seconds` of frames: on time, except every `lateEvery`-th is late (a missed vsync); `cpu` ms each. */
  function run(a: AutoTier, seconds: number, { lateEvery = 0, cpu = 3, canSwitch = true, interval = HZ60 } = {}) {
    const switches: AutoTierChoice[] = [];
    for (let t = 0, n = 0; t < seconds * 1000; n++) {
      const ms = lateEvery && n % lateEvery === 0 ? interval * 2 : interval;
      const next = a.frame(ms, cpu, interval, canSwitch);
      if (next) switches.push(next);
      t += ms;
    }
    return switches;
  }

  it('a phone with headroom on Low tries High, and keeps and remembers it when frames stay on time', () => {
    const { tier, remembered } = auto('low');
    expect(run(tier, 9)).toEqual(['high']); // 3 s to settle, then a 5 s block with headroom
    expect(run(tier, 12)).toEqual([]); // the switch settles, then an 8 s trial with frames on time
    expect(tier.tier).toBe('high');
    expect(remembered).toEqual([{ tier: 'high', version: VERSION, at: 100 * DAY }]);
  });

  it('rolls back to Low when more than ~5% of frames are late, remembers it, and tries no more', () => {
    const { tier, remembered } = auto('low');
    run(tier, 9);
    expect(run(tier, 12, { lateEvery: 10 })).toEqual(['low']); // 10% late on trial
    expect(remembered.at(-1)?.tier).toBe('low');
    expect(run(tier, 60)).toEqual([]); // plenty of headroom on Low, but this device already failed High
    expect(tier.tier).toBe('low');
  });

  it('draws the line at about 5% late frames', () => {
    for (const [lateEvery, kept] of [[25, true], [16, false]] as const) { // 4% vs 6.25% late
      const { tier } = auto('low');
      run(tier, 9);
      run(tier, 12, { lateEvery });
      expect(tier.tier, `1 in ${lateEvery} late`).toBe(kept ? 'high' : 'low');
    }
  });

  it('measures late frames against the display it is on (a 120 Hz phone)', () => {
    const { tier } = auto('low');
    expect(run(tier, 9, { interval: 1000 / 120, cpu: 2 })).toEqual(['high']);
    // 60 fps is on time at 60 Hz, but on a 120 Hz screen every frame missed a vsync: back to Low.
    const switches: AutoTierChoice[] = [];
    for (let t = 0; t < 12_000; t += HZ60) { const next = tier.frame(HZ60, 2, 1000 / 120, true); if (next) switches.push(next); }
    expect(switches).toEqual(['low']);
  });

  it('needs real headroom to try High: frames on time and spare CPU', () => {
    expect(run(auto('low').tier, 30, { lateEvery: 30 })).toEqual([]); // 3% late on Low already
    expect(run(auto('low').tier, 30, { cpu: 10 })).toEqual([]); // the app's own work takes over half a frame
  });

  it('only switches when the app says it may (SolarView, Focus, an idle BaseView)', () => {
    const { tier } = auto('low');
    expect(run(tier, 30, { canSwitch: false })).toEqual([]); // decided, but mid-landing: it waits
    expect(tier.tier).toBe('low');
    expect(run(tier, 0.05)).toEqual(['high']); // the first idle frame
  });

  it('watches High on any device: a weak desktop gives way to Low', () => {
    const { tier, remembered } = auto('high');
    expect(run(tier, 14, { lateEvery: 8 })).toEqual(['low']); // 3 s settle + a 10 s block, 12.5% late
    expect(remembered.at(-1)?.tier).toBe('low');
  });

  it('remembers per device and app version, for 14 days', () => {
    const at = 100 * DAY;
    expect(auto('low', { tier: 'high', version: VERSION, at }).tier.tier).toBe('high'); // learned: start on High
    const failed = auto('low', { tier: 'low', version: VERSION, at }).tier;
    expect(run(failed, 60)).toEqual([]); // learned Low: no trial this time
    expect(run(auto('low', { tier: 'low', version: '2.3.1', at }).tier, 9)).toEqual(['high']); // a new version learns again
    expect(run(auto('low', { tier: 'low', version: VERSION, at: at - 15 * DAY }).tier, 9)).toEqual(['high']); // and so does an old memory
    const storage = new Map<string, string>();
    const store = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) };
    writeAutoMemory({ tier: 'high', version: VERSION, at }, store);
    expect(readAutoMemory(store)).toEqual({ tier: 'high', version: VERSION, at });
    storage.set('gse.autoTier', '{"tier":"ultra","version":"2.4.0","at":1}');
    expect(readAutoMemory(store)).toBeNull(); // Auto never holds Ultra
    storage.set('gse.autoTier', 'not json');
    expect(readAutoMemory(store)).toBeNull();
  });

  it('a switch’s own load stall and settling frames are not held against the new tier', () => {
    const { tier } = auto('low');
    let next: AutoTierChoice | null = null;
    while (!next) next = tier.frame(HZ60, 3, HZ60, true); // up to the very frame it switches
    expect(next).toBe('high');
    expect(tier.frame(2_000, 3, HZ60, true)).toBeNull(); // the tier change's texture and shader stall
    for (let t = 0; t < 2_900; t += 40) tier.frame(40, 3, HZ60, true); // slow while it settles
    expect(run(tier, 12)).toEqual([]);
    expect(tier.tier).toBe('high');
  });

  it('never picks Ultra', () => {
    const { tier } = auto('high');
    const seen = new Set([...run(tier, 30), ...run(tier, 30, { lateEvery: 5 }), ...run(tier, 30)]);
    for (const t of seen) expect(['low', 'high']).toContain(t);
    expect(['low', 'high']).toContain(tier.tier);
  });
});
