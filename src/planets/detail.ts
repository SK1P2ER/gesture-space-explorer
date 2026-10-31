// Level-of-detail decisions, kept free of three.js so they can be unit-tested.

/**
 * Sphere detail level for a body: 0 = 128 segments, 1 = 64, 2 = 32.
 * @param radiusPx the body's radius on screen, in CSS pixels
 */
export function detailFor(radiusPx: number, focused: boolean): number {
  if (focused || radiusPx >= 120) return 0; // smooth silhouette up close
  if (radiusPx >= 16) return 1;
  return 2; // a few pixels wide: nobody can tell
}

export interface HdSwitchConfig {
  /** Switch up once the disk is this wide in device pixels… */
  onPx: number;
  /** …and back once it is narrower than this. */
  offPx: number;
  /** Seconds the condition must hold first, so zooming past doesn't trigger a download. */
  onDelay: number;
  offDelay: number;
}

/**
 * Thresholds for a base map `texels` wide: it covers the visible half of the
 * sphere, so ~texels/π of them span the disk — beyond that it's magnified.
 * (2K: switch at ~650 px; 1K on Low quality: ~325 px.)
 */
export function hdSwitchConfig(texels: number): HdSwitchConfig {
  const onPx = texels / Math.PI;
  return { onPx, offPx: onPx * 0.7, onDelay: 0.4, offDelay: 1.5 };
}

/** Decides when the focused body should show its up-close textures, with hysteresis so it doesn't flicker. */
export class HdSwitch {
  wanted = false;
  private timer = 0;

  constructor(private cfg: HdSwitchConfig) {}

  /** New thresholds (after a quality change); starts over from "not wanted". */
  reset(cfg: HdSwitchConfig) {
    this.cfg = cfg;
    this.wanted = false;
    this.timer = 0;
  }

  /**
   * @param diameterPx the body's diameter on screen, in device pixels
   * @returns true when `wanted` changed
   */
  update(dt: number, eligible: boolean, diameterPx: number): boolean {
    if (!eligible) {
      // Leaving a planet releases its 4K textures right away.
      const changed = this.wanted;
      this.wanted = false;
      this.timer = 0;
      return changed;
    }
    const want = diameterPx > (this.wanted ? this.cfg.offPx : this.cfg.onPx);
    if (want === this.wanted) {
      this.timer = 0;
      return false;
    }
    this.timer += dt;
    if (this.timer < (want ? this.cfg.onDelay : this.cfg.offDelay)) return false;
    this.wanted = want;
    this.timer = 0;
    return true;
  }
}
