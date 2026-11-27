// Debug-only diagnostics: the recorder, its statistics, the camera assertions and the export flow.
// Everything here is synthetic: a fake clock, a fake page, fake tracks. It proves the bookkeeping, not a phone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cameraEvents, type CameraSnapshot } from '../src/performance/cameraEvents';
import {
  DiagnosticsController, DiagnosticsSession, Histogram, MAX_CHECKS, MAX_EVENTS, MAX_SEGMENTS, MAX_TRACKS, SCHEMA, exportReport, pageInfo,
  type DiagnosticsContext, type DiagnosticsReport, type SessionOptions,
} from '../src/performance/diagnostics';
import { FakeTrack } from './helpers/media';

type Page = EventTarget & { visibilityState: DocumentVisibilityState };
let page: Page;
let win: EventTarget;
let clock: number;
let snapshot: CameraSnapshot | null;

const CTX: DiagnosticsContext = { mode: 'solarView', spaceport: false, phase: 'none', camera: 'tracking', tier: 'medium', renderScale: 1, pixelRatio: 2, loading: false };
const ctx = (over: Partial<DiagnosticsContext> = {}) => () => ({ ...CTX, ...over });

function options(over: Partial<SessionOptions> = {}): SessionOptions {
  return {
    scenario: 'C2', now: () => clock, wallNow: () => Date.UTC(2026, 10, 14) + clock, doc: page, win,
    build: { appVersion: '2.4.0', entryChunk: 'index-ENTRY123.js', diagnosticsChunk: 'diagnostics-CHUNK456.js', loadedAssets: ['index-ENTRY123.js'] },
    page: { origin: 'https://lab.example', path: '/', query: { debug: '' } },
    device: { userAgent: 'test-agent', viewport: [390, 844], dpr: 3 },
    ...over,
  };
}
const started: DiagnosticsSession[] = [];
function session(over: Partial<SessionOptions> = {}) {
  const s = new DiagnosticsSession(options(over));
  s.start();
  started.push(s);
  return s;
}
/** Frames every `step` ms from `from` (inclusive) to `to` (inclusive), each at the page's current clock. */
function frames(s: DiagnosticsSession, from: number, to: number, step = 16, c = ctx()) {
  for (let t = from; t <= to; t += step) { clock = t; s.frame(t, c); }
}
function setVisibility(state: DocumentVisibilityState, at: number) {
  clock = at;
  page.visibilityState = state;
  page.dispatchEvent(new Event('visibilitychange'));
}
const verdict = (r: DiagnosticsReport, id: string) => r.assertions.find((a) => a.id === id)!.verdict;
/** A segment's key, when it is not the truncated "mixed" one. */
const keyOf = (seg: DiagnosticsReport['segments'][number]) => (seg.key === 'mixed' ? null : seg.key);
/** What tracking.ts and camera.ts emit when the page hides with the camera on. */
function appHides(track: FakeTrack, sessionId = 1) {
  cameraEvents.emit({ type: 'hidden-handled', sessionId });
  track.stop();
  cameraEvents.stopped(track as unknown as MediaStreamTrack);
  cameraEvents.emit({ type: 'session-disposed', sessionId, reason: 'err.disconnected', current: true });
}
/** A restart that asks for the camera once and gets one live track. */
function restartGetsCamera(_s: DiagnosticsSession, at: number, sessionId = 2) {
  clock = at;
  cameraEvents.emit({ type: 'restart-requested', accepted: true });
  cameraEvents.emit({ type: 'session-created', sessionId });
  const id = cameraEvents.request(sessionId);
  const fresh = new FakeTrack();
  cameraEvents.resolved(id, [fresh as unknown as MediaStreamTrack]);
  return fresh;
}

beforeEach(() => {
  clock = 0;
  page = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  win = new EventTarget();
  snapshot = null;
  cameraEvents.provideSnapshot(() => snapshot);
});
afterEach(() => {
  // A test that failed mid-session must not leave it recording for the next one.
  for (const s of started.splice(0)) { try { s.stop(); } catch { /* already stopped */ } }
  cameraEvents.provideSnapshot(null);
  cameraEvents.reset();
});

