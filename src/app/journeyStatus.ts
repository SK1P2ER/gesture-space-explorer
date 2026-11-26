// SPCE-LINE Orbital Journey (Sprint 2): the journey message for one route, Tanegashima Spaceport ('cape') → Jezero
// Dome ('jezero'), derived from the mission and scene state each frame. Pure: no DOM, no clock. Elapsed time is used
// for visual transitions only (the view), never to decide a phase.

export const JOURNEY_ROUTE = { from: 'cape', to: 'jezero' } as const;

/** departing: countdown and the launch presentation; transit: the flight; preparing: landing and the destination
 * scene getting ready; failed: the destination could not be prepared (recoverable); arrived: the destination is
 * interactive. */
export type JourneyPhase = 'departing' | 'transit' | 'preparing' | 'failed' | 'arrived';
export type PrepState = 'idle' | 'loading' | 'ready' | 'failed';

export interface JourneySnapshot {
  mode: string;
  /** The base you are at (BaseView, Launch) or landing on (Docking). */
  baseId: string | null;
  destinationId: string | null;
  countdown: boolean;
  presenting: boolean;
  trip: { from: string; to: string } | null;
  horizon: boolean;
  prep: PrepState;
}

/** Is this snapshot part of the route's departure or flight (the only ways onto the route)? */
function startsRoute(s: JourneySnapshot) {
  if (s.mode === 'launch') return s.baseId === JOURNEY_ROUTE.from && s.destinationId === JOURNEY_ROUTE.to;
  if (s.mode === 'travel') return s.trip?.from === JOURNEY_ROUTE.from && s.trip?.to === JOURNEY_ROUTE.to;
  return false;
}

/**
 * The phase for a snapshot. `onRoute` says the journey was seen leaving Tanegashima for Jezero (docking and the base
 * view at Jezero alone do not say where the rocket came from). Null: no journey message (other routes, a cancelled
 * departure, exploring, leaving).
 */
export function deriveJourney(s: JourneySnapshot, onRoute: boolean): JourneyPhase | null {
  if (startsRoute(s)) return s.mode === 'launch' ? 'departing' : 'transit';
  if (!onRoute || s.baseId !== JOURNEY_ROUTE.to) return null;
  if (s.mode === 'docking') return 'preparing';
  if (s.mode !== 'baseView' || s.horizon) return null;
  if (s.prep === 'ready') return 'arrived';
  if (s.prep === 'failed') return 'failed';
  return 'preparing';
}

/** Keeps "on the route" across the frames where the snapshot alone can't tell (docking, the base view at Jezero). */
export class JourneyTracker {
  private onRoute = false;
  phase: JourneyPhase | null = null;
  update(s: JourneySnapshot): JourneyPhase | null {
    if (startsRoute(s)) this.onRoute = true;
    const phase = deriveJourney(s, this.onRoute);
    if (phase === null) this.onRoute = false;
    this.phase = phase;
    return phase;
  }
  /** Ends the journey (exploring started): later frames show nothing until the route starts again. */
  end() { this.onRoute = false; this.phase = null; }
}

export type JourneySim = 'none' | 'slow' | 'fail';

/**
 * Getting the destination ready after touchdown. Ready once the scene has been interactive for two updates in a row
 * (it exists and a frame was drawn between). A simulation (?journeysim=slow|fail, dev or ?debug) delays it, or fails
 * the first attempt; Try again (retry) starts a new attempt.
 */
export class DestinationPrep {
  state: PrepState = 'idle';
  attempts = 0;
  private startedAt = 0;
  private seen = 0;
  constructor(readonly sim: JourneySim = 'none', readonly delayMs = 4000) {}
  begin(now: number) { this.state = 'loading'; this.startedAt = now; this.seen = 0; this.attempts++; }
  retry(now: number) { if (this.state === 'failed') this.begin(now); }
  reset() { this.state = 'idle'; this.attempts = 0; this.seen = 0; }
  update(now: number, interactive: boolean) {
    if (this.state !== 'loading') return;
    this.seen = interactive ? this.seen + 1 : 0;
    if (this.sim !== 'none' && now - this.startedAt < this.delayMs) return;
    if (this.sim === 'fail' && this.attempts === 1) { this.state = 'failed'; return; }
    if (this.seen >= 2) this.state = 'ready';
  }
}

export function parseJourneySim(search: string, allowed: boolean): JourneySim {
  if (!allowed) return 'none';
  const v = new URLSearchParams(search).get('journeysim');
  return v === 'slow' || v === 'fail' ? v : 'none';
}
