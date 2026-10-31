import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { BODIES } from '../src/data/bodies';
import { isClick, keyToIntent } from '../src/input/keyboard';
import { nextInSystem, pickable, step, systemOf } from '../src/navigation';
import { kindLabel, labelText } from '../src/ui/kind';

const at = (id: string) => BODIES.findIndex((b) => b.id === id);
const id = (index: number | null) => (index === null ? null : BODIES[index].id);

describe('← → (and ✌️)', () => {
  it('step through the Sun and the planets, skipping moons', () => {
    const tour: string[] = [];
    let i = 0;
    do {
      tour.push(BODIES[i].id);
      i = step(BODIES, i, 1);
    } while (i !== 0);
    expect(tour).toEqual(['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'halley']);
    expect(id(step(BODIES, 0, -1))).toBe('halley');
  });

  it('from a moon, continue from its planet', () => {
    expect(id(step(BODIES, at('europa'), 1))).toBe('saturn');
    expect(id(step(BODIES, at('europa'), -1))).toBe('mars');
    expect(id(step(BODIES, at('moon'), 1))).toBe('mars');
  });
});

describe('M', () => {
  it('goes planet → its moons → back to the planet', () => {
    const cycle: (string | null)[] = [];
    let i: number | null = at('jupiter');
    for (let k = 0; k < 5; k++) {
      i = nextInSystem(BODIES, i!);
      cycle.push(id(i));
    }
    expect(cycle).toEqual(['io', 'europa', 'ganymede', 'callisto', 'jupiter']);
    expect(id(nextInSystem(BODIES, at('earth')))).toBe('moon');
    expect(id(nextInSystem(BODIES, at('moon')))).toBe('earth');
    expect(id(nextInSystem(BODIES, at('titan')))).toBe('saturn');
  });

  it('has nowhere to go without moons', () => {
    for (const p of ['sun', 'mercury', 'venus', 'mars', 'uranus', 'neptune', 'pluto', 'halley']) expect(nextInSystem(BODIES, at(p)), p).toBeNull();
  });

  it('is the M key', () => {
    expect(keyToIntent('m', config.keyboard)).toEqual({ type: 'nextMoon' });
    expect(keyToIntent('M', config.keyboard)).toEqual({ type: 'nextMoon' });
  });
});

describe('pointing and clicking', () => {
  it('can pick planets anywhere, but moons only in the system in focus', () => {
    const fromJupiter = BODIES.filter(pickable(BODIES[at('jupiter')])).map((b) => b.id);
    expect(fromJupiter).toContain('io');
    expect(fromJupiter).toContain('saturn');
    expect(fromJupiter).not.toContain('moon');
    expect(fromJupiter).not.toContain('titan');
    const fromIo = BODIES.filter(pickable(BODIES[at('io')])).map((b) => b.id);
    expect(fromIo).toContain('callisto');
    expect(BODIES.filter(pickable(BODIES[0])).some((b) => b.kind === 'moon')).toBe(false);
    expect(systemOf(BODIES[at('ganymede')])).toBe('jupiter');
  });

  it('treats a short press without movement as a click, not a drag', () => {
    expect(isClick({ x: 100, y: 100, t: 0 }, { x: 103, y: 102, t: 180 })).toBe(true);
    expect(isClick({ x: 100, y: 100, t: 0 }, { x: 140, y: 100, t: 180 })).toBe(false); // dragged
    expect(isClick({ x: 100, y: 100, t: 0 }, { x: 100, y: 100, t: 900 })).toBe(false); // held
  });
});

describe('labels', () => {
  it('say what a moon belongs to, in every language', () => {
    const titan = BODIES[at('titan')];
    expect(labelText(titan, 'en')).toBe('Titan · moon of Saturn');
    expect(kindLabel(titan, 'ja')).toBe('土星の衛星');
    expect(kindLabel(BODIES[at('moon')], 'my')).toContain('ကမ္ဘာ');
    expect(labelText(BODIES[at('mars')], 'en')).toBe('Mars');
    expect(labelText(BODIES[at('pluto')], 'en')).toBe('Pluto · dwarf planet');
    expect(labelText(BODIES[at('pluto')], 'ja')).toBe('冥王星 · 準惑星');
    expect(labelText(BODIES[at('halley')], 'en')).toBe('Halley’s Comet · comet');
  });
});
