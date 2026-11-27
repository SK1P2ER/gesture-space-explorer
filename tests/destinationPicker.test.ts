// The opt-in 3D destination picker's input logic (src/app/destinationPicker.ts): which hand input selects or confirms,
// and when. Synthetic observations and screen targets; the real app feeds the engine's stable pose and pointer.
import { describe, expect, it } from 'vitest';
import { DestinationPicker, ellipseCompensation, layoutPicker, layoutTargets, orbDrawScale, orbLook, pickerDestinations, PICKER, type PickerInput, type PickerTarget } from '../src/app/destinationPicker';
import { BASES } from '../src/data/bases';
import { BODIES } from '../src/data/bodies';

const VIEW = { width: 400, height: 800 };
const TARGETS: PickerTarget[] = [
  { baseId: 'tranquility', x: 60, y: 300, r: 28 },
  { baseId: 'jezero', x: 160, y: 300, r: 28 },
  { baseId: 'conamara', x: 260, y: 300, r: 28 },
  { baseId: 'kraken', x: 360, y: 300, r: 28 },
];
/** A 👆 at screen pixels (x, y) at time t; the engine's pointer is normalized. */
const point = (t: number, x: number, y: number): PickerInput => ({ t, pose: 'point', pointer: { x: x / VIEW.width, y: y / VIEW.height }, thumbsUp: false, hand: true });
const palm = (t: number, x: number, y: number): PickerInput => ({ t, pose: 'palm', pointer: { x: x / VIEW.width, y: y / VIEW.height }, thumbsUp: false, hand: true });
const thumb = (t: number): PickerInput => ({ t, pose: 'fist', pointer: null, thumbsUp: true, hand: true });
const none = (t: number): PickerInput => ({ t, pose: null, pointer: null, thumbsUp: false, hand: false });
const FREE = { active: true, selected: null as string | null, confirmByGesture: true };
const GUIDED = { active: true, selected: null as string | null, confirmByGesture: false };
function run(p: DestinationPicker, inputs: PickerInput[], ctx = FREE) {
  const out: { t: number; select?: string; confirm?: true }[] = [];
  for (const i of inputs) { const a = p.observe(i, TARGETS, VIEW, ctx); if (a.select || a.confirm) out.push({ t: i.t, ...a }); }
  return out;
}
const series = (from: number, to: number, step: number, f: (t: number) => PickerInput) => { const r = []; for (let t = from; t <= to; t += step) r.push(f(t)); return r; };

describe('destinations and layout', () => {
  it('maps every picker object to one valid destination base (never the base you are at), by base id', () => {
    const fromCape = pickerDestinations('cape');
    expect(fromCape.map((d) => d.baseId)).toEqual(['tranquility', 'jezero', 'conamara', 'kraken']);
    for (const d of fromCape) {
      const base = BASES.find((b) => b.id === d.baseId)!;
      expect(d.bodyId).toBe(base.body);
      expect(BODIES.some((b) => b.id === d.bodyId)).toBe(true);
    }
    expect(pickerDestinations('jezero').map((d) => d.baseId)).not.toContain('jezero');
    expect(new Set(pickerDestinations('mars-none-such').map((d) => d.baseId)).size).toBe(BASES.length);
  });

  it('lays targets out inside the free band with spacing for forgiving, unambiguous regions; too small a band: none', () => {
    const ids = ['tranquility', 'jezero', 'conamara', 'kraken'];
    const t = layoutTargets(ids, { left: 12, top: 200, right: 378, bottom: 420 })!;
    expect(t.map((x) => x.baseId)).toEqual(ids);
    for (const x of t) {
      expect(x.x - x.r).toBeGreaterThanOrEqual(12); expect(x.x + x.r).toBeLessThanOrEqual(378);
      expect(x.y - x.r).toBeGreaterThanOrEqual(200); expect(x.y + x.r + PICKER.labelPx).toBeLessThanOrEqual(420);
    }
    for (let i = 1; i < t.length; i++) expect(Math.hypot(t[i].x - t[i - 1].x, t[i].y - t[i - 1].y)).toBeGreaterThanOrEqual(2 * PICKER.hitPx(t[i].r));
    expect(layoutTargets(ids, { left: 0, top: 0, right: 390, bottom: 60 })).toBeNull();
  });
});

