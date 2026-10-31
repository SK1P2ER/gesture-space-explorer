import type { Vec2 } from './perception';

// Landing: the palm's position on the camera image steers the rocket. A layer on
// top of the gesture engine's observation (the engine itself is unchanged).

/** Hand-steering sensitivity levels (the setting cycles through them): how much of the camera view spans the full range. */
export const STEER_SENSITIVITY = { low: 0.6, normal: 1, high: 1.6 } as const;
export type SteerSensitivity = keyof typeof STEER_SENSITIVITY;
export const SENSITIVITY_ORDER: readonly SteerSensitivity[] = ['low', 'normal', 'high'];

/** At normal sensitivity, the middle 60% of the view spans −1 … 1. */
const HALF_SPAN = 0.3;

/**
 * The palm's center (perception's units: 0 … 1 across the view, mirrored like a
 * mirror) → steering, −1 … 1 each way (x: screen right, y: screen down).
 */
export function steerFromPalm(center: Vec2, sensitivity: SteerSensitivity): { x: number; y: number } {
  const span = HALF_SPAN / STEER_SENSITIVITY[sensitivity];
  const c = (v: number) => Math.max(-1, Math.min(1, v / span));
  return { x: c(center.x - 0.5), y: c(center.y - 0.5) };
}

export const parseSensitivity = (v: string | null | undefined): SteerSensitivity =>
  v === 'low' || v === 'high' ? v : 'normal';
