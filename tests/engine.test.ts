import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { GestureEngine, type Picker } from '../src/gestures/engine';
import type { Intent } from '../src/intents';
import type { Hand, Point3 } from '../src/tracking/types';
import type { Recording } from '../src/ui/recorder';

// Real poses (recorded MediaPipe output) moved along scripted paths.
const ASPECT = 4 / 3;
const FRAME_MS = 33;

const fixtureHand = (name: string): Hand => {
  const rec: Recording = JSON.parse(readFileSync(new URL(`./fixtures/${name}.landmarks.json`, import.meta.url), 'utf8'));
  return rec.frames[0].hands[0];
};

const POSES = {
  palm: fixtureHand('right_hands'),
  fist: fixtureHand('fist'),
  point: fixtureHand('pointing_up'),
  v: fixtureHand('victory'),
  pinch: (() => {
    const h = fixtureHand('pointing_up');
    const lm = h.landmarks.map((p) => [...p] as Point3);
    lm[4] = [lm[8][0] + 0.005, lm[8][1] + 0.005, lm[8][2]];
    return { ...h, landmarks: lm };
  })(),
};
type PoseName = keyof typeof POSES;

/**
 * Put a pose with its palm center at frame center + (dx, dy) in the user's
 * (mirrored) view, scaled about that center. All poses share one anchor, so
 * switching pose in place looks like the same hand changing shape.
 */
function place(pose: PoseName, dx = 0, dy = 0, scale = 1): Hand {
  const h = POSES[pose];
  const [cx, cy] = h.landmarks[9];
  return {
    ...h,
    landmarks: h.landmarks.map(([x, y, z]): Point3 => [0.5 + (x - cx) * scale - dx, 0.5 + (y - cy) * scale + dy, z]),
  };
}

/** Run a script of frames through a fresh engine; returns all intents. */
function run(frames: Hand[][], pick: Picker = () => null) {
  const engine = new GestureEngine(config.gestures, config.smoothing, pick);
  const intents: Intent[] = [];
  frames.forEach((hands, i) => intents.push(...engine.update({ t: i * FRAME_MS, aspect: ASPECT, hands })));
  return { intents, engine };
}

/** n frames of one hand moving linearly from `from` to `to` (mirrored-view offsets). */
const path = (pose: PoseName, n: number, from: [number, number], to: [number, number] = from) =>
  Array.from({ length: n }, (_, i) => {
    const k = n === 1 ? 0 : i / (n - 1);
    return [place(pose, from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k)];
  });

const types = (intents: Intent[]) => intents.map((i) => i.type);
const count = (intents: Intent[], type: Intent['type']) => intents.filter((i) => i.type === type).length;