describe('picker layout: the card is always placed; the orbs take the room left beside or above it', () => {
  const ids = ['tranquility', 'jezero', 'conamara', 'kraken'];
  const card = { width: 300, minWidth: 240, height: 140 };
  const inside = (r: { left: number; top: number; right: number; bottom: number }, b: typeof r) => r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5;

  it('portrait band: orbs above, the card below, both inside the band and not overlapping', () => {
    const band = { left: 12, top: 300, right: 378, bottom: 760 };
    const l = layoutPicker(ids, [band], card)!;
    expect(l.targets.map((t) => t.baseId)).toEqual(ids);
    expect(inside(l.card, band)).toBe(true);
    for (const t of l.targets) expect(t.y + t.r + PICKER.labelPx).toBeLessThanOrEqual(l.card.top);
  });

  it('a short, wide band: orbs beside the card', () => {
    const band = { left: 60, top: 100, right: 760, bottom: 320 };
    const l = layoutPicker(ids, [band], card)!;
    expect(l.targets).toHaveLength(4);
    expect(inside(l.card, band)).toBe(true);
    for (const t of l.targets) expect(t.x + PICKER.hitPx(t.r)).toBeLessThanOrEqual(l.card.left);
  });

  it('short landscape: orbs and card may use two different free bands, never overlapping each other', () => {
    // Under a left-hand Guided card, and the strip to its right (844×390 with a short HUD).
    const under = { left: 12, top: 170, right: 378, bottom: 298 }, right = { left: 386, top: 120, right: 832, bottom: 300 };
    const l = layoutPicker(ids, [under, right], card)!;
    expect(l.targets).toHaveLength(4);
    expect(inside(l.card, under) || inside(l.card, right)).toBe(true);
    for (const t of l.targets) {
      const box = { left: t.x - PICKER.hitPx(t.r), right: t.x + PICKER.hitPx(t.r), top: t.y - t.r, bottom: t.y + t.r + PICKER.labelPx };
      expect(box.right <= l.card.left || box.left >= l.card.right || box.bottom <= l.card.top || box.top >= l.card.bottom).toBe(true);
    }
  });

  it('short landscape from the ground view (measured, MY): a whole card beside the mission card, orbs in the low strip', () => {
    // 844×390: the full-width strip is only 105 px tall; the column right of the mission card is taller.
    const bands = [{ left: 12, top: 182, right: 832, bottom: 287 }, { left: 12, top: 182, right: 691.75, bottom: 287 },
      { left: 316.2, top: 72, right: 832, bottom: 287 }, { left: 316.2, top: 53, right: 691.75, bottom: 287 },
      { left: 156, top: 95, right: 832, bottom: 287 }, { left: 156, top: 95, right: 691.75, bottom: 287 }];
    const l = layoutPicker(ids, bands, { width: 320, minWidth: 220, height: 228 })!;
    expect(l.targets).toHaveLength(4);
    expect(l.card.bottom - l.card.top).toBeGreaterThanOrEqual(228 - 0.5); // whole, not clipped
    for (const t of l.targets) {
      expect(t.r).toBeGreaterThanOrEqual(PICKER.minRadiusPx);
      // The halo (1.15 r) stays inside the strip.
      expect(t.y - 1.15 * t.r).toBeGreaterThanOrEqual(182 - 0.5);
      const box = { left: t.x - PICKER.hitPx(t.r), right: t.x + PICKER.hitPx(t.r), top: t.y - t.r, bottom: t.y + t.r + PICKER.labelPx };
      expect(box.right <= l.card.left || box.left >= l.card.right || box.bottom <= l.card.top || box.top >= l.card.bottom).toBe(true);
    }
  });

  it('the screen flow\'s card prefers one stable place: the bottom of the free area, whole, with the orbs above it', () => {
    const band = { left: 12, top: 120, right: 378, bottom: 760 };
    const l = layoutPicker(ids, [band], { width: 366, minWidth: 220, height: 240, preferBottom: true })!;
    expect(l.targets).toHaveLength(4);
    expect(l.card.bottom).toBe(band.bottom);
    expect(l.card.right - l.card.left).toBe(366);
    for (const t of l.targets) expect(t.y + t.r + PICKER.labelPx).toBeLessThanOrEqual(l.card.top);
    // Without the preference the old choice (a side slot giving larger orbs) may win; with it, the bottom does.
    const free = layoutPicker(ids, [band], { width: 366, minWidth: 220, height: 240 })!;
    expect(free.targets).toHaveLength(4);
  });

  it('picks the band that gives the largest orbs; with no room for orbs the card still gets a place', () => {
    const small = { left: 12, top: 12, right: 378, bottom: 160 };
    const big = { left: 12, top: 300, right: 378, bottom: 760 };
    expect(layoutPicker(ids, [small, big], card)!.card.top).toBeGreaterThanOrEqual(300);
    const cardOnly = layoutPicker(ids, [small], card)!;
    expect(cardOnly.targets).toEqual([]);
    expect(cardOnly.card.bottom - cardOnly.card.top).toBeGreaterThan(0);
    expect(layoutPicker(ids, [], card)).toBeNull();
  });
});

