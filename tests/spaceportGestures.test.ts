import { describe, expect, it } from 'vitest';
import { HOME_HOLD_MS, SpaceportGestures, type GestureInput, type GestureOutcome, type GestureTarget } from '../src/app/spaceportGestures';
import type { Pose } from '../src/gestures/perception';

const VIEW = { width: 1000, height: 1000 };
const A: GestureTarget = { id: 'next', rect: { left: 900, top: 400, right: 980, bottom: 600 } };
const B: GestureTarget = { id: 'prev', rect: { left: 20, top: 400, right: 100, bottom: 600 } };
const TARGETS = [A, B];
const at = (target: GestureTarget) => ({ x: (target.rect.left + target.rect.right) / 2 / VIEW.width, y: (target.rect.top + target.rect.bottom) / 2 / VIEW.height });

/** A detection stream at ~30 fps. */
function rig(targets: readonly GestureTarget[] = TARGETS) {
  const g = new SpaceportGestures();
  let t = 0;
  const outcomes: GestureOutcome[] = [];
  const frame = (input: Partial<GestureInput>, list = targets) => {
    t += 33;
    const o = g.observe({ t, pose: null, pointer: null, thumbsUp: false, hand: true, ...input }, list, VIEW);
    outcomes.push(o);
    return o;
  };
  const run = (ms: number, input: Partial<GestureInput>, list = targets) => { for (let s = 0; s < ms; s += 33) frame(input, list); };
  const point = (target: GestureTarget, ms: number) => run(ms, { pose: 'point' as Pose, pointer: at(target) });
  // The engine reports 👍 as a fist with thumbsUp (as in the picker's browser test).
  const thumb = (ms: number) => run(ms, { pose: 'fist' as Pose, thumbsUp: true });
  const acts = () => outcomes.filter(o => o.act).map(o => o.act);
  return { g, frame, run, point, thumb, acts, outcomes };
}

describe('spaceport gestures: 👆 dwell arms, 👍 acts once', () => {
  it('arms only after the full dwell, and the ring fills on the target', () => {
    const r = rig();
    r.point(A, 300);
    expect(r.g.focus).toBe('next'); expect(r.g.armed).toBeNull();
    expect(r.g.dwellProgress).toBeGreaterThan(0.5); expect(r.g.dwellProgress).toBeLessThan(1);
    r.point(A, 250);
    expect(r.g.armed).toBe('next'); expect(r.g.dwellProgress).toBe(1);
  });

  it('a 👍 without an armed target does nothing', () => {
    const r = rig(); r.thumb(1500);
    expect(r.acts()).toEqual([]);
  });

  it('👍 held acts exactly once; holding on acts no more; a seen release re-arms it', () => {
    const r = rig();
    r.point(A, 600); r.thumb(1500);
    expect(r.acts()).toEqual(['next']);
    r.run(200, { pose: 'none' }); // the hand, seen without 👍
    r.thumb(600);
    expect(r.acts()).toEqual(['next', 'next']);
  });

  it('a hand leaving the frame is not a release: the 👍 that comes back acts nothing', () => {
    const r = rig();
    r.point(A, 600); r.thumb(600);
    expect(r.acts()).toEqual(['next']);
    r.run(150, { hand: false }); // within the grace: still armed, still owed a release
    r.thumb(800);
    expect(r.acts()).toEqual(['next']);
  });
});

describe('spaceport gestures: ✊ cancel and the hand leaving', () => {
  it('a 👍 is not a cancel, and a brief fist on the way from 👆 to 👍 is not one either', () => {
    const r = rig();
    r.point(A, 600);
    r.run(150, { pose: 'fist' });                 // transition, shorter than the grace
    expect(r.g.armed).toBe('next');
    r.thumb(600);
    expect(r.acts()).toEqual(['next']);
    expect(r.outcomes.filter(o => o.cancelled)).toHaveLength(0);
  });

  it('✊ cancels the armed target, reports it once, and the next 👍 acts nothing', () => {
    const r = rig();
    r.point(A, 600);
    r.run(300, { pose: 'fist' });
    expect(r.outcomes.filter(o => o.cancelled)).toHaveLength(1);
    expect(r.g.armed).toBeNull();
    r.thumb(1000);
    expect(r.acts()).toEqual([]);
  });

  it('the hand gone longer than the grace cancels the armed target', () => {
    const r = rig();
    r.point(A, 600);
    r.run(400, { hand: false });
    expect(r.g.armed).toBeNull();
    r.thumb(1000);
    expect(r.acts()).toEqual([]);
  });
});