describe('statistics', () => {
  it('counts intervals, not frames: four frames are three intervals, and FPS is 1000 × intervals / summed time', () => {
    const s = session();
    frames(s, 0, 48);
    const r = s.stop();
    const [seg] = r.segments;
    expect(seg.steady.intervals + seg.warmup.intervals).toBe(3);
    expect(seg.warmup.fps).toBeCloseTo(1000 * 3 / 48);
  });

  it('one frame is no interval: FPS is not measured rather than zero', () => {
    const s = session();
    frames(s, 0, 0);
    const r = s.stop();
    expect(r.segments[0].warmup.intervals).toBe(0);
    expect(r.segments[0].warmup.fps).toBeNull();
  });

  it('reports percentiles as 0.5 ms histogram bins, labelled approximate', () => {
    const h = new Histogram();
    for (const v of [10.1, 10.2, 10.3, 16.6, 16.7, 16.8, 16.9, 17.0, 33.4, 33.4]) h.add(v);
    const p50 = h.percentile(0.5)!;
    expect(p50).toMatchObject({ approximate: true, lowMs: 16.5, highMs: 17 });
    expect(h.percentile(0.95)).toMatchObject({ approximate: true, lowMs: 33, highMs: 33.5 });
    expect(h.summary().percentileMethod).toMatch(/nearest-rank.*0\.5 ms bins/);
  });

  it('keeps intervals of 250 ms or more out of the bins: counted, exact max, exact values, and an honest overflow percentile', () => {
    const h = new Histogram();
    for (let i = 0; i < 18; i++) h.add(16);
    h.add(300);
    h.add(1200);
    const summary = h.summary();
    expect(summary.maxMs).toBe(1200);
    expect(summary.overflow).toEqual({ count: 2, atLeastMs: 250, kept: 'smallest', values: [300, 1200], valuesComplete: true });
    expect(h.percentile(0.95)).toEqual({ overflow: true, atLeastMs: 250, atMostMs: 1200, exactMs: 300 });
    expect(summary.p50).toMatchObject({ lowMs: 16, highMs: 16.5 });
  });

  it('beyond 64 overflow values, a rank is exact only when the kept (smallest) values establish it; otherwise a bound', () => {
    const h = new Histogram();
    for (let v = 1000; v > 900; v--) h.add(v); // 100 overflow values, largest first
    const { overflow } = h.summary();
    expect(overflow.count).toBe(100);
    expect(overflow.values).toHaveLength(64);
    expect(overflow.values[0]).toBe(901);
    expect(overflow.values.at(-1)).toBe(964);
    expect(overflow.valuesComplete).toBe(false);
    // Rank 50 of 100 is the 50th smallest: among the 64 smallest kept, so it is exact.
    expect(h.percentile(0.5)).toEqual({ overflow: true, atLeastMs: 250, atMostMs: 1000, exactMs: 950 });
    // Rank 95 lies past the kept values: at least the 64th smallest, at most the max, and no exact value.
    expect(h.percentile(0.95)).toEqual({ overflow: true, atLeastMs: 964, atMostMs: 1000, exactMs: null });
    expect(h.summary().maxMs).toBe(1000);
  });

  it('separates warm-up (the first 2 s) from steady state', () => {
    const s = session();
    frames(s, 0, 4000, 20);
    const [seg] = s.stop().segments;
    expect(seg.warmup.intervals).toBe(100);
    expect(seg.steady.intervals).toBe(100);
    expect(seg.steady.fps).toBeCloseTo(50);
  });
});