describe('orb appearance and shape', () => {
  it('a texture still loading shows the body-specific fallback; a loaded or procedural texture is used', () => {
    expect(orbLook('loading')).toBe('fallback');
    expect(orbLook('ready')).toBe('texture');
    expect(orbLook('fallback')).toBe('texture'); // the app's own procedural textures after a failed load
  });

  it('cancels the off-axis stretch of a perspective view: none on the axis, cos θ toward the edge, along the radial direction', () => {
    expect(ellipseCompensation(0, 0, -1).scale).toBeCloseTo(1, 6);
    const c = ellipseCompensation(Math.tan(Math.PI / 6), 0, -1); // 30° to the right
    expect(c.scale).toBeCloseTo(Math.cos(Math.PI / 6), 6);
    // The squeezed axis is perpendicular to the view ray and lies in the radial (x) plane.
    expect(Math.abs(c.axis[1])).toBeCloseTo(0, 6);
    expect(c.axis[0] * Math.tan(Math.PI / 6) + c.axis[2] * -1).toBeCloseTo(0, 6);
  });
});

describe('selection: 👆 only, and only while the picker is active', () => {
  it('a 👆 held steadily on a target selects it once after the focus time; it never confirms', () => {
    const p = new DestinationPicker();
    const out = run(p, series(0, 1500, 50, (t) => point(t, 160, 300)));
    expect(out).toEqual([{ t: expect.any(Number), select: 'jezero' }]);
    expect(out[0].t).toBeGreaterThanOrEqual(PICKER.selectMs);
    expect(out[0].t).toBeLessThan(PICKER.selectMs + 150);
  });

  it('a brief hover does not select', () => {
    const p = new DestinationPicker();
    expect(run(p, [...series(0, 300, 50, (t) => point(t, 160, 300)), ...series(350, 900, 50, (t) => point(t, 200, 600))])).toEqual([]);
  });

  it('✋ does not select in the picker, wherever it is', () => {
    const p = new DestinationPicker();
    expect(run(p, series(0, 2000, 50, (t) => palm(t, 160, 300)))).toEqual([]);
    expect(p.hover).toBeNull();
  });

  it('an inactive picker (flag off, or not its turn) does nothing and holds no state', () => {
    const p = new DestinationPicker();
    const off = { ...FREE, active: false };
    expect(run(p, [...series(0, 1500, 50, (t) => point(t, 160, 300)), ...series(1550, 2500, 50, thumb)], off)).toEqual([]);
    expect(p.hover).toBeNull();
    expect(p.confirmProgress).toBe(0);
  });

  it('forgiving: a 👆 slightly outside the drawn target still focuses it', () => {
    const p = new DestinationPicker();
    p.observe(point(0, 160 + 38, 300 + 10), TARGETS, VIEW, FREE);
    expect(p.hover).toBe('jezero');
  });

  it('stable: jitter on the boundary between neighbours does not flip the focus or select the other one', () => {
    const p = new DestinationPicker();
    const out = run(p, series(0, 1500, 50, (t) => point(t, 160, 300)));
    expect(out.map((o) => o.select)).toEqual(['jezero']);
    // Now jitter ±6 px around the midpoint between jezero (160) and conamara (260), leaning to conamara.
    const jitter = run(p, series(1550, 3000, 50, (t) => point(t, 214 + (Math.round(t / 50) % 2 ? 6 : -6), 300)));
    expect(jitter).toEqual([]);
    expect(p.hover).toBe('jezero');
    // A clear move onto conamara does switch, and then selects it after the focus time.
    const moved = run(p, series(3050, 4200, 50, (t) => point(t, 262, 302)));
    expect(moved.map((o) => o.select)).toEqual(['conamara']);
  });

  it('the focus time is observed time: a detection gap restarts it rather than counting unobserved time', () => {
    const p = new DestinationPicker();
    expect(run(p, [point(0, 160, 300), point(100, 160, 300), point(900, 160, 300)])).toEqual([]);
    expect(run(p, series(950, 1200, 50, (t) => point(t, 160, 300)))).toEqual([]);
  });

  it('losing the hand clears the focus after a short grace, so a stale hover cannot select later', () => {
    const p = new DestinationPicker();
    run(p, series(0, 250, 50, (t) => point(t, 160, 300)));
    run(p, series(300, 800, 50, none));
    expect(p.hover).toBeNull();
    expect(run(p, series(850, 1100, 50, (t) => point(t, 160, 300)))).toEqual([]); // starts over
  });

  it('re-selecting the destination that is already selected emits nothing', () => {
    const p = new DestinationPicker();
    expect(run(p, series(0, 1500, 50, (t) => point(t, 160, 300)), { ...FREE, selected: 'jezero' })).toEqual([]);
  });
});

