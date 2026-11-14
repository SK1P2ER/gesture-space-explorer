// Debug-only diagnostics (?debug → Diagnostics): one explicitly started and stopped recording of frame timing per
// scene, the camera's lifecycle events, and machine checks of the hidden-page camera rules. Loaded on demand, local
// only, and exported by the tester as one JSON file. It never asks for the camera itself.
//
// What it is not: GPU time, presented or dropped frames, sensor-to-display latency or the OS camera indicator. Frame
// intervals are end-of-frame to end-of-frame times on the page's own clock.
import { cameraEvents, type CameraEvent, type CameraEventSink, type TrackInfo } from './cameraEvents';

export const SCHEMA = 'gse-diagnostics/1';
export const BIN_MS = 0.5;
const BINS = 500; // 0 … 250 ms
const OVERFLOW_MS = BIN_MS * BINS;
const OVERFLOW_VALUES = 64;
export const MAX_SEGMENTS = 256;
export const MAX_EVENTS = 2000;
/** Track references kept to read their state later (live ones only), and pending 2 s state checks. */
export const MAX_TRACKS = 16;
export const MAX_CHECKS = 8;
/** A state check that cannot run within this long after it was due (no frames: hidden, or stalled) is dropped. */
const CHECK_LATE_MS = 1000;
export const WARMUP_MS = 2000;
/** A frame gap this long with no visibility event may be a suspension the page never heard about. */
const GAP_MS = 1000;
/** A4: visible time to watch for an automatic restart. A5: time to judge one restart. */
const A4_MS = 10_000;
const A5_MS = 15_000;
const A5_LIVE_MS = 2_000;
const TEXT_MAX = 80;
const NOTES_MAX = 2000;
const QUERY_KEYS = ['flags', 'lang', 'base', 'debug'];
const PERCENTILE_METHOD = `nearest-rank over ${BIN_MS} ms bins (approximate: the bin's bounds are reported); intervals of ${OVERFLOW_MS} ms or more are counted separately, the smallest ${OVERFLOW_VALUES} kept exactly: a rank among them is exact, a rank beyond them is reported as bounds`;

export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export type Percentile = { approximate: true; lowMs: number; highMs: number } | { overflow: true; atLeastMs: number; atMostMs: number; exactMs: number | null };

/** Fixed bins: constant memory, one increment per sample. Exact count, sum and max; overflow kept apart, never clamped. */
export class Histogram {
  private readonly bins = new Uint32Array(BINS);
  count = 0;
  sum = 0;
  max = 0;
  private overflow = 0;
  private readonly overflowValues: number[] = [];

  add(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.count++;
    this.sum += ms;
    if (ms > this.max) this.max = ms;
    if (ms >= OVERFLOW_MS) {
      this.overflow++;
      // Keep the smallest values, sorted: then the n-th smallest overflow value is known exactly for every n they cover.
      const v = round(ms);
      const kept = this.overflowValues;
      if (kept.length < OVERFLOW_VALUES || v < kept[kept.length - 1]) {
        if (kept.length === OVERFLOW_VALUES) kept.pop();
        let i = kept.length;
        while (i > 0 && kept[i - 1] > v) i--;
        kept.splice(i, 0, v);
      }
    } else this.bins[Math.floor(ms / BIN_MS)]++;
  }

  percentile(fraction: number): Percentile | null {
    if (!this.count) return null;
    const rank = Math.max(1, Math.ceil(fraction * this.count));
    let seen = 0;
    for (let k = 0; k < BINS; k++) {
      seen += this.bins[k];
      if (seen >= rank) return { approximate: true, lowMs: k * BIN_MS, highMs: (k + 1) * BIN_MS };
    }
    // The rank falls among the overflow values: exact only if the kept (smallest) values reach it, otherwise a bound.
    const nth = rank - seen - 1;
    const kept = this.overflowValues;
    const atMostMs = round(this.max);
    if (nth < kept.length) return { overflow: true, atLeastMs: OVERFLOW_MS, atMostMs, exactMs: kept[nth] };
    return { overflow: true, atLeastMs: kept.length ? kept[kept.length - 1] : OVERFLOW_MS, atMostMs, exactMs: null };
  }

  summary() {
    return {
      count: this.count,
      sumMs: round(this.sum),
      maxMs: this.count ? round(this.max) : null,
      p50: this.percentile(0.5),
      p95: this.percentile(0.95),
      overflow: { count: this.overflow, atLeastMs: OVERFLOW_MS, kept: 'smallest', values: [...this.overflowValues], valuesComplete: this.overflowValues.length === this.overflow },
      percentileMethod: PERCENTILE_METHOD,
    };
  }
}
/** Frame intervals: FPS = 1000 × intervals / summed interval time. Never an average of FPS values. */
function frameStats(h: Histogram) {
  const { count, ...rest } = h.summary();
  return { intervals: count, fps: count ? round((1000 * count) / h.sum) : null, ...rest };
}
const round = (n: number) => Math.round(n * 100) / 100;

