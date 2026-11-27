// What a page load starts with, decided from the facts it has (pure; main.ts acts on the answer).
//  - offer:   a saved journey to continue (Continue / Start fresh)
//  - link:    the place the link names
//  - ground:  free mode's start on Earth, the Tanegashima ground view
//  - default: the app's own start (the overview), unchanged for the flag-off app and Guided
import type { MissionCheckpoint } from './checkpoint';

export interface StartFacts {
  /** Free mode: the picker flow (?flags=picker3d) without Guided. */
  freeMode: boolean;
  /** A Guided session is under way: Guided keeps its own start and recovery. */
  guidedActive: boolean;
  /** The saved checkpoint, if any. */
  saved: (Pick<MissionCheckpoint, 'phase' | 'baseId' | 'destinationId'> & Partial<Pick<MissionCheckpoint, 'trip' | 'dock'>>) | null;
  /** The link's place, as parsed (body is set whenever the link names a place). */
  link: { base?: string; body?: string };
}
export type StartPlan = 'offer' | 'link' | 'ground' | 'default';

/** Resting at Earth's base with nothing begun (no destination chosen, no trip, no landing): nothing to continue. */
export function idleAtCape(saved: StartFacts['saved']): boolean {
  return !!saved && saved.phase === 'base' && saved.baseId === 'cape' && !saved.destinationId && !saved.trip && !saved.dock;
}

const free = (f: StartFacts) => f.freeMode && !f.guidedActive;

export function startPlan(f: StartFacts): StartPlan {
  // A saved journey is offered unless the link names another place; in free mode an idle Cape is no journey.
  const offer = !!f.saved && (!f.link.base || f.link.base === f.saved.baseId) && !(free(f) && idleAtCape(f.saved));
  if (offer) return 'offer';
  if (f.link.body !== undefined) return 'link';
  return free(f) ? 'ground' : 'default';
}

/** Start fresh was chosen: free mode goes to the Earth ground view, over any link; otherwise the link, or the app's own start. */
export function afterStartFresh(f: StartFacts): Exclude<StartPlan, 'offer'> {
  if (free(f)) return 'ground';
  return f.link.body !== undefined ? 'link' : 'default';
}
