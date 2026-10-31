import { describe, expect, it } from 'vitest';
import type { Point3 } from '../src/tracking/types';
import { Recorder } from '../src/ui/recorder';

const hand = (x: number) => ({
  handedness: 'Right' as const,
  score: 0.987654,
  landmarks: Array.from({ length: 21 }, (): Point3 => [x + 0.123456789, 0.5, -0.01]),
});

describe('Recorder', () => {
  it('ignores frames until started', () => {
    const r = new Recorder();
    r.push({ t: 1, hands: [] });
    expect(r.recording).toBe(false);
    expect(r.stop()).toBeNull();
  });

  it('rebases time to 0 and rounds numbers', () => {
    const r = new Recorder();
    r.start();
    r.push({ t: 1000.4, hands: [hand(0)] });
    r.push({ t: 1033.7, hands: [] });
    const rec = r.stop()!;

    expect(rec.version).toBe(1);
    expect(rec.frames.map((f) => f.t)).toEqual([0, 33]);
    expect(rec.frames[0].hands[0].score).toBe(0.9877);
    expect(rec.frames[0].hands[0].landmarks[0]).toEqual([0.1235, 0.5, -0.01]);
    expect(r.recording).toBe(false);
  });
});
