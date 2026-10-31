import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

// Node lacks PageTransitionEvent. Preserve its actual Event inheritance and persisted contract.
class PageTransitionEvent extends Event {
  readonly persisted: boolean;
  constructor(type: string, init: PageTransitionEventInit = {}) { super(type, init); this.persisted = !!init.persisted; }
}
async function fixture() {
  const target = new EventTarget() as Window;
  const suspend = vi.fn(), resume = vi.fn(), dispose = vi.fn();
  const source = readFileSync('src/main.ts', 'utf8');
  // Exercise the original actual registration before remediation, then the extracted owner.
  const legacy = source.match(/addEventListener\('pagehide', \(\) => \{ cancelCinematic\(\); cinematic.dispose\(\); cinematicControls.dispose\(\); \}, \{ once: true \}\);/);
  if (legacy) {
    new Function('addEventListener', 'cancelCinematic', 'cinematic', 'cinematicControls', legacy[0])(
      target.addEventListener.bind(target), suspend, { dispose }, { dispose: () => {} });
    return { target, suspend, resume, dispose, cleanup: () => {} };
  }
  const { attachPageLifecycle } = await import('../src/app/pageLifecycle');
  expect(source).toContain('attachPageLifecycle(');
  return { target, suspend, resume, dispose, cleanup: attachPageLifecycle({ suspend, resume, dispose }, target) };
}
it('suspends persisted pages and resumes without disposing owners over repeated cache visits', async () => {
  const f = await fixture();
  for (let i = 0; i < 3; i++) {
    f.target.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(f.dispose).not.toHaveBeenCalled();
    f.target.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(f.suspend).toHaveBeenCalledTimes(i + 1); expect(f.resume).toHaveBeenCalledTimes(i + 1);
  }
  f.cleanup();
});
it('ignores initial pageshow and fully tears down nonpersisted navigation exactly once', async () => {
  const f = await fixture(); f.target.dispatchEvent(new PageTransitionEvent('pageshow'));
  expect(f.resume).not.toHaveBeenCalled();
  f.target.dispatchEvent(new PageTransitionEvent('pagehide'));
  f.target.dispatchEvent(new PageTransitionEvent('pagehide'));
  f.target.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  expect(f.dispose).toHaveBeenCalledTimes(1); expect(f.resume).not.toHaveBeenCalled();
});
