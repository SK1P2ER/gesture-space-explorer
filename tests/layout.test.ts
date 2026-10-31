import { describe, expect, it } from 'vitest';
import { IDLE_MS, IdleTracker } from '../src/ui/idle';
import { insetsFor } from '../src/ui/layout';

describe('insets from the panels on screen', () => {
  it('a card on the right takes a column; a bottom sheet a strip', () => {
    // Landscape phone, info card on the right.
    expect(insetsFor(844, 390, [{ left: 560, top: 60, right: 828, bottom: 380 }])).toEqual({ top: 0, right: (844 - 560) / 844, bottom: 0, left: 0 });
    // Portrait phone, bottom sheet.
    expect(insetsFor(390, 844, [{ left: 0, top: 540, right: 390, bottom: 844 }])).toEqual({ top: 0, right: 0, bottom: 304 / 844, left: 0 });
  });

  it('a panel at the top left goes to whichever edge costs less view', () => {
    const tall = insetsFor(844, 390, [{ left: 16, top: 70, right: 160, bottom: 380 }]); // tall and narrow: a column
    expect(tall.left).toBeCloseTo(160 / 844, 9);
    expect(tall.top).toBe(0);
    const wide = insetsFor(844, 390, [{ left: 200, top: 0, right: 640, bottom: 60 }]); // short and wide: a strip
    expect(wide.top).toBeCloseTo(60 / 390, 9);
  });

  it('combines panels per side (largest wins) and ignores empty or off-screen rects', () => {
    const r = insetsFor(1000, 800, [
      { left: 700, top: 100, right: 1000, bottom: 700 },
      { left: 800, top: 0, right: 1000, bottom: 800 },
      { left: 0, top: 0, right: 0, bottom: 0 }, // hidden (display: none)
      { left: 1200, top: 0, right: 1400, bottom: 100 }, // off-screen
    ]);
    expect(r).toEqual({ top: 0, right: 0.3, bottom: 0, left: 0 });
  });
});

describe('immersive mode (idle UI fade)', () => {
  it('fades after a few seconds without input; any input brings the UI back', () => {
    const idle = new IdleTracker(0);
    expect(idle.immersive(IDLE_MS - 1, { pinned: false })).toBe(false);
    expect(idle.immersive(IDLE_MS, { pinned: false })).toBe(true);
    idle.input(IDLE_MS + 10);
    expect(idle.immersive(IDLE_MS + 20, { pinned: false })).toBe(false);
  });

  it('never fades while something is pinned (mission HUD, open panel), and restarts the clock after', () => {
    const idle = new IdleTracker(0);
    expect(idle.immersive(10_000, { pinned: true })).toBe(false);
    expect(idle.immersive(10_000 + IDLE_MS - 1, { pinned: false })).toBe(false);
    expect(idle.immersive(10_000 + IDLE_MS, { pinned: false })).toBe(true);
  });
});
