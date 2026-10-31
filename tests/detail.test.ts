import { describe, expect, it } from 'vitest';
import { detailFor, HdSwitch, hdSwitchConfig } from '../src/planets/detail';

describe('detailFor', () => {
  it('uses the densest sphere for the focused body, whatever its size', () => {
    expect(detailFor(2, true)).toBe(0);
  });

  it('drops segments as bodies shrink on screen', () => {
    expect(detailFor(200, false)).toBe(0);
    expect(detailFor(40, false)).toBe(1);
    expect(detailFor(4, false)).toBe(2);
  });
});

describe('HdSwitch', () => {
  const cfg = { onPx: 640, offPx: 440, onDelay: 0.4, offDelay: 1.5 };
  const run = (sw: HdSwitch, seconds: number, eligible: boolean, px: number) => {
    let changed = false;
    for (let t = 0; t < seconds; t += 0.1) changed = sw.update(0.1, eligible, px) || changed;
    return changed;
  };

  it('switches on only after the body stays big for onDelay', () => {
    const sw = new HdSwitch(cfg);
    expect(run(sw, 0.3, true, 800)).toBe(false);
    expect(run(sw, 0.2, true, 800)).toBe(true);
    expect(sw.wanted).toBe(true);
  });

  it('ignores zooming past the threshold', () => {
    const sw = new HdSwitch(cfg);
    run(sw, 0.3, true, 800);
    run(sw, 0.1, true, 300);
    run(sw, 0.3, true, 800);
    expect(sw.wanted).toBe(false);
  });

  it('keeps 4K between offPx and onPx (hysteresis)', () => {
    const sw = new HdSwitch(cfg);
    run(sw, 1, true, 800);
    run(sw, 5, true, 500);
    expect(sw.wanted).toBe(true);
  });

  it('releases after the body stays small for offDelay', () => {
    const sw = new HdSwitch(cfg);
    run(sw, 1, true, 800);
    expect(run(sw, 1.3, true, 300)).toBe(false);
    expect(run(sw, 0.3, true, 300)).toBe(true);
    expect(sw.wanted).toBe(false);
  });

  it('derives thresholds from the base texture size', () => {
    expect(hdSwitchConfig(2048).onPx).toBeCloseTo(652, 0);
    expect(hdSwitchConfig(1024).onPx).toBeCloseTo(326, 0);
  });

  it('starts over after reset (quality change)', () => {
    const sw = new HdSwitch(cfg);
    run(sw, 1, true, 800);
    sw.reset(hdSwitchConfig(1024));
    expect(sw.wanted).toBe(false);
    expect(run(sw, 0.5, true, 400)).toBe(true); // 400 px is past the 1K threshold
  });

  it('releases at once when the body loses focus', () => {
    const sw = new HdSwitch(cfg);
    run(sw, 1, true, 800);
    expect(sw.update(0.016, false, 800)).toBe(true);
    expect(sw.wanted).toBe(false);
  });
});