describe('segments and the background', () => {
  it('a hidden interval is never a frame interval, and the baseline starts again on return', () => {
    const s = session();
    frames(s, 0, 32);
    setVisibility('hidden', 40);
    setVisibility('visible', 5000);
    frames(s, 5000, 5032);
    const r = s.stop();
    expect(r.segments).toHaveLength(2);
    const all = r.segments.flatMap((seg) => [seg.warmup, seg.steady]);
    expect(Math.max(...all.map((x) => x.maxMs ?? 0))).toBeLessThan(100);
    expect(r.segments[1].warmupReason).toBe('visible');
  });

  it('a mode change opens a segment with warm-up; a camera status change opens one without', () => {
    const s = session();
    frames(s, 0, 32);
    frames(s, 48, 80, 16, ctx({ mode: 'launch' }));
    frames(s, 96, 128, 16, ctx({ mode: 'launch', camera: 'keyboard' }));
    const r = s.stop();
    expect(r.segments.map((seg) => [keyOf(seg)?.mode, keyOf(seg)?.camera, seg.warmupReason])).toEqual([
      ['solarView', 'tracking', 'start'], ['launch', 'tracking', 'scene'], ['launch', 'keyboard', null],
    ]);
  });

  it('keeps a short launch or landing segment, however short', () => {
    const s = session();
    frames(s, 0, 32);
    frames(s, 48, 64, 16, ctx({ mode: 'docking' }));
    frames(s, 80, 112);
    const r = s.stop();
    expect(r.segments.map((seg) => keyOf(seg)?.mode)).toEqual(['solarView', 'docking', 'solarView']);
    expect(r.segments[1].frames).toBe(2);
  });

  it('500 automatic render-scale changes stay one segment, warm up once, and are counted', () => {
    const s = session();
    for (let i = 0; i <= 500; i++) { clock = i * 16; s.frame(clock, ctx({ renderScale: i % 2 ? 0.8 : 0.9 })); }
    const r = s.stop();
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].renderScale).toMatchObject({ min: 0.8, max: 0.9, changes: 500 });
    expect(r.segments[0].warmupReason).toBe('start');
  });

  it('past the segment cap, frames go to one truncated "mixed" segment and its figures are inconclusive', () => {
    const s = session();
    for (let i = 0; i < MAX_SEGMENTS + 5; i++) frames(s, i * 100, i * 100 + 32, 16, ctx({ mode: i % 2 ? 'focus' : 'solarView' }));
    const r = s.stop();
    expect(r.segments).toHaveLength(MAX_SEGMENTS);
    expect(r.segments.at(-1)).toMatchObject({ truncated: true, key: 'mixed' });
    expect(r.limits.segmentsTruncated).toBe(true);
    expect(r.segments.at(-1)!.verdict).toBe('INCONCLUSIVE');
  });

  it('records timing samples from tracking per segment, and detection-to-render on the next frame', () => {
    const s = session();
    frames(s, 0, 16);
    s.timing(20, 7, 1);
    frames(s, 32, 32);
    const [seg] = s.stop().segments;
    expect(seg.inference.count).toBe(1);
    expect(seg.detectionToRender.maxMs).toBe(12);
  });
});