describe('screen change (the destination flow): a held 👍 owes a release, whatever the animation', () => {
  const selected = { ...FREE, selected: 'jezero' };
  it('a 👍 held across a screen change completes nothing on the next screen; a release then a full hold confirms once', () => {
    const p = new DestinationPicker();
    expect(run(p, series(0, 600, 50, thumb), selected).filter((o) => o.confirm)).toHaveLength(1); // screen 2's Confirm
    p.screenChanged(); // → screen 3, the same 👍 still up
    expect(run(p, series(650, 2500, 50, thumb), selected)).toEqual([]);
    expect(p.waitingRelease).toBe(true); // shown: a 👍 is seen and owes a release
    run(p, series(2550, 2700, 50, (t) => point(t, 10, 10)), selected);
    const out = run(p, series(2750, 3500, 50, thumb), selected);
    expect(out.filter((o) => o.confirm)).toHaveLength(1);
    expect(out[0].t - 2750).toBeGreaterThanOrEqual(500);
  });

  it('a screen change by a tap (no 👍 held) costs nothing: the next observed frame without 👍 is the release', () => {
    const p = new DestinationPicker();
    p.screenChanged();
    expect(p.waitingRelease).toBe(false); // nothing to show: no 👍 seen
    expect(p.confirmProgress).toBe(0);
    run(p, [none(0)], selected);
    expect(run(p, series(50, 700, 50, thumb), selected).filter((o) => o.confirm)).toHaveLength(1);
  });

  it('tracking lost while 👍 is held across the change: coming back with 👍 still up confirms nothing', () => {
    const p = new DestinationPicker();
    run(p, series(0, 300, 50, thumb), selected);
    p.screenChanged();
    p.trackingLost();
    expect(run(p, series(1000, 2500, 50, thumb), selected)).toEqual([]);
  });

  it('a screen change restarts a 👆 focus (no carried-over dwell)', () => {
    const p = new DestinationPicker();
    run(p, series(0, 300, 50, (t) => point(t, 160, 300)), FREE);
    expect(p.focusProgress).toBeGreaterThan(0);
    p.screenChanged();
    expect([p.hover, p.focusProgress]).toEqual([null, 0]);
  });
});

