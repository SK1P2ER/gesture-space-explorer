import { describe, expect, it } from 'vitest';
import { ACCEPTS, INTENT_TYPES, modeForFocus, ModeMachine, TRANSITIONS, type Mode } from '../src/app/modes';
import type { Intent } from '../src/intents';

const intent = (type: Intent['type']) => ({ type }) as Intent;
const MODES = Object.keys(TRANSITIONS) as Mode[];

describe('app modes', () => {
  it('starts in SolarView and follows the focus: the Sun is SolarView, any other body Focus', () => {
    const m = new ModeMachine();
    expect(m.mode).toBe('solarView');
    expect(modeForFocus(0)).toBe('solarView');
    expect(modeForFocus(5)).toBe('focus');
    expect(m.go('focus')).toBe(true);
    expect(m.go('focus')).toBe(true); // planet → planet
    expect(m.go('solarView')).toBe(true);
  });

  it('goes the whole way round: base, launch, travel, docking, base', () => {
    const m = new ModeMachine();
    const seen: string[] = [];
    m.onChange((to, from) => seen.push(`${from}→${to}`));
    for (const to of ['focus', 'baseView', 'launch', 'travel', 'docking', 'baseView', 'focus', 'solarView'] as Mode[]) expect(m.go(to), to).toBe(true);
    expect(seen).toEqual([
      'solarView→focus', 'focus→baseView', 'baseView→launch', 'launch→travel',
      'travel→docking', 'docking→baseView', 'baseView→focus', 'focus→solarView',
    ]);
  });

  it('refuses shortcuts: no base from the overview, no leaving a rocket mid-flight', () => {
    const m = new ModeMachine();
    expect(m.go('baseView')).toBe(false);
    expect(m.go('travel')).toBe(false);
    expect(m.mode).toBe('solarView');
    for (const to of ['focus', 'baseView', 'launch', 'travel'] as Mode[]) m.go(to);
    for (const to of ['solarView', 'focus', 'baseView', 'launch'] as Mode[]) expect(m.go(to), to).toBe(false);
    expect(m.mode).toBe('travel');
    expect(m.go('docking')).toBe(true);
    expect(m.go('focus')).toBe(false); // you land first
  });

  it('can abort a launch back to the base', () => {
    const m = new ModeMachine();
    for (const to of ['focus', 'baseView', 'launch'] as Mode[]) m.go(to);
    expect(m.go('baseView')).toBe(true);
  });

  it('every mode can be reached from SolarView, and every mode can get back to it', () => {
    const reach = (from: Mode) => {
      const seen = new Set<Mode>([from]);
      const queue = [from];
      while (queue.length) for (const n of TRANSITIONS[queue.shift()!]) if (!seen.has(n)) seen.add(n), queue.push(n);
      return seen;
    };
    expect(reach('solarView').size).toBe(MODES.length);
    for (const m of MODES) expect(reach(m).has('solarView'), m).toBe(true);
  });

  it('keeps today’s behavior: SolarView and Focus accept every intent', () => {
    for (const mode of ['solarView', 'focus'] as Mode[]) for (const type of INTENT_TYPES) expect(ACCEPTS[mode].has(type), `${mode} ${type}`).toBe(true);
  });

  it('interprets intents per mode: no planet switching during launch, travel or docking', () => {
    const m = new ModeMachine();
    for (const to of ['focus', 'baseView', 'launch', 'travel'] as Mode[]) m.go(to);
    for (const type of ['next', 'prev', 'nextMoon', 'enterBase'] as const) expect(m.accepts(intent(type)), type).toBe(false);
    expect(m.accepts(intent('select'))).toBe(true); // Enter skips the trip
    expect(m.accepts(intent('toggleLanguage'))).toBe(true);
    expect(m.accepts(intent('photo'))).toBe(true);
    m.go('docking');
    expect(m.accepts(intent('togglePause'))).toBe(false); // time keeps running while you land
    expect(m.accepts(intent('rotate'))).toBe(false); // your hand steers the rocket instead
    for (const type of ['steer', 'next', 'prev', 'zoom', 'select', 'toggleAutoLand'] as const) expect(m.accepts(intent(type)), type).toBe(true); // steering; Enter auto-lands
    expect(m.accepts(intent('nextMoon'))).toBe(false);
    expect(m.accepts(intent('enterBase'))).toBe(false);
  });
});