describe('camera assertions', () => {
  it('started after the camera was already running: the snapshot track counts, and hiding releases it (A1, A2 PASS)', () => {
    const track = new FakeTrack();
    snapshot = { sessionId: 1, stopped: false, status: 'tracking', tracks: [track as unknown as MediaStreamTrack], pendingRequestIds: [] };
    const s = session();
    frames(s, 0, 32);
    setVisibility('hidden', 40);
    appHides(track);
    setVisibility('visible', 5000);
    frames(s, 5000, 16000);
    const r = s.stop();
    expect(r.events[0]).toMatchObject({ type: 'snapshot', tracks: [{ kind: 'video', readyState: 'live' }] });
    expect(verdict(r, 'A1')).toBe('PASS');
    expect(verdict(r, 'A2')).toBe('PASS');
    expect(verdict(r, 'A3')).toBe('PASS');
    expect(verdict(r, 'A4')).toBe('PASS');
  });

  it('the app handles hiding before the recorder hears of it (its listener came first): the transition is still recorded first, once', () => {
    const track = new FakeTrack();
    snapshot = { sessionId: 1, stopped: false, status: 'tracking', tracks: [track as unknown as MediaStreamTrack], pendingRequestIds: [] };
    // Like tracking.ts: a listener registered before the diagnostics session started.
    page.addEventListener('visibilitychange', () => { if (page.visibilityState === 'hidden') appHides(track); });
    const s = session();
    frames(s, 0, 32);
    setVisibility('hidden', 40);
    setVisibility('visible', 5000);
    frames(s, 5000, 16000);
    const r = s.stop();
    const types = r.events.map((e) => e.type);
    expect(types.indexOf('visibility')).toBeLessThan(types.indexOf('hidden-handled'));
    expect(r.events.filter((e) => e.type === 'visibility')).toHaveLength(2);
    expect(verdict(r, 'A1')).toBe('PASS');
    expect(verdict(r, 'A2')).toBe('PASS');
  });

  it('stop requested is not stop confirmed: a track still live at the visible re-check fails A2', () => {
    const track = new FakeTrack();
    track.stop.mockImplementation(() => {}); // asked to stop, still live
    snapshot = { sessionId: 1, stopped: false, status: 'tracking', tracks: [track as unknown as MediaStreamTrack], pendingRequestIds: [] };
    const s = session();
    setVisibility('hidden', 10);
    appHides(track);
    setVisibility('visible', 5000);
    const r = s.stop();
    expect(r.events.some((e) => e.type === 'track-stop-requested' && e.readyStateAfter === 'live')).toBe(true);
    expect(verdict(r, 'A2')).toBe('FAIL');
  });

  it('"ended" seen only at the visible re-check does not prove the release happened while hidden: A2 inconclusive', () => {
    const track = new FakeTrack();
    snapshot = { sessionId: 1, stopped: false, status: 'tracking', tracks: [track as unknown as MediaStreamTrack], pendingRequestIds: [] };
    const s = session();
    setVisibility('hidden', 10);
    cameraEvents.emit({ type: 'hidden-handled', sessionId: 1 });
    track.stop(); // stopped, but the stop was never reported while hidden
    setVisibility('visible', 5000);
    const r = s.stop();
    expect(r.events.some((e) => e.type === 'track-state' && e.source === 'visible-recheck' && e.readyState === 'ended')).toBe(true);
    expect(verdict(r, 'A2')).toBe('INCONCLUSIVE');
  });

  it('a request pending when the page hides: its tracks must be confirmed ended while hidden (PASS)', () => {
    const s = session();
    cameraEvents.emit({ type: 'session-created', sessionId: 4 });
    const id = cameraEvents.request(4);
    setVisibility('hidden', 10);
    cameraEvents.emit({ type: 'hidden-handled', sessionId: 4 });
    cameraEvents.emit({ type: 'session-disposed', sessionId: 4, reason: 'err.disconnected', current: true });
    clock = 400;
    const late = new FakeTrack();
    cameraEvents.resolved(id, [late as unknown as MediaStreamTrack]); // the camera answers while hidden
    late.stop();
    cameraEvents.stopped(late as unknown as MediaStreamTrack);
    setVisibility('visible', 5000);
    expect(verdict(s.stop(), 'A2')).toBe('PASS');
  });

  it('a request pending when the page hides that never resolves, or resolves with no confirmed stop while hidden: A2 inconclusive', () => {
    const never = session();
    cameraEvents.emit({ type: 'session-created', sessionId: 4 });
    cameraEvents.request(4);
    setVisibility('hidden', 10);
    cameraEvents.emit({ type: 'hidden-handled', sessionId: 4 });
    setVisibility('visible', 5000);
    const r1 = never.stop();
    expect(verdict(r1, 'A2')).toBe('INCONCLUSIVE');
    expect(r1.assertions.find((a) => a.id === 'A2')!.instances[0].reason).toMatch(/unresolved/);
    cameraEvents.reset();

    const unconfirmed = session();
    cameraEvents.emit({ type: 'session-created', sessionId: 5 });
    const id = cameraEvents.request(5);
    setVisibility('hidden', 10);
    cameraEvents.emit({ type: 'hidden-handled', sessionId: 5 });
    clock = 400;
    const late = new FakeTrack();
    cameraEvents.resolved(id, [late as unknown as MediaStreamTrack]);
    late.stop(); // ended, but no stop was reported while hidden
    setVisibility('visible', 5000);
    expect(verdict(unconfirmed.stop(), 'A2')).toBe('INCONCLUSIVE');
  });

  it('with no confirmation read at all, A2 is inconclusive, not PASS', () => {
    const track = new FakeTrack();
    snapshot = { sessionId: 1, stopped: false, status: 'tracking', tracks: [track as unknown as MediaStreamTrack], pendingRequestIds: [] };
    const s = session();
    setVisibility('hidden', 10);
    cameraEvents.emit({ type: 'hidden-handled', sessionId: 1 }); // the page froze before the stop was logged
    const r = s.stop(); // never visible again: no re-check
    expect(verdict(r, 'A2')).toBe('INCONCLUSIVE');
  });

  it('A1 is inconclusive when the hidden event is seen but not its handling', () => {
    snapshot = { sessionId: 1, stopped: false, status: 'tracking', tracks: [new FakeTrack() as unknown as MediaStreamTrack], pendingRequestIds: [] };
    const s = session();
    setVisibility('hidden', 10);
    setVisibility('visible', 5000);
    expect(verdict(s.stop(), 'A1')).toBe('INCONCLUSIVE');
  });

  it('a 3 s frame gap with no visibility event is recorded as an unobserved gap, and A1 is inconclusive', () => {
    const s = session();
    frames(s, 0, 16);
    frames(s, 3016, 3032);
    const r = s.stop();
    expect(r.events.some((e) => e.type === 'unobserved-gap' && e.gapMs === 3000)).toBe(true);
    expect(verdict(r, 'A1')).toBe('INCONCLUSIVE');
  });

  it('a camera request while hidden fails A3', () => {
    const s = session();
    setVisibility('hidden', 10);
    clock = 20;
    cameraEvents.request(5);
    setVisibility('visible', 5000);
    expect(verdict(s.stop(), 'A3')).toBe('FAIL');
  });

  it('dropped events inside the hidden window make A3 inconclusive', () => {
    const s = session();
    setVisibility('hidden', 10);
    for (let i = 0; i < MAX_EVENTS + 10; i++) cameraEvents.emit({ type: 'restart-requested', accepted: false });
    setVisibility('visible', 5000);
    const r = s.stop();
    expect(r.limits.eventsDropped).toBeGreaterThan(0);
    expect(verdict(r, 'A3')).toBe('INCONCLUSIVE');
  });

  it('A4 needs ten visible seconds: a session stopped 6 s after return is inconclusive, a full 10 s with no request passes', () => {
    const short = session();
    setVisibility('hidden', 10);
    setVisibility('visible', 1000);
    frames(short, 1000, 7000, 100);
    expect(verdict(short.stop(), 'A4')).toBe('INCONCLUSIVE');
    cameraEvents.reset();
    const full = session();
    setVisibility('hidden', 10);
    setVisibility('visible', 1000);
    frames(full, 1000, 11500, 100);
    expect(verdict(full.stop(), 'A4')).toBe('PASS');
  });

  it('a camera request after return without a restart fails A4', () => {
    const s = session();
    setVisibility('hidden', 10);
    setVisibility('visible', 1000);
    frames(s, 1000, 4000, 100);
    cameraEvents.request(9); // nobody asked
    frames(s, 4100, 12000, 100);
    expect(verdict(s.stop(), 'A4')).toBe('FAIL');
  });

  it('a restart before ten seconds leaves A4 inconclusive, and A5 is judged on its own: a good restart still passes', () => {
    const s = session();
    setVisibility('hidden', 10);
    setVisibility('visible', 1000);
    frames(s, 1000, 3000, 100);
    restartGetsCamera(s, 3000);
    frames(s, 3100, 18200, 100);
    const r = s.stop();
    expect(verdict(r, 'A4')).toBe('INCONCLUSIVE');
    expect(r.assertions.find((a) => a.id === 'A4')!.instances[0].reason).toMatch(/before a restart/);
    expect(verdict(r, 'A5')).toBe('PASS');
  });

  it('one restart, one request, one live track confirmed 2 s later, and nothing more for 15 s: A5 PASS', () => {
    const s = session();
    frames(s, 0, 100);
    restartGetsCamera(s, 100);
    frames(s, 116, 3000);
    frames(s, 3100, 15200, 100);
    const r = s.stop();
    expect(r.events.some((e) => e.type === 'track-state' && e.source === 'restart-check' && e.readyState === 'live')).toBe(true);
    expect(verdict(r, 'A5')).toBe('PASS');
  });

  it('A5 is inconclusive when the session ends before its 15 s window, even if the camera came on', () => {
    const s = session();
    restartGetsCamera(s, 100);
    frames(s, 116, 3000);
    expect(verdict(s.stop(), 'A5')).toBe('INCONCLUSIVE');
  });

  it('A5: two requests for one restart fail; an unresolved request at 15 s is inconclusive; a rejection is inconclusive with its code', () => {
    const two = session();
    clock = 100;
    cameraEvents.emit({ type: 'restart-requested', accepted: true });
    cameraEvents.request(2);
    cameraEvents.request(3);
    frames(two, 116, 3000);
    expect(verdict(two.stop(), 'A5')).toBe('FAIL');
    cameraEvents.reset();

    const pending = session();
    clock = 100;
    cameraEvents.emit({ type: 'restart-requested', accepted: true });
    cameraEvents.request(2);
    frames(pending, 116, 16000, 100);
    expect(verdict(pending.stop(), 'A5')).toBe('INCONCLUSIVE');
    cameraEvents.reset();

    const denied = session();
    clock = 100;
    cameraEvents.emit({ type: 'restart-requested', accepted: true });
    cameraEvents.rejected(cameraEvents.request(2), 'denied');
    frames(denied, 116, 3000);
    const r = denied.stop();
    expect(verdict(r, 'A5')).toBe('INCONCLUSIVE');
    expect(r.assertions.find((a) => a.id === 'A5')!.instances[0].reason).toMatch(/denied/);
  });

  it('A5: a second accepted restart inside the first one\'s 15 s leaves the first inconclusive; the second is judged on its own', () => {
    const s = session();
    frames(s, 0, 100);
    const first = restartGetsCamera(s, 100, 2);
    frames(s, 116, 4900, 100);
    // The app accepts a restart only once the previous session is gone: its camera was released first.
    clock = 4950;
    first.stop();
    cameraEvents.stopped(first as unknown as MediaStreamTrack);
    restartGetsCamera(s, 5000, 3);
    frames(s, 5100, 21000, 100);
    const a5 = s.stop().assertions.find((a) => a.id === 'A5')!;
    expect(a5.instances.map((i) => i.verdict)).toEqual(['INCONCLUSIVE', 'PASS']);
    expect(a5.instances[0].reason).toMatch(/another restart/);
    expect(a5.verdict).toBe('INCONCLUSIVE');
  });

  it('A5: the next restart\'s request is never counted for the previous restart, even in the same millisecond', () => {
    const s = session();
    frames(s, 0, 100);
    const first = restartGetsCamera(s, 100, 2);
    frames(s, 116, 4900, 100);
    clock = 4950;
    first.stop();
    cameraEvents.stopped(first as unknown as MediaStreamTrack);
    restartGetsCamera(s, 5000, 3); // restart and its request share t = 5000
    frames(s, 5100, 21000, 100);
    const a5 = s.stop().assertions.find((a) => a.id === 'A5')!;
    expect(a5.instances[0].verdict).not.toBe('FAIL');
    expect(a5.instances[0].reason).not.toMatch(/2 camera requests/);
  });

  it('assertions with nothing to judge are inconclusive, never PASS', () => {
    const s = session();
    frames(s, 0, 100);
    const r = s.stop();
    for (const id of ['A1', 'A2', 'A3', 'A4', 'A5']) expect(verdict(r, id)).toBe('INCONCLUSIVE');
  });
});

