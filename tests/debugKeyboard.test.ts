import { afterEach, expect, it, vi } from 'vitest';
import { setupDebugTools } from '../src/app/debugTools';
import { downloadRecording } from '../src/ui/recorder';
import type { Recorder } from '../src/ui/recorder';
import type { DebugOverlay } from '../src/ui/debugOverlay';
import type * as THREE from 'three';
vi.mock('../src/ui/recorder', () => ({ downloadRecording: vi.fn() }));
class ElementStub {
  parentNode = null; shadowRoot = null; isContentEditable = false;
  constructor(public ownerDocument: object, public interactive = false) {}
  closest() { return this.interactive ? this : null; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
function fixture() {
  let modal = false;
  const doc = { activeElement: null as ElementStub | null, querySelector: (s: string): unknown => s === '#scene' ? scene : modal ? {} : null, querySelectorAll: () => [] };
  const scene = new ElementStub(doc); doc.activeElement = scene;
  for (const name of ['Node', 'Element', 'HTMLElement', 'ShadowRoot']) vi.stubGlobal(name, ElementStub);
  vi.stubGlobal('document', doc);
  const handlers: ((event: KeyboardEvent) => void)[] = [];
  vi.stubGlobal('addEventListener', (_type: string, fn: (e: KeyboardEvent) => void) => handlers.push(fn));
  const recorder = { recording: false, start: vi.fn(), stop: vi.fn(() => ({ frames: [{}] })) };
  setupDebugTools({} as THREE.WebGLRenderer, { enabled: true } as DebugOverlay, recorder as unknown as Recorder, false, () => null);
  const key = (options: object = {}) => handlers[0]({ key: 'r', target: scene, composedPath: () => [scene], ...options } as unknown as KeyboardEvent);
  return { key, recorder, doc, scene, modal: () => { modal = true; } };
}
it.each(['ctrlKey', 'metaKey', 'altKey', 'repeat', 'isComposing', 'defaultPrevented'])('does not record or download on %s', flag => {
  const f = fixture(); f.key({ [flag]: true }); expect(f.recorder.start).not.toHaveBeenCalled();
  f.recorder.recording = true; f.key({ [flag]: true }); expect(downloadRecording).not.toHaveBeenCalled();
});
it('plain R and Shift+R follow the existing case-insensitive scene shortcut convention', () => {
  const f = fixture(); f.key(); f.key({ key: 'R', shiftKey: true }); expect(f.recorder.start).toHaveBeenCalledTimes(2);
  f.recorder.recording = true; f.key(); expect(downloadRecording).toHaveBeenCalledTimes(1);
});
it('leaves interactive event ancestry, actual focus and blocking dialogs alone', () => {
  const f = fixture(), input = new ElementStub(f.doc, true);
  f.key({ composedPath: () => [input] });
  f.doc.activeElement = input; f.key();
  f.doc.activeElement = f.scene; f.modal(); f.key();
  expect(f.recorder.start).not.toHaveBeenCalled();
});
