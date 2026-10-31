import { canHandleShortcut } from './shortcutOwnership';
import type { Config } from '../config';
import type { Intent, IntentBus } from '../intents';

// Pure mapping so it can be unit-tested without a DOM.
export function keyToIntent(key: string, cfg: Config['keyboard'], mods: { ctrl?: boolean; shift?: boolean } = {}): Intent | null {
  // With Ctrl (or ⌘): only undo / redo; other shortcuts (copy, reload…) belong to the browser.
  if (mods.ctrl) {
    if (key === 'z' || key === 'Z') return { type: mods.shift ? 'buildRedo' : 'buildUndo' };
    if (key === 'y' || key === 'Y') return { type: 'buildRedo' };
    return null;
  }
  switch (key) {
    case 'ArrowLeft': return { type: 'prev' };
    case 'ArrowRight': return { type: 'next' };
    case 'ArrowUp': return { type: 'zoom', factor: 1 / cfg.zoomStep };
    case 'ArrowDown': return { type: 'zoom', factor: cfg.zoomStep };
    case 'Enter': return { type: 'select' };
    case 'Escape': return { type: 'dismiss' };
    case ' ': return { type: 'togglePause' };
    case '[': return { type: 'timeScale', factor: 1 / cfg.timeStep };
    case ']': return { type: 'timeScale', factor: cfg.timeStep };
    case 'd': case 'D': return { type: 'toggleDebug' };
    case 'l': case 'L': return { type: 'toggleLanguage' };
    case 'p': case 'P': return { type: 'photo' };
    case 'b': case 'B': return { type: 'reverseTime' };
    case 'n': case 'N': return { type: 'timeNow' };
    case 'w': case 'W': return { type: 'toggleWatermark' };
    case 't': case 'T': return { type: 'toggleTrueScale' };
    case 'v': case 'V': return { type: 'enterBase' };
    case 'g': case 'G': return { type: 'toggleWeightPanel' };
    case 'm': case 'M': return { type: 'nextMoon' };
    case 'a': case 'A': return { type: 'toggleAutoLand' };
    case 'j': case 'J': return { type: 'togglePassport' };
    case 's': case 'S': return { type: 'cycleSteerSensitivity' };
    case '?': case 'h': case 'H': return { type: 'toggleHelp' };
    case 'c': case 'C': return { type: 'togglePreview' };
    case 'o': case 'O': return { type: 'toggleHorizon' };
    case 'k': case 'K': return { type: 'toggleBuild' };
    case 'q': case 'Q': return { type: 'buildTurn', dir: -1 };
    case 'e': case 'E': return { type: 'buildTurn', dir: 1 };
    case 'Delete': case 'Backspace': return { type: 'buildDelete' };
    default: return null;
  }
}

export interface PointerSample {
  x: number;
  y: number;
  t: number;
}

/** A press and release close together in place and time: a click or tap, not a drag. */
export const isClick = (down: PointerSample, up: PointerSample) => Math.hypot(up.x - down.x, up.y - down.y) < 6 && up.t - down.t < 500;

/**
 * Keyboard + mouse drag/wheel → Intents; a click or tap on a body selects it.
 * @param pick the body at a point on the target (client pixels), if any
 * Returns a cleanup function.
 */
export function attachKeyboardAndMouse(
  target: HTMLElement,
  bus: IntentBus,
  cfg: Config,
  pick: (x: number, y: number) => string | null = () => null,
  /** Build mode: a press it takes (returns true) is a grab, not a camera drag; it gets the moves and the release. */
  grab: { down(x: number, y: number): boolean; move(x: number, y: number): void; up(): void; click?(x: number, y: number): boolean } | null = null,
): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!canHandleShortcut(e, target, { allowCommand: true, allowRepeat: e.key !== ' ' })) return;
    const intent = keyToIntent(e.key, cfg.keyboard, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    if (!intent) return;
    e.preventDefault();
    bus.emit(intent);
  };

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let down: PointerSample | null = null;
  let grabbing = false;
  const onDown = (e: PointerEvent) => {
    if (grab?.down(e.clientX, e.clientY)) {
      grabbing = true;
      target.setPointerCapture(e.pointerId);
      return;
    }
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    down = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    target.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (grabbing) return grab!.move(e.clientX, e.clientY);
    if (!dragging) return;
    const scale = (2 * Math.PI) / target.clientWidth;
    bus.emit({ type: 'rotate', dx: -(e.clientX - lastX) * scale, dy: -(e.clientY - lastY) * scale });
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    if (grabbing) {
      grabbing = false;
      grab!.up();
      return;
    }
    dragging = false;
    if (e.type === 'pointerup' && down && isClick(down, { x: e.clientX, y: e.clientY, t: e.timeStamp })) {
      if (grab?.click?.(e.clientX, e.clientY)) {
        down = null;
        return;
      }
      const bodyId = pick(e.clientX, e.clientY);
      if (bodyId) bus.emit({ type: 'select', bodyId });
    }
    down = null;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    bus.emit({ type: 'zoom', factor: Math.exp(e.deltaY * 0.001) });
  };

  window.addEventListener('keydown', onKey);
  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
  target.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    window.removeEventListener('keydown', onKey);
    target.removeEventListener('pointerdown', onDown);
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    target.removeEventListener('wheel', onWheel);
  };
}