export interface DiagnosticsContext {
  mode: string;
  spaceport: boolean;
  phase: 'countdown' | 'horizon' | 'none';
  camera: string;
  tier: string;
  renderScale: number;
  pixelRatio: number;
  loading: boolean;
}
export interface BuildInfo { appVersion: string; entryChunk: string | null; diagnosticsChunk: string | null; loadedAssets: string[] }
export interface PageInfo { origin: string; path: string; query: Record<string, string> }
export interface DeviceInfo { userAgent: string; viewport: [number, number]; dpr: number }
export interface Entered { model?: string; os?: string; browser?: string; lowPower?: string; charging?: string; screenRecording?: string }
interface VisibilityTarget extends EventTarget { visibilityState: DocumentVisibilityState }
export interface SessionOptions {
  scenario: string;
  now: () => number;
  wallNow: () => number;
  doc: VisibilityTarget;
  win: EventTarget;
  build: BuildInfo;
  page: PageInfo;
  device: DeviceInfo;
}

/** Only the query keys the app reads for a test link; everything else (tokens, unknown keys) is left out. */
export function pageInfo(url: URL): PageInfo {
  const query: Record<string, string> = {};
  for (const key of QUERY_KEYS) { const v = url.searchParams.get(key); if (v !== null) query[key] = v; }
  return { origin: url.origin, path: url.pathname, query };
}

type RecordedEvent = (CameraEvent | { type: 'snapshot'; sessionId: number | null; stopped: boolean; status: string; tracks: TrackInfo[]; pendingRequestIds: number[] }
  | { type: 'visibility'; state: DocumentVisibilityState }
  | { type: 'pagehide'; persisted: boolean }
  | { type: 'unobserved-gap'; gapMs: number }
  | { type: 'track-state'; trackId: string; kind: string; readyState: MediaStreamTrackState; source: 'visible-recheck' | 'restart-check' }) & { t: number };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export interface SegmentKey { scenario: string; mode: string; spaceport: boolean; phase: string; camera: string; visibility: 'visible'; tier: string; loading: boolean }

interface Segment {
  key: SegmentKey | 'mixed';
  keyString: string;
  start: number;
  end: number;
  frames: number;
  warmupReason: 'start' | 'visible' | 'scene' | 'tier' | 'loading-ended' | null;
  warmupUntil: number;
  last: number | null;
  warmup: Histogram;
  steady: Histogram;
  inference: Histogram;
  gesture: Histogram;
  detectionToRender: Histogram;
  scale: Range;
  pixelRatio: Range;
  truncated: boolean;
}
interface Range { min: number; max: number; weighted: number; weightMs: number; changes: number; last: number | null }
const range = (): Range => ({ min: Infinity, max: -Infinity, weighted: 0, weightMs: 0, changes: 0, last: null });
function note(r: Range, value: number, dtMs: number) {
  if (r.last !== null && value !== r.last) r.changes++;
  if (r.last !== null && dtMs > 0) { r.weighted += r.last * dtMs; r.weightMs += dtMs; }
  r.min = Math.min(r.min, value);
  r.max = Math.max(r.max, value);
  r.last = value;
}
const rangeJson = (r: Range) => (r.last === null ? null : { min: r.min, max: r.max, timeWeightedMean: r.weightMs ? round(r.weighted / r.weightMs) : r.last, changes: r.changes });

let recording: DiagnosticsSession | null = null;

export class DiagnosticsSession {
  private readonly events: RecordedEvent[] = [];
  private dropped = 0;
  private firstDropAt: number | null = null;
  private readonly segments: Segment[] = [];
  private segment: Segment | null = null;
  private nextWarmup: Segment['warmupReason'] = 'start';
  private previous: DiagnosticsContext | null = null;
  private readonly tracks = new Map<string, MediaStreamTrack>();
  private readonly checks: { due: number; trackIds: string[] }[] = [];
  /** What could not be kept: from then on, camera evidence is incomplete and cannot PASS. */
  private tracksNotRetained = 0;
  private checksDropped = 0;
  private checksExpired = 0;
  private coverageLostAt: number | null = null;
  private pendingDetect: number | null = null;
  private readonly hook = new Histogram();
  private visibilityAt = -Infinity;
  private lastVisibility: DocumentVisibilityState = 'visible';
  private t0 = 0;
  private startedAt = 0;
  private running = false;
  private readonly sink: CameraEventSink = (event, tracks) => this.camera(event, tracks);
  private readonly onVisibility = () => this.visibility();
  private readonly onPageHide = (e: Event) => this.record({ type: 'pagehide', persisted: Boolean((e as PageTransitionEvent).persisted) });

