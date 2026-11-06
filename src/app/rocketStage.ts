import * as THREE from 'three';
import { Rocket, type RocketOptions } from '../scene/rocketKit';
import type { Atmosphere } from '../data/atmosphere';
import { setBaseLayer } from '../scene/baseKit/baseLighting';
import { DUST_PUFFS, PadDust, type PadFrame } from '../scene/padDust';

export interface RocketStageDeps {
  scene: THREE.Scene;
  /** How to build the rocket: texture size and detail from the quality setting. */
  rocketOptions: () => RocketOptions;
  reducedMotion: () => boolean;
}

/**
 * The rocket on stage (v2.2), with its pad dust: built the first time it's needed, at the quality
 * then in effect; rebuilt when the quality changes; freed when there's nothing to show it in.
 * Whether it is a full stack or the lander alone outlives any one build.
 */
export class RocketStage {
  private kit: { rocket: Rocket; key: string; dust: PadDust; layers?: string } | null = null;
  private stackedNow = true;
  private night = 0;

  constructor(private readonly d: RocketStageDeps) {}

  /** A full stack (booster attached), or the lander alone after a separation. */
  get stacked() {
    return this.stackedNow;
  }

  /** The rocket (built on first use). */
  get rocket(): Rocket {
    if (!this.kit) this.build();
    return this.kit!.rocket;
  }

  /** The rocket's scene object (built on first use). */
  get group(): THREE.Group {
    return this.rocket.group;
  }

  private build() {
    const opts = this.d.rocketOptions();
    const key = JSON.stringify(opts);
    const rocket = new Rocket(opts);
    if (!this.stackedNow) rocket.separate(true); // the booster is long gone: a lander
    const dust = new PadDust(opts.detail === 'low' ? DUST_PUFFS.few : DUST_PUFFS.full);
    this.d.scene.add(rocket.group, dust.mesh);
    this.kit = { rocket, key, dust };
  }

  /** Nothing to show it in: free it (rebuilt when needed). */
  free() {
    this.kit?.rocket.dispose();
    this.kit?.dust.dispose();
    this.kit = null;
  }

  /**
   * Once a frame while it's shown: rebuilt if the quality changed (the options are compared here, not
   * on every read), animated, and put in the base pass or with the planets (with its dust).
   */
  show(dt: number, layers: { onBase: boolean; dustOnBase: boolean; shadows: boolean }) {
    if (this.kit && this.kit.key !== JSON.stringify(this.d.rocketOptions())) this.free();
    this.group.visible = true;
    const kit = this.kit!;
    kit.rocket.update(dt);
    const key = `${layers.onBase}|${layers.dustOnBase}|${layers.shadows}|${this.stackedNow}`;
    if (kit.layers !== key) {
      setBaseLayer(kit.rocket.group, layers.onBase);
      kit.rocket.setShadows(layers.onBase && layers.shadows);
      setBaseLayer(kit.dust.mesh, layers.dustOnBase);
      kit.layers = key;
    }
  }

  /** Windows glow after dark; sunlit paint and dust dim. */
  setNight(night: number, onBaseLayer: boolean) {
    this.night = night;
    this.kit?.rocket.setNight(night, onBaseLayer);
  }

  /** The rocket and its dust, as scene branches (the base pass draws only what it needs). */
  roots(): THREE.Object3D[] {
    return this.kit ? [this.kit.rocket.group, this.kit.dust.mesh] : [];
  }

  /** The rocket's numbers, if it exists (for tests and the budget). */
  stats() {
    return this.kit?.rocket.stats() ?? null;
  }

  /** Engines at this level, in this air (whichever stage is firing; steady with reduced motion). */
  thrust(level: number, seconds: number, air: Atmosphere) {
    this.kit?.rocket.setThrust(level, seconds, air, this.d.reducedMotion());
  }

  legs(deploy: number) {
    this.kit?.rocket.setLegs(deploy);
  }

  /** Refueled at a base: a full stack again. */
  restack() {
    this.stackedNow = true;
    this.kit?.rocket.restack();
  }

  /** Booster separation: the upper stage flies on as the lander. */
  separate() {
    this.stackedNow = false;
    this.rocket.separate(this.d.reducedMotion());
  }

  /** The pad dust this frame: how much the engines blow onto which pad, and its look there. */
  dust(dt: number, pad: PadFrame | null, camera: THREE.Camera, emit: number, amount: number, color: number) {
    this.kit!.dust.update(dt, pad, camera, emit, amount, color, this.night);
  }
}
