import { describe, expect, it } from 'vitest';
import { sheetSwipe, SWIPE_PX } from '../src/ui/sheet';

describe('the info sheet on phones', () => {
  it('collapses on a swipe down, closes on a second, and expands on a swipe up', () => {
    expect(sheetSwipe(SWIPE_PX + 10, false)).toBe('collapse');
    expect(sheetSwipe(SWIPE_PX + 10, true)).toBe('dismiss');
    expect(sheetSwipe(-(SWIPE_PX + 10), true)).toBe('expand');
    expect(sheetSwipe(-(SWIPE_PX + 10), false)).toBe('expand');
  });

  it('ignores small movements (a tap on the handle toggles instead)', () => {
    for (const dy of [0, 5, -5, SWIPE_PX, -SWIPE_PX]) expect(sheetSwipe(dy, false), String(dy)).toBeNull();
  });
});
