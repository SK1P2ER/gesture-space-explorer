import { describe, expect, it } from 'vitest';
import { ShellNav } from '../src/shell/nav';

describe('AstroLife shell navigation', () => {
  it('starts at the hub, which has nothing behind it', () => {
    const nav = new ShellNav();
    expect(nav.current).toEqual({ name: 'hub' });
    expect(nav.back()).toBe(false);
    expect(nav.current).toEqual({ name: 'hub' });
  });

  it('goes back through the screens it opened, in order', () => {
    const nav = new ShellNav();
    nav.go({ name: 'destinations' });
    nav.go({ name: 'destination', id: 'jezero' });
    expect(nav.back()).toBe(true);
    expect(nav.current).toEqual({ name: 'destinations' });
    expect(nav.back()).toBe(true);
    expect(nav.current).toEqual({ name: 'hub' });
  });

  it('does not stack the screen already shown (a double tap is one step)', () => {
    const nav = new ShellNav();
    nav.go({ name: 'destinations' });
    nav.go({ name: 'destinations' });
    nav.back();
    expect(nav.current).toEqual({ name: 'hub' });
  });

  it('starting a screen leaves only the hub behind it (a confirmed booking can’t be backed into)', () => {
    const nav = new ShellNav();
    nav.go({ name: 'destination', id: 'jezero' });
    nav.go({ name: 'book', step: 'traveller' });
    nav.go({ name: 'book', step: 'review' });
    nav.start({ name: 'trip', ref: 'AL-12345', fresh: true });
    expect(nav.back()).toBe(true);
    expect(nav.current).toEqual({ name: 'hub' });
  });

  it('going home clears the stack', () => {
    const nav = new ShellNav();
    nav.go({ name: 'destinations' });
    nav.go({ name: 'destination', id: 'jezero' });
    nav.go({ name: 'hub' });
    expect(nav.current).toEqual({ name: 'hub' });
    expect(nav.back()).toBe(false);
  });
});