  constructor(private readonly o: SessionOptions) {}

  start() {
    if (recording) throw new Error('a diagnostics session is already recording');
    recording = this;
    this.running = true;
    this.t0 = this.o.now();
    this.startedAt = this.o.wallNow();
    this.lastVisibility = this.o.doc.visibilityState;
    cameraEvents.attach(this.sink);
    this.o.doc.addEventListener('visibilitychange', this.onVisibility);
    this.o.win.addEventListener('pagehide', this.onPageHide);
    const snap = cameraEvents.snapshot();
    for (const track of snap?.tracks ?? []) this.keep(cameraEvents.idOf(track), track);
    this.record({
      type: 'snapshot', sessionId: snap?.sessionId ?? null, stopped: snap?.stopped ?? true, status: snap?.status ?? 'none',
      tracks: (snap?.tracks ?? []).map((t) => ({ trackId: cameraEvents.idOf(t), kind: t.kind, readyState: t.readyState })), pendingRequestIds: snap?.pendingRequestIds ?? [],
    });
  }

  private rel() { return round(this.o.now() - this.t0); }
  private record(e: DistributiveOmit<RecordedEvent, 't'>) {
    if (this.events.length >= MAX_EVENTS) {
      this.dropped++;
      this.firstDropAt ??= this.rel();
      return;
    }
    this.events.push({ ...e, t: this.rel() } as RecordedEvent);
  }

  private camera(event: CameraEvent, tracks?: readonly MediaStreamTrack[]) {
    if (!this.running) return;
    // The app's own visibilitychange listener can run before ours: record the transition, read from the page, first.
    this.visibility();
    this.record(event);
    // A track confirmed ended needs no more watching.
    if ((event.type === 'track-stop-requested' && event.readyStateAfter === 'ended') || event.type === 'track-ended') this.tracks.delete(event.trackId);
    if (event.type === 'gum-resolved' && tracks) {
      const live = event.tracks.filter((t, i) => t.readyState === 'live' && this.keep(t.trackId, tracks[i])).map((t) => t.trackId);
      if (live.length) this.check(live);
    }
  }

  private lose() { this.coverageLostAt ??= this.rel(); }
  /** Keeps a live track to read its state later, within the cap and while the log still records. */
  private keep(trackId: string, track: MediaStreamTrack): boolean {
    if (track.readyState !== 'live') return false;
    if (this.tracks.has(trackId)) return true;
    if (this.tracks.size >= MAX_TRACKS || this.dropped) { this.tracksNotRetained++; this.lose(); return false; }
    this.tracks.set(trackId, track);
    return true;
  }
  private check(trackIds: string[]) {
    if (this.checks.length >= MAX_CHECKS || this.dropped) { this.checksDropped++; this.lose(); return; }
    this.checks.push({ due: this.o.now() + A5_LIVE_MS, trackIds });
  }

  private readTracks(source: 'visible-recheck' | 'restart-check', only?: string[]) {
    for (const [trackId, track] of this.tracks) {
      if (source === 'visible-recheck' || only?.includes(trackId)) {
        this.record({ type: 'track-state', trackId, kind: track.kind, readyState: track.readyState, source });
        if (track.readyState === 'ended') this.tracks.delete(trackId);
      }
    }
  }

  /** How many track references and pending checks are held now (tests). */
  retained() { return { tracks: this.tracks.size, checks: this.checks.length }; }

  /** Records a visibility transition once, whichever notices it first: our listener or a camera event read during it. */
  private visibility() {
    if (!this.running) return;
    const state = this.o.doc.visibilityState;
    if (state === this.lastVisibility) return;
    this.lastVisibility = state;
    this.visibilityAt = this.o.now();
    this.record({ type: 'visibility', state });
    if (state === 'visible') this.readTracks('visible-recheck');
    // A hidden interval is never a frame interval: the next frame starts a fresh baseline.
    if (this.segment?.truncated) this.segment.last = null;
    else this.segment = null;
    this.nextWarmup = state === 'visible' ? 'visible' : this.nextWarmup;
    this.pendingDetect = null;
  }

