// The ground view's vehicle marker yields to a control it would cover (src/ui/activeVehicle.ts entersZone).
import { describe, expect, it } from 'vitest';
import { entersZone, KEEP_CLEAR_PX } from '../src/ui/activeVehicle';

const button = { left: 12, top: 357, right: 219, bottom: 409 };
const box = (left: number, top: number, w = 70, h = 24) => ({ left, top, right: left + w, bottom: top + h });

describe('vehicle marker keep-clear zone', () => {
  it('yields when it overlaps the control', () => expect(entersZone(box(150, 370), button)).toBe(true));
  it('yields inside the margin around it, even without touching (the 1 px case)', () => {
    expect(entersZone(box(220, 345), button)).toBe(true);
    expect(entersZone(box(button.right + KEEP_CLEAR_PX - 1, 370), button)).toBe(true);
    expect(entersZone(box(150, button.bottom + KEEP_CLEAR_PX - 1), button)).toBe(true);
  });
  it('stays when it is clear of the margin', () => {
    expect(entersZone(box(button.right + KEEP_CLEAR_PX, 370), button)).toBe(false);
    expect(entersZone(box(150, button.top - KEEP_CLEAR_PX - 24), button)).toBe(false);
    expect(entersZone(box(400, 100), button)).toBe(false);
  });
});
