import { describe, expect, it } from 'vitest';
import { DestinationPrep, JourneyTracker, deriveJourney, parseJourneySim, type JourneySnapshot } from '../src/app/journeyStatus';

const base: JourneySnapshot = { mode: 'baseView', baseId: 'cape', destinationId: 'jezero', countdown: false, presenting: false, trip: null, horizon: false, prep: 'idle' };
const snap = (o: Partial<JourneySnapshot>): JourneySnapshot => ({ ...base, ...o });

describe('deriveJourney (Tanegashima → Jezero)', () => {
  it('departing: countdown and the launch presentation at Tanegashima for Jezero', () => {
    expect(deriveJourney(snap({ mode: 'launch', countdown: true }), false)).toBe('departing');
    expect(deriveJourney(snap({ mode: 'launch', presenting: true }), false)).toBe('departing');
  });
  it('transit: a trip from Tanegashima to Jezero', () => {
    expect(deriveJourney(snap({ mode: 'travel', baseId: null, destinationId: null, trip: { from: 'cape', to: 'jezero' } }), false)).toBe('transit');
  });
  it('preparing while landing and while the scene is not interactive; failed; arrived only when ready', () => {
    const at = { baseId: 'jezero', destinationId: null };
    expect(deriveJourney(snap({ ...at, mode: 'docking' }), true)).toBe('preparing');
    expect(deriveJourney(snap({ ...at, prep: 'idle' }), true)).toBe('preparing');
    expect(deriveJourney(snap({ ...at, prep: 'loading' }), true)).toBe('preparing');
    expect(deriveJourney(snap({ ...at, prep: 'failed' }), true)).toBe('failed');
    expect(deriveJourney(snap({ ...at, prep: 'ready' }), true)).toBe('arrived');
    expect(deriveJourney(snap({ ...at, prep: 'ready', horizon: true }), true)).toBeNull(); // exploring
  });
  it('other routes and states: no message', () => {
    expect(deriveJourney(snap({}), false)).toBeNull(); // a confirmed route, not launching
    expect(deriveJourney(snap({ mode: 'launch', destinationId: 'tranquility', countdown: true }), false)).toBeNull();
    expect(deriveJourney(snap({ mode: 'travel', trip: { from: 'cape', to: 'tranquility' } }), false)).toBeNull();
    expect(deriveJourney(snap({ mode: 'travel', trip: { from: 'tranquility', to: 'jezero' } }), false)).toBeNull();
    // Landing at Jezero from elsewhere is not this journey.
    expect(deriveJourney(snap({ mode: 'docking', baseId: 'jezero' }), false)).toBeNull();
    expect(deriveJourney(snap({ mode: 'baseView', baseId: 'jezero', prep: 'ready' }), false)).toBeNull();
    expect(deriveJourney(snap({ mode: 'focus', baseId: null }), true)).toBeNull();
  });
});

describe('JourneyTracker', () => {
  it('follows the route from departure through arrival, and ends on exploring', () => {
    const j = new JourneyTracker();
    const seq = [
      snap({ mode: 'launch', countdown: true }),
      snap({ mode: 'launch', presenting: true }),
      snap({ mode: 'travel', trip: { from: 'cape', to: 'jezero' } }),
      snap({ mode: 'docking', baseId: 'jezero', destinationId: null }),
      snap({ mode: 'baseView', baseId: 'jezero', destinationId: null, prep: 'loading' }),
      snap({ mode: 'baseView', baseId: 'jezero', destinationId: null, prep: 'ready' }),
    ].map((s) => j.update(s));
    expect(seq).toEqual(['departing', 'departing', 'transit', 'preparing', 'preparing', 'arrived']);
    j.end();
    expect(j.update(snap({ mode: 'baseView', baseId: 'jezero', destinationId: null, prep: 'ready' }))).toBeNull();
  });
  it('a cancelled departure (back to the base view) leaves no message and drops the route', () => {
    const j = new JourneyTracker();
    j.update(snap({ mode: 'launch', countdown: true }));
    expect(j.update(snap({}))).toBeNull();
    expect(j.update(snap({ mode: 'docking', baseId: 'jezero' }))).toBeNull();
  });
  it('leaving Jezero ends the journey', () => {
    const j = new JourneyTracker();
    j.update(snap({ mode: 'travel', trip: { from: 'cape', to: 'jezero' } }));
    expect(j.update(snap({ mode: 'baseView', baseId: 'jezero', prep: 'ready' }))).toBe('arrived');
    expect(j.update(snap({ mode: 'focus', baseId: null }))).toBeNull();
    expect(j.update(snap({ mode: 'baseView', baseId: 'jezero', prep: 'ready' }))).toBeNull();
  });
});

describe('DestinationPrep', () => {
  it('ready once the scene has been interactive for two updates; not before', () => {
    const p = new DestinationPrep();
    p.begin(0);
    p.update(10, false); expect(p.state).toBe('loading');
    p.update(20, true); expect(p.state).toBe('loading');
    p.update(30, true); expect(p.state).toBe('ready');
  });
  it('elapsed time alone never makes it ready', () => {
    const p = new DestinationPrep();
    p.begin(0);
    for (let t = 0; t < 60000; t += 1000) p.update(t, false);
    expect(p.state).toBe('loading');
  });
  it('slow: waits the delay even when interactive', () => {
    const p = new DestinationPrep('slow', 4000);
    p.begin(0);
    for (let t = 0; t < 4000; t += 100) p.update(t, true);
    expect(p.state).toBe('loading');
    p.update(4000, true); expect(p.state).toBe('ready');
  });
  it('fail: the first attempt fails; Try again succeeds', () => {
    const p = new DestinationPrep('fail', 1000);
    p.begin(0);
    p.update(500, true); expect(p.state).toBe('loading');
    p.update(1000, true); expect(p.state).toBe('failed');
    p.update(2000, true); expect(p.state).toBe('failed');
    p.retry(3000); expect(p.state).toBe('loading');
    p.update(3500, true); p.update(4000, true); expect(p.state).toBe('ready');
    p.reset(); expect(p.state).toBe('idle'); expect(p.attempts).toBe(0);
  });
  it('the simulation is only read where allowed', () => {
    expect(parseJourneySim('?journeysim=slow', true)).toBe('slow');
    expect(parseJourneySim('?journeysim=fail', true)).toBe('fail');
    expect(parseJourneySim('?journeysim=fail', false)).toBe('none');
    expect(parseJourneySim('?journeysim=bogus', true)).toBe('none');
  });
});

describe('journey view words and layout (pure helpers)', async () => {
  const { journeyRoute, journeyLayout, journeyText } = await import('../src/ui/journeyStatusView');
  it('the compact route names the departure place and the destination base in each language', () => {
    expect(journeyRoute('en')).toBe('Tanegashima → Jezero Dome');
    expect(journeyRoute('ja')).toMatch(/^種子島 → /);
    expect(journeyRoute('my')).toMatch(/^Tanegashima → Jezero/);
  });
  it('Preparing keeps the destination name', () => {
    expect(journeyText('preparing', 'en')).toBe('Preparing Jezero Dome…');
  });
  it('the card layout: landscape phones put it on the right, portrait phones low, the rest beside the panel', () => {
    expect(journeyLayout(844, 390)).toBe('land');
    expect(journeyLayout(390, 844)).toBe('phone');
    expect(journeyLayout(1280, 800)).toBe('desk');
    expect(journeyLayout(640, 900)).toBe('phone');
    expect(journeyLayout(1024, 480)).toBe('land');
  });
});
