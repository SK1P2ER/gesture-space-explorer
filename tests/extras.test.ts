import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { GestureEngine } from '../src/gestures/engine';
import { ExtraGestures } from '../src/gestures/extras';
import { observeHand } from '../src/gestures/perception';
import type { Intent } from '../src/intents';
import type { Hand } from '../src/tracking/types';
import { ASPECT, FRAME_MS, frames, HANDS, place, swingThumb, type HandName } from './helpers/hands';

/** Runs frames through the original engine and the v1.2 gestures together, as main.ts does. */
function run(script: Hand[][]) {
  const engine = new GestureEngine(config.gestures, config.smoothing, () => 'earth'); // every point hits a planet
  const extras = new ExtraGestures(config.gestures, config.smoothing);
  const fromEngine: Intent[] = [];
  const fromExtras: Intent[] = [];
  script.forEach((hands, i) => {
    const t = i * FRAME_MS;
    fromEngine.push(...engine.update({ t, aspect: ASPECT, hands }));
    fromExtras.push(...extras.update({ t, aspect: ASPECT, hands }, engine));
  });
  return { fromEngine, fromExtras, extras };
}

const count = (intents: Intent[], type: Intent['type']) => intents.filter((i) => i.type === type).length;
const seconds = (s: number) => Math.round((s * 1000) / FRAME_MS);

describe('v1.2 hand shapes (built from real recordings)', () => {
  const fingers = (name: HandName) => {
    const o = observeHand(place(HANDS[name]), ASPECT, config.gestures);
    const f = o.fingers;
    return { pose: o.pose, bits: [f.index, f.middle, f.ring, f.pinky].map(Number).join('') };
  };

  it('🤘 is index + pinky, which the original engine treats as no gesture', () => {
    expect(fingers('rock')).toEqual({ pose: 'none', bits: '1001' });
  });

  it('🤙 is pinky only (plus thumb), also no gesture for the original engine', () => {
    expect(fingers('shaka')).toEqual({ pose: 'none', bits: '0001' });
    expect(observeHand(place(HANDS.shaka), ASPECT, config.gestures).fingers.thumb).toBe(true);
  });
});

describe('🤘 → photo', () => {
  it('takes one photo after a ~0.8 s hold, and the original engine does nothing', () => {
    const { fromEngine, fromExtras } = run(frames('rock', seconds(1.3)));
    expect(count(fromExtras, 'photo')).toBe(1);
    expect(fromEngine).toEqual([]);
  });

  it('a short 🤘 takes no photo', () => {
    const { fromExtras } = run(frames('rock', seconds(0.6)));
    expect(count(fromExtras, 'photo')).toBe(0);
  });

  it('one 🤘 = one photo, however long it is held; the next 🤘 takes another', () => {
    const once = run(frames('rock', seconds(4)));
    expect(count(once.fromExtras, 'photo')).toBe(1);
    const twice = run([...frames('rock', seconds(1.2)), ...frames('palm', seconds(0.3)), ...frames('rock', seconds(1.2))]);
    expect(count(twice.fromExtras, 'photo')).toBe(2);
  });

  it('shows hold progress while 🤘 is up', () => {
    const { extras } = run(frames('rock', seconds(0.5)));
    expect(extras.ui.action).toBe('photo');
    expect(extras.ui.progress).toBeGreaterThan(0.2);
    expect(extras.ui.progress).toBeLessThan(1);
  });

  it('existing gestures never take a photo', () => {
    for (const name of ['palm', 'fist', 'point', 'v'] as const) {
      const still = run(frames(name, seconds(2)));
      const moving = run(frames(name, seconds(2), { dx: -0.2 }, { dx: 0.2 }));
      expect(count(still.fromExtras, 'photo') + count(moving.fromExtras, 'photo'), name).toBe(0);
    }
  });
});

