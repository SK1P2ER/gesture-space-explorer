// The Quality setting and the tier in effect (quality.ts has the pure parts). v2.4 auto-quality:
// under the tier's pixel-ratio cap, render resolution follows the frame rate (ResolutionGovernor);
// texture detail is chosen for the full ratio, so a step never loads or drops a texture. Auto
// (AutoTier) gives capable devices High and keeps weak ones on Low, learned per device.
import {
  AutoTier, autoStartTier, isMobile, nextQualitySetting, PROFILES, readAutoMemory, renderPixelRatio, ResolutionGovernor,
  saveQuality, UltraGuard, writeAutoMemory, type DeviceInfo, type QualityProfile, type QualitySetting, type QualityTier,
} from '../quality';
import type { AppState } from './state';

export interface QualityControlDeps {
  state: Pick<AppState, 'qualitySetting' | 'qualityTier'>;
  device: DeviceInfo;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  version: string;
  now: () => number;
  devicePixelRatio: () => number;
  /** Puts a tier into effect in the renderer and the scene, resizing for its pixel ratio. */
  applyTier: (tier: QualityTier) => void;
  /** The render resolution changed: apply pixelRatio() and resize. */
  resize: () => void;
}

export class QualityControl {
  readonly governor = new ResolutionGovernor();
  readonly mobile: boolean;
  autoTier: AutoTier | null;
  private readonly ultraGuard = new UltraGuard();
  /** The previous frame's own CPU time, for Auto's headroom check. */
  private cpuMs = 0;
  private prewarmPending = false;

  constructor(private readonly d: QualityControlDeps) {
    this.mobile = isMobile(d.device);
    this.autoTier = d.state.qualitySetting === 'auto' ? this.newAutoTier() : null;
    if (this.autoTier) d.state.qualityTier = this.autoTier.tier; // what this device learned on an earlier visit
  }

  get profile(): QualityProfile {
    return PROFILES[this.d.state.qualityTier];
  }

  /** The pixel ratio the tier allows (texture detail is chosen for it). */
  fullPixelRatio() {
    return Math.min(this.d.devicePixelRatio(), this.profile.pixelRatio);
  }

  /** The pixel ratio rendered at: the tier's, scaled by the governor. */
  pixelRatio() {
    return renderPixelRatio(this.d.devicePixelRatio(), this.profile.pixelRatio, this.governor.scale, this.mobile);
  }

  /** The Quality button: Auto → Low → High → Ultra → Auto on desktop; phones and tablets skip Ultra. */
  cycleSetting() {
    this.setSetting(nextQualitySetting(this.d.state.qualitySetting, this.mobile));
  }

  /** The Quality button (and Ultra giving way to High): a fixed tier, or Auto. */
  setSetting(setting: QualitySetting) {
    this.d.state.qualitySetting = setting;
    saveQuality(setting, this.d.storage);
    this.autoTier = setting === 'auto' ? this.newAutoTier() : null;
    this.setTier(this.autoTier ? this.autoTier.tier : (setting as QualityTier));
  }

  /** The tier in effect, from the setting or from Auto. */
  setTier(tier: QualityTier) {
    this.d.state.qualityTier = tier;
    if (tier === 'ultra') this.ultraGuard.rearm();
    this.governor.reset(); // a new tier starts at its full resolution
    this.d.applyTier(tier);
    this.prewarmPending = true; // compile only after this frame replaces retired scene owners
  }

  /**
   * First thing each frame: Ultra's guard, the render resolution, Auto. Auto changes tier only when
   * `canSwitch` says a rebuild can't interrupt anything.
   * @returns true when Ultra just gave way to High (tell the visitor)
   */
  frame(dtMs: number, canSwitch: () => boolean): boolean {
    const ultraGaveWay = this.ultraGuard.frame(dtMs, this.d.state.qualityTier);
    if (ultraGaveWay) this.setSetting('high');
    if (this.governor.frame(dtMs)) this.d.resize();
    const autoSwitch = this.autoTier?.frame(dtMs, this.cpuMs, this.governor.targetMs, canSwitch());
    if (autoSwitch && autoSwitch !== this.d.state.qualityTier) this.setTier(autoSwitch);
    return ultraGaveWay;
  }

  /** A photo gets every pixel the tier allows; resolution scaling measures afresh afterwards. */
  fullResolution() {
    if (this.governor.scale >= 1) return;
    this.governor.reset();
    this.d.resize();
  }

  /** Compile the shaders the other tiers need, once the scene allows (after startup, while idle). */
  requestPrewarm() {
    this.prewarmPending = true;
  }

  /**
   * Whether to warm up shaders now. Optional warm-up must not retain programs of replaceable base
   * or mission owners, so it waits for `canPrewarm` (the persistent scene); rapid tier changes
   * coalesce into one.
   */
  takePrewarm(canPrewarm: boolean): boolean {
    if (!this.prewarmPending || !canPrewarm) return false;
    this.prewarmPending = false;
    return true;
  }

  /** Last thing each frame: its own CPU time, for Auto's headroom check on the next. */
  endFrame(cpuMs: number) {
    this.cpuMs = cpuMs;
  }

  /** For ?debug: the render scale, the pixel ratio in use and the frame rate held. */
  describeResolution(rendererPixelRatio: number): string {
    const target = this.governor.targetMs;
    return `${Math.round(this.governor.scale * 100)}% · ${rendererPixelRatio.toFixed(2)}x · holds ${target ? Math.round(1000 / target) : '—'} fps`;
  }

  /** For ?debug: the setting, and in Auto what it has learned. */
  describeTier(): string {
    return this.autoTier ? `Auto: ${this.autoTier.describe()}` : `${this.d.state.qualitySetting} (fixed)`;
  }

  private newAutoTier() {
    const { device, storage, version, now } = this.d;
    return new AutoTier(autoStartTier(device), readAutoMemory(storage), { version, now, remember: (m) => writeAutoMemory(m, storage) });
  }
}