describe('bounded memory while recording', () => {
  /** A camera answer with one live track, as camera.ts reports it; optionally stopped and reported ended. */
  function answer(at: number, stop: boolean) {
    clock = at;
    const id = cameraEvents.request(9);
    const track = new FakeTrack();
    cameraEvents.resolved(id, [track as unknown as MediaStreamTrack]);
    if (stop) { track.stop(); cameraEvents.stopped(track as unknown as MediaStreamTrack); }
    return track;
  }

  it('tracks confirmed ended are let go: 100 answered-and-stopped cameras keep nothing', () => {
    const s = session();
    for (let i = 0; i < 100; i++) answer(i * 10, true);
    expect(s.retained().tracks).toBe(0);
    expect(s.stop().limits.tracksNotRetained).toBe(0);
  });

  it('live tracks are capped; once one could not be kept, A2 cannot pass for a later hide', () => {
    const s = session();
    const tracks = Array.from({ length: MAX_TRACKS + 20 }, (_, i) => answer(i * 10, false));
    expect(s.retained().tracks).toBe(MAX_TRACKS);
    frames(s, 1000, 1100);
    setVisibility('hidden', 1200);
    cameraEvents.emit({ type: 'hidden-handled', sessionId: 9 });
    for (const t of tracks) { t.stop(); cameraEvents.stopped(t as unknown as MediaStreamTrack); }
    setVisibility('visible', 5000);
    const r = s.stop();
    expect(r.limits.tracksNotRetained).toBe(20);
    expect(verdict(r, 'A2')).toBe('INCONCLUSIVE');
    expect(r.assertions.find((a) => a.id === 'A2')!.instances[0].reason).toMatch(/not retained/);
  });

  it('pending state checks are capped while no frame runs, and a check that comes too late is dropped: A5 cannot pass', () => {
    const s = session();
    setVisibility('hidden', 10); // no frames while hidden: due checks cannot run
    for (let i = 0; i < MAX_CHECKS + 10; i++) answer(20 + i, false);
    expect(s.retained().checks).toBe(MAX_CHECKS);
    clock = 100;
    cameraEvents.emit({ type: 'restart-requested', accepted: true });
    answer(100, false);
    setVisibility('visible', 30_000); // frames resume long after every check was due
    frames(s, 30_000, 46_000, 100);
    const r = s.stop();
    expect(s.retained().checks).toBe(0);
    expect(r.limits.checksDropped).toBeGreaterThan(0);
    expect(r.limits.checksExpired).toBeGreaterThan(0);
    expect(r.events.some((e) => e.type === 'track-state' && e.source === 'restart-check')).toBe(false);
    expect(verdict(r, 'A5')).not.toBe('PASS');
  });

  it('after the event log is full, no more tracks or checks are kept', () => {
    const s = session();
    for (let i = 0; i < MAX_EVENTS + 5; i++) cameraEvents.emit({ type: 'restart-requested', accepted: false });
    const before = s.retained();
    for (let i = 0; i < 30; i++) answer(100 + i, false);
    expect(s.retained()).toEqual(before);
    expect(s.stop().limits.eventsDropped).toBeGreaterThan(0);
  });
});

