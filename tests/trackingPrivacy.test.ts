// Webcam privacy on failure: every track the app acquired ends, and the status
// never claims tracking, whatever fails after the camera was granted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTracking, type TrackingDeps, type TrackingSession } from '../src/app/tracking';
import { createState } from '../src/app/state';
import { config } from '../src/config';
import { GestureEngine } from '../src/gestures/engine';
import { ExtraGestures } from '../src/gestures/extras';
import { createIntentBus } from '../src/intents';
import { createHandTracker, type HandTracker } from '../src/tracking/handTracker';
import { Recorder } from '../src/ui/recorder';
import { deferred, FakeStream, FakeTrack, FakeVideo } from './helpers/media';

vi.mock('../src/tracking/handTracker', () => ({ createHandTracker: vi.fn() }));
const create = vi.mocked(createHandTracker);
const sessions: TrackingSession[] = [];
let video: FakeVideo;
let getUserMedia: ReturnType<typeof vi.fn>;
let deps: TrackingDeps;
let statuses: string[];

function detector() {
  let fatal: Parameters<HandTracker['run']>[2] = () => {};
  let frame: Parameters<HandTracker['run']>[1] = () => {};
  const stop = vi.fn();
  return {
    delegate: 'GPU' as const,
    dispose: vi.fn(),
    run: vi.fn<HandTracker['run']>((_video, onFrame, onFatal) => { frame = onFrame; fatal = onFatal; return stop; }),
    stop,
    emit: () => frame({ t: 1000, hands: [] }, 2),
    fail: () => fatal(new Error('Terminal detection error')),
  };
}

/** A camera that hands back more than one track: every one is the app's to stop. */
const grant = () => new FakeStream([new FakeTrack(), new FakeTrack(), new FakeTrack('audio')]);
const live = (s: FakeStream) => s.tracks.filter((t) => t.readyState === 'live').length;
function expectReleased(s: FakeStream) {
  for (const track of s.tracks) {
    expect(track.readyState).toBe('ended');
    expect(track.stop).toHaveBeenCalledTimes(1);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  create.mockReset();
  video = new FakeVideo();
  getUserMedia = vi.fn();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { isSecureContext: true }));
  vi.stubGlobal('navigator', { userAgent: 'Node test', maxTouchPoints: 0, mediaDevices: { getUserMedia } });
  vi.stubGlobal('document', { querySelector: () => video.element });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const state = createState();
  // Every status the app publishes, not just the last: a failed startup must never pass through 'tracking'.
  statuses = [];
  let status = state.status;
  Object.defineProperty(state, 'status', { get: () => status, set: (s) => { statuses.push(s.kind); status = s; } });
  deps = {
    state, bus: createIntentBus(),
    gestures: new GestureEngine(config.gestures, config.smoothing, () => null),
    extras: new ExtraGestures(config.gestures, config.smoothing),
    overlay: { delegate: '', show: vi.fn(), onFrame: vi.fn(), enabled: false } as unknown as TrackingDeps['overlay'],
    recorder: new Recorder(),
    gestureHud: { flash: vi.fn() } as unknown as TrackingDeps['gestureHud'],
    more: () => [], frameMode: () => 'focus', gestureMessage: () => null,
  };
});
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function start() {
  const session = startTracking(deps);
  sessions.push(session);
  await session.ready;
  return session;
}