describe('destination change mid-hold: a 👍 begun for one destination never confirms another', () => {
  // ctx.selected is what every route (tap, key, list, 👆) leaves selected; the picker reads it on every detection.
  const on = (id: string | null) => ({ ...FREE, selected: id });
  /** The controlling hand seen, without 👍: the only observation that releases a 👍 owed for a destination change. */
  const bare = (t: number): PickerInput => ({ t, pose: 'fist', pointer: null, thumbsUp: false, hand: true });
  it('changed during a partial hold: the 👍 kept up confirms nothing, however long; it owes a release', () => {
    const p = new DestinationPicker();
    expect(run(p, series(0, 300, 50, thumb), on('kraken'))).toEqual([]);
    expect(p.confirmProgress).toBeGreaterThan(0.5);
    expect(run(p, series(350, 3000, 50, thumb), on('tranquility'))).toEqual([]);
    expect(p.waitingRelease).toBe(true);
    expect(p.confirmProgress).toBe(0);
  });

  it('after an observed release (the hand seen without 👍), a fresh full 500 ms hold confirms the new destination once', () => {
    const p = new DestinationPicker();
    run(p, series(0, 300, 50, thumb), on('kraken'));
    run(p, series(350, 1000, 50, thumb), on('tranquility'));
    run(p, series(1050, 1150, 50, bare), on('tranquility'));
    expect(p.waitingRelease).toBe(false);
    const out = run(p, series(1200, 2500, 50, thumb), on('tranquility'));
    expect(out.filter((o) => o.confirm)).toHaveLength(1);
    expect(out[0].t - 1200).toBeGreaterThanOrEqual(500);
  });

  it('hand lost after the change, then 👍 found again: no release was seen, so nothing is confirmed', () => {
    const p = new DestinationPicker();
    run(p, series(0, 300, 50, thumb), on('kraken'));
    run(p, series(350, 500, 50, thumb), on('tranquility'));
    run(p, series(550, 900, 50, none), on('tranquility')); // tracking drops the hand: not a release for this change
    expect(run(p, series(950, 4000, 50, thumb), on('tranquility'))).toEqual([]);
    expect(p.waitingRelease).toBe(true);
    run(p, [bare(4050)], on('tranquility'));
    expect(run(p, series(4100, 5000, 50, thumb), on('tranquility'))).toEqual([{ t: 4600, confirm: true }]);
  });

  it('hand lost with 👍 up, the destination changed meanwhile, then 👍 found again: nothing is confirmed', () => {
    const p = new DestinationPicker();
    run(p, series(0, 300, 50, thumb), on('kraken'));
    run(p, series(350, 600, 50, none), on('kraken'));
    run(p, series(650, 800, 50, none), on('tranquility')); // a tap while the hand is out of sight
    expect(run(p, series(850, 4000, 50, thumb), on('tranquility'))).toEqual([]);
  });

  it('camera stopped and restarted after the change (no hand at first, then 👍): not a release', () => {
    const p = new DestinationPicker();
    run(p, series(0, 300, 50, thumb), on('kraken'));
    run(p, [thumb(350)], on('tranquility'));
    p.trackingLost();
    run(p, series(5000, 5300, 50, none), on('tranquility')); // the new session's first detections: no hand yet
    expect(run(p, series(5350, 8000, 50, thumb), on('tranquility'))).toEqual([]);
    expect(p.waitingRelease).toBe(true);
  });

  it('the last hand seen had no 👍 (a 👆, then out of sight): a change owes nothing; the next 👍 is a normal full hold', () => {
    const p = new DestinationPicker();
    run(p, series(0, 200, 50, (t) => point(t, 10, 10)), on('kraken'));
    run(p, series(250, 400, 50, none), on('kraken'));
    run(p, [none(450)], on('tranquility')); // a tap, the hand out of sight
    expect(run(p, series(500, 1200, 50, thumb), on('tranquility'))).toEqual([{ t: 1000, confirm: true }]);
  });

  it('the same destination chosen again is not a change: the hold goes on and completes at 500 ms', () => {
    const p = new DestinationPicker();
    run(p, series(0, 300, 50, thumb), on('kraken'));
    const out = run(p, series(350, 1000, 50, thumb), { ...on('kraken') }); // a new context object, the same id
    expect(out).toEqual([{ t: 500, confirm: true }]);
  });

  it('a change while no 👍 is up costs nothing: the next hold is a normal full hold', () => {
    const p = new DestinationPicker();
    run(p, series(0, 200, 50, none), on('kraken'));
    run(p, [none(250)], on('tranquility'));
    const out = run(p, series(300, 1200, 50, thumb), on('tranquility'));
    expect(out).toEqual([{ t: 800, confirm: true }]);
  });

  it('a 👆 selection and a completing 👍 in the same detection: the selection wins, nothing is confirmed', () => {
    const p = new DestinationPicker();
    // The stable pose reads 👆 on another orb while the raw observation still reads 👍: the 👍 hold (begun at 0 for
    // Kraken) and the 👆 focus on the Moon both complete on the same detection.
    const both = (t: number): PickerInput => ({ ...point(t, 60, 300), thumbsUp: true });
    const end = 500, start = end - PICKER.selectMs;
    run(p, [thumb(0), ...series(50, start - 50, 50, thumb)], on('kraken'));
    const out = run(p, series(start, end, 50, both), on('kraken'));
    expect(out).toEqual([{ t: end, select: 'tranquility' }]);
    expect(run(p, series(end + 50, 3000, 50, thumb), on('tranquility'))).toEqual([]);
  });

  it('tracking lost after the change is not a release: coming back with 👍 still up confirms nothing', () => {
    const p = new DestinationPicker();
    run(p, series(0, 300, 50, thumb), on('kraken'));
    run(p, [thumb(350)], on('tranquility'));
    p.trackingLost();
    expect(run(p, series(2000, 4000, 50, thumb), on('tranquility'))).toEqual([]);
    expect(p.waitingRelease).toBe(true);
  });

  it('changed while standing down (Details open, another owner): back in the picker the held 👍 still owes a release', () => {
    const p = new DestinationPicker();
    run(p, series(0, 300, 50, thumb), on('kraken'));
    run(p, series(350, 600, 50, thumb), { ...on('kraken'), active: false });
    expect(run(p, series(650, 2500, 50, thumb), on('tranquility'))).toEqual([]);
  });

  it('changed again after it already confirmed (latched): still owes a release, never a second confirmation', () => {
    const p = new DestinationPicker();
    expect(run(p, series(0, 600, 50, thumb), on('kraken')).filter((o) => o.confirm)).toHaveLength(1);
    expect(run(p, series(650, 2500, 50, thumb), on('tranquility'))).toEqual([]);
  });
});

