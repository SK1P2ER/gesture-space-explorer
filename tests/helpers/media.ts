import { vi } from 'vitest';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export class FakeTrack extends EventTarget {
  readyState: MediaStreamTrackState = 'live';
  readonly stop = vi.fn(() => { this.readyState = 'ended'; });
  constructor(readonly kind = 'video') { super(); }
  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

export class FakeStream {
  constructor(readonly tracks = [new FakeTrack()]) {}
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
  get media() { return this as unknown as MediaStream; }
}

export class FakeVideo extends EventTarget {
  srcObject: MediaProvider | null = null;
  videoWidth = 640;
  videoHeight = 480;
  readyState = 2;
  currentTime = 0;
  paused = true;
  muted = false;
  playsInline = false;
  private nextId = 0;
  readonly frames = new Map<number, () => void>();
  readonly play = vi.fn(async () => { this.paused = false; });
  readonly pause = vi.fn(() => { this.paused = true; });
  readonly requestVideoFrameCallback = vi.fn((callback: () => void) => {
    const id = ++this.nextId;
    this.frames.set(id, callback);
    return id;
  });
  readonly cancelVideoFrameCallback = vi.fn((id: number) => { this.frames.delete(id); });
  frame() {
    this.currentTime += 1 / 30;
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    for (const callback of callbacks) callback();
  }
  get element() { return this as unknown as HTMLVideoElement; }
}
