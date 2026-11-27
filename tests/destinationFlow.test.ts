// The destination screen flow's state (src/app/destinationFlow.ts): screens, the preview, the confirmed record and
// its invalidation. Pure: the mission is described by plain values, as main.ts reads it each frame.
import { describe, expect, it } from 'vitest';
import { DestinationFlow, type FlowMission } from '../src/app/destinationFlow';

const at = (over: Partial<FlowMission> = {}): FlowMission => ({ baseId: 'cape', destinationId: null, mode: 'baseView', blocked: false, ...over });

describe('destination flow: screens and preview', () => {
  it('starts closed; opening shows screen 2 with the mission\'s destination (or none) as the preview', () => {
    const f = new DestinationFlow();
    expect(f.screen).toBe('closed');
    expect(f.open(at())).toBe(true);
    expect([f.screen, f.preview]).toEqual(['select', null]);
    const g = new DestinationFlow();
    g.open(at({ destinationId: 'jezero' }));
    expect(g.preview).toBe('jezero');
  });

  it('does not open while blocked (a pending saved-mission offer), outside a base view, or with no base', () => {
    for (const m of [at({ blocked: true }), at({ mode: 'launch' }), at({ mode: 'travel' }), at({ baseId: null })]) {
      const f = new DestinationFlow();
      expect(f.open(m)).toBe(false);
      expect(f.screen).toBe('closed');
    }
  });

  it('choosing on screen 2 changes only the preview, and moves it with next/prev; not on other screens', () => {
    const f = new DestinationFlow();
    f.open(at());
    f.choose('kraken');
    expect(f.preview).toBe('kraken');
    f.step(['tranquility', 'jezero', 'conamara', 'kraken'], 1);
    expect(f.preview).toBe('tranquility');
    f.step(['tranquility', 'jezero', 'conamara', 'kraken'], -1);
    expect(f.preview).toBe('kraken');
    const closed = new DestinationFlow();
    closed.choose('kraken');
    expect(closed.preview).toBe(null);
  });

  it('every screen change bumps the generation (focus restarts, a held 👍 owes a release)', () => {
    const f = new DestinationFlow();
    const g0 = f.generation;
    f.open(at());
    expect(f.generation).toBe(g0 + 1);
    f.choose('jezero');
    expect(f.generation).toBe(g0 + 1); // a preview is not a screen change
    expect(f.confirmRequest()).toBe('jezero');
    f.afterConfirm(at({ destinationId: 'jezero' }));
    expect(f.generation).toBe(g0 + 2);
    f.back();
    expect(f.generation).toBe(g0 + 3);
  });
});

describe('destination flow: confirmation', () => {
  it('screen 3 opens only when the mission accepted the confirmed destination', () => {
    const f = new DestinationFlow();
    f.open(at());
    expect(f.confirmRequest()).toBe(null); // nothing to confirm yet
    f.choose('jezero');
    expect(f.afterConfirm(at({ destinationId: null }))).toBe('refused');
    expect([f.screen, f.confirmed]).toEqual(['select', null]);
    expect(f.afterConfirm(at({ destinationId: 'kraken' }))).toBe('refused');
    expect(f.afterConfirm(at({ destinationId: 'jezero' }))).toBe('accepted');
    expect([f.screen, f.confirmed]).toEqual(['confirm', 'jezero']);
  });

  it('Back: 3 → 2 keeps the confirmation (preview = it); 2 → 1 closes and discards the preview', () => {
    const f = new DestinationFlow();
    f.open(at());
    f.choose('jezero');
    f.afterConfirm(at({ destinationId: 'jezero' }));
    expect(f.back()).toBe('select');
    expect([f.screen, f.preview, f.confirmed]).toEqual(['select', 'jezero', 'jezero']);
    f.choose('kraken');
    expect(f.back()).toBe('closed');
    expect([f.screen, f.preview]).toEqual(['closed', null]);
    expect(f.confirmedFor(at({ destinationId: 'jezero' }))).toBe('jezero'); // still the mission's confirmed destination
  });

  it('opened from the ground view, Back from screen 2 returns there', () => {
    const f = new DestinationFlow();
    f.open(at(), true);
    expect(f.back()).toBe('ground');
    expect(f.fromGround).toBe(false);
  });

  it('the screen 1 shortcut opens screen 3 only for a valid confirmation, and never launches by itself', () => {
    const f = new DestinationFlow();
    expect(f.showJourney(at({ destinationId: 'jezero' }))).toBe(false); // saved, never confirmed here
    f.open(at());
    f.choose('jezero');
    f.afterConfirm(at({ destinationId: 'jezero' }));
    f.back(); f.back();
    expect(f.showJourney(at({ destinationId: 'jezero' }))).toBe(true);
    expect(f.screen).toBe('confirm');
  });
});

