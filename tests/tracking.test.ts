import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTracking, type TrackingDeps, type TrackingSession } from '../src/app/tracking';
import { createState } from '../src/app/state';
import { config } from '../src/config';
import { GestureEngine } from '../src/gestures/engine';
import { ExtraGestures } from '../src/gestures/extras';
import { keyToIntent } from '../src/input/keyboard';
import { createIntentBus } from '../src/intents';
import { createHandTracker, type HandTracker } from '../src/tracking/handTracker';
import type { HandFrame } from '../src/tracking/types';
import { Recorder } from '../src/ui/recorder';
import { deferred, FakeStream, FakeVideo } from './helpers/media';

vi.mock('../src/tracking/handTracker', () => ({ createHandTracker: vi.fn() }));
const create = vi.mocked(createHandTracker);
const sessions: TrackingSession[] = [];
const FRAME: HandFrame = { t: 1000, hands: [] };
let stream: FakeStream;
let video: FakeVideo;
let getUserMedia: ReturnType<typeof vi.fn>;
let deps: TrackingDeps;

function detector() {
  let frame: Parameters<HandTracker['run']>[1] = () => {};
  let fatal: Parameters<HandTracker['run']>[2] = () => {};
  const stop = vi.fn();
  const task = {
    delegate: 'GPU' as const,
    dispose: vi.fn(),
    run: vi.fn<HandTracker['run']>((_video, onFrame, onFatal) => {
      frame = onFrame;
      fatal = onFatal;
      return stop;
    }),
    stop,
    emit: () => frame(FRAME, 2),
    fail: () => fatal(new Error('Terminal detection error')),
  };
  return task;
}

