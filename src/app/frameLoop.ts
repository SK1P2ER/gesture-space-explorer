// The frame loop's phases, in the order they run (v2.5). main.ts supplies what each phase does; the
// order lives here so a test can pin it without a browser (tests/frameLoop.test.ts).
//
// Input is mostly events between frames (intents on the bus). What runs as a phase is the input
// that has to wait for the frame: a deep link, which needs the planets where this frame's date puts
// them, so it comes after simulateWorld.

export interface FramePhases {
  /** Frame timing and quality: Ultra's guard, the render resolution, Auto. */
  start(now: number): void;
  /** The clock, and the planets placed for its date. */
  simulateWorld(): void;
  /** A pending deep link (it needs this frame's planets), and whether a camera view may go on. */
  applyInput(): void;
  /** Mission flight, landing and base state. */
  simulateMission(): void;
  /** Bases, the camera, the horizon view, and what the scene draws this frame. */
  updateScene(): void;
  render(): void;
  /** Labels, panels and the HUD, from this frame's camera and state. */
  updateUi(): void;
  /** Deferred warm-up and this frame's CPU time. */
  end(): void;
}

export const PHASE_ORDER = ['start', 'simulateWorld', 'applyInput', 'simulateMission', 'updateScene', 'render', 'updateUi', 'end'] as const;

export function runFrame(phases: FramePhases, now: number) {
  phases.start(now);
  phases.simulateWorld();
  phases.applyInput();
  phases.simulateMission();
  phases.updateScene();
  phases.render();
  phases.updateUi();
  phases.end();
}