  /** Once per rendered frame, with the frame's end time. The context is read only while recording. */
  frame(t: number, context: () => DiagnosticsContext) {
    if (!this.running) return;
    const hookStart = this.o.now();
    if (this.o.doc.visibilityState === 'visible') {
      const c = context();
      const seg = this.segmentFor(t, c);
      if (seg.last !== null) {
        const dt = t - seg.last;
        if (dt >= GAP_MS && this.visibilityAt < seg.last) this.record({ type: 'unobserved-gap', gapMs: round(dt) });
        (t <= seg.warmupUntil ? seg.warmup : seg.steady).add(dt);
        note(seg.scale, c.renderScale, dt);
        note(seg.pixelRatio, c.pixelRatio, dt);
      } else {
        note(seg.scale, c.renderScale, 0);
        note(seg.pixelRatio, c.pixelRatio, 0);
      }
      seg.frames++;
      seg.last = seg.end = t;
      if (this.pendingDetect !== null) { seg.detectionToRender.add(t - this.pendingDetect); this.pendingDetect = null; }
      const now = this.o.now();
      for (let i = this.checks.length - 1; i >= 0; i--) {
        const { due, trackIds } = this.checks[i];
        if (due > now) continue;
        this.checks.splice(i, 1);
        // Too late to say anything about "2 s after": drop it rather than report a reading taken at another time.
        if (now - due > CHECK_LATE_MS) { this.checksExpired++; this.lose(); } else this.readTracks('restart-check', trackIds);
      }
      this.previous = c;
    }
    this.hook.add(this.o.now() - hookStart);
  }

  /** From the tracking loop: inference and gesture time; detection-to-render is closed by the next frame. */
  timing(t: number, detectMs: number, processingMs: number) {
    if (!this.running || !this.segment) return;
    this.segment.inference.add(detectMs);
    this.segment.gesture.add(processingMs);
    this.pendingDetect = t;
  }

  private segmentFor(t: number, c: DiagnosticsContext): Segment {
    const key: SegmentKey = { scenario: this.o.scenario, mode: c.mode, spaceport: c.spaceport, phase: c.phase, camera: c.camera, visibility: 'visible', tier: c.tier, loading: c.loading };
    const keyString = JSON.stringify(key);
    if (this.segment && (this.segment.keyString === keyString || this.segment.truncated)) return this.segment;
    let reason = this.nextWarmup;
    const p = this.previous;
    if (!reason && p) {
      if (p.mode !== c.mode || p.spaceport !== c.spaceport || p.phase !== c.phase) reason = 'scene';
      else if (p.tier !== c.tier) reason = 'tier';
      else if (p.loading && !c.loading) reason = 'loading-ended';
    }
    this.nextWarmup = null;
    const truncated = this.segments.length === MAX_SEGMENTS - 1;
    const seg: Segment = {
      key: truncated ? 'mixed' : key, keyString: truncated ? 'mixed' : keyString, start: t, end: t, frames: 0,
      warmupReason: reason, warmupUntil: reason ? t + WARMUP_MS : -Infinity, last: null,
      warmup: new Histogram(), steady: new Histogram(), inference: new Histogram(), gesture: new Histogram(), detectionToRender: new Histogram(),
      scale: range(), pixelRatio: range(), truncated,
    };
    this.segments.push(seg);
    this.segment = seg;
    return seg;
  }

