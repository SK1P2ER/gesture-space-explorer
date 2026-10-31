import type { TextureTier } from './data/bodies';

export type Quality = 'low' | 'high' | 'ultra';

export interface QualityProfile {
  /** Cap on devicePixelRatio. */
  pixelRatio: number;
  bloom: boolean;
  /** Textures every body loads up front… */
  baseTier: TextureTier;
  /** …and what the focused body switches to up close. */
  hdTier: TextureTier;
  /** Rocks drawn in the asteroid belt and the Kuiper belt (one draw call each). */
  asteroids: number;
  kuiper: number;
  /** The Milky Way behind everything: always on screen, so the one exception to 4K-only-up-close. */
  skyTier: TextureTier;
  /** MSAA samples through the bloom pipeline (clamped to what the GPU allows). */
  msaa: number;
  /** Size of the textures generated in code (rocket panels, base modules), px. */
  kitTexture: number;
  /** Particle effects (dust, flame layers): a reduced set, or all of it. */
  particles: 'few' | 'full';
}

export const PROFILES: Record<Quality, QualityProfile> = {
  low: { pixelRatio: 1, bloom: false, baseTier: '1k', hdTier: '2k', asteroids: 1500, kuiper: 400, skyTier: '2k', msaa: 0, kitTexture: 256, particles: 'few' },
  high: { pixelRatio: 2, bloom: true, baseTier: '2k', hdTier: '4k', asteroids: 6000, kuiper: 1500, skyTier: '4k', msaa: 4, kitTexture: 512, particles: 'full' },
  // Desktop only, never picked by itself: sharp on 4K screens (pixel ratio up to 3), 8× MSAA, bigger generated textures.
  // Planet textures stay as High: NASA's 4K maps are the top.
  ultra: { pixelRatio: 3, bloom: true, baseTier: '2k', hdTier: '4k', asteroids: 6000, kuiper: 1500, skyTier: '4k', msaa: 8, kitTexture: 1024, particles: 'full' },
};

/** What the Quality button sets: a fixed tier, or Auto (AutoTier picks Low or High for this device). */
export type QualitySetting = 'auto' | Quality;

/** The Quality button: Auto → Low → High → Ultra → Auto on desktop; phones and tablets skip Ultra. */
export function nextQualitySetting(current: QualitySetting, mobile: boolean): QualitySetting {
  const cycle: QualitySetting[] = mobile ? ['auto', 'low', 'high'] : ['auto', 'low', 'high', 'ultra'];
  return cycle[(cycle.indexOf(current) + 1) % cycle.length]; // Ultra on a phone (not in its cycle) → Auto
}

/**
 * Ultra is a promise of smoothness too: if frames keep missing 60 fps (over ~18 ms on
 * average for 3 s), drop to High once. Pure: feed it frame times, it says when.
 */
export class UltraGuard {
  private slowFor = 0;
  private tripped = false;

  constructor(private readonly limitMs = 18, private readonly forSeconds = 3) {}

  /** @returns true once, when Ultra should give way to High */
  frame(dtMs: number, quality: Quality): boolean {
    if (quality !== 'ultra' || this.tripped) {
      this.slowFor = 0;
      return false;
    }
    // A stall is not a frame rate: a tab switch (the first frame back spans the whole absence) or
    // switching to Ultra itself (new MSAA targets, shaders) once counted as seconds of slow frames.
    if (dtMs > 250) return false;
    // A slow average, not one hitch: ease toward the latest frame time.
    this.slowFor = dtMs > this.limitMs ? this.slowFor + dtMs / 1000 : Math.max(0, this.slowFor - dtMs / 1000);
    if (this.slowFor < this.forSeconds) return false;
    this.tripped = true;
    return true;
  }

  /** Choosing Ultra again re-arms it. */
  rearm() {
    this.tripped = false;
    this.slowFor = 0;
  }
}

/**
 * Display refresh intervals (ms) the governor's target snaps to: 240 Hz down to 60 Hz. Never
 * slower: frames that were slow from the start look the same as a slow display, so a device
 * that never once reached 60 fps still aims for 60, not for whatever it managed.
 */
const REFRESH_MS = [240, 165, 144, 120, 90, 75, 60].map((hz) => 1000 / hz);