describe('session boundaries, privacy and the report', () => {
  it('one session at a time; repeated sessions start from fresh counters; nothing is listened to after stop', () => {
    const add = vi.spyOn(page, 'addEventListener');
    const remove = vi.spyOn(page, 'removeEventListener');
    const first = session();
    expect(() => session()).toThrow(/already/);
    frames(first, 0, 100);
    first.stop();
    expect(remove.mock.calls.length).toBe(add.mock.calls.length);
    expect(cameraEvents.attached()).toBe(false);
    const second = session();
    frames(second, 500, 532);
    const r = second.stop();
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].frames).toBe(3);
  });

  it('the report records both chunk names, never claims byte identity, and holds no commit SHA', () => {
    const s = session();
    frames(s, 0, 32);
    const r = s.stop();
    expect(r.schema).toBe(SCHEMA);
    expect(r.build).toMatchObject({ entryChunk: 'index-ENTRY123.js', diagnosticsChunk: 'diagnostics-CHUNK456.js', byteIdentity: 'NOT VERIFIED' });
    expect(r.deployment).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/\b[0-9a-f]{40}\b/);
  });

  it('keeps only allowlisted query keys, and bounds what the tester types', () => {
    const info = pageInfo(new URL('https://user:pw@lab.example/?flags=astrolife,guided&lang=en&debug&token=abc&base=cape&x=1#frag'));
    expect(info).toEqual({ origin: 'https://lab.example', path: '/', query: { flags: 'astrolife,guided', lang: 'en', debug: '', base: 'cape' } });
    const s = session();
    const r = s.stop({ model: 'x'.repeat(500), os: ' iOS 26.1 ' }, 'y'.repeat(5000));
    expect(r.device.entered.model).toHaveLength(80);
    expect(r.device.entered.os).toBe('iOS 26.1');
    expect(r.observations).toHaveLength(2000);
  });

  it('exports no tracks, streams, landmarks or storage: only plain JSON', () => {
    const track = new FakeTrack();
    snapshot = { sessionId: 1, stopped: false, status: 'tracking', tracks: [track as unknown as MediaStreamTrack], pendingRequestIds: [] };
    const s = session();
    frames(s, 0, 32);
    const r = s.stop();
    const text = JSON.stringify(r);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(r)));
    expect(text).not.toMatch(/landmark|localStorage|cookie|srcObject|deviceId|groupId|label/i);
    expect(r.notMeasured).toEqual(expect.arrayContaining(['GPU time', 'presented or dropped frames', 'sensor-to-display latency', 'OS camera indicator']));
  });

  it('measures its own frame hook and says it is self-measured', () => {
    const s = session();
    frames(s, 0, 160);
    const r = s.stop();
    expect(r.observer.frameHookMs.count).toBe(11);
    expect(r.observer.note).toMatch(/self-measured/);
  });

  it('the report is frozen at stop: a visibility change afterwards (the share sheet) is not in it', () => {
    const s = session();
    frames(s, 0, 32);
    const r = s.stop();
    const events = r.events.length;
    setVisibility('hidden', 100);
    setVisibility('visible', 200);
    expect(r.events).toHaveLength(events);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.segments[0])).toBe(true);
  });
});