describe('destination flow: the confirmed record is invalidated', () => {
  const confirmed = () => {
    const f = new DestinationFlow();
    f.open(at());
    f.choose('jezero');
    f.afterConfirm(at({ destinationId: 'jezero' }));
    f.back(); f.back();
    return f;
  };
  it.each([
    ['another destination (any route)', at({ destinationId: 'kraken' })],
    ['no destination (Start fresh, a reset)', at({ destinationId: null })],
    ['another base (arrival, a base switch)', at({ baseId: 'jezero', destinationId: 'jezero' })],
    ['a flight under way', at({ destinationId: 'jezero', mode: 'travel' })],
    ['docking', at({ destinationId: 'jezero', mode: 'docking' })],
    ['a saved-mission offer pending', at({ destinationId: 'jezero', blocked: true })],
  ])('by %s, and stays invalid afterwards', (_name, m) => {
    const f = confirmed();
    f.sync(m);
    expect(f.confirmed).toBe(null);
    // Back to the very same mission values later: the old confirmation does not come back.
    f.sync(at({ destinationId: 'jezero' }));
    expect(f.confirmedFor(at({ destinationId: 'jezero' }))).toBe(null);
    expect(f.showJourney(at({ destinationId: 'jezero' }))).toBe(false);
  });

  it('survives a launch countdown that is cancelled (same base, same destination, same journey)', () => {
    const f = confirmed();
    f.sync(at({ destinationId: 'jezero', mode: 'launch' }));
    f.sync(at({ destinationId: 'jezero' }));
    expect(f.confirmedFor(at({ destinationId: 'jezero' }))).toBe('jezero');
  });

  it('a new flow (a reload) has no confirmation: a saved destination is only "saved"', () => {
    const f = new DestinationFlow();
    expect(f.confirmedFor(at({ destinationId: 'jezero' }))).toBe(null);
    expect(f.savedFor(at({ destinationId: 'jezero' }))).toBe('jezero');
    expect(confirmed().savedFor(at({ destinationId: 'jezero' }))).toBe(null);
  });

  it('on screen 3, losing the confirmation goes back to screen 2 (preview = the mission\'s destination)', () => {
    const f = new DestinationFlow();
    f.open(at());
    f.choose('jezero');
    f.afterConfirm(at({ destinationId: 'jezero' }));
    const g = f.generation;
    f.sync(at({ destinationId: 'kraken' }));
    expect([f.screen, f.preview, f.confirmed]).toEqual(['select', 'kraken', null]);
    expect(f.generation).toBe(g + 1);
  });

  it('the flow closes when the base view ends (a launch) or a saved-mission offer appears', () => {
    for (const m of [at({ destinationId: 'jezero', mode: 'launch' }), at({ blocked: true })]) {
      const f = new DestinationFlow();
      f.open(at());
      f.choose('jezero');
      f.afterConfirm(at({ destinationId: 'jezero' }));
      f.sync(m);
      expect(f.screen).toBe('closed');
    }
  });
});
