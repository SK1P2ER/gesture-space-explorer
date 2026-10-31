import type { Config } from '../config';

export type CameraError = 'unsupported' | 'insecure' | 'denied' | 'not-found' | 'disconnected' | 'unknown';

export interface CameraHandle {
  readonly stream: MediaStream;
  isLive(): boolean;
  dispose(): void;
}

/**
 * @param onEnded called if the camera goes away later (unplugged, revoked,
 *   taken by another app), so the UI can fall back to keyboard mode.
 */
export async function startCamera(video: HTMLVideoElement, cfg: Config['camera'], onEnded: () => void, signal?: AbortSignal): Promise<CameraHandle> {
  signal?.throwIfAborted();
  if (!window.isSecureContext) throw cameraError('insecure');
  if (!navigator.mediaDevices?.getUserMedia) throw cameraError('unsupported');

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: cfg.width }, height: { ideal: cfg.height }, facingMode: 'user' },
    });
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === 'NotAllowedError' || name === 'SecurityError') throw cameraError('denied');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw cameraError('not-found');
    throw cameraError('unknown');
  }

  let disposed = false;
  const tracks = stream.getTracks();
  const videoTracks = stream.getVideoTracks();
  const camera: CameraHandle = {
    stream,
    isLive: () => !disposed && videoTracks.length > 0 && videoTracks.every((track) => track.readyState === 'live'),
    dispose() {
      if (disposed) return;
      disposed = true;
      signal?.removeEventListener('abort', camera.dispose);
      for (const track of videoTracks) track.removeEventListener('ended', onEnded);
      for (const track of tracks) track.stop();
      // An older startup must never pause or detach a newer preview.
      if (video.srcObject === stream) {
        video.pause();
        video.srcObject = null;
      }
    },
  };
  for (const track of videoTracks) track.addEventListener('ended', onEnded, { once: true });
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
