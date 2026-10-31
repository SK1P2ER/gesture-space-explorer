// How far a planet is shown turned on its axis.
//
// The real rotation (from the IAU data) is shown whenever it is slow enough to
// see. Fast-forwarding makes real rotations far too fast for a 60 Hz screen
// (Earth at a week per second is 7 turns a second, which strobes and can even
// appear to run backwards), so above `capDegPerSec` the planet turns steadily
// at the cap, in the right direction. When the speed drops back, it eases onto
// the real angle again: at slow speeds the view is accurate, e.g. "Now" shows
// Earth's actual day and night.

const TWO_PI = Math.PI * 2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * @param shown the angle shown last frame (null on the first frame)
 * @param exact the real angle now, radians
 * @param degPerSec how fast the real angle is changing, degrees per real second
 * @param dt real seconds since last frame
 */
export function governSpin(shown: number | null, exact: number, degPerSec: number, dt: number, capDegPerSec = 36): number {
  if (shown === null) return exact % TWO_PI;
  const rate = (degPerSec * Math.PI) / 180;
  const cap = (capDegPerSec * Math.PI) / 180;
  if (Math.abs(rate) > cap) return (shown + Math.sign(rate) * cap * dt) % TWO_PI;
  // Follow the real rotation, closing any gap (e.g. after fast-forwarding) along the shorter way round.
  const predicted = shown + rate * dt;
  const gap = wrap(exact - predicted);
  return (predicted + gap * (1 - Math.exp(-dt * 6))) % TWO_PI;
}
