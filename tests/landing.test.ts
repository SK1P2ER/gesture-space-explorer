import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { parseSensitivity, steerFromPalm } from '../src/gestures/steer';
import { replayLanding, type LandingContext } from '../src/sim/landingReplay';
import type { Hand } from '../src/tracking/types';
import { Recorder, type Recording } from '../src/ui/recorder';
import { fixtureHand, FRAME_MS } from './helpers/hands';

describe('hand steering for landings', () => {
  it('the middle of the view is straight down; the edges of the range are ±1', () => {
    expect(steerFromPalm({ x: 0.5, y: 0.5 }, 'normal')).toEqual({ x: 0, y: 0 });
    expect(steerFromPalm({ x: 0.8, y: 0.2 }, 'normal')).toEqual({ x: 1, y: -1 });
    expect(steerFromPalm({ x: 1, y: 0 }, 'normal')).toEqual({ x: 1, y: -1 }); // clamped
  });

  it('higher sensitivity: a smaller hand movement steers as far', () => {
    const at = (s: 'low' | 'normal' | 'high') => steerFromPalm({ x: 0.6, y: 0.5 }, s).x;
    expect(at('low')).toBeLessThan(at('normal'));
    expect(at('normal')).toBeLessThan(at('high'));
    expect(steerFromPalm({ x: 0.5 + 0.3 / 1.6, y: 0.5 }, 'high').x).toBeCloseTo(1, 9);
  });

  it('reads the stored setting safely', () => {
    expect(parseSensitivity('high')).toBe('high');
    expect(parseSensitivity('low')).toBe('low');
    for (const bad of [null, undefined, '', 'turbo']) expect(parseSensitivity(bad)).toBe('normal');
  });
});

/** The fixture's open hand, moved so its palm center (mirrored, as perception sees it) is at (cx, cy). */
function palmAt(base: Hand, cx: number, cy: number): Hand {
  const [mx, my] = base.landmarks[9];
  const [dx, dy] = [1 - cx - mx, cy - my];
  return { ...base, landmarks: base.landmarks.map(([x, y, z]) => [x + dx, y + dy, z] as [number, number, number]) };
}

function recording(where: { x: number; y: number }, gravity: number, seconds = 30): Recording {
  const hand = fixtureHand('right_hands');
  const rec = new Recorder();
  rec.start();
  let t = 0;
  for (let i = 0; i < 15; i++, t += FRAME_MS) rec.push({ t, hands: [palmAt(hand, 0.5, 0.5)] }, 'travel');
  for (; t < (seconds + 0.5) * 1000; t += FRAME_MS) rec.push({ t, hands: [palmAt(hand, where.x, where.y)] }, 'docking');
  const landing: LandingContext = { baseId: 'jezero', gravity, sensitivity: 'normal', autoLand: false, startAlt: 3 / 0.35 };
  return rec.stop(landing)!;
}

describe('landing replays (?debug recordings)', () => {
  it('a recording keeps each frame’s mode and the landing’s settings, through JSON', () => {
    const rec: Recording = JSON.parse(JSON.stringify(recording({ x: 0.5, y: 0.5 }, 3.7, 1)));
    expect(rec.frames[0].mode).toBe('travel');
    expect(rec.frames.at(-1)!.mode).toBe('docking');
    expect(rec.landing).toMatchObject({ baseId: 'jezero', gravity: 3.7, sensitivity: 'normal' });
  });

  it('a hand held in the middle lands on the pad', () => {
    const r = replayLanding(recording({ x: 0.5, y: 0.5 }, 3.7), config);
    expect(r.attempts[0].outcome).toBe('landed');
    expect(r.steer.length).toBeGreaterThan(100);
    expect(Math.abs(r.steer[0].x)).toBeLessThan(0.05);
  });

  it('a hand held off to the side misses, attempt after attempt', () => {
    const r = replayLanding(recording({ x: 0.85, y: 0.5 }, 9.8), config);
    expect(r.attempts.length).toBeGreaterThan(1);
    expect(r.attempts.every((a) => a.outcome === 'missed')).toBe(true);
    expect(r.steer[0].x).toBeGreaterThan(0.9); // right in the mirror is right on screen
  });

  it('says so when a recording has no landing in it', () => {
    const rec = new Recorder();
    rec.start();
    rec.push({ t: 0, hands: [] });
    expect(() => replayLanding(rec.stop()!, config)).toThrow(/no landing/);
  });
});
