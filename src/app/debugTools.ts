import { canHandleShortcut } from '../input/shortcutOwnership';
import type * as THREE from 'three';
import type { LandingContext } from '../sim/landingReplay';
import type { DebugOverlay } from '../ui/debugOverlay';
import { FrameStatsReadout } from '../ui/frameStats';
import { downloadRecording, type Recorder } from '../ui/recorder';

export interface DebugTools {
  /** Call once per frame (FPS panel). */
  update(): void;
  /** The CPU/GPU readout, while shown. */
  readonly frameStats: FrameStatsReadout | null;
}

/**
 * Debug-only tools, deliberately not Intents:
 * - R (in debug mode) starts and stops a landmark recording.
 * - stats.js FPS / frame-time panel (tap it to cycle FPS → ms → MB), with CPU and GPU frame
 *   times under it (ui/frameStats.ts). In dev builds, F toggles them. In production they're
 *   there only with ?debug, shown right away, so they can be read on a phone (no F key there).
 *   stats.js is loaded on demand: never in the main bundle.
 */
export function setupDebugTools(
  renderer: THREE.WebGLRenderer,
  overlay: DebugOverlay,
  recorder: Recorder,
  debugUrl: boolean,
  /** The latest landing, saved with a recording so it can be replayed (sim/landingReplay.ts). */
  landing: () => LandingContext | null,
): DebugTools {
  const scene = document.querySelector<HTMLElement>('#scene')!;
  addEventListener('keydown', (e) => {
    if (!canHandleShortcut(e, scene) || !overlay.enabled || (e.key !== 'r' && e.key !== 'R')) return;
    if (recorder.recording) {
      const rec = recorder.stop(landing());
      if (rec?.frames.length) downloadRecording(rec);
    } else {
      recorder.start();
    }
  });

  let stats: { dom: HTMLElement; update(): void } | null = null;
  const tools = {
    frameStats: null as FrameStatsReadout | null,
    update: () => stats?.update(),
  };
  if (import.meta.env.DEV || debugUrl) {
    let statsOn = false;
    const showStats = (on: boolean) => {
      statsOn = on;
      if (!on) {
        stats?.dom.remove();
        stats = null;
        tools.frameStats?.dispose();
        tools.frameStats = null;
        return;
      }
      void import('three/addons/libs/stats.module.js').then(({ default: Stats }) => {
        if (!statsOn || stats) return;
        const panel = new Stats();
        // Below the version label and debug mode's (closed) config panel.
        panel.dom.style.cssText = 'position:fixed;top:40px;right:16px;z-index:10;cursor:pointer;opacity:0.9';
        document.body.append(panel.dom);
        stats = panel;
        tools.frameStats = new FrameStatsReadout(renderer.getContext() as WebGL2RenderingContext);
        document.body.append(tools.frameStats.dom);
      });
    };
    addEventListener('keydown', (e) => {
      if (!canHandleShortcut(e, scene) || (e.key !== 'f' && e.key !== 'F')) return;
      showStats(!statsOn);
    });
    if (debugUrl) showStats(true);
  }
  if (debugUrl) overlay.setDebug(true);
  return tools;
}
