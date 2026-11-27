/**
 * Animation-frame timestamps can precede the performance.now() read taken while
 * the app initialized. A negative first step at a base link can turn the camera
 * matrices into NaN. Never step backward or catch up an entire hidden-tab gap.
 */
export function frameSeconds(elapsedMs: number): number {
  return Math.min(Math.max(0, elapsedMs) / 1000, 0.1);
}
