import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { startCamera } from '../src/tracking/camera';
import { deferred, FakeStream, FakeTrack, FakeVideo } from './helpers/media';

let stream: FakeStream;
let video: FakeVideo;
let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stream = new FakeStream([new FakeTrack(), new FakeTrack('audio')]);
  video = new FakeVideo();
  getUserMedia = vi.fn().mockResolvedValue(stream.media);
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('camera ownership', () => {
  it('attaches a live stream; repeated disposal stops every track once and detaches the preview', async () => {
    const ended = vi.fn();
    const camera = await startCamera(video.element, config.camera, ended);
    expect(camera.stream).toBe(stream.media);
    expect(camera.isLive()).toBe(true);
    expect(video.srcObject).toBe(stream.media);
    camera.dispose();
    camera.dispose();
    expect(camera.isLive()).toBe(false);
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(video.pause).toHaveBeenCalledTimes(1);
    stream.tracks[0].dispatchEvent(new Event('ended'));
    expect(ended).not.toHaveBeenCalled();
  });

  it('does not pause or detach a replacement stream', async () => {
    const camera = await startCamera(video.element, config.camera, vi.fn());
    const replacement = new FakeStream();
    video.srcObject = replacement.media;
    camera.dispose();
    expect(video.srcObject).toBe(replacement.media);
    expect(video.pause).not.toHaveBeenCalled();
    expect(replacement.tracks[0].stop).not.toHaveBeenCalled();
  });

  it('releases all tracks if video playback fails', async () => {
    video.play.mockRejectedValueOnce(new Error('Playback failed'));
    await expect(startCamera(video.element, config.camera, vi.fn())).rejects.toThrow('Playback failed');
    expect(video.srcObject).toBeNull();
    for (const track of stream.tracks) expect(track.readyState).toBe('ended');
  });

  it('stops a stream granted after cancellation without attaching it over a newer preview', async () => {
    const granted = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(granted.promise);
    const abort = new AbortController();
    const pending = startCamera(video.element, config.camera, vi.fn(), abort.signal);
    abort.abort();
    const replacement = new FakeStream();
    video.srcObject = replacement.media;
    granted.resolve(stream.media);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(video.srcObject).toBe(replacement.media);
    expect(video.play).not.toHaveBeenCalled();
    for (const track of stream.tracks) expect(track.readyState).toBe('ended');
    expect(replacement.tracks[0].readyState).toBe('live');
  });

  it('releases resources when cancelled during pending video playback', async () => {
    const playing = deferred<void>();
    video.play.mockReturnValueOnce(playing.promise);
    const abort = new AbortController();
    const pending = startCamera(video.element, config.camera, vi.fn(), abort.signal);
    await vi.waitFor(() => expect(video.play).toHaveBeenCalled());
    abort.abort();
    expect(video.srcObject).toBeNull();
    for (const track of stream.tracks) expect(track.readyState).toBe('ended');
    playing.resolve();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('checks readyState after playback even when stop() dispatched no ended event', async () => {
    video.play.mockImplementationOnce(async () => { stream.tracks[0].stop(); });
    await expect(startCamera(video.element, config.camera, vi.fn())).rejects.toMatchObject({ code: 'disconnected' });
    expect(video.srcObject).toBeNull();
  });

  it('reports an ended video track once and removes its listener on cleanup', async () => {
    const ended = vi.fn();
    const camera = await startCamera(video.element, config.camera, ended);
    stream.tracks[0].end();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(camera.isLive()).toBe(false);
    camera.dispose();
    stream.tracks[0].end();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('maps camera denial without acquiring resources', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    await expect(startCamera(video.element, config.camera, vi.fn())).rejects.toMatchObject({ code: 'denied' });
    expect(video.srcObject).toBeNull();
    expect(video.play).not.toHaveBeenCalled();
  });
});
