import { describe, expect, it } from 'vitest';
import { parseFlags } from '../src/app/flags';

describe('?flags=', () => {
  it('reads a comma-separated list, ignoring empty entries', () => {
    expect([...parseFlags('?flags=build,cinematic')]).toEqual(['build', 'cinematic']);
    expect([...parseFlags('?body=mars&flags=,astrolife,')]).toEqual(['astrolife']);
    expect(parseFlags('?flags=').size).toBe(0);
    expect(parseFlags('').size).toBe(0);
  });

  it('reads ?al as ?flags=astrolife', () => {
    expect([...parseFlags('?al')]).toEqual(['astrolife']); // a souvenir link's short form (decision 26)
    expect([...parseFlags('?al=')]).toEqual(['astrolife']);
    expect([...parseFlags('?flags=build&al&debug')].sort()).toEqual(['astrolife', 'build']);
    expect(parseFlags('?alpha&flags=').size).toBe(0); // only the exact key
  });
});
