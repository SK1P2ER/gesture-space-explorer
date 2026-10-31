import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { createHandTracker, type HandTracker } from '../src/tracking/handTracker';
import { deferred, FakeVideo } from './helpers/media';

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn() },
  HandLandmarker: { createFromOptions: vi.fn() },
}));

const create = vi.mocked(HandLandmarker.createFromOptions);
const fileset = vi.mocked(FilesetResolver.forVisionTasks);
const owned: HandTracker[] = [];
let detector: { detectForVideo: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  detector = { detectForVideo: vi.fn(() => ({ landmarks: [], handedness: [] })), close: vi.fn() };
  create.mockResolvedValue(detector as unknown as HandLandmarker);
  fileset.mockResolvedValue({ wasmLoaderPath: 'local.js', wasmBinaryPath: 'local.wasm' });
  vi.stubGlobal('document', { hidden: false });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } })));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  for (const tracker of owned.splice(0)) tracker.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function tracker() {
  const task = await createHandTracker(config.tracking, vi.fn());
  owned.push(task);
  return task;
}

describe('MediaPipe task and inference loop ownership', () => {
  it('creates the GPU task normally, converts frames, and closes the task once', async () => {
    const task = await tracker();
    const video = new FakeVideo();
    const frame = vi.fn();
    const fatal = vi.fn();
    expect(task.delegate).toBe('GPU');
    expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      baseOptions: expect.objectContaining({ delegate: 'GPU', modelAssetBuffer: new Uint8Array([1, 2, 3]) }),
      runningMode: 'VIDEO',
    }));
    task.run(video.element, frame, fatal);
    video.frame();
    expect(frame).toHaveBeenCalledWith({ t: expect.any(Number), hands: [] }, expect.any(Number));
    expect(fatal).not.toHaveBeenCalled();
    task.dispose();
    task.dispose();
    expect(detector.close).toHaveBeenCalledTimes(1);
    expect(video.frames.size).toBe(0);
    expect(() => task.run(video.element, frame, fatal)).toThrow('disposed');
  });

  it('rejects an HTTP 503 model load without allocating a task', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
    await expect(createHandTracker(config.tracking, vi.fn())).rejects.toThrow('HTTP 503');
    expect(create).not.toHaveBeenCalled();
  });

  it('passes cancellation to the model fetch and avoids initialization after an early abort', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(createHandTracker(config.tracking, vi.fn(), abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    const active = new AbortController();
    const task = await createHandTracker(config.tracking, vi.fn(), active.signal);
    owned.push(task);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('hand_landmarker.v1.task'), { signal: active.signal });
  });

  it('closes a task returned after initialization was cancelled', async () => {
    const pendingTask = deferred<HandLandmarker>();
    create.mockReturnValueOnce(pendingTask.promise);
    const abort = new AbortController();
    const pending = createHandTracker(config.tracking, vi.fn(), abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    abort.abort();
    pendingTask.resolve(detector as unknown as HandLandmarker);
    await rejected;
    expect(detector.close).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('retains CPU fallback for an ordinary GPU initialization failure', async () => {
    create.mockRejectedValueOnce(new Error('GPU unavailable'));
    const task = await tracker();
    expect(task.delegate).toBe('CPU');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][1]?.baseOptions?.delegate).toBe('CPU');
  });

  it('does not start a CPU task when cancellation accompanies GPU initialization failure', async () => {
    const pendingTask = deferred<HandLandmarker>();
    create.mockReturnValueOnce(pendingTask.promise);
    const abort = new AbortController();
    const pending = createHandTracker(config.tracking, vi.fn(), abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    abort.abort();
    pendingTask.reject(new Error('GPU stopped'));
    await rejected;
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('cancels the scheduled video callback and ignores an already-queued stale callback', async () => {
    const task = await tracker();
    const video = new FakeVideo();
    const frame = vi.fn();
    const stop = task.run(video.element, frame, vi.fn());
    const queued = [...video.frames.values()][0];
    stop();
    stop();
    queued();
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledTimes(1);
    expect(video.frames.size).toBe(0);
    expect(detector.detectForVideo).not.toHaveBeenCalled();
    expect(frame).not.toHaveBeenCalled();
  });

  it('cancels requestAnimationFrame when video-frame callbacks are unavailable', async () => {
    const task = await tracker();
    const video = new FakeVideo();
    Reflect.deleteProperty(video, 'requestVideoFrameCallback');
    const request = vi.fn(() => 42);
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    task.run(video.element, vi.fn(), vi.fn());
    task.dispose();
    expect(request).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('stops the previous loop when run is called again on the same task', async () => {
    const task = await tracker();
    const video = new FakeVideo();
    const previous = vi.fn();
    const current = vi.fn();
    task.run(video.element, previous, vi.fn());
    task.run(video.element, current, vi.fn());
    expect(video.frames.size).toBe(1);
    video.frame();
    expect(previous).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
  });

  it('does not reschedule if disposal occurs inside the frame-processing callback', async () => {
    const task = await tracker();
    const video = new FakeVideo();
    task.run(video.element, () => task.dispose(), vi.fn());
    video.frame();
    expect(video.frames.size).toBe(0);
    expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
    expect(detector.close).toHaveBeenCalledTimes(1);
  });

  it('reports a callback scheduling failure as terminal', async () => {
    const task = await tracker();
    const video = new FakeVideo();
    const fatal = vi.fn();
    video.requestVideoFrameCallback.mockImplementationOnce(() => { throw new Error('Scheduling failed'); });
    task.run(video.element, vi.fn(), fatal);
    expect(fatal).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Scheduling failed' }));
    expect(video.frames.size).toBe(0);
  });

  it('tolerates transient detection errors and ordinary frames with no hands', async () => {
    const task = await tracker();
    const video = new FakeVideo();
    const frame = vi.fn();
    const fatal = vi.fn();
    detector.detectForVideo.mockImplementationOnce(() => { throw new Error('One bad frame'); });
    task.run(video.element, frame, fatal);
    for (let i = 0; i < 40; i++) video.frame();
    expect(frame).toHaveBeenCalledTimes(39);
    expect(fatal).not.toHaveBeenCalled();
    expect(detector.close).not.toHaveBeenCalled();
  });

  it.each(['detector', 'processing'])('stops after consecutive terminal %s failures', async (where) => {
    const task = await tracker();
    const video = new FakeVideo();
    const frame = vi.fn();
    const fatal = vi.fn();
    const fail = () => { throw new Error('Terminal frame failure'); };
    if (where === 'detector') detector.detectForVideo.mockImplementation(fail);
    else frame.mockImplementation(fail);
    task.run(video.element, frame, fatal);
    for (let i = 0; i < 40; i++) video.frame();
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(detector.detectForVideo).toHaveBeenCalledTimes(30);
    expect(video.frames.size).toBe(0);
    task.dispose();
    expect(detector.close).toHaveBeenCalledTimes(1);
  });
});
