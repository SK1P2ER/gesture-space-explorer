// Camera lifecycle events for the debug diagnostics (?debug → Diagnostics). camera.ts and tracking.ts report here;
// nothing listens unless a diagnostics session is recording, so in normal use every report is a null check.
// Local only: ids are counters made here, never device ids, labels or the streams themselves.

export interface TrackInfo { trackId: string; kind: string; readyState: MediaStreamTrackState }
export type CameraEvent =
  | { type: 'session-created'; sessionId: number }
  | { type: 'hidden-handled'; sessionId: number }
  | { type: 'session-disposed'; sessionId: number; reason: string; current: boolean }
  | { type: 'tracking-started'; sessionId: number }
  | { type: 'gum-requested'; requestId: number; sessionId: number }
  | { type: 'gum-resolved'; requestId: number; tracks: TrackInfo[] }
  | { type: 'gum-rejected'; requestId: number; code: string }
  | { type: 'track-stop-requested'; trackId: string; readyStateAfter: MediaStreamTrackState }
  | { type: 'track-ended'; trackId: string }
  | { type: 'restart-requested'; accepted: boolean };

/** The tracking session as it is now, for a diagnostics session started while the camera is already on. */
export interface CameraSnapshot {
  sessionId: number | null;
  stopped: boolean;
  status: string;
  tracks: MediaStreamTrack[];
  pendingRequestIds: number[];
}

/** The second argument carries the tracks themselves, so a recorder can read their state later; it never exports them. */
export type CameraEventSink = (event: CameraEvent, tracks?: readonly MediaStreamTrack[]) => void;

let sink: CameraEventSink | null = null;
let snapshotProvider: (() => Omit<CameraSnapshot, 'pendingRequestIds'> | null) | null = null;
let nextRequestId = 0;
let unnamed = 0;
const pending = new Set<number>();
const ids = new WeakMap<MediaStreamTrack, string>();

const info = (track: MediaStreamTrack): TrackInfo => ({ trackId: cameraEvents.idOf(track), kind: track.kind, readyState: track.readyState });

export const cameraEvents = {
  attach(next: CameraEventSink) {
    if (sink) throw new Error('a camera event sink is already attached');
    sink = next;
  },
  detach(current: CameraEventSink) {
    if (sink === current) sink = null;
  },
  attached: () => sink !== null,
  emit(event: CameraEvent) {
    sink?.(event);
  },
  /** Before each getUserMedia call. Returns the request's id, which its answer is reported with. */
  request(sessionId: number): number {
    const requestId = ++nextRequestId;
    pending.add(requestId);
    sink?.({ type: 'gum-requested', requestId, sessionId });
    return requestId;
  },
  resolved(requestId: number, tracks: readonly MediaStreamTrack[]) {
    pending.delete(requestId);
    tracks.forEach((track, i) => ids.set(track, `${requestId}.${i + 1}`));
    if (sink) sink({ type: 'gum-resolved', requestId, tracks: tracks.map(info) }, tracks);
  },
  rejected(requestId: number, code: string) {
    pending.delete(requestId);
    sink?.({ type: 'gum-rejected', requestId, code });
  },
  /** Right after track.stop(): what the track says about itself then (asked to stop is not the same as stopped). */
  stopped(track: MediaStreamTrack) {
    if (sink) sink({ type: 'track-stop-requested', trackId: cameraEvents.idOf(track), readyStateAfter: track.readyState }, [track]);
  },
  ended(track: MediaStreamTrack) {
    if (sink) sink({ type: 'track-ended', trackId: cameraEvents.idOf(track) }, [track]);
  },
  /** A track got before anyone listened has no request id: it is named here, once. */
  idOf(track: MediaStreamTrack): string {
    let id = ids.get(track);
    if (!id) { id = `pre.${++unnamed}`; ids.set(track, id); }
    return id;
  },
  pendingRequests: () => [...pending],
  provideSnapshot(provider: typeof snapshotProvider) {
    snapshotProvider = provider;
  },
  snapshot(): CameraSnapshot | null {
    const now = snapshotProvider?.();
    return now ? { ...now, pendingRequestIds: [...pending] } : null;
  },
  /** Tests only: forget every request, name and listener. */
  reset() {
    sink = null;
    nextRequestId = 0;
    unnamed = 0;
    pending.clear();
  },
};
