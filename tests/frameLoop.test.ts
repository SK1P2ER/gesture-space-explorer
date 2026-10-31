import { describe, expect, it } from 'vitest';
import { PHASE_ORDER, runFrame, type FramePhases } from '../src/app/frameLoop';

/** Phases that log their calls, around a stand-in world: simulateWorld places the planets for the frame's date. */
function recorder() {
  const calls: string[] = [];
  const world = { frame: 0, placedFor: -1 };
  const seenByLink: number[] = [];
  const phases = Object.fromEntries(PHASE_ORDER.map((name) => [name, () => calls.push(name)])) as unknown as FramePhases;
  phases.start = () => { world.frame++; calls.push('start'); };
  phases.simulateWorld = () => { world.placedFor = world.frame; calls.push('simulateWorld'); };
  // main.ts applies a pending deep link here: it focuses a body where this frame put it.
  phases.applyInput = () => { seenByLink.push(world.placedFor === world.frame ? world.frame : -1); calls.push('applyInput'); };
  return { calls, phases, seenByLink };
}

describe('frame loop: named phases in a fixed order', () => {
  it('runs every phase once per frame, in order', () => {
    const { calls, phases } = recorder();
    runFrame(phases, 16);
    expect(calls).toEqual([...PHASE_ORDER]);
    runFrame(phases, 32);
    expect(calls).toEqual([...PHASE_ORDER, ...PHASE_ORDER]);
  });

  it('a deep link is applied after the planets are placed for that frame, on the very first frame too', () => {
    // A link with a date opens there: its body and base are where that date puts them, not where the
    // planets were before the first update (app/deepLink.ts, main.ts applyLink).
    expect(PHASE_ORDER.indexOf('applyInput')).toBeGreaterThan(PHASE_ORDER.indexOf('simulateWorld'));
    const { phases, seenByLink } = recorder();
    runFrame(phases, 16);
    runFrame(phases, 32);
    expect(seenByLink).toEqual([1, 2]); // never -1: never ahead of this frame's planets
  });

  it('the scene is updated from this frame\'s mission state, rendered, and only then the UI reads it', () => {
    const at = (name: (typeof PHASE_ORDER)[number]) => PHASE_ORDER.indexOf(name);
    expect(at('simulateMission')).toBeLessThan(at('updateScene'));
    expect(at('updateScene')).toBeLessThan(at('render'));
    expect(at('render')).toBeLessThan(at('updateUi'));
    expect([PHASE_ORDER[0], PHASE_ORDER.at(-1)]).toEqual(['start', 'end']); // CPU time spans the whole frame
  });
});