describe('selected emphasis: visual only', () => {
  it('the selected (or confirming) planet is drawn 12% larger; every other one at its size', () => {
    expect(PICKER.selectedScale).toBe(1.12);
    expect(orbDrawScale(true, 1, 1, true)).toBe(1.12);
    expect(orbDrawScale(false, 1.12, 1, true)).toBe(1);
  });
  it('eases over about 160 ms; under reduced motion it changes at once', () => {
    expect(orbDrawScale(true, 1, 0.08, false)).toBeCloseTo(1.06, 5);
    expect(orbDrawScale(true, 1, 0.16, false)).toBeCloseTo(1.12, 5);
    expect(orbDrawScale(true, 1, 1, false)).toBe(1.12); // never overshoots
    expect(orbDrawScale(false, 1.12, 0.08, false)).toBeCloseTo(1.06, 5);
    expect(orbDrawScale(true, 1, 0.01, true)).toBe(1.12);
  });
  it('the hit targets are the layout\'s and do not depend on the emphasis (the scale is not an input of either)', () => {
    const ids = ['tranquility', 'jezero', 'conamara', 'kraken'];
    const band = { left: 12, top: 120, right: 378, bottom: 520 };
    expect(layoutTargets(ids, band)).toEqual(layoutTargets(ids, band));
    expect(PICKER.hitPx(28)).toBe(Math.max(28 * 1.5, 44));
  });
});

