import { describe, expect, it } from 'vitest';
import { formatLine, FrameTimes, GpuTimer, type TimerExtension, type TimerGl } from '../src/ui/frameStats';

describe('FrameTimes', () => {
  it('summarizes the last second: mean and 95th percentile', () => {
    const times = new FrameTimes(1000);
    // 100 frames: 95 at 2 ms, 5 slow ones at 10 ms.
    for (let i = 0; i < 100; i++) times.push(i * 10, i % 20 === 0 ? 10 : 2);
    const s = times.summary()!;
    expect(s.count).toBe(100);
    expect(s.mean).toBeCloseTo(2.4, 6);
    expect(s.p95).toBe(2); // 5% slow frames sit just above the 95th percentile…
    times.push(1000, 10); // …one more, and it's in
    expect(times.summary()!.p95).toBe(10);
  });

  it('forgets frames older than the window', () => {
    const times = new FrameTimes(1000);
    times.push(0, 50);
    times.push(500, 2);
    times.push(1600, 4);
    expect(times.summary()).toEqual({ mean: 4, p95: 4, count: 1 });
  });

  it('has nothing to say before the first frame', () => {
    expect(new FrameTimes().summary()).toBeNull();
    expect(formatLine('GPU', null)).toBe('GPU     —');
  });

  it('formats a line', () => {
    expect(formatLine('CPU', { mean: 3.21, p95: 4.84, count: 60 })).toBe('CPU   3.2 ms  p95   4.8');
  });
});

/** Just enough WebGL2 for timer queries; results come back when the test says so. */
function fakeGl() {
  const EXT: TimerExtension = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
  let next = 1;
  const state = {
    disjoint: false,
    ready: new Map<number, number>(), // query → ns
    open: null as number | null,
    live: new Set<number>(),
  };
  const gl = {
    QUERY_RESULT: 1,
    QUERY_RESULT_AVAILABLE: 2,
    createQuery: () => {
      const q = next++;
      state.live.add(q);
      return q as unknown as WebGLQuery;
    },
    beginQuery: (_target: number, q: WebGLQuery) => {
      if (state.open !== null) throw new Error('nested query');
      state.open = q as unknown as number;
    },
    endQuery: () => {
      state.open = null;
    },
    getQueryParameter: (q: WebGLQuery, pname: number) => {
      const ns = state.ready.get(q as unknown as number);
      return pname === 2 ? ns !== undefined : ns;
    },
    deleteQuery: (q: WebGLQuery | null) => state.live.delete(q as unknown as number),
    getParameter: () => state.disjoint,
  } as unknown as TimerGl;
  return { gl, EXT, state };
}

describe('GpuTimer', () => {
  it('reports each frame once its result is available, in ms, oldest first', () => {
    const { gl, EXT, state } = fakeGl();
    const timer = new GpuTimer(gl, EXT);
    timer.begin();
    timer.end(); // query 1
    timer.begin();
    timer.end(); // query 2
    expect(timer.poll()).toEqual([]); // GPU hasn't finished
    state.ready.set(2, 2_000_000);
    expect(timer.poll()).toEqual([]); // in order: 1 isn't ready, so 2 waits
    state.ready.set(1, 3_500_000);
    expect(timer.poll()).toEqual([3.5, 2]);
    expect(state.live.size).toBe(0); // queries are deleted once read
  });

  it('drops results from a disjoint period', () => {
    const { gl, EXT, state } = fakeGl();
    const timer = new GpuTimer(gl, EXT);
    timer.begin();
    timer.end();
    state.ready.set(1, 9_000_000);
    state.disjoint = true;
    expect(timer.poll()).toEqual([]);
    expect(state.live.size).toBe(0);
  });

  it('skips frames rather than piling up queries when the GPU falls behind', () => {
    const { gl, EXT, state } = fakeGl();
    const timer = new GpuTimer(gl, EXT);
    for (let i = 0; i < 10; i++) {
      timer.begin();
      timer.end();
    }
    expect(state.live.size).toBe(4);
    timer.dispose();
    expect(state.live.size).toBe(0);
  });
});
