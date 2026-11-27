import { describe, expect, it } from 'vitest';
import { CameraTween, easeInOutCubic, PRESET_MS, smoothstep, type Vec3 } from '../src/scene/cameraTween';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('launch preview camera tween', () => {
  it('preset moves last 300–450 ms (owner, 2026-11-21)', () => {
    expect(PRESET_MS).toBeGreaterThanOrEqual(300);
    expect(PRESET_MS).toBeLessThanOrEqual(450);
  });

  it('eases in and out, starts exactly at the current pose and ends exactly on the destination', () => {
    expect(easeInOutCubic(0)).toBe(0); expect(easeInOutCubic(1)).toBe(1); expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(0.1)).toBeLessThan(0.1); expect(easeInOutCubic(0.9)).toBeGreaterThan(0.9);
    const tween = new CameraTween(v(0, 50, 0), v(0, 0, 0), { durationMs: PRESET_MS });
    const eye = v(0, 0, 0), target = v(0, 0, 0);
    tween.step(0, v(100, 50, 0), v(10, 0, 0), eye, target);
    expect(eye).toEqual(v(0, 50, 0));
    const frames: Vec3[] = [];
    while (!tween.step(16, v(100, 50, 0), v(10, 0, 0), eye, target)) frames.push({ ...eye });
    expect(eye).toEqual(v(100, 50, 0)); expect(target).toEqual(v(10, 0, 0));
    expect(frames.length).toBeGreaterThan(20); expect(frames.length).toBeLessThan(30);
    // No frame jumps more than a fifth of the way (smooth at 60 fps).
    let last = v(0, 50, 0);
    for (const f of [...frames, eye]) { expect(dist(last, f)).toBeLessThan(20); last = f; }
  });

  it('follows a destination that moves while it travels (Follow during playback)', () => {
    const tween = new CameraTween(v(0, 0, 0), v(0, 0, 0), { durationMs: PRESET_MS });
    const eye = v(0, 0, 0), target = v(0, 0, 0);
    let rocket = 0, done = false;
    while (!done) { rocket += 2; done = tween.step(16, v(50, rocket, 0), v(0, rocket + 28, 0), eye, target); }
    expect(eye).toEqual(v(50, rocket, 0)); expect(target).toEqual(v(0, rocket + 28, 0));
  });

  it('a second preset starts from the pose the first one had reached, not from a stored preset', () => {
    const eye = v(0, 0, 0), target = v(0, 0, 0);
    const first = new CameraTween(v(0, 0, 0), v(0, 0, 0), { durationMs: PRESET_MS });
    for (let i = 0; i < 8; i++) first.step(16, v(100, 0, 0), v(0, 0, 0), eye, target);
    const reached = { ...eye };
    const second = new CameraTween(eye, target, { durationMs: PRESET_MS });
    second.step(16, v(-100, 0, 0), v(0, 0, 0), eye, target);
    expect(dist(eye, reached)).toBeLessThan(5);
  });

  it('a zero duration (reduced motion) arrives at once; the old place flight keeps its arc and curve', () => {
    const eye = v(0, 0, 0), target = v(0, 0, 0);
    expect(new CameraTween(v(0, 0, 0), v(0, 0, 0), { durationMs: 0 }).step(0, v(9, 9, 9), v(1, 1, 1), eye, target)).toBe(true);
    expect(eye).toEqual(v(9, 9, 9));
    const flight = new CameraTween(v(0, 10, 0), v(0, 0, 0), { durationMs: 900, ease: smoothstep, arc: true });
    flight.step(450, v(100, 10, 0), v(0, 0, 0), eye, target);
    expect(eye.y).toBeCloseTo(10 + 110); // halfway: the full lift of 4·½·½·(120 − 10)
  });
});
