import { describe, expect, it } from 'vitest';
import { BUILD_GRAB, BuildGrab } from '../src/gestures/buildGrab';
import type { Intent } from '../src/intents';

/** Feed [ms, pinch point or null] segments at ~30 fps; collect the intent types (cursor moves folded). */
function run(segments: [number, { x: number; y: number } | null][]) {
  const g = new BuildGrab();
  const out: string[] = [];
  let t = 0;
  for (const [ms, p] of segments)
    for (const end = t + ms; t < end; t += 33)
      for (const i of g.update(t, p) as Intent[]) if (out.at(-1) !== i.type || i.type !== 'buildCursor') out.push(i.type);
  return out;
}
const P = { x: 0.4, y: 0.6 };

describe('pinch to grab, move and drop (Build mode)', () => {
  it('hold the pinch: grab; move: cursor; open the fingers: drop', () => {
    expect(run([[500, P], [300, { x: 0.5, y: 0.5 }], [300, null]])).toEqual(['buildCursor', 'buildGrab', 'buildCursor', 'buildDrop']);
  });

  it('a quick pinch in passing does nothing', () => {
    expect(run([[BUILD_GRAB.holdMs - 60, P], [400, null]])).toEqual([]);
  });

  it('a tracking flicker while holding does not drop the module', () => {
    expect(run([[500, P], [66, null], [300, P], [300, null]])).toEqual(['buildCursor', 'buildGrab', 'buildCursor', 'buildDrop']);
  });

  it('after a drop, the next grab needs a fresh hold', () => {
    const out = run([[500, P], [300, null], [BUILD_GRAB.holdMs - 60, P], [300, null]]);
    expect(out.filter((x) => x === 'buildGrab')).toHaveLength(1);
  });
});