  /** Stops collecting, detaches everything, and returns the frozen report. */
  stop(entered: Entered = {}, observations = '') {
    if (!this.running) throw new Error('this diagnostics session is not recording');
    const endT = this.rel();
    this.running = false;
    recording = null;
    cameraEvents.detach(this.sink);
    this.o.doc.removeEventListener('visibilitychange', this.onVisibility);
    this.o.win.removeEventListener('pagehide', this.onPageHide);
    const text = (s: unknown) => (typeof s === 'string' ? s.trim().slice(0, TEXT_MAX) : '');
    const report = {
      schema: SCHEMA,
      build: { ...this.o.build, method: 'served URL file names (Vite content-hashed)', byteIdentity: 'NOT VERIFIED' },
      page: this.o.page,
      deployment: null,
      device: {
        ...this.o.device,
        entered: { model: text(entered.model), os: text(entered.os), browser: text(entered.browser), lowPower: text(entered.lowPower), charging: text(entered.charging), screenRecording: text(entered.screenRecording) },
      },
      session: { scenario: this.o.scenario, startedAt: new Date(this.startedAt).toISOString(), stoppedAt: new Date(this.o.wallNow()).toISOString(), durationMs: endT, endedBy: 'stop' },
      segments: this.segments.map((s) => ({
        key: s.key, startMs: round(s.start - this.t0), endMs: round(s.end - this.t0), frames: s.frames, warmupReason: s.warmupReason,
        warmup: frameStats(s.warmup), steady: frameStats(s.steady),
        inference: s.inference.summary(), gestureProcessing: s.gesture.summary(), detectionToRender: s.detectionToRender.summary(),
        renderScale: rangeJson(s.scale), pixelRatio: rangeJson(s.pixelRatio),
        truncated: s.truncated, verdict: s.truncated ? 'INCONCLUSIVE' : 'NOT JUDGED',
      })),
      events: this.events,
      assertions: evaluate(this.events, endT, this.firstDropAt, this.coverageLostAt),
      observations: typeof observations === 'string' ? observations.trim().slice(0, NOTES_MAX) : '',
      notMeasured: ['GPU time', 'presented or dropped frames', 'sensor-to-display latency', 'OS camera indicator', 'thermal and battery state', 'WebGL context loss (handled by the app, not reported here)'],
      observer: { frameHookMs: this.hook.summary(), note: 'self-measured: one performance.now() pair per frame around the recorder; excludes garbage collection, the panel and the event handlers' },
      limits: {
        eventsMax: MAX_EVENTS, eventsDropped: this.dropped, firstDropAtMs: this.firstDropAt,
        tracksRetainedMax: MAX_TRACKS, tracksNotRetained: this.tracksNotRetained,
        checksMax: MAX_CHECKS, checksDropped: this.checksDropped, checksExpired: this.checksExpired,
        coverageIncompleteFromMs: this.coverageLostAt,
        segmentsMax: MAX_SEGMENTS, segmentsTruncated: this.segments.some((s) => s.truncated),
        warmupMs: WARMUP_MS, binMs: BIN_MS, overflowAtMs: OVERFLOW_MS, overflowValuesKept: OVERFLOW_VALUES,
        backgroundLimit: 'a phone may suspend the page before or while it handles being hidden: events can be missing or late, and are never inferred',
        persistence: 'none: a reload or a closed tab loses an unexported session',
      },
    };
    this.tracks.clear();
    this.checks.length = 0;
    return deepFreeze(report);
  }
}

export type DiagnosticsReport = ReturnType<DiagnosticsSession['stop']>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

// ---- the camera assertions: PASS needs complete evidence; missing or truncated evidence is INCONCLUSIVE ----
interface Instance { at: number; verdict: Verdict; reason: string; evidence: number[] }
interface Assertion { id: string; claim: string; verdict: Verdict; instances: Instance[] }

const CLAIMS: Record<string, string> = {
  A1: 'the app handled each hidden transition while a camera session was active',
  A2: 'every app-owned track live at a hidden transition, and every track from a request still pending then, was confirmed ended while the page was hidden (a stop or an ended event before it was visible again)',
  A3: 'no camera request while hidden',
  A4: 'no camera request in the first 10 visible seconds after returning, without an explicit restart',
  A5: 'one explicit restart made exactly one request, which resolved to one live video track (checked 2 s later), with no further request for 15 s',
};

