import type { Config } from '../config';
import { cameraEvents } from '../performance/cameraEvents';

export type CameraError = 'unsupported' | 'insecure' | 'denied' | 'not-found' | 'disconnected' | 'unknown';

export interface CameraHandle {
  readonly stream: MediaStream;
  isLive(): boolean;
  dispose(): void;
}

/**
 * @param onEnded called if the camera goes away later (unplugged, revoked,
 *   taken by another app), so the UI can fall back to keyboard mode.
 * @param sessionId the tracking session asking, for the debug diagnostics' event log only.
 */
export async function startCamera(video: HTMLVideoElement, cfg: Config['camera'], onEnded: () => void, signal?: AbortSignal, sessionId = 0): Promise<CameraHandle> {
  signal?.throwIfAborted();
  if (!window.isSecureContext) throw cameraError('insecure');
  if (!navigator.mediaDevices?.getUserMedia) throw cameraError('unsupported');

  let stream: MediaStream;
  const requestId = cameraEvents.request(sessionId);
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: cfg.width }, height: { ideal: cfg.height }, facingMode: 'user' },
    });
  } catch (e) {
    const name = (e as DOMException).name;
    const code: CameraError = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
      : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'not-found' : 'unknown';
    cameraEvents.rejected(requestId, code);
    throw cameraError(code);
  }

  let disposed = false;
  const tracks = stream.getTracks();
  const videoTracks = stream.getVideoTracks();
  cameraEvents.resolved(requestId, tracks);
  const ended = (e: Event) => {
    cameraEvents.ended(e.target as MediaStreamTrack);
    onEnded();
  };
  const camera: CameraHandle = {
    stream,
    isLive: () => !disposed && videoTracks.length > 0 && videoTracks.every((track) => track.readyState === 'live'),
    dispose() {
      if (disposed) return;
      disposed = true;
      signal?.removeEventListener('abort', camera.dispose);
      for (const track of videoTracks) track.removeEventListener('ended', ended);
      for (const track of tracks) {
        track.stop();
        cameraEvents.stopped(track);
      }
      // An older startup must never pause or detach a newer preview.
      if (video.srcObject === stream) {
        video.pause();
        video.srcObject = null;
      }
    },
  };
  for (const track of videoTracks) track.addEventListener('ended', ended, { once: true });
  signal?.addEventListener('abort', camera.dispose, { once: true });
  try {
    signal?.throwIfAborted(); // getUserMedia itself cannot be aborted; release a late stream here.
    if (!camera.isLive()) throw cameraError('disconnected');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    signal?.throwIfAborted();
    if (!camera.isLive()) throw cameraError('disconnected');
    return camera;
  } catch (e) {
    camera.dispose();
    throw e;
  }
}

function cameraError(code: CameraError) {
  return Object.assign(new Error(code), { code });
}

export function cameraErrorCode(e: unknown): CameraError {
  return (e as { code?: CameraError } | null)?.code ?? 'unknown';
}