describe('the controller and export', () => {
  it('export is refused while recording, and allowed after stop', async () => {
    const c = new DiagnosticsController(() => options());
    c.start('C2', () => true);
    await expect(c.export({ share: vi.fn(), download: vi.fn() })).rejects.toThrow(/stop/i);
    c.stop();
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await c.export({ share, download: vi.fn() })).toBe('shared');
  });

  it('a cancelled share, then a failed download, both keep the report; discard clears it', async () => {
    const c = new DiagnosticsController(() => options());
    c.start('C2', () => true);
    c.stop();
    const cancel = vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    expect(await c.export({ share: cancel, download: vi.fn() })).toBe('cancelled');
    expect(c.report).not.toBeNull();
    const failing = vi.fn(() => { throw new Error('blocked'); });
    expect(await c.export({ share: null, download: failing })).toBe('failed');
    expect(c.report).not.toBeNull();
    c.discard();
    expect(c.report).toBeNull();
  });

  it('a new session over an unexported report asks first; declining keeps the report', () => {
    const c = new DiagnosticsController(() => options());
    c.start('C2', () => true);
    c.stop();
    const kept = c.report;
    const confirm = vi.fn(() => false);
    expect(c.start('C3', confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(c.report).toBe(kept);
    expect(c.start('C3', () => true)).toBe(true);
    expect(c.recording).toBe(true);
  });

  it('exportReport tries the share sheet, then a download, and names the file', async () => {
    const r = { schema: SCHEMA } as unknown as DiagnosticsReport;
    const download = vi.fn();
    expect(await exportReport(r, { share: null, download })).toBe('downloaded');
    expect(download.mock.calls[0][0]).toMatch(/^gse-diagnostics-.*\.json$/);
    expect(JSON.parse(download.mock.calls[0][1])).toEqual({ schema: SCHEMA });
  });
});