describe('webcam released after a failure that follows camera access', () => {
  type Task = ReturnType<typeof detector>;
  it.each<[string, string, number, (task: Task) => void]>([
    ['the model fails to load', 'err.tracker', 0, () => { create.mockRejectedValueOnce(new Error('Model HTTP 503')); }],
    ['the detector fails inside run()', 'err.tracking-stopped', 1, (task) => {
      task.run.mockImplementationOnce((_v, _f, fatal) => { fatal(new Error('Synchronous detector failure')); return task.stop; });
      create.mockResolvedValueOnce(task);
    }],
    ['starting the loop throws', 'err.tracker', 1, (task) => {
      task.run.mockImplementationOnce(() => { throw new Error('Loop setup failed'); });
      create.mockResolvedValueOnce(task);
    }],
  ])('%s: every acquired track ends, the preview detaches, and tracking is never reported', async (_name, reason, disposed, arrange) => {
    const stream = grant();
    getUserMedia.mockResolvedValueOnce(stream.media);
    const task = detector();
    arrange(task);
    await start();
    expectReleased(stream);
    expect(video.srcObject).toBeNull();
    expect(statuses).not.toContain('tracking');
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason });
    expect(task.dispose).toHaveBeenCalledTimes(disposed);
  });

  it('a successful startup keeps every track live until it is stopped', async () => {
    const stream = grant();
    getUserMedia.mockResolvedValueOnce(stream.media);
    const task = detector();
    create.mockResolvedValueOnce(task);
    const session = await start();
    for (let i = 0; i < 5; i++) task.emit();
    expect(live(stream)).toBe(stream.tracks.length);
    for (const track of stream.tracks) expect(track.stop).not.toHaveBeenCalled();
    expect(video.srcObject).toBe(stream.media);
    expect(deps.state.status).toEqual({ kind: 'tracking', delegate: 'GPU' });
    session.dispose();
    expectReleased(stream);
  });
});

describe('a failed restart', () => {
  async function running() {
    const stream = grant();
    getUserMedia.mockResolvedValueOnce(stream.media);
    const task = detector();
    create.mockResolvedValueOnce(task);
    await start();
    statuses.length = 0;
    return { stream, task };
  }

  it('releases the newly granted stream and does not revive the old one when the model fails', async () => {
    const old = await running();
    const fresh = grant();
    getUserMedia.mockResolvedValueOnce(fresh.media);
    create.mockRejectedValueOnce(new Error('Model HTTP 503'));
    await start();
    expectReleased(old.stream);
    expectReleased(fresh);
    expect(old.task.dispose).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    old.task.emit(); // stale callbacks from the replaced session change nothing
    old.task.fail();
    expect(statuses).not.toContain('tracking');
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.tracker' });
  });

  it('releases the old stream when the restart is denied, and stale callbacks cannot overwrite the denial', async () => {
    const old = await running();
    getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    create.mockResolvedValueOnce(detector());
    await start();
    expectReleased(old.stream);
    expect(video.srcObject).toBeNull();
    old.task.fail();
    expect(statuses).not.toContain('tracking');
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.denied' });
  });
});

describe('a camera lost during startup is never reported as tracking', () => {
  // The reported bug: "Camera disconnected", then "Hand control on (GPU)" once the late detector arrived.
  it.each<[string, (track: FakeTrack) => void]>([
    ['ends with an ended event', (track) => track.end()],
    ['is stopped without one', (track) => track.stop()],
  ])('while the model loads, the camera %s: the late detector is closed, never run', async (_name, lose) => {
    const stream = grant();
    getUserMedia.mockResolvedValueOnce(stream.media);
    const pending = deferred<HandTracker>();
    create.mockReturnValueOnce(pending.promise);
    const session = startTracking(deps);
    sessions.push(session);
    await vi.waitFor(() => expect(video.play).toHaveBeenCalledTimes(1));
    lose(stream.tracks[0]);
    const task = detector();
    pending.resolve(task);
    await session.ready;
    expect(statuses).not.toContain('tracking');
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.disconnected' });
    expect(task.run).not.toHaveBeenCalled();
    expect(task.dispose).toHaveBeenCalledTimes(1);
    expect(live(stream)).toBe(0);
    expect(video.srcObject).toBeNull();
  });

  it('the camera ends while the preview is still starting to play', async () => {
    const stream = grant();
    getUserMedia.mockResolvedValueOnce(stream.media);
    const playing = deferred<void>();
    video.play.mockReturnValueOnce(playing.promise);
    const task = detector();
    create.mockResolvedValueOnce(task);
    const session = startTracking(deps);
    sessions.push(session);
    await vi.waitFor(() => expect(video.play).toHaveBeenCalledTimes(1));
    stream.tracks[0].end();
    playing.resolve();
    await session.ready;
    expect(statuses).not.toContain('tracking');
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.disconnected' });
    expect(task.run).not.toHaveBeenCalled();
    expect(live(stream)).toBe(0);
    expect(video.srcObject).toBeNull();
  });
});
