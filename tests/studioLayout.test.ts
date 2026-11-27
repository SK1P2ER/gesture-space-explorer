import { describe, expect, it } from 'vitest';
import { studioLayout } from '../src/ui/studioLayout';

const ids = ['tranquility', 'jezero', 'conamara', 'kraken'];
const at = (width: number, height: number, top = 0, bottom = height) => studioLayout(ids, { left: 0, top, right: width, bottom }, { width, height });
const inside = (t: { x: number; y: number; r: number }, s: { left: number; top: number; right: number; bottom: number }) =>
  t.x - t.r >= s.left && t.x + t.r <= s.right && t.y - t.r >= s.top && t.y + t.r <= s.bottom;

describe('studio layout (experimental, ?flags=picker3d,studio)', () => {
  it('uses the shallow arc where one row has the height for it', () => {
    for (const [w, h] of [[1280, 800], [780, 590], [390, 844]] as const) {
      const l = at(w, h, 90, h - 90);
      expect(l.arrangement, `${w}x${h}`).toBe('arc');
      // the two ends sit higher than the middle pair, by the same amount
      expect(l.targets[0].y).toBeCloseTo(l.targets[3].y);
      expect(l.targets[1].y).toBeCloseTo(l.targets[2].y);
      expect(l.targets[0].y).toBeLessThan(l.targets[1].y);
    }
  });

  it('falls back to a plain row in a short landscape view', () => {
    const l = at(844, 390, 60, 310);
    expect(l.arrangement).toBe('row');
    expect(new Set(l.targets.map((t) => t.y)).size).toBe(1);
  });

  it('falls back to a two-row grid where four 88 px hit boxes do not fit side by side', () => {
    const l = at(340, 760, 80, 700);
    expect(l.arrangement).toBe('grid');
    expect(new Set(l.targets.map((t) => Math.round(t.y))).size).toBe(2);
  });

  it('keeps every planet inside the stage, at least 88 px apart, clear of the console', () => {
    for (const [w, h] of [[1280, 800], [780, 590], [390, 844], [844, 390], [340, 760]] as const) {
      const l = at(w, h, 70, h - 80);
      for (const t of l.targets) expect(inside(t, l.stage), `${w}x${h} ${t.baseId}`).toBe(true);
      for (let i = 0; i < l.targets.length; i++) for (let j = i + 1; j < l.targets.length; j++) {
        expect(Math.hypot(l.targets[i].x - l.targets[j].x, l.targets[i].y - l.targets[j].y), `${w}x${h}`).toBeGreaterThanOrEqual(88);
      }
      const overlap = l.stage.left < l.cell.right && l.cell.left < l.stage.right && l.stage.top < l.cell.bottom && l.cell.top < l.stage.bottom;
      expect(overlap, `${w}x${h} stage and console overlap`).toBe(false);
      expect(l.header.bottom).toBeLessThanOrEqual(l.stage.top);
    }
  });

  it('depends on the area, the viewport and the destinations only', () => {
    expect(at(1280, 800, 90, 710)).toEqual(at(1280, 800, 90, 710));
    expect(at(1280, 800, 90, 710).targets.map((t) => t.baseId)).toEqual(ids);
  });
});