describe('🤙 → time dial', () => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dial = (intents: Intent[]) =>
    intents.reduce((sum, i) => sum + (i.type === 'timeDial' ? i.delta : 0), 0);
  /** Hold a 🤙 still (it settles), then tilt it to `toDeg` over a second, then hold. */
  const settleThenTilt = (toDeg: number, mirror = false) => [
    ...frames('shaka', seconds(0.6), { mirror }),
    ...frames('shaka', seconds(1), { mirror }, { mirror, tilt: rad(toDeg) }),
    ...frames('shaka', seconds(0.5), { mirror, tilt: rad(toDeg) }),
  ];

  it('tilting right speeds up, tilting left slows down (90° = half the slider)', () => {
    expect(dial(run(settleThenTilt(30)).fromExtras)).toBeCloseTo(30 / 90, 1);
    expect(dial(run(settleThenTilt(-30)).fromExtras)).toBeCloseTo(-30 / 90, 1);
  });

  it('feels the same with the left hand: tilting toward your right is faster', () => {
    expect(dial(run(settleThenTilt(30, true)).fromExtras)).toBeCloseTo(30 / 90, 1);
    expect(dial(run(settleThenTilt(-30, true)).fromExtras)).toBeCloseTo(-30 / 90, 1);
  });

  it('ignores the tilt while the pose settles (~0.3 s), so forming it changes nothing', () => {
    // Tilting while forming the shaka, done before it has settled.
    const script = [...frames('shaka', seconds(0.25), {}, { tilt: rad(40) }), ...frames('shaka', seconds(1.5), { tilt: rad(40) })];
    const { fromExtras } = run(script);
    expect(Math.abs(dial(fromExtras))).toBeLessThan(0.02);
  });

  it('holding still does not drift', () => {
    expect(Math.abs(dial(run(frames('shaka', seconds(3), { tilt: rad(15) })).fromExtras))).toBeLessThan(0.01);
  });

  it('the original engine does nothing while dialing', () => {
    expect(run(settleThenTilt(45)).fromEngine).toEqual([]);
  });

  it('shows the dial once it is live', () => {
    const settling = run(frames('shaka', seconds(0.25)));
    expect(settling.extras.ui).toMatchObject({ action: 'dial', dialActive: false });
    const live = run(frames('shaka', seconds(0.8)));
    expect(live.extras.ui).toMatchObject({ action: 'dial', dialActive: true });
  });

  it('a tilting shaka with the thumb partly lost never takes a photo, even when it flickers to 🤘', () => {
    const thumbLost = (k: number) => swingThumb(HANDS.shaka, -0.9 * k); // the thumb folds into the palm
    const script: Hand[][] = [];
    const n = seconds(5);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const tilt = rad(40 * Math.sin(k * Math.PI * 4)); // rocking back and forth
      // Every 12th frame, two frames read as 🤘 (index finger seen as up); a 200 ms 🤘 streak midway.
      const flicker = i % 12 < 2 || (i > n / 2 && i < n / 2 + seconds(0.2));
      script.push([place(flicker ? HANDS.rock : thumbLost(k), { tilt })]);
    }
    // …and the hand ends in a 🤘 for 0.4 s, still within the block after the dial.
    script.push(...frames('rock', seconds(0.4)));
    const { fromExtras } = run(script);
    expect(count(fromExtras, 'photo')).toBe(0);
    expect(count(fromExtras, 'timeDial')).toBeGreaterThan(20); // and the dial kept working
  });

  it('a deliberate 🤘 after the dial takes a photo once the 0.5 s block is over', () => {
    const script = [...frames('shaka', seconds(1)), ...frames('rock', seconds(2))];
    const { fromExtras } = run(script);
    expect(count(fromExtras, 'photo')).toBe(1);
    // Blocked 0.5 s + the 0.8 s hold: no photo during the first ~1.2 s of 🤘.
    const early = run([...frames('shaka', seconds(1)), ...frames('rock', seconds(1.2))]);
    expect(count(early.fromExtras, 'photo')).toBe(0);
  });
});