export interface GovernorOptions {
  /** The lowest scale of the tier's pixel ratio it goes to. */
  minScale: number;
  step: number;
  /** Slow: frames over this many times the display's interval, for `slowSeconds` (net). */
  slowFactor: number;
  slowSeconds: number;
  /** Fast: frames under this many times the interval, for `fastSeconds` in a row. */
  fastFactor: number;
  fastSeconds: number;
  /** No step up this soon after any step. */
  holdSeconds: number;
  /** A step down that bought less than this (fraction of frame time) is undone… */
  minGain: number;
  /** …and resolution is left alone this long: the frames are slow for another reason (CPU, the tracker). */
  cooldownSeconds: number;
}

const GOVERNOR: GovernorOptions = {
  minScale: 0.6, step: 0.1, slowFactor: 1.3, slowSeconds: 2, fastFactor: 1.1, fastSeconds: 5,
  holdSeconds: 8, minGain: 0.05, cooldownSeconds: 30,
};

/**
 * Auto-quality (v2.4): holds the display's own frame rate by scaling the render resolution under
 * the chosen tier's pixel-ratio cap. Resolution only: no shader, texture or effect changes, so a
 * step never stalls. The target is the fastest steady frame interval seen, snapped to a real
 * refresh rate (60, 90, 120 Hz…). One hitch changes nothing; a step down that doesn't help is
 * undone. Pure: feed it frame times.
 */
export class ResolutionGovernor {
  /** The fraction of the tier's pixel ratio to render at, minScale … 1. */
  scale = 1;
  private readonly o: GovernorOptions;
  private recent: number[] = [];
  private bestMs = Infinity;
  private seconds = 0;
  private slowFor = 0;
  private fastFor = 0;
  private holdUntil = 0;
  private cooldownUntil = 0;
  private averageMs = 0;
  /** The last step down, until it has had time to show whether it helped. */
  private trial: { at: number; beforeMs: number } | null = null;

  constructor(options: Partial<GovernorOptions> = {}) {
    this.o = { ...GOVERNOR, ...options };
  }

  /** The frame interval it aims for, once known (ms). */
  get targetMs(): number | null {
    if (this.bestMs === Infinity) return null;
    return REFRESH_MS.find((ms) => ms >= this.bestMs * 0.97) ?? REFRESH_MS.at(-1)!; // 60 Hz at the slowest
  }

  /** @returns true when the scale changed (apply it: renderer.setPixelRatio and resize) */
  frame(dtMs: number): boolean {
    if (!(dtMs > 0) || dtMs > 250) return false; // a tab switch or a load stall, not a frame rate
    const { o } = this;
    this.seconds += dtMs / 1000;
    this.averageMs = this.averageMs ? this.averageMs + (dtMs - this.averageMs) * 0.05 : dtMs;
    this.recent.push(dtMs);
    if (this.recent.length > 8) this.recent.shift();
    if (this.recent.length === 8) this.bestMs = Math.min(this.bestMs, median(this.recent));
    const target = this.targetMs;
    if (target === null || this.seconds < 1) return false;

    if (this.trial && this.seconds - this.trial.at >= o.slowSeconds) {
      const gain = 1 - this.averageMs / this.trial.beforeMs;
      this.trial = null;
      if (gain < o.minGain) {
        this.cooldownUntil = this.seconds + o.cooldownSeconds;
        return this.set(this.scale + o.step);
      }
    }

    this.slowFor = dtMs > target * o.slowFactor ? this.slowFor + dtMs / 1000 : Math.max(0, this.slowFor - dtMs / 1000);
    this.fastFor = dtMs <= target * o.fastFactor ? this.fastFor + dtMs / 1000 : 0;
    if (this.slowFor >= o.slowSeconds && this.scale > o.minScale && this.seconds >= this.cooldownUntil && !this.trial) {
      this.trial = { at: this.seconds, beforeMs: this.averageMs };
      return this.set(this.scale - o.step);
    }
    if (this.fastFor >= o.fastSeconds && this.scale < 1 && this.seconds >= this.holdUntil) return this.set(this.scale + o.step);
    return false;
  }

  /** A new tier (or a photo, which wants every pixel): full resolution, and start measuring afresh. */
  reset() {
    this.scale = 1;
    this.slowFor = this.fastFor = 0;
    this.trial = null;
    this.holdUntil = this.cooldownUntil = this.seconds;
  }