describe('spaceport gestures: no leftover charge (owner regression list, 2026-11-21)', () => {
  it('preview closed mid-hold: reopened with the 👍 still up, nothing happens until a seen release and a fresh dwell', () => {
    const r = rig();
    r.point(A, 600); r.thumb(300);              // charge 300 of 500 ms
    r.g.reset();                                 // preview closed (and reopened)
    expect(r.g.armed).toBeNull(); expect(r.g.confirmProgress).toBe(0);
    r.thumb(1000);
    expect(r.acts()).toEqual([]);
    r.point(A, 600); r.thumb(300);               // the point is a seen release; a fresh hold must be full
    expect(r.acts()).toEqual([]);
    r.thumb(300);
    expect(r.acts()).toEqual(['next']);
  });

  it('hand lost mid-hold: the charge is gone when the hand returns', () => {
    const r = rig();
    r.point(A, 600); r.thumb(400);
    r.run(500, { hand: false });
    r.point(A, 600); r.thumb(250);
    expect(r.acts()).toEqual([]);
    r.thumb(400);
    expect(r.acts()).toEqual(['next']);
  });

  it('target changed mid-hold: the new target starts from zero and needs its own full 👍', () => {
    const r = rig();
    r.point(A, 600); r.thumb(400);
    r.point(B, 600);
    expect(r.g.armed).toBe('prev'); expect(r.g.confirmProgress).toBe(0);
    r.thumb(250);
    expect(r.acts()).toEqual([]);
    r.thumb(400);
    expect(r.acts()).toEqual(['prev']);
  });

  it('owner hands-on case: after an act, 👍 held out of frame past the grace and back in acts nothing; it takes a release, a fresh dwell and a fresh 👍', () => {
    const r = rig();
    r.point(A, 600); r.thumb(600);
    expect(r.acts()).toEqual(['next']);
    r.run(400, { hand: false });                 // left the frame with 👍 up, longer than the 200 ms grace
    expect(r.g.armed).toBeNull();                // the target is disarmed
    r.thumb(1500);                               // back in with the same 👍, held
    expect(r.acts()).toEqual(['next']);
    r.point(A, 300);                             // thumb down and pointing (a seen release), but the dwell isn't full
    r.thumb(800);
    expect(r.acts()).toEqual(['next']);
    r.point(A, 600); r.thumb(600);               // a full dwell on Next, then a fresh 👍
    expect(r.acts()).toEqual(['next', 'next']);
  });

  it('owner hands-on case: the hand stays in frame and the thumb drops: Next stays armed and a fresh 👍 acts once more', () => {
    const r = rig();
    r.point(A, 600); r.thumb(600);
    r.run(200, { pose: 'none' });                // thumb down, hand still seen
    expect(r.g.armed).toBe('next');
    r.thumb(600);
    expect(r.acts()).toEqual(['next', 'next']);
  });

  it('stale target: arm A, 👆 B for less than the dwell, then 👍: neither acts; B confirms only after its own dwell', () => {
    const r = rig();
    r.point(A, 600);
    expect(r.g.armed).toBe('next');
    r.point(B, 300);                             // B takes the focus but has not dwelled 450 ms
    expect(r.g.armed).toBeNull(); expect(r.g.focus).toBe('prev');
    r.thumb(1200);
    expect(r.acts()).toEqual([]);
    r.point(B, 600); r.thumb(600);               // the point is a seen release; B's own dwell, then a fresh 👍
    expect(r.acts()).toEqual(['prev']);
  });

  it('stale target, quickest case: arm A, one frame on B, straight to 👍: nothing acts', () => {
    const r = rig();
    r.point(A, 600);
    r.point(B, 33);                              // inside the boundary grace, but the 👆 ended on B
    r.thumb(1200);
    expect(r.acts()).toEqual([]);
  });

  it('jitter onto a neighbour inside the boundary grace keeps A armed when the 👆 comes back', () => {
    const r = rig();
    r.point(A, 600);
    r.point(B, 66);                              // two frames, shorter than PICKER.boundaryGraceMs
    r.point(A, 66);
    expect(r.g.armed).toBe('next');
    r.thumb(600);
    expect(r.acts()).toEqual(['next']);
  });

  it('repeated confirmation on the same target still works after a seen release', () => {
    const r = rig();
    r.point(A, 600); r.thumb(600);
    r.run(100, { pose: 'none' }); r.thumb(600);
    r.run(100, { pose: 'none' }); r.thumb(600);
    expect(r.acts()).toEqual(['next', 'next', 'next']);
  });

  it('a target that disappears (scrolled out, preview changed) is disarmed', () => {
    const r = rig();
    r.point(A, 600);
    r.frame({ pose: 'none' }, [B]);
    expect(r.g.armed).toBeNull();
    r.thumb(1000);
    expect(r.acts()).toEqual([]);
  });
});

describe('spaceport gestures: the hint follows the state', () => {
  it('point → hold 👍 → lower the thumb → hold again; ✊, hand lost and reset go back to point', () => {
    const r = rig();
    r.run(100, { pose: 'none' });
    expect(r.g.hint).toBe('point');
    r.point(A, 300); expect(r.g.hint).toBe('point');   // dwelling, not armed yet
    r.point(A, 300); expect(r.g.hint).toBe('hold');
    r.thumb(600); expect(r.g.hint).toBe('release');     // acted; the 👍 is still up
    r.run(100, { pose: 'none' }); expect(r.g.hint).toBe('hold');
    r.run(300, { pose: 'fist' }); expect(r.g.hint).toBe('point');
    r.point(A, 600); r.run(400, { hand: false }); expect(r.g.hint).toBe('point');
    r.point(A, 600); r.g.reset(); expect(r.g.hint).toBe('point');
  });
});

describe('spaceport gestures: ✋ home', () => {
  it('✋ held 1 s goes home once per palm and clears the armed target', () => {
    const r = rig();
    r.point(A, 600);
    r.run(HOME_HOLD_MS - 100, { pose: 'palm' });
    expect(r.outcomes.filter(o => o.home)).toHaveLength(0);
    r.run(300, { pose: 'palm' });
    expect(r.outcomes.filter(o => o.home)).toHaveLength(1);
    expect(r.g.armed).toBeNull();
    r.run(1500, { pose: 'palm' });
    expect(r.outcomes.filter(o => o.home)).toHaveLength(1);
    r.run(100, { pose: 'none' }); r.run(HOME_HOLD_MS + 100, { pose: 'palm' });
    expect(r.outcomes.filter(o => o.home)).toHaveLength(2);
  });
});
