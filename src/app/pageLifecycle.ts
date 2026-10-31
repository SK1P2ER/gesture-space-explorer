/** A persisted document keeps its existing owners and listeners; it never starts another RAF loop. */
export function attachPageLifecycle(owner: { suspend(): void; resume(): void; dispose(): void }, target: Window = window) {
  let suspended = false;
  let disposed = false;
  const cleanup = () => {
    target.removeEventListener('pagehide', hide);
    target.removeEventListener('pageshow', show);
  };
  const hide = (event: PageTransitionEvent) => {
    if (disposed) return;
    if (event.persisted) {
      if (!suspended) { suspended = true; owner.suspend(); }
    } else {
      disposed = true; cleanup(); owner.dispose();
    }
  };
  const show = (event: PageTransitionEvent) => {
    if (event.persisted && suspended && !disposed) {
      suspended = false; owner.resume();
    }
  };
  target.addEventListener('pagehide', hide);
  target.addEventListener('pageshow', show);
  return cleanup;
}