describe('GestureEngine', () => {
  describe('✋ palm → rotate only', () => {
    it('moving right rotates the camera (like dragging right)', () => {
      const { intents } = run(path('palm', 20, [-0.1, 0], [0.1, 0]));
      const dx = intents.filter((i) => i.type === 'rotate').reduce((s, i) => s + (i.type === 'rotate' ? i.dx : 0), 0);
      expect(dx).toBeLessThan(-0.5);
    });

    it('a FAST palm sweep never switches planets (rotate/swipe conflict fixed)', () => {
      const { intents } = run(path('palm', 6, [-0.3, 0], [0.3, 0]));
      expect(count(intents, 'next') + count(intents, 'prev')).toBe(0);
      expect(count(intents, 'rotate')).toBeGreaterThan(0);
    });
  });

  describe('✌️ V → switch planet', () => {
    const swipe = (to: number) => run([...path('v', 4, [0, 0]), ...path('v', 6, [0, 0], [to, 0]), ...path('v', 10, [to, 0])]);

    it('holding ✌️ still → exactly one next (one gesture = one switch)', () => {
      const { intents } = run(path('v', 90, [0, 0])); // ~3s
      expect(types(intents)).toEqual(['next']);
    });

    it('holding ✌️ switches after vHoldMs, not before', () => {
      const frames = Math.floor(config.gestures.vHoldMs / FRAME_MS) - 2;
      const { intents, engine } = run(path('v', frames, [0, 0]));
      expect(intents).toEqual([]);
      expect(engine.ui.progress).toBeGreaterThan(0.6);
    });

    it('a realistic swipe right (0.25 frame width in 300ms) → exactly one next', () => {
      expect(types(run([...path('v', 3, [0, 0]), ...path('v', 10, [0, 0], [0.25, 0]), ...path('v', 30, [0.25, 0])]).intents)).toEqual(['next']);
    });

    it('fast swipe right → exactly one next', () => {
      expect(types(swipe(0.4).intents)).toEqual(['next']);
    });

    it('fast swipe left → exactly one prev (the hold never fires first)', () => {
      expect(types(swipe(-0.4).intents)).toEqual(['prev']);
    });

    it('swiping back and forth within one ✌️ still switches only once', () => {
      const script = [...path('v', 3, [0, 0]), ...path('v', 6, [0, 0], [0.4, 0]), ...path('v', 6, [0.4, 0], [-0.1, 0]), ...path('v', 6, [-0.1, 0], [0.3, 0])];
      expect(count(run(script).intents, 'next') + count(run(script).intents, 'prev')).toBe(1);
    });

    it('re-forming ✌️ inside the cooldown does not switch again; after it, it does', () => {
      const quick = [...path('v', 20, [0, 0]), ...path('palm', 4, [0, 0]), ...path('v', 4, [0, 0])];
      expect(count(run(quick).intents, 'next')).toBe(1);
      const later = [...path('v', 20, [0, 0]), ...path('palm', 20, [0, 0]), ...path('v', 30, [0, 0])];
      expect(count(run(later).intents, 'next')).toBe(2);
    });

    it('V never rotates the camera', () => {
      expect(count(swipe(0.4).intents, 'rotate')).toBe(0);
    });

    it('mostly-vertical movement does not switch', () => {
      expect(types(run([...path('v', 4, [0, 0]), ...path('v', 6, [0, 0], [0.15, 0.4])]).intents)).toEqual([]);
    });
  });

  describe('🤏 pinch → zoom', () => {
    it('moving up zooms in', () => {
      const { intents } = run(path('pinch', 20, [0, 0.1], [0, -0.1]));
      const total = intents.reduce((p, i) => p * (i.type === 'zoom' ? i.factor : 1), 1);
      expect(total).toBeLessThan(0.7);
    });
  });

  describe('☝️ point → dwell to select', () => {
    it('holding on a body for 1s selects it exactly once', () => {
      const { intents } = run(path('point', 90, [0, 0]), () => 'mars'); // ~3s
      expect(intents).toEqual([{ type: 'select', bodyId: 'mars' }]);
    });

    it('does not select before the dwell time', () => {
      const { intents, engine } = run(path('point', 20, [0, 0]), () => 'mars'); // ~0.66s
      expect(intents).toEqual([]);
      expect(engine.ui.progress).toBeGreaterThan(0.4);
      expect(engine.ui.hoverId).toBe('mars');
    });

    it('pointing at empty space selects nothing', () => {
      expect(run(path('point', 60, [0, 0]), () => null).intents).toEqual([]);
    });

    it('a brief miss (jitter) does not restart the dwell', () => {
      let n = 0;
      const flaky: Picker = () => (++n % 7 === 0 ? null : 'mars');
      expect(run(path('point', 45, [0, 0]), flaky).intents).toEqual([{ type: 'select', bodyId: 'mars' }]);
    });

    it('exposes a screen pointer', () => {
      const { engine } = run(path('point', 5, [0, 0]));
      expect(engine.ui.pointer).not.toBeNull();
    });
  });

  describe('✊ fist → hold to pause', () => {
    it('held fist toggles pause exactly once', () => {
      expect(types(run(path('fist', 60, [0, 0])).intents)).toEqual(['togglePause']);
    });

    it('a short fist does nothing', () => {
      expect(types(run([...path('fist', 8, [0, 0]), ...path('palm', 10, [0, 0])]).intents)).not.toContain('togglePause');
    });

    it('open then close again toggles a second time', () => {
      const script = [...path('fist', 25, [0, 0]), ...path('palm', 10, [0, 0]), ...path('fist', 25, [0, 0])];
      expect(count(run(script).intents, 'togglePause')).toBe(2);
    });

    it('a single fist-like frame inside a palm stream is ignored', () => {
      const script = [...path('palm', 10, [0, 0]), ...path('fist', 1, [0, 0]), ...path('palm', 10, [0, 0])];
      const { intents } = run(script);
      expect(count(intents, 'togglePause')).toBe(0);
    });
  });

  describe('who is in control', () => {
    it('ignores small (far away) hands', () => {
      const tiny = Array.from({ length: 60 }, () => [place('fist', 0, 0, 0.15)]);
      expect(run(tiny).intents).toEqual([]);
    });

    it('a second, bigger hand cannot take over while the first is present', () => {
      const frames = [
        ...path('palm', 5, [-0.2, 0]),
        ...Array.from({ length: 40 }, () => [place('palm', -0.2, 0), place('fist', 0.3, 0, 1.2)]),
      ];
      const { intents, engine } = run(frames);
      expect(count(intents, 'togglePause')).toBe(0);
      expect(engine.ui.pose).toBe('palm');
    });

    it('control passes to the other hand once the first one is gone', () => {
      const frames = [
        ...Array.from({ length: 5 }, () => [place('palm', -0.2, 0), place('fist', 0.3, 0)]),
        ...Array.from({ length: 50 }, () => [place('fist', 0.3, 0)]),
      ];
      expect(count(run(frames).intents, 'togglePause')).toBe(1);
    });

    it('a new hand does not inherit the previous hand’s half-finished fist', () => {
      const frames = [
        ...path('fist', 10, [-0.3, 0]), // ~330ms: not yet a pause
        ...Array.from({ length: 30 }, () => [place('palm', 0.3, 0)]), // a different hand, elsewhere
      ];
      expect(count(run(frames).intents, 'togglePause')).toBe(0);
    });
  });

  describe('robustness: real-world timing and tracking dropouts', () => {
    /** Frames with explicit timestamps; returns intents tagged with the frame time. */
    const runTimed = (frames: [t: number, hands: Hand[]][]) => {
      const engine = new GestureEngine(config.gestures, config.smoothing, () => null);
      return frames.flatMap(([t, hands]) => engine.update({ t, aspect: ASPECT, hands }).map((intent) => ({ t, intent })));
    };
    const at = (pose: PoseName, from: number, n: number, dx = 0, dy = 0) =>
      Array.from({ length: n }, (_, i): [number, Hand[]] => [from + i * FRAME_MS, [place(pose, dx, dy)]]);

    it('a detection stall (e.g. first GPU frame) does not count as holding ✌️', () => {
      const events = runTimed([[0, [place('v')]], [700, [place('v')]], [733, [place('v')]]]);
      expect(events).toEqual([]);
    });

    it('returning to the tab after 5s does not instantly fire a held fist', () => {
      const events = runTimed([...at('fist', 0, 2), ...at('fist', 5000, 2)]);
      expect(events).toEqual([]);
    });

    it('a ✌️ formed during the cooldown still needs a full hold after it', () => {
      const events = runTimed([...at('v', 0, 20), ...at('palm', 660, 3), ...at('v', 760, 60)]);
      const nexts = events.filter((e) => e.intent.type === 'next');
      expect(nexts).toHaveLength(2);
      const cooldownEnd = nexts[0].t + config.gestures.switchCooldownMs;
      expect(nexts[1].t).toBeGreaterThanOrEqual(cooldownEnd + config.gestures.vHoldMs - FRAME_MS);
    });

    it('a brief tracking dropout does not jerk the camera when the hand reappears', () => {
      const events = runTimed([
        ...at('palm', 0, 15, 0, 0),
        ...Array.from({ length: 4 }, (_, i): [number, Hand[]] => [495 + i * FRAME_MS, []]), // lost ~130ms
        ...at('palm', 627, 10, 0.12, 0), // back, 0.12 frame-widths away
      ]);
      for (const { intent } of events) if (intent.type === 'rotate') expect(Math.abs(intent.dx)).toBeLessThan(0.1);
    });

    it('reset() clears control and on-screen state (tracking stopped)', () => {
      const { engine } = run(path('point', 20, [0, 0]), () => 'mars');
      expect(engine.ui.pointer).not.toBeNull();
      engine.reset();
      expect(engine.ui).toEqual({ pose: null, action: null, pointer: null, hoverId: null, progress: 0 });
      expect(engine.lastObs).toBeNull();
    });

    it('releasing the second hand after two-hand mode does not jump the zoom', () => {
      const events = runTimed([
        ...at('pinch', 0, 10, -0.15, 0),
        ...Array.from({ length: 10 }, (_, i): [number, Hand[]] => [
          330 + i * FRAME_MS,
          [place('pinch', -0.15, (0.2 * i) / 9, 0.8), place('pinch', 0.15, 0.2, 0.8)],
        ]),
        ...at('pinch', 660, 10, -0.15, 0.2),
      ]);
      for (const { intent } of events) if (intent.type === 'zoom') expect(intent.factor).toBeGreaterThan(0.9);
      for (const { intent } of events) if (intent.type === 'zoom') expect(intent.factor).toBeLessThan(1.1);
    });
  });

  describe('🤏🤏 two-hand pinch → time speed', () => {
    const twoHands = (spreadFrom: number, spreadTo: number) =>
      Array.from({ length: 20 }, (_, i) => {
        const s = spreadFrom + ((spreadTo - spreadFrom) * i) / 19;
        return [place('pinch', -s, 0, 0.8), place('pinch', s, 0, 0.8)];
      });
    const product = (intents: Intent[]) => intents.reduce((p, i) => p * (i.type === 'timeScale' ? i.factor : 1), 1);

    it('spreading apart speeds time up', () => {
      const { intents } = run(twoHands(0.1, 0.3));
      expect(product(intents)).toBeGreaterThan(2);
      expect(count(intents, 'zoom')).toBe(0);
    });

    it('bringing hands together slows time down', () => {
      expect(product(run(twoHands(0.3, 0.1)).intents)).toBeLessThan(0.5);
    });
  });
});