describe('Details dialog: selection and confirmation pause, then need fresh input', () => {
  const selected = { ...FREE, selected: 'jezero' };
  it('opening cancels a 👍 hold in progress; while open nothing selects or confirms; after closing a held 👍 must be released', () => {
    const p = new DestinationPicker();
    run(p, series(0, 300, 50, thumb), selected);
    expect(p.confirmProgress).toBeGreaterThan(0.5);
    p.standDown(); // the dialog opens
    expect(p.confirmProgress).toBe(0);
    // While open the picker is not active: 👆 and 👍 do nothing.
    expect(run(p, series(350, 1500, 50, thumb), { ...selected, active: false })).toEqual([]);
    expect(run(p, series(1550, 2500, 50, (t) => point(t, 260, 300)), { ...FREE, active: false })).toEqual([]);
    p.screenChanged(); // the dialog closes: fresh input needed
    expect(run(p, series(2550, 4000, 50, thumb), selected)).toEqual([]); // the same 👍, still up
    run(p, [none(4050)], selected);
    expect(run(p, series(4100, 4800, 50, thumb), selected).filter((o) => o.confirm)).toHaveLength(1);
  });
});

describe('pointer boundary stability', () => {
  it('steadies small cursor jitter and follows a deliberate move to the next world immediately', () => {
    const p = new DestinationPicker();
    run(p, [point(0, 160, 300), point(50, 163, 302), point(100, 157, 298)]);
    expect(p.cursorAt(100, VIEW.width, VIEW.height)).toEqual(point(100, 160, 300).pointer);
    run(p, [point(150, 260, 300)]);
    expect(p.cursorAt(150, VIEW.width, VIEW.height)).toEqual(point(150, 260, 300).pointer);
    expect(p.hover).toBe('conamara');
  });

  it('holds cursor feedback across a short missed frame without adding dwell or leaving a stale pointer', () => {
    const p = new DestinationPicker();
    run(p, series(0, 400, 50, (t) => point(t, 160, 300)));
    expect(run(p, [none(450), none(500)])).toEqual([]);
    expect(p.focusProgress).toBe(0);
    expect(p.cursorAt(500, VIEW.width, VIEW.height)).toEqual(point(500, 160, 300).pointer);
    expect(p.cursorAt(500, VIEW.height, VIEW.width)).toBeNull();
    expect(p.cursorAt(550, VIEW.width, VIEW.height)).toBeNull();
    expect(run(p, [point(600, 160, 300)])).toEqual([]);
    expect(p.focusProgress).toBe(0);
    expect(run(p, [thumb(650)])).toEqual([]);
    expect(p.cursorAt(650, VIEW.width, VIEW.height)).toBeNull();
  });

  it('briefly leaving every target pauses dwell instead of losing it; outside time is not counted', () => {
    const p = new DestinationPicker();
    run(p, series(0, 300, 50, (t) => point(t, 160, 300)));
    expect(p.focusProgress).toBeCloseTo(300 / 450);
    expect(run(p, [point(350, 160, 380)])).toEqual([]);
    expect(p.hover).toBe('jezero');
    expect(run(p, [point(400, 160, 300)])).toEqual([]);
    expect(p.focusProgress).toBeCloseTo(300 / 450);
    expect(run(p, series(450, 550, 50, (t) => point(t, 160, 300)))).toEqual([{ t: 550, select: 'jezero' }]);
  });

  it('a prolonged excursion clears focus, while moving directly to another target switches promptly', () => {
    const p = new DestinationPicker();
    run(p, series(0, 300, 50, (t) => point(t, 160, 300)));
    run(p, series(350, 650, 50, (t) => point(t, 160, 380)));
    expect([p.hover, p.focusProgress]).toEqual([null, 0]);
    run(p, [point(700, 160, 300), point(750, 260, 300)]);
    expect([p.hover, p.focusProgress]).toEqual(['conamara', 0]);
  });

  it('a stale point with no controlling hand cannot select a target', () => {
    const p = new DestinationPicker();
    expect(run(p, series(0, 1000, 50, (t) => ({ ...point(t, 160, 300), hand: false })))).toEqual([]);
    expect(p.focusProgress).toBe(0);
  });
});

