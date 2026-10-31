import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { observeHand, type Pose } from '../src/gestures/perception';
import type { Hand } from '../src/tracking/types';
import type { Recording } from '../src/ui/recorder';

// Real MediaPipe output, recorded with the app's debug recorder from
// MediaPipe's own test images fed in as a fake webcam (640x480 → aspect 4/3).
const ASPECT = 4 / 3;
const load = (name: string): Recording =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.landmarks.json`, import.meta.url), 'utf8'));

const posesIn = (name: string) =>
  load(name).frames.flatMap((f) => f.hands.map((h) => observeHand(h, ASPECT, config.gestures).pose));

describe('observeHand — pose from real landmarks', () => {
  const cases: [string, Pose][] = [
    ['right_hands', 'palm'],
    ['fist', 'fist'],
    ['pointing_up', 'point'],
    ['victory', 'v'],
  ];

  for (const [fixture, expected] of cases) {
    it(`${fixture} → ${expected} in every frame`, () => {
      const poses = posesIn(fixture);
      expect(poses.length).toBeGreaterThan(10);
      expect(new Set(poses)).toEqual(new Set([expected]));
    });
  }

  it('a relaxed ✌️ with the ring finger half raised is still a V', () => {
    const hand = load('victory').frames[0].hands[0];
    const lm = hand.landmarks.map((p) => [...p]) as Hand['landmarks'];
    // Raise the ring finger: put its tip just past its PIP, away from the wrist.
    const [wx, wy] = lm[0];
    const [px, py, pz] = lm[14];
    lm[16] = [wx + (px - wx) * 1.3, wy + (py - wy) * 1.3, pz];
    const obs = observeHand({ ...hand, landmarks: lm }, ASPECT, config.gestures);
    expect(obs.fingers.ring).toBe(true);
    expect(obs.pose).toBe('v');
  });

  it('reports finger states for logging', () => {
    const obs = observeHand(load('victory').frames[0].hands[0], ASPECT, config.gestures);
    expect(obs.fingers).toMatchObject({ index: true, middle: true, ring: false, pinky: false });
    expect(obs.ratios).toHaveLength(4);
  });

  it('thumbs-up is never mistaken for point, v, palm or pinch', () => {
    for (const pose of posesIn('thumb_up')) expect(['fist', 'none']).toContain(pose);
  });

  it('detects a pinch when the thumb tip touches the index tip', () => {
    const hand = load('pointing_up').frames[0].hands[0];
    const pinched: Hand = { ...hand, landmarks: hand.landmarks.map((p) => [...p]) as Hand['landmarks'] };
    const [x, y, z] = pinched.landmarks[8];
    pinched.landmarks[4] = [x + 0.005, y + 0.005, z];
    expect(observeHand(pinched, ASPECT, config.gestures).pose).toBe('pinch');
  });

  it('pinch has hysteresis: a slightly open pinch stays a pinch only if it was one', () => {
    const hand = load('pointing_up').frames[0].hands[0];
    const obs = observeHand(hand, ASPECT, config.gestures);
    const lm = hand.landmarks.map((p) => [...p]) as Hand['landmarks'];
    // Place the thumb tip between the enter and exit thresholds.
    const gap = ((config.gestures.pinchEnter + config.gestures.pinchExit) / 2) * obs.palm;
    lm[4] = [lm[8][0] + gap / ASPECT, lm[8][1], lm[8][2]];
    const h: Hand = { ...hand, landmarks: lm };
    expect(observeHand(h, ASPECT, config.gestures, false).pose).not.toBe('pinch');
    expect(observeHand(h, ASPECT, config.gestures, true).pose).toBe('pinch');
  });

  it('mirrors x so the preview and gestures agree with what the user sees', () => {
    const hand = load('pointing_up').frames[0].hands[0];
    const obs = observeHand(hand, ASPECT, config.gestures);
    expect(obs.indexTip.x).toBeCloseTo(1 - hand.landmarks[8][0], 5);
    expect(obs.indexTip.y).toBeCloseTo(hand.landmarks[8][1], 5);
  });
});