  private set(scale: number): boolean {
    const next = Math.round(Math.min(1, Math.max(this.o.minScale, scale)) * 100) / 100;
    this.slowFor = this.fastFor = 0;
    this.holdUntil = this.seconds + this.o.holdSeconds;
    if (next === this.scale) return false;
    this.scale = next;
    return true;
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
}

/**
 * The pixel ratio to render at: the device's, capped by the tier, times the governor's scale.
 * On desktop it never drops below 1 (a monitor's own pixels stay sharp); phones may go lower.
 */
export function renderPixelRatio(devicePixelRatio: number, tierCap: number, scale: number, mobile: boolean): number {
  const full = Math.min(devicePixelRatio, tierCap);
  const scaled = full * scale;
  return mobile ? scaled : Math.max(Math.min(full, 1), scaled);
}

/** The tiers Auto picks between. Never Ultra: that is only ever a desktop user's own choice. */
export type AutoTierChoice = 'low' | 'high';

/** What a device learned in Auto, kept per browser: its tier, for this app version, and when. */
export interface AutoMemory {
  tier: AutoTierChoice;
  version: string;
  at: number;
}

export interface AutoTierOptions {
  /** Late: a frame over this many display intervals (it missed a vsync). */
  lateFactor: number;
  /** Low: a block this long with at most `headroomLate` late frames and the app's own CPU time
   * under `headroomCpu` of the interval is headroom, and High is tried. */
  headroomSeconds: number;
  headroomLate: number;
  headroomCpu: number;
  /** After any switch: textures load and shaders compile; those frames aren't the tier's. */
  settleSeconds: number;
  /** High on trial: judged over this long; more than `rollbackLate` late frames and it's back to Low. */
  trialSeconds: number;
  rollbackLate: number;
  /** High, settled: judged in blocks this long, with the same limit. */
  watchSeconds: number;
  /** A memory older than this (or from another app version) is learned again. */
  memoryDays: number;
}

const AUTO_TIER: AutoTierOptions = {
  lateFactor: 1.5, headroomSeconds: 5, headroomLate: 0.01, headroomCpu: 0.5,
  settleSeconds: 3, trialSeconds: 8, rollbackLate: 0.05, watchSeconds: 10, memoryDays: 14,
};

type AutoPhase = 'low' | 'trial' | 'high';

/**
 * Auto quality's tier (v2.4). The goal: capable phones get High (the v2.2/v2.3 visuals) without
 * anyone choosing it, and weak devices stay smooth. Phones start on Low; when Low has headroom,
 * High is tried and kept unless more than ~5% of frames are late; High keeps being watched the
 * same way and gives way to Low if the device can't hold it. Whatever it learns is remembered for
 * the device (per app version), so a phone that failed isn't tried again on every visit. Never
 * Ultra. A switch is only made when the app says it may (SolarView, Focus, an idle BaseView), so a
 * decision reached during a landing waits until it's over. Resolution scaling (ResolutionGovernor)
 * works inside whichever tier this picks. Pure: feed it frames.
 */
export class AutoTier {
  tier: AutoTierChoice;
  private phase: AutoPhase;
  /** Low with no more trials: this device already failed High (for this version). */
  private lockedLow: boolean;
  private readonly o: AutoTierOptions;
  private seconds = 0;
  private settleUntil = 0;
  private block = { seconds: 0, frames: 0, late: 0, cpu: [] as number[] };
  private pending: AutoTierChoice | null = null;
  /** The last finished block's late fraction, for ?debug. */
  lastLate: number | null = null;

  constructor(
    start: AutoTierChoice,
    memory: AutoMemory | null,
    private readonly context: { version: string; now: () => number; remember: (memory: AutoMemory) => void },
    options: Partial<AutoTierOptions> = {},
  ) {
    this.o = { ...AUTO_TIER, ...options };
    const fresh = memory && memory.version === context.version && context.now() - memory.at < this.o.memoryDays * 86_400_000;
    this.tier = fresh ? memory.tier : start;
    this.lockedLow = !!fresh && memory.tier === 'low';
    this.phase = this.tier === 'high' ? 'high' : 'low';
    this.settleUntil = this.o.settleSeconds;
  }

