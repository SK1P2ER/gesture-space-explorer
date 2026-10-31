import type { Insets } from '../scene/cameraRig';

// The responsive layout's shared rules: what counts as a compact screen, and
// how much of the view the open panels cover (so the camera can center the
// focused body in the rest). Pure, so it can be tested.

/** Phones in either orientation: narrow, or short (landscape). Keep in sync with style.css. */
export const COMPACT_QUERY = '(max-width: 640px), (max-height: 500px)';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The view's insets, as shares of its width and height, for panels covering it.
 * Each panel is pushed to whichever edge loses the least view: a card on the
 * right takes a column, a bottom sheet a strip. Off-screen or empty rects count
 * for nothing. The rig keeps at least a fifth of the view free.
 */
export function insetsFor(width: number, height: number, rects: readonly Rect[]): Insets {
  const out: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const r of rects) {
    const [left, right] = [Math.max(0, r.left), Math.min(width, r.right)];
    const [top, bottom] = [Math.max(0, r.top), Math.min(height, r.bottom)];
    if (right - left < 1 || bottom - top < 1) continue;
    const options: [keyof Insets, number][] = [
      ['left', right / width],
      ['right', (width - left) / width],
      ['top', bottom / height],
      ['bottom', (height - top) / height],
    ];
    const [side, share] = options.reduce((best, o) => (o[1] < best[1] ? o : best));
    out[side] = Math.max(out[side], share);
  }
  return out;
}