beforeEach(() => {
  vi.clearAllMocks();
  create.mockReset();
  stream = new FakeStream();
  video = new FakeVideo();
  getUserMedia = vi.fn().mockResolvedValue(stream.media);
  const windowTarget = Object.assign(new EventTarget(), { isSecureContext: true });
  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('navigator', { userAgent: 'Node test', maxTouchPoints: 0, mediaDevices: { getUserMedia } });
  vi.stubGlobal('document', { querySelector: () => video.element });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  deps = {
    state: createState(), bus: createIntentBus(),
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
function start() {
  const session = startTracking(deps);
  sessions.push(session);
  return session;
}
async function pendingStartup() {
  const pending = deferred<HandTracker>();
  create.mockReturnValueOnce(pending.promise);
  const session = start();
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(video.play).toHaveBeenCalledTimes(1));
  return { pending, session };
}
function expectCameraReleased() {
  for (const track of stream.tracks) {
    expect(track.readyState).toBe('ended');
    expect(track.stop).toHaveBeenCalledTimes(1);
  }
  expect(video.srcObject).toBeNull();
}

describe('tracking session lifecycle and cancellation', () => {
  it('releases the camera on model rejection, preserves keyboard fallback, and leaves intent dispatch usable', async () => {
    const { pending, session } = await pendingStartup();
    const update = vi.spyOn(deps.gestures, 'update');
    pending.reject(new Error('Model HTTP 503'));
    await expect(session.ready).resolves.toBeUndefined();
    expect(session.cancelled).toBe(true);
    expectCameraReleased();
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.tracker' });
    expect(update).not.toHaveBeenCalled();
    const listener = vi.fn();
    deps.bus.on(listener);
    deps.bus.emit(keyToIntent('ArrowRight', config.keyboard)!);
    expect(listener).toHaveBeenCalledWith({ type: 'next' });
  });

  it('cancels immediately on disconnect during model startup and disposes late success', async () => {
    const { pending, session } = await pendingStartup();
    const task = detector();
    stream.tracks[0].end();
    expect(session.cancelled).toBe(true);
    expectCameraReleased();
    expect(create.mock.calls[0][2]?.aborted).toBe(true);
    pending.resolve(task);
    await session.ready;
    expect(task.dispose).toHaveBeenCalledTimes(1);
    expect(task.run).not.toHaveBeenCalled();
    expect(deps.overlay.show).not.toHaveBeenCalled();
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.disconnected' });
    create.mock.calls[0][1](0.9); // stale model progress must not overwrite fallback
    expect(deps.state.status.kind).toBe('keyboard');
  });

  it('handles late initialization rejection without replacing the disconnect reason', async () => {
    const { pending, session } = await pendingStartup();
    stream.tracks[0].end();
    pending.reject(new Error('Late model rejection'));
    await expect(session.ready).resolves.toBeUndefined();
    expectCameraReleased();
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.disconnected' });
  });

  it('checks ended tracks before activation even if stop() emitted no ended event', async () => {
    const { pending, session } = await pendingStartup();
    const task = detector();
    stream.tracks[0].stop();
    pending.resolve(task);
    await session.ready;
    expect(video.srcObject).toBeNull();
    expect(task.dispose).toHaveBeenCalledTimes(1);
    expect(task.run).not.toHaveBeenCalled();
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.disconnected' });
  });

  it('starts normal GPU tracking and processes gestures through the existing bus', async () => {
    const task = detector();
    create.mockResolvedValueOnce(task);
    const session = start();
    await session.ready;
    expect(session.cancelled).toBe(false);
    expect(deps.state.status).toEqual({ kind: 'tracking', delegate: 'GPU' });
    expect(video.srcObject).toBe(stream.media);
    expect(deps.overlay.show).toHaveBeenCalledWith(4 / 3);
    const listener = vi.fn();
    deps.bus.on(listener);
    vi.spyOn(deps.gestures, 'update').mockReturnValueOnce([{ type: 'togglePause' }]);
    task.emit();
    expect(listener).toHaveBeenCalledWith({ type: 'togglePause' });
    expect(deps.overlay.onFrame).toHaveBeenCalledWith(FRAME, 2);
    expect(task.dispose).not.toHaveBeenCalled();
  });

  it('disposes the loop, camera, detector and page listener exactly once', async () => {
    const task = detector();
    create.mockResolvedValueOnce(task);
    const reset = vi.spyOn(deps.gestures, 'reset');
    const remove = vi.spyOn(window, 'removeEventListener');
    const session = start();
    await session.ready;
    session.dispose();
    session.dispose();
    window.dispatchEvent(new Event('pagehide'));
    expectCameraReleased();
    expect(task.stop).toHaveBeenCalledTimes(1);
    expect(task.dispose).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('pagehide', expect.any(Function));
    const update = vi.spyOn(deps.gestures, 'update');
    task.emit();
    task.fail();
    expect(update).not.toHaveBeenCalled();
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.disconnected' });
  });

  it('releases all resources and falls back once on terminal runtime failure', async () => {
    const task = detector();
    create.mockResolvedValueOnce(task);
    const session = start();
    await session.ready;
    task.fail();
    task.fail();
    expectCameraReleased();
    expect(task.stop).toHaveBeenCalledTimes(1);
    expect(task.dispose).toHaveBeenCalledTimes(1);
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.tracking-stopped' });
  });

  it('stops emitting intents and confirmations if an intent listener cancels the session', async () => {
    const task = detector();
    create.mockResolvedValueOnce(task);
    const session = start();
    await session.ready;
    vi.spyOn(deps.gestures, 'update').mockReturnValueOnce([{ type: 'togglePause' }, { type: 'next' }]);
    deps.gestureMessage = () => 'Must not appear after cancellation';
    const listener = vi.fn(() => session.dispose());
    deps.bus.on(listener);
    task.emit();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(deps.gestureHud.flash).not.toHaveBeenCalled();
    expectCameraReleased();
    expect(task.dispose).toHaveBeenCalledTimes(1);
  });

  it('handles a synchronous runtime failure before run returns its stop callback', async () => {
    const task = detector();
    task.run.mockImplementationOnce((_video, _frame, fatal) => {
      fatal(new Error('Synchronous detector failure'));
      return task.stop;
    });
    create.mockResolvedValueOnce(task);
    await start().ready;
    expectCameraReleased();
    expect(task.stop).toHaveBeenCalledTimes(1);
    expect(task.dispose).toHaveBeenCalledTimes(1);
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.tracking-stopped' });
  });

  it('cleans up if starting the inference loop throws', async () => {
    const task = detector();
    task.run.mockImplementationOnce(() => { throw new Error('Loop setup failed'); });
    create.mockResolvedValueOnce(task);
    await expect(start().ready).resolves.toBeUndefined();
    expectCameraReleased();
    expect(task.dispose).toHaveBeenCalledTimes(1);
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.tracker' });
  });

  it('disposes a pending session on pagehide and closes a late detector', async () => {
    const { pending, session } = await pendingStartup();
    window.dispatchEvent(new Event('pagehide'));
    expect(session.cancelled).toBe(true);
    expectCameraReleased();
    const task = detector();
    pending.resolve(task);
    await session.ready;
    expect(task.dispose).toHaveBeenCalledTimes(1);
    expect(task.run).not.toHaveBeenCalled();
  });

  it('releases an active session on pagehide', async () => {
    const task = detector();
    create.mockResolvedValueOnce(task);
    const session = start();
    await session.ready;
    window.dispatchEvent(new Event('pagehide'));
    expectCameraReleased();
    expect(task.stop).toHaveBeenCalledTimes(1);
    expect(task.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('ends camera tracks on pagehide persisted=%s without reacquiring on pageshow', async (persisted) => {
    class PageTransitionEvent extends Event {
      constructor(type: string, readonly persisted: boolean) { super(type); }
    }
    const task = detector(); create.mockResolvedValueOnce(task);
    const session = start(); await session.ready;
    window.dispatchEvent(new PageTransitionEvent('pagehide', persisted));
    expectCameraReleased(); expect(task.stop).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new PageTransitionEvent('pageshow', persisted));
    expect(getUserMedia).toHaveBeenCalledTimes(1); expect(deps.state.status.kind).toBe('keyboard');
  });

  it('a new session after pagehide (🖐 Turn on hand control) reacquires the camera and tracks again', async () => {
    create.mockResolvedValueOnce(detector());
    await start().ready;
    window.dispatchEvent(new Event('pagehide'));
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.disconnected' });
    const previousStream = stream;
    stream = new FakeStream();
    getUserMedia.mockResolvedValueOnce(stream.media);
    create.mockResolvedValueOnce(detector());
    await start().ready;
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(previousStream.tracks[0].readyState).toBe('ended');
    expect(stream.tracks[0].readyState).toBe('live');
    expect(video.srcObject).toBe(stream.media);
    expect(deps.state.status).toEqual({ kind: 'tracking', delegate: 'GPU' });
  });

  it('a replacement session owns the preview and ignores all old frame/fatal callbacks', async () => {
    const previousTask = detector();
    create.mockResolvedValueOnce(previousTask);
    const previous = start();
    await previous.ready;
    const previousStream = stream;
    stream = new FakeStream();
    getUserMedia.mockResolvedValueOnce(stream.media);
    const task = detector();
    create.mockResolvedValueOnce(task);
    const current = start();
    await current.ready;
    expect(current.id).not.toBe(previous.id);
    expect(previous.cancelled).toBe(true);
    expect(previousStream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(previousTask.dispose).toHaveBeenCalledTimes(1);
    const update = vi.spyOn(deps.gestures, 'update');
    previousTask.emit();
    previousTask.fail();
    previous.dispose();
    previousStream.tracks[0].end();
    expect(update).not.toHaveBeenCalled();
    expect(video.srcObject).toBe(stream.media);
    expect(stream.tracks[0].readyState).toBe('live');
    expect(task.dispose).not.toHaveBeenCalled();
    expect(deps.state.status).toEqual({ kind: 'tracking', delegate: 'GPU' });
  });

  it.each(['success', 'rejection'])('rapid start/stop/start ignores late old detector %s and camera permission', async (outcome) => {
    const cameraPermission = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(cameraPermission.promise);
    const pending = deferred<HandTracker>();
    create.mockReturnValueOnce(pending.promise);
    const previous = start();
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    previous.dispose();
    const previousStream = stream;
    stream = new FakeStream();
    getUserMedia.mockResolvedValueOnce(stream.media);
    const task = detector();
    create.mockResolvedValueOnce(task);
    const current = start();
    await current.ready;
    const late = detector();
    if (outcome === 'success') pending.resolve(late);
    else pending.reject(new Error('Old task failed late'));
    cameraPermission.resolve(previousStream.media);
    await previous.ready;
    await vi.dynamicImportSettled();
    expect(previousStream.tracks[0].readyState).toBe('ended');
    expect(late.run).not.toHaveBeenCalled();
    expect(late.dispose).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
    expect(video.srcObject).toBe(stream.media);
    expect(stream.tracks[0].stop).not.toHaveBeenCalled();
    expect(task.dispose).not.toHaveBeenCalled();
    expect(deps.state.status).toEqual({ kind: 'tracking', delegate: 'GPU' });
    create.mock.calls[0][1](0.5);
    expect(deps.state.status.kind).toBe('tracking');
  });

  it('does not create a detector for a session stopped before its lazy module is ready', async () => {
    const previousStream = stream;
    getUserMedia.mockResolvedValueOnce(previousStream.media);
    const previous = start();
    previous.dispose();
    await previous.ready;
    await vi.dynamicImportSettled();
    expect(create).not.toHaveBeenCalled();
    stream = new FakeStream();
    getUserMedia.mockResolvedValueOnce(stream.media);
    const task = detector();
    create.mockResolvedValueOnce(task);
    const current = start();
    await Promise.all([previous.ready, current.ready]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(previousStream.tracks[0].readyState).toBe('ended');
    expect(video.srcObject).toBe(stream.media);
    expect(deps.state.status).toEqual({ kind: 'tracking', delegate: 'GPU' });
    expect(task.dispose).not.toHaveBeenCalled();
  });

  it('model rejection cancels and releases a camera whose play promise is still pending', async () => {
    const playing = deferred<void>();
    video.play.mockReturnValueOnce(playing.promise);
    const { pending, session } = await pendingStartup();
    pending.reject(new Error('Model failed during playback startup'));
    await vi.waitFor(() => expect(session.cancelled).toBe(true));
    expectCameraReleased();
    playing.reject(new Error('Playback rejected after cancellation'));
    await expect(session.ready).resolves.toBeUndefined();
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.tracker' });
  });

  it('camera denial closes an already-created detector and preserves the camera error', async () => {
    const task = detector();
    const permission = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(permission.promise);
    create.mockResolvedValueOnce(task);
    const session = start();
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await vi.dynamicImportSettled();
    permission.reject(new DOMException('Denied', 'NotAllowedError'));
    await session.ready;
    expect(task.dispose).toHaveBeenCalledTimes(1);
    expect(task.run).not.toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.denied' });
  });

  it('a no-event stopped camera is detected before processing another frame', async () => {
    const task = detector();
    create.mockResolvedValueOnce(task);
    const session = start();
    await session.ready;
    stream.tracks[0].stop();
    const update = vi.spyOn(deps.gestures, 'update');
    task.emit();
    expect(update).not.toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    expect(task.dispose).toHaveBeenCalledTimes(1);
    expect(deps.state.status).toEqual({ kind: 'keyboard', reason: 'err.disconnected' });
  });
});
