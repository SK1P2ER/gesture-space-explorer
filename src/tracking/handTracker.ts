import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { Config } from '../config';
import type { HandFrame } from './types';

const BASE = import.meta.env.BASE_URL;
const WASM_PATH = `${BASE}mediapipe/${__MEDIAPIPE_VERSION__}/wasm`;
const MODEL_PATH = `${BASE}models/hand_landmarker.v1.task`;

export type Delegate = 'GPU' | 'CPU';

export interface HandTracker {
  delegate: Delegate;
  /** Stops inference and closes the owned MediaPipe task. Safe to call repeatedly. */
  dispose(): void;
  /**
   * Starts the per-video-frame detection loop. Returns a stop function.
   * A failing frame is skipped; `onFatal` fires (and the loop stops) only if
   * detection keeps failing, so one bad frame can't silently kill gestures.
   */
  run(
    video: HTMLVideoElement,
    onFrame: (frame: HandFrame, detectMs: number) => void,
    onFatal: (error: unknown) => void,
  ): () => void;
}

const MAX_CONSECUTIVE_FAILURES = 30; // ~1 s of frames

// Safari's GPU delegate is unreliable: it can initialize fine and then
// return nothing. Go straight to CPU there.
const isSafari = /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);

export async function createHandTracker(
  cfg: Config['tracking'],
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<HandTracker> {
  signal?.throwIfAborted();
  const [fileset, model] = await Promise.all([
    FilesetResolver.forVisionTasks(WASM_PATH),
    fetchWithProgress(MODEL_PATH, onProgress, signal),
  ]);
  signal?.throwIfAborted();

  const create = (delegate: Delegate) =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: model, delegate },
      runningMode: 'VIDEO',
      numHands: cfg.numHands,
      minHandDetectionConfidence: cfg.minHandDetectionConfidence,
      minHandPresenceConfidence: cfg.minHandPresenceConfidence,
      minTrackingConfidence: cfg.minTrackingConfidence,
    });

  let delegate: Delegate = isSafari ? 'CPU' : 'GPU';
  let landmarker: HandLandmarker;
  try {
    landmarker = await create(delegate);
  } catch (e) {
    signal?.throwIfAborted();
    if (delegate === 'CPU') throw e;
    console.warn('[tracker] GPU delegate failed, falling back to CPU', e);
    delegate = 'CPU';
    landmarker = await create(delegate);
  }

  // MediaPipe creation is not abortable. A task created after cancellation is still ours to close.
  if (signal?.aborted) {
    landmarker.close();
    signal.throwIfAborted();
  }
  let disposed = false;
  let stopRun = () => {};

  return {
    delegate,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopRun();
      landmarker.close();
    },
    run(video, onFrame, onFatal) {
      if (disposed) throw new Error('Hand tracker is disposed');
      stopRun();
      let stopped = false;
      let videoCallback: number | null = null;
      let animationCallback: number | null = null;
      let lastVideoTime = -1;
      let lastTs = 0;
      let failures = 0;

      const stop = () => {
        if (stopped) return;
        stopped = true;
        if (videoCallback !== null) video.cancelVideoFrameCallback?.(videoCallback);
        if (animationCallback !== null) cancelAnimationFrame(animationCallback);
        videoCallback = animationCallback = null;
      };

      const tick = () => {
        videoCallback = animationCallback = null;
        if (stopped || disposed) return;
        // Don't burn battery in a background tab; don't re-detect the same frame.
        if (!document.hidden && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          const ts = Math.max(performance.now(), lastTs + 1); // must strictly increase
          lastTs = ts;
          try {
            const start = performance.now();
            const result = landmarker.detectForVideo(video, ts);
            onFrame(toFrame(result, ts), performance.now() - start);
            failures = 0;
          } catch (e) {
            if (failures === 0) console.error('[tracker] frame failed', e);
            if (++failures >= MAX_CONSECUTIVE_FAILURES) {
              stop();
              onFatal(e);
              return;
            }
          }
        }
        if (!stopped && !disposed) schedule();
      };

      const schedule = () => {
        try {
          if ('requestVideoFrameCallback' in video) videoCallback = video.requestVideoFrameCallback(tick);
          else animationCallback = requestAnimationFrame(tick);
        } catch (e) {
          stop();
          onFatal(e);
        }
      };

      stopRun = stop;
      schedule();
      return stop;
    },
  };
}

function toFrame(result: HandLandmarkerResult, t: number): HandFrame {
  return {
    t,
    hands: result.landmarks.map((lms, i) => {
      const category = result.handedness[i]?.[0];
      return {
        handedness: category?.categoryName === 'Left' ? 'Left' : 'Right',
        score: category?.score ?? 0,
        landmarks: lms.map((p) => [p.x, p.y, p.z]),
      };
    }),
  };
}

async function fetchWithProgress(url: string, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress(received / total);
  }
  onProgress(1);
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
