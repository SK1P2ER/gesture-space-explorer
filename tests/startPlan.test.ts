// What a page load starts with (src/app/startPlan.ts): pure decisions from the saved checkpoint, the link and the mode.
import { describe, expect, it } from 'vitest';
import { afterStartFresh, idleAtCape, startPlan, type StartFacts } from '../src/app/startPlan';

const atBase = (baseId: string, more: Partial<NonNullable<StartFacts['saved']>> = {}): NonNullable<StartFacts['saved']> =>
  ({ phase: 'base', baseId, destinationId: null, ...more });
const free = (saved: StartFacts['saved'], link: StartFacts['link'] = {}): StartFacts => ({ freeMode: true, guidedActive: false, saved, link });
const other = (saved: StartFacts['saved'], link: StartFacts['link'] = {}, guidedActive = false): StartFacts => ({ freeMode: false, guidedActive, saved, link });
const kraken = { base: 'kraken', body: 'titan' }, jezero = { base: 'jezero', body: 'mars' }, cape = { base: 'cape', body: 'earth' };

describe('free mode (the picker flow, no Guided)', () => {
  it('nothing saved and no place in the link: the Tanegashima ground view', () => {
    expect(startPlan(free(null))).toBe('ground');
  });
  it('nothing saved, a place in the link: the link', () => {
    expect(startPlan(free(null, kraken))).toBe('link');
  });
  it('a journey saved elsewhere: offered (Continue / Start fresh); a link to the same base too', () => {
    expect(startPlan(free(atBase('kraken')))).toBe('offer');
    expect(startPlan(free(atBase('kraken'), kraken))).toBe('offer');
  });
  it('a link to another place than the saved one: the link, no offer', () => {
    expect(startPlan(free(atBase('kraken'), jezero))).toBe('link');
  });
  it('resting at Cape with nothing begun is no journey: not offered; the ground view, or the link', () => {
    expect(startPlan(free(atBase('cape')))).toBe('ground');
    expect(startPlan(free(atBase('cape'), cape))).toBe('link');
    expect(startPlan(free(atBase('cape'), kraken))).toBe('link');
  });
  it('at Cape with something begun (a destination chosen, a trip, a landing): still offered', () => {
    expect(startPlan(free(atBase('cape', { destinationId: 'kraken' })))).toBe('offer');
    expect(startPlan(free({ phase: 'travel', baseId: 'cape', destinationId: 'kraken', trip: { fromId: 'cape', toId: 'kraken' } as never }))).toBe('offer');
    expect(startPlan(free({ phase: 'docking', baseId: 'cape', destinationId: null, dock: {} as never }))).toBe('offer');
  });
  it('Start fresh: the ground view, over any link', () => {
    expect(afterStartFresh(free(atBase('kraken')))).toBe('ground');
    expect(afterStartFresh(free(atBase('kraken'), kraken))).toBe('ground');
  });
});

describe('the flag-off app and Guided keep their own start and recovery', () => {
  it('nothing saved: the app\'s own start, or the link', () => {
    expect(startPlan(other(null))).toBe('default');
    expect(startPlan(other(null, kraken))).toBe('link');
    expect(startPlan(other(null, {}, true))).toBe('default');
  });
  it('resting at Cape is offered as before', () => {
    expect(startPlan(other(atBase('cape')))).toBe('offer');
    expect(startPlan(other(atBase('cape'), {}, true))).toBe('offer');
  });
  it('free mode with an active Guided session keeps Guided\'s recovery (offered)', () => {
    expect(startPlan({ freeMode: true, guidedActive: true, saved: atBase('cape'), link: {} })).toBe('offer');
  });
  it('Start fresh: the link, or the app\'s own start', () => {
    expect(afterStartFresh(other(atBase('kraken'), kraken))).toBe('link');
    expect(afterStartFresh(other(atBase('kraken')))).toBe('default');
  });
});

describe('idle at Cape', () => {
  it('only the base phase at Cape with no destination, trip or landing', () => {
    expect(idleAtCape(atBase('cape'))).toBe(true);
    expect(idleAtCape(atBase('kraken'))).toBe(false);
    expect(idleAtCape(atBase('cape', { destinationId: 'jezero' }))).toBe(false);
    expect(idleAtCape(null)).toBe(false);
  });
});