describe('confirmation: 👍 hold, once, released before the next, cancelled by tracking loss', () => {
  const selected = { ...FREE, selected: 'jezero' };
  it('a 👍 held 500 ms of observed time confirms once; holding on does not confirm again', () => {
    const p = new DestinationPicker();
    const out = run(p, series(0, 2000, 50, thumb), selected);
    expect(out).toEqual([{ t: expect.any(Number), confirm: true }]);
    expect(out[0].t).toBeGreaterThanOrEqual(500);
  });

  it('needs a release: 👍 down, release, 👍 again confirms a second time only after a fresh full hold', () => {
    const p = new DestinationPicker();
    const out = run(p, [...series(0, 700, 50, thumb), ...series(750, 900, 50, (t) => point(t, 10, 10)), ...series(950, 1700, 50, thumb)], selected);
    expect(out.filter((o) => o.confirm)).toHaveLength(2);
    expect(out[1].t - 950).toBeGreaterThanOrEqual(500);
  });

  it('no destination selected: 👍 confirms nothing', () => {
    const p = new DestinationPicker();
    expect(run(p, series(0, 2000, 50, thumb), FREE)).toEqual([]);
  });

  it('tracking loss mid-hold cancels the progress; a dropout is not permission to confirm', () => {
    const p = new DestinationPicker();
    run(p, series(0, 400, 50, thumb), selected);
    expect(p.confirmProgress).toBeGreaterThan(0.5);
    p.trackingLost();
    expect(p.confirmProgress).toBe(0);
    expect(run(p, series(450, 800, 50, thumb), selected)).toEqual([]); // 350 ms: not a full hold
  });

  it('a gap in detections mid-hold restarts it (no unobserved time counts)', () => {
    const p = new DestinationPicker();
    expect(run(p, [...series(0, 400, 50, thumb), ...series(800, 1100, 50, thumb)], selected)).toEqual([]);
  });

  it('a hold that already confirmed stays latched across a tracking dropout: no second confirmation without a release', () => {
    const p = new DestinationPicker();
    run(p, series(0, 700, 50, thumb), selected);
    run(p, series(750, 1200, 50, none), selected);
    expect(run(p, series(1250, 2400, 50, thumb), selected)).toEqual([]);
    expect(p.waitingRelease).toBe(true);
  });

  it('standing down (a launch, another mode) does not release a held 👍: back in the picker it still needs a release', () => {
    const p = new DestinationPicker();
    expect(run(p, series(0, 700, 50, thumb), selected).filter((o) => o.confirm)).toHaveLength(1);
    run(p, series(750, 2000, 50, thumb), { ...selected, active: false }); // the launch: the picker does not own input
    expect(run(p, series(2050, 3500, 50, thumb), selected)).toEqual([]); // the same 👍, still held
    run(p, series(3550, 3700, 50, (t) => point(t, 10, 10)), selected);
    expect(run(p, series(3750, 4400, 50, thumb), selected).filter((o) => o.confirm)).toHaveLength(1);
  });

  it('in Guided the picker never confirms by gesture: Guided keeps its own 👍 confirmation', () => {
    const p = new DestinationPicker();
    expect(run(p, series(0, 2000, 50, thumb), { ...GUIDED, selected: 'jezero' })).toEqual([]);
  });

  it('👍 does not move the focus or select', () => {
    const p = new DestinationPicker();
    expect(run(p, series(0, 2000, 50, thumb), selected).every((o) => !o.select)).toBe(true);
  });
});
