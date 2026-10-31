import type { LandingContext } from '../sim/landingReplay';
import type { HandFrame } from '../tracking/types';

// Records landmark numbers only (never images). Downloads locally as JSON,
// ready to drop into tests/fixtures/ for replay tests.

export interface Recording {
  version: 1;
  createdAt: string;
  /** Each frame carries the app's mode when it was seen ('docking' while landing). */
  frames: RecordedFrame[];
  /** The last landing during the recording: enough to replay it (sim/landingReplay.ts). */
  landing?: LandingContext;
}

export type RecordedFrame = HandFrame & { mode?: string };

export class Recorder {
  private frames: RecordedFrame[] | null = null;

  get recording() {
    return this.frames !== null;
  }

  get frameCount() {
    return this.frames?.length ?? 0;
  }

  start() {
    this.frames = [];
  }

  push(frame: HandFrame, mode?: string) {
    this.frames?.push(mode ? { ...frame, mode } : frame);
  }

  stop(landing?: LandingContext | null): Recording | null {
    if (!this.frames) return null;
    const t0 = this.frames[0]?.t ?? 0;
    // Rebase time to 0 and trim precision to keep files small.
    const frames = this.frames.map((f) => ({
      ...(f.mode ? { mode: f.mode } : {}),
      t: Math.round(f.t - t0),
      hands: f.hands.map((h) => ({
        ...h,
        score: round(h.score),
        landmarks: h.landmarks.map(([x, y, z]) => [round(x), round(y), round(z)] as [number, number, number]),
      })),
    }));
    this.frames = null;
    return { version: 1, createdAt: new Date().toISOString(), frames, ...(landing ? { landing } : {}) };
  }
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

export function downloadRecording(rec: Recording) {
  const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${rec.landing ? 'landing' : 'gesture'}-${rec.createdAt.replace(/[:.]/g, '-')}.landmarks.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