  /**
   * @param intervalMs the display's frame interval (ResolutionGovernor.targetMs), once known
   * @param canSwitch whether a tier change may happen now
   * @returns the tier to switch to now, if any
   */
  frame(dtMs: number, cpuMs: number, intervalMs: number | null, canSwitch: boolean): AutoTierChoice | null {
    if (!(dtMs > 0) || dtMs > 250) return null; // a tab switch or a load stall, not a frame rate
    this.seconds += dtMs / 1000;
    if (this.pending) return canSwitch ? this.switchTo(this.pending) : null;
    if (intervalMs === null || this.seconds < this.settleUntil) return null;

    const b = this.block;
    b.seconds += dtMs / 1000;
    b.frames++;
    if (dtMs > intervalMs * this.o.lateFactor) b.late++;
    b.cpu.push(cpuMs);
    const length = this.phase === 'low' ? this.o.headroomSeconds : this.phase === 'trial' ? this.o.trialSeconds : this.o.watchSeconds;
    if (b.seconds < length) return null;

    const late = b.late / b.frames;
    const cpu = median(b.cpu);
    this.lastLate = late;
    this.block = { seconds: 0, frames: 0, late: 0, cpu: [] };
    let decision: AutoTierChoice | null = null;
    if (this.phase === 'low') {
      if (!this.lockedLow && late <= this.o.headroomLate && cpu < intervalMs * this.o.headroomCpu) decision = 'high';
    } else if (late > this.o.rollbackLate) {
      this.lockedLow = true;
      this.remember('low');
      decision = 'low';
    } else if (this.phase === 'trial') {
      this.phase = 'high';
      this.remember('high'); // kept: this device holds High
    }
    if (!decision) return null;
    this.pending = decision;
    return canSwitch ? this.switchTo(decision) : null;
  }

  /** For ?debug: where Auto is and how late the last judged frames were. */
  describe(): string {
    const state = this.pending ? `→ ${this.pending} when idle` : this.phase === 'trial' ? 'trying High' : this.lockedLow ? 'stays Low' : this.phase === 'low' ? 'watching for headroom' : 'holding High';
    return `${this.tier} · ${state}${this.lastLate === null ? '' : ` · ${(this.lastLate * 100).toFixed(1)}% late`}`;
  }

  private switchTo(tier: AutoTierChoice): AutoTierChoice {
    this.pending = null;
    this.tier = tier;
    this.phase = tier === 'low' ? 'low' : 'trial';
    this.settleUntil = this.seconds + this.o.settleSeconds;
    this.block = { seconds: 0, frames: 0, late: 0, cpu: [] };
    return tier;
  }

  private remember(tier: AutoTierChoice) {
    this.context.remember({ tier, version: this.context.version, at: this.context.now() });
  }
}

export interface DeviceInfo {
  userAgent: string;
  maxTouchPoints: number;
  /** navigator.userAgentData?.mobile, where supported. */
  uaMobile?: boolean;
}

/** Phones and tablets: GPU and memory budgets are much smaller, and the hand tracker shares them. */
export function isMobile({ userAgent, maxTouchPoints, uaMobile }: DeviceInfo): boolean {
  if (uaMobile) return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1; // iPadOS reports itself as a Mac
}

const STORAGE_KEY = 'gse.quality';
const AUTO_KEY = 'gse.autoTier';

/**
 * The user's saved choice, else Auto. A saved tier only ever came from the Quality button (or
 * Ultra stepping back to High), so it stays a fixed choice; Auto is for everyone who never chose.
 */
export function initialQualitySetting(device: DeviceInfo, storage: Pick<Storage, 'getItem'> | null): QualitySetting {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (saved === 'auto' || saved === 'low' || saved === 'high') return saved;
    if (saved === 'ultra') return isMobile(device) ? 'high' : 'ultra'; // never Ultra on phones and tablets
  } catch {
    // storage blocked (private mode, sandboxed iframe): fall through to the default
  }
  return 'auto';
}

/** The tier Auto starts a device on before it has learned anything: Low on phones and tablets, High elsewhere. */
export const autoStartTier = (device: DeviceInfo): AutoTierChoice => (isMobile(device) ? 'low' : 'high');

export function saveQuality(setting: QualitySetting, storage: Pick<Storage, 'setItem'> | null) {
  try {
    storage?.setItem(STORAGE_KEY, setting);
  } catch {
    // not persisted; the choice still applies for this visit
  }
}

export function readAutoMemory(storage: Pick<Storage, 'getItem'> | null): AutoMemory | null {
  try {
    const m = JSON.parse(storage?.getItem(AUTO_KEY) ?? 'null') as Partial<AutoMemory> | null;
    return m && (m.tier === 'low' || m.tier === 'high') && typeof m.version === 'string' && Number.isFinite(m.at)
      ? { tier: m.tier, version: m.version, at: m.at! } : null;
  } catch {
    return null;
  }
}

export function writeAutoMemory(memory: AutoMemory, storage: Pick<Storage, 'setItem'> | null) {
  try {
    storage?.setItem(AUTO_KEY, JSON.stringify(memory));
  } catch {
    // not persisted: this device learns again next visit
  }
}

export function currentDevice(): DeviceInfo {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return { userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints ?? 0, uaMobile: nav.userAgentData?.mobile };
}

export function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
