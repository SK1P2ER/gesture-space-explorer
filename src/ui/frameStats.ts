// Frame timing for ?debug, under the FPS counter: how long one frame of our loop
// takes on the CPU (scene update, render commands, HUD), and how long its render
// takes on the GPU, as the mean and 95th percentile over the last second.
// GPU time needs WebGL timer queries (EXT_disjoint_timer_query_webgl2): desktop
// Chrome and Edge have them, Safari, Firefox and many phones don't — CPU time
// still tells those apart.

export interface Summary {
  mean: number;
  p95: number;
  count: number;
}

/** Frame times over a sliding window. */
export class FrameTimes {
  private samples: { t: number; ms: number }[] = [];

  constructor(private readonly windowMs = 1000) {}

  push(t: number, ms: number) {
    this.samples.push({ t, ms });
    while (t - this.samples[0].t > this.windowMs) this.samples.shift();
  }

  summary(): Summary | null {
    const n = this.samples.length;
    if (!n) return null;
    const sorted = this.samples.map((s) => s.ms).sort((a, b) => a - b);
    return {
      mean: sorted.reduce((sum, ms) => sum + ms, 0) / n,
      p95: sorted[Math.ceil(0.95 * n) - 1], // nearest rank
      count: n,
    };
  }
}

/** "CPU   3.2 ms  p95   4.8" */
export function formatLine(label: string, s: Summary | null): string {
  if (!s) return `${label}     —`;
  return `${label} ${s.mean.toFixed(1).padStart(5)} ms  p95 ${s.p95.toFixed(1).padStart(5)}`;
}

export interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export type TimerGl = Pick<
  WebGL2RenderingContext,
  'createQuery' | 'beginQuery' | 'endQuery' | 'getQueryParameter' | 'deleteQuery' | 'getParameter' | 'QUERY_RESULT' | 'QUERY_RESULT_AVAILABLE'
>;

/** Most queries in flight: if the GPU falls this far behind, frames go unmeasured rather than piling up. */
const MAX_PENDING = 4;

/** GPU time of what's drawn between begin() and end(). Results arrive a few frames later (poll). */
export class GpuTimer {
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  constructor(
    private readonly gl: TimerGl,
    private readonly ext: TimerExtension,
  ) {}

  static create(gl: WebGL2RenderingContext): GpuTimer | null {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
    return ext ? new GpuTimer(gl, ext) : null;
  }

  begin() {
    if (this.active || this.pending.length >= MAX_PENDING) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Finished measurements, in ms, oldest first. Dropped when the GPU reports a disjoint (e.g. a clock change). */
  poll(): number[] {
    const { gl } = this;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    const out: number[] = [];
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = this.pending.shift()!;
      const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(query);
      if (!disjoint) out.push(ns / 1e6);
    }
    return out;
  }

  dispose() {
    if (this.active) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    for (const query of [...this.pending, this.active]) if (query) this.gl.deleteQuery(query);
    this.pending = [];
    this.active = null;
  }
}

/** The readout itself: two lines, refreshed twice a second. */
export class FrameStatsReadout {
  readonly dom = document.createElement('pre');
  private readonly cpu = new FrameTimes();
  private readonly gpu = new FrameTimes();
  private readonly timer: GpuTimer | null;
  private shownAt = -Infinity;

  constructor(gl: WebGL2RenderingContext) {
    this.timer = GpuTimer.create(gl);
    this.dom.id = 'frame-times';
  }

  beginGpu() {
    this.timer?.begin();
  }

  endGpu() {
    this.timer?.end();
  }

  /** Once per frame, last thing in the loop. */
  frame(now: number, cpuMs: number) {
    this.cpu.push(now, cpuMs);
    for (const ms of this.timer?.poll() ?? []) this.gpu.push(now, ms);
    if (now - this.shownAt < 500) return;
    this.shownAt = now;
    this.dom.textContent = [
      formatLine('CPU', this.cpu.summary()),
      this.timer ? formatLine('GPU', this.gpu.summary()) : 'GPU   n/a (no timer queries)',
    ].join('\n');
  }

  dispose() {
    this.timer?.dispose();
    this.dom.remove();
  }
}
