/** Ephemeral visual state only; Mission remains the authority for navigation/landing. */
export type OperationalState = 'standby' | 'active' | 'landing' | 'maintenance';
// Existing .05 pivot, .06 half-width and .003 half-thickness: leave room for
// the terrain patch's .004 lift + conservative .012 bump envelope.
export const SOLAR_LIMIT = 0.5;
export const DISH_LIMIT = 0.12;
export const DOOR_LIMIT = Math.PI / 2;

export const STATUS = {
  standby: { brightness: 0.65, beacon: 0x596b76, guidance: 0xc5d4dd },
  active: { brightness: 1, beacon: 0x86cda6, guidance: 0xffe5af },
  landing: { brightness: 1.1, beacon: 0xffcf88, guidance: 0xffcf88 },
  maintenance: { brightness: 0.85, beacon: 0x99b9dc, guidance: 0x99b9dc },
} as const;

const approach = (value: number, target: number, distance: number) =>
  value + Math.max(-distance, Math.min(distance, target - value));

/** No RAF, timers, GPU resources or callbacks. Owned and retired by one Showcases entry. */
export class MarsBaseOperationsController {
  state: OperationalState = 'standby';
  doorAngle = 0;
  solarAngle = 0;
  dishAngle = 0;
  private elapsed = 0;
  private disposed = false;

  constructor(readonly movingParts: boolean, readonly tracking: boolean) {}

  update(dt: number, state: OperationalState, paused: boolean, reducedMotion: boolean,
    sunX: number, sunY: number, night: number) {
    if (this.disposed) return;
    this.state = state;
    const door = this.movingParts && (state === 'active' || state === 'maintenance') ? DOOR_LIMIT : 0;
    if (reducedMotion) {
      // Stable poses, including when the preference changes during a movement.
      this.doorAngle = door;
      this.solarAngle = this.dishAngle = 0;
      return;
    }
    if (paused) return;
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    const solar = this.tracking && night < 1 && sunY > 0
      ? Math.max(-SOLAR_LIMIT, Math.min(SOLAR_LIMIT, Math.atan2(sunX, sunY))) : 0;
    this.elapsed += step;
    this.doorAngle = approach(this.doorAngle, door, step * 0.55);
    this.solarAngle = approach(this.solarAngle, solar, step * 0.05);
    const dish = this.movingParts && state === 'active' ? Math.sin(this.elapsed * 0.08) * DISH_LIMIT : 0;
    this.dishAngle = approach(this.dishAngle, dish, step * 0.02);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.state = 'standby';
    this.doorAngle = this.solarAngle = this.dishAngle = this.elapsed = 0;
  }
}
