import type { Config } from '../config';
import type { HandFrame } from '../tracking/types';
import type { Recorder } from './recorder';

// Same as HandLandmarker.HAND_CONNECTIONS, inlined so MediaPipe can be lazy-loaded.
const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20], // pinky + palm
];

// The camera preview (with hand skeleton) is always shown small in a corner:
// it tells users the camera is on and helps them keep their hand in frame.
// Debug mode adds stats, the recorder and live config tuning (lil-gui).
export class DebugOverlay {
  private root = document.querySelector<HTMLElement>('#preview')!;
  private canvas = document.querySelector<HTMLCanvasElement>('#preview canvas')!;
  private stats = document.querySelector<HTMLElement>('#debug-stats')!;
  private copyButton = document.querySelector<HTMLButtonElement>('#preview .debug-copy')!;
  private ctx = this.canvas.getContext('2d')!;

  private debug = false;
  /** The camera preview is up (tracking started); without it, ?debug shows the stats alone. */
  private cameraShown = false;
  private gui: { destroy(): void } | null = null;
  private lastFrame: HandFrame | null = null;
  private detectMs = 0;
  private detectTimes: number[] = [];
  private renderTimes: number[] = [];
  delegate = '—';
  /** Set by main each frame: what the gesture engine currently sees. */
  gestureInfo = '—';
  /** Set by main each frame: auto-quality's render resolution and the frame rate it holds. */
  resolutionInfo = '—';
  /** Set by main each frame: the Quality setting, and in Auto what it has learned. */
  tierInfo = '—';
  /** Recovered "can't happen" states, newest last; kept while debug is off so turning it on shows them. */
  readonly incidents: string[] = [];

  constructor(
    private readonly cfg: Config,
    private readonly recorder: Recorder,
  ) {
    this.copyButton.addEventListener('click', () => {
      void this.copyReport();
      this.copyButton.blur(); // keep Space / Enter for the scene
    });
  }

  /** The link and the debug lines as text, for pasting into a bug report. Nothing is sent anywhere. */
  reportText(): string {
    return [
      `Gesture Space Explorer v${__APP_VERSION__} · debug report · ${new Date().toISOString()}`,
      `link    ${location.href}`,
      `device  ${navigator.userAgent} · ${innerWidth}×${innerHeight} @ ${devicePixelRatio}x`,
      this.stats.textContent ?? '',
    ].join('\n');
  }

  /** 📋 Copy report: to the clipboard (local only); where that's refused, the text is selected to copy by hand. */
  private async copyReport() {
    const text = this.reportText();
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;inset:auto 0 0 0;height:40vh;z-index:100;font:11px monospace';
      document.body.append(area);
      area.select();
      try { copied = document.execCommand('copy'); } catch { /* left selected for a manual copy */ }
      if (copied) area.remove();
      else area.addEventListener('blur', () => area.remove(), { once: true });
    }
    this.copyButton.textContent = copied ? '✓ Copied' : 'Select and copy the text below';
    setTimeout(() => (this.copyButton.textContent = '📋 Copy report'), 2000);
  }

  get enabled() {
    return this.debug;
  }

  setDebug(on: boolean) {
    this.debug = on;
    this.root.classList.toggle('debug', on);
    this.syncVisibility();
    if (on && !this.gui) {
      // Loaded on demand so lil-gui stays out of the main bundle.
      void import('lil-gui').then(({ default: GUI }) => {
        if (!this.debug || this.gui) return;
        const gui = new GUI({ title: 'Config (live)', closeFolders: true });
        gui.close();
        addFolder(gui, 'gestures', this.cfg.gestures);
        addFolder(gui, 'smoothing', this.cfg.smoothing);
        addFolder(gui, 'render', this.cfg.render);
        addFolder(gui, 'keyboard', this.cfg.keyboard);
        this.gui = gui;
      });
    } else if (!on && this.gui) {
      this.gui.destroy();
      this.gui = null;
    }
  }

  /** Something the app recovered from (it is also logged to the console by whoever reports it). */
  report(message: string) {
    this.incidents.push(`${new Date().toISOString().slice(11, 19)} ${message}`);
    if (this.incidents.length > MAX_INCIDENTS) this.incidents.shift();
  }

  /** @param aspect camera width / height — the preview matches it exactly. */
  show(aspect: number) {
    this.root.style.setProperty('--aspect', String(aspect));
    this.cameraShown = true;
    this.syncVisibility();
  }

  /** Shown with the camera, or in debug mode without it (the stats and the Copy report button only). */
  private syncVisibility() {
    this.root.hidden = !this.cameraShown && !this.debug;
    this.root.classList.toggle('stats-only', this.debug && !this.cameraShown);
    this.copyButton.hidden = !this.debug;
  }

  onFrame(frame: HandFrame, detectMs: number) {
    this.lastFrame = frame;
    this.detectMs = detectMs;
    pushTime(this.detectTimes, frame.t);
    this.draw();
  }

  /** Call once per rendered frame. */
  onRender(now: number) {
    pushTime(this.renderTimes, now);
    if (!this.debug) return;
    const hands = this.lastFrame?.hands ?? [];
    this.stats.textContent = [
      `render  ${fps(this.renderTimes)} fps`,
      `detect  ${fps(this.detectTimes)} fps · ${this.detectMs.toFixed(1)} ms · ${this.delegate}`,
      `hands   ${hands.length ? hands.map((h) => `${h.handedness[0]} ${h.score.toFixed(2)}`).join(', ') : '—'}`,
      `gesture ${this.gestureInfo}`,
      `res     ${this.resolutionInfo}`,
      `quality ${this.tierInfo}`,
      this.recorder.recording ? `● REC   ${this.recorder.frameCount} frames (R to stop)` : `R  record landmarks`,
      ...this.incidents.map((incident) => `⚠ ${incident}`),
    ].join('\n');
  }

  private draw() {
    const { canvas, ctx } = this;
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
    const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
    ctx.clearRect(0, 0, w, h);
    for (const hand of this.lastFrame?.hands ?? []) {
      const pts = hand.landmarks.map(([x, y]) => [x * w, y * h] as const);
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.strokeStyle = hand.handedness === 'Left' ? '#4fd1c5' : '#f6ad55';
      ctx.beginPath();
      for (const [start, end] of CONNECTIONS) {
        ctx.moveTo(...pts[start]);
        ctx.lineTo(...pts[end]);
      }
      ctx.stroke();
      ctx.fillStyle = '#fff';
      for (const [x, y] of pts) {
        ctx.beginPath();
        ctx.arc(x, y, 2.5 * devicePixelRatio, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function addFolder(gui: import('lil-gui').default, name: string, obj: Record<string, number>) {
  const folder = gui.addFolder(name);
  for (const key of Object.keys(obj)) folder.add(obj, key);
}

function pushTime(times: number[], t: number) {
  times.push(t);
  while (times.length && t - times[0] > 1000) times.shift();
}

const MAX_INCIDENTS = 5;

const fps = (times: number[]) => String(Math.max(0, times.length - 1)).padStart(3);