function evaluate(events: readonly RecordedEvent[], endT: number, firstDropAt: number | null, coverageLostAt: number | null): Assertion[] {
  const out: Record<string, Instance[]> = { A1: [], A2: [], A3: [], A4: [], A5: [] };
  const truncatedBy = (end: number) => firstDropAt !== null && end >= firstDropAt;
  /** Track references or state checks could not be kept from this time: A2 and A5 evidence after it is incomplete. */
  const uncoveredBy = (end: number) => coverageLostAt !== null && end >= coverageLostAt;
  const idx = (pred: (e: RecordedEvent, i: number) => boolean, from: number, to: number) => {
    const found: number[] = [];
    for (let i = from; i < to; i++) if (pred(events[i], i)) found.push(i);
    return found;
  };

  // Which sessions, tracks and camera requests are live or pending, event by event.
  const liveSessions = new Set<number>();
  const liveTracks = new Map<string, string>(); // trackId → kind
  const pendingRequests = new Set<number>();
  const states: { sessions: Set<number>; tracks: Map<string, string>; pending: Set<number> }[] = [];
  for (const e of events) {
    if (e.type === 'snapshot') {
      if (e.sessionId !== null && !e.stopped) liveSessions.add(e.sessionId);
      for (const t of e.tracks) if (t.readyState === 'live') liveTracks.set(t.trackId, t.kind);
      for (const id of e.pendingRequestIds) pendingRequests.add(id);
    } else if (e.type === 'session-created') liveSessions.add(e.sessionId);
    else if (e.type === 'session-disposed') liveSessions.delete(e.sessionId);
    else if (e.type === 'gum-requested') pendingRequests.add(e.requestId);
    else if (e.type === 'gum-rejected') pendingRequests.delete(e.requestId);
    else if (e.type === 'gum-resolved') { pendingRequests.delete(e.requestId); for (const t of e.tracks) if (t.readyState === 'live') liveTracks.set(t.trackId, t.kind); }
    else if (e.type === 'track-stop-requested') { if (e.readyStateAfter === 'ended') liveTracks.delete(e.trackId); }
    else if (e.type === 'track-ended') liveTracks.delete(e.trackId);
    else if (e.type === 'track-state') { if (e.readyState === 'ended') liveTracks.delete(e.trackId); else liveTracks.set(e.trackId, e.kind); }
    states.push({ sessions: new Set(liveSessions), tracks: new Map(liveTracks), pending: new Set(pendingRequests) });
  }

  const visibility = idx((e) => e.type === 'visibility', 0, events.length);
  const gaps = idx((e) => e.type === 'unobserved-gap', 0, events.length);

  for (const h of visibility) {
    const he = events[h] as Extract<RecordedEvent, { type: 'visibility' }>;
    if (he.state !== 'hidden') continue;
    const v = visibility.find((i) => i > h && (events[i] as Extract<RecordedEvent, { type: 'visibility' }>).state === 'visible');
    const end = v ?? events.length;
    const endTime = v !== undefined ? events[v].t : endT;
    const before = h > 0 ? states[h - 1] : { sessions: new Set<number>(), tracks: new Map<string, string>(), pending: new Set<number>() };
    const dropped = truncatedBy(endTime);

    // A1
    if (before.sessions.size) {
      const handled = idx((e) => e.type === 'hidden-handled', h, end);
      out.A1.push(handled.length
        ? { at: he.t, verdict: 'PASS', reason: 'hidden-handled recorded', evidence: [h, ...handled] }
        : { at: he.t, verdict: 'INCONCLUSIVE', reason: 'hidden seen, its handling not recorded (the page may have been suspended first)', evidence: [h] });
    }
    // A2: the tracks live at hiding, plus the tracks of any request still pending then, each confirmed ended WHILE
    // hidden: a stop reporting "ended", or an ended event, before the visible event. "Ended" seen only at the visible
    // re-check does not prove the release happened while hidden; "live" seen there does prove it did not.
    if (before.tracks.size || before.pending.size) {
      const hiddenEnd = v ?? events.length; // events strictly before the page was visible again
      const recheckEnd = v === undefined ? v : (() => { const i = events.findIndex((e, j) => j > v && e.type !== 'track-state'); return i === -1 ? events.length : i; })();
      const required = new Map(before.tracks);
      const problems: string[] = [];
      const evidence = [h];
      for (const requestId of before.pending) {
        const settled = events.findIndex((e, i) => i > h && (e.type === 'gum-resolved' || e.type === 'gum-rejected') && e.requestId === requestId);
        if (settled === -1) { problems.push(`request ${requestId} pending at hiding was still unresolved`); continue; }
        evidence.push(settled);
        const answer = events[settled];
        if (answer.type !== 'gum-resolved') continue; // rejected: no tracks to release
        if (settled > hiddenEnd) { problems.push(`request ${requestId} pending at hiding resolved only after the page was visible again`); continue; }
        for (const t of answer.tracks) required.set(t.trackId, t.kind);
      }
      const stillLive: string[] = [];
      for (const trackId of required.keys()) {
        const confirm = idx((e) => (e.type === 'track-stop-requested' && e.trackId === trackId && e.readyStateAfter === 'ended')
          || (e.type === 'track-ended' && e.trackId === trackId), h, hiddenEnd);
        const live = v === undefined ? [] : idx((e) => e.type === 'track-state' && e.source === 'visible-recheck' && e.trackId === trackId && e.readyState === 'live', v, recheckEnd!);
        if (live.length) { stillLive.push(trackId); evidence.push(...live); } else if (confirm.length) evidence.push(confirm[0]); else problems.push(`no confirmed ended state for ${trackId} while hidden`);
      }
      out.A2.push(stillLive.length ? { at: he.t, verdict: 'FAIL', reason: `still live at the visible re-check: ${stillLive.join(', ')}`, evidence }
        : dropped ? { at: he.t, verdict: 'INCONCLUSIVE', reason: 'events were dropped in this window', evidence }
        : uncoveredBy(endTime) ? { at: he.t, verdict: 'INCONCLUSIVE', reason: 'some tracks or state checks were not retained (memory cap): evidence incomplete', evidence }
        : problems.length ? { at: he.t, verdict: 'INCONCLUSIVE', reason: problems.join('; '), evidence }
        : { at: he.t, verdict: 'PASS', reason: `${required.size} track(s) confirmed ended while hidden`, evidence });
    }
    // A3
    const hiddenRequests = idx((e) => e.type === 'gum-requested', h, end);
    out.A3.push(hiddenRequests.length ? { at: he.t, verdict: 'FAIL', reason: 'a camera request while hidden', evidence: [h, ...hiddenRequests] }
      : v === undefined ? { at: he.t, verdict: 'INCONCLUSIVE', reason: 'the session ended while hidden', evidence: [h] }
      : dropped ? { at: he.t, verdict: 'INCONCLUSIVE', reason: 'events were dropped in this window', evidence: [h, v] }
      : { at: he.t, verdict: 'PASS', reason: 'no request between hidden and visible', evidence: [h, v] });

    // A4: from the return, ten visible seconds without a request unless a restart came first.
    if (v !== undefined) {
      const vt = events[v].t;
      const limit = vt + A4_MS;
      const nextHidden = visibility.find((i) => i > v && events[i].t <= limit);
      const restart = events.findIndex((e, i) => i > v && e.t <= limit && e.type === 'restart-requested' && e.accepted);
      const stopAt = Math.min(limit, nextHidden !== undefined ? events[nextHidden].t : Infinity, restart !== -1 ? events[restart].t : Infinity, endT);
      // By event order, not time: the restart's own request can share its millisecond.
      const auto = idx((e) => e.type === 'gum-requested' && e.t <= stopAt, v, restart !== -1 ? restart : events.length);
      out.A4.push(auto.length ? { at: vt, verdict: 'FAIL', reason: 'a camera request after return with no explicit restart', evidence: [v, ...auto] }
        : truncatedBy(stopAt) ? { at: vt, verdict: 'INCONCLUSIVE', reason: 'events were dropped in this window', evidence: [v] }
        : stopAt < limit ? { at: vt, verdict: 'INCONCLUSIVE', reason: `only ${round((stopAt - vt) / 1000)} s of the 10 s were observed before ${restart !== -1 && events[restart].t === stopAt ? 'a restart' : nextHidden !== undefined ? 'hiding again' : 'the session ended'}`, evidence: [v] }
        : { at: vt, verdict: 'PASS', reason: 'ten visible seconds without a camera request', evidence: [v] });
    }
  }

  // A5: per accepted restart. Its window ends at its 15 s limit or at the next accepted restart, by EVENT ORDER: the
  // next restart's request can share its millisecond, and belongs to that restart, not this one.
  events.forEach((r, ri) => {
    if (r.type !== 'restart-requested' || !r.accepted) return;
    const limit = r.t + A5_MS;
    const next = events.findIndex((e, i) => i > ri && e.type === 'restart-requested' && e.accepted);
    const endIndex = next !== -1 ? next : events.length;
    const cutByRestart = next !== -1 && events[next].t < limit;
    const windowEnd = Math.min(limit, cutByRestart ? events[next].t : Infinity);
    const inWindow = (e: RecordedEvent, i: number) => i < endIndex && e.t <= limit;
    const requests = idx((e, i) => inWindow(e, i) && e.type === 'gum-requested', ri + 1, events.length);
    const hidden = idx((e, i) => inWindow(e, i) && e.type === 'visibility' && e.state === 'hidden', ri + 1, events.length);
    const add = (verdict: Verdict, reason: string, evidence: number[]) => out.A5.push({ at: r.t, verdict, reason, evidence: [ri, ...evidence] });
    if (requests.length >= 2) return add('FAIL', `${requests.length} camera requests for one restart`, requests);
    if (truncatedBy(windowEnd)) return add('INCONCLUSIVE', 'events were dropped in this window', requests);
    if (uncoveredBy(windowEnd)) return add('INCONCLUSIVE', 'some tracks or state checks were not retained (memory cap): evidence incomplete', requests);
    if (hidden.length) return add('INCONCLUSIVE', 'the page was hidden during the window', hidden);
    const cut = `another restart came after ${round((windowEnd - r.t) / 1000)} s, before the 15 s window was observed`;
    if (!requests.length) return add(cutByRestart ? 'INCONCLUSIVE' : endT >= limit ? 'FAIL' : 'INCONCLUSIVE', cutByRestart ? cut : endT >= limit ? 'no camera request after an accepted restart' : 'the session ended before a request', []);
    const reqId = (events[requests[0]] as Extract<RecordedEvent, { type: 'gum-requested' }>).requestId;
    const settled = events.findIndex((e) => (e.type === 'gum-resolved' || e.type === 'gum-rejected') && e.requestId === reqId);
    if (settled === -1 || !inWindow(events[settled], settled)) return add('INCONCLUSIVE', 'the camera request was still unresolved', requests);
    const answer = events[settled];
    if (answer.type === 'gum-rejected') return add('INCONCLUSIVE', `the camera request was rejected: ${answer.code}`, [requests[0], settled]);
    if (answer.type !== 'gum-resolved') return;
    const video = answer.tracks.filter((t) => t.kind === 'video').map((t) => t.trackId);
    const check = idx((e) => e.type === 'track-state' && e.source === 'restart-check' && video.includes(e.trackId), settled, events.length);
    if (!check.length) return add('INCONCLUSIVE', 'no state check 2 s after the camera answered', [requests[0], settled]);
    const liveNow = check.filter((i) => (events[i] as Extract<RecordedEvent, { type: 'track-state' }>).readyState === 'live');
    if (liveNow.length !== 1) return add('FAIL', `${liveNow.length} live video track(s) 2 s after the camera answered`, [requests[0], settled, ...check]);
    const otherLive = [...states[check[0]].tracks].filter(([id, kind]) => kind === 'video' && !video.includes(id));
    if (otherLive.length) return add('FAIL', `another video track was still live: ${otherLive.map(([id]) => id).join(', ')}`, [requests[0], settled, ...check]);
    if (cutByRestart) return add('INCONCLUSIVE', cut, [requests[0], settled, ...check]);
    if (endT < limit) return add('INCONCLUSIVE', `only ${round((endT - r.t) / 1000)} s of the 15 s window were observed`, [requests[0], settled, ...check]);
    return add('PASS', 'one request, resolved, one live video track', [requests[0], settled, ...check]);
  });

  return Object.entries(out).map(([id, instances]) => {
    let verdict: Verdict = instances.some((i) => i.verdict === 'FAIL') ? 'FAIL'
      : !instances.length || instances.some((i) => i.verdict === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'PASS';
    if (id === 'A1' && gaps.length && verdict === 'PASS') verdict = 'INCONCLUSIVE';
    const reason = !instances.length ? 'not exercised in this session' : id === 'A1' && gaps.length ? `${gaps.length} unobserved frame gap(s) of 1 s or more` : undefined;
    return { id, claim: CLAIMS[id], verdict, ...(reason ? { reason } : {}), instances };
  });
}

// ---- export and the controller the panel drives ----
export interface ExportDeps {
  /** The share sheet with a file, where the browser has one; null when it does not. */
  share: ((name: string, text: string) => Promise<void>) | null;
  /** A download, where the share sheet is unavailable. */
  download: (name: string, text: string) => void;
}
export type ExportOutcome = 'shared' | 'cancelled' | 'downloaded' | 'failed';

export async function exportReport(report: DiagnosticsReport, deps: ExportDeps): Promise<ExportOutcome> {
  const name = `gse-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const text = JSON.stringify(report, null, 1);
  if (deps.share) {
    try {
      await deps.share(name, text);
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  try {
    deps.download(name, text);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

/** Start, stop, export, discard. The report stays until it is discarded, whatever the export did. */
export class DiagnosticsController {
  private session: DiagnosticsSession | null = null;
  report: DiagnosticsReport | null = null;
  private exported = false;

  constructor(private readonly options: (scenario: string) => SessionOptions) {}

  get recording() { return this.session !== null; }

  /** @param confirm asked only when an unexported report would be replaced. */
  start(scenario: string, confirm: () => boolean): boolean {
    if (this.session) return false;
    if (this.report && !this.exported && !confirm()) return false;
    const session = new DiagnosticsSession({ ...this.options(scenario), scenario });
    session.start();
    this.session = session;
    this.report = null;
    this.exported = false;
    return true;
  }

  frame(t: number, context: () => DiagnosticsContext) { this.session?.frame(t, context); }
  timing(t: number, detectMs: number, processingMs: number) { this.session?.timing(t, detectMs, processingMs); }

  stop(entered?: Entered, observations?: string): DiagnosticsReport | null {
    if (!this.session) return null;
    this.report = this.session.stop(entered, observations);
    this.session = null;
    return this.report;
  }

  async export(deps: ExportDeps): Promise<ExportOutcome> {
    if (this.session) throw new Error('stop the session before exporting');
    if (!this.report) throw new Error('nothing to export');
    const outcome = await exportReport(this.report, deps);
    if (outcome === 'shared' || outcome === 'downloaded') this.exported = true;
    return outcome;
  }

  discard() {
    this.report = null;
    this.exported = false;
  }
}
