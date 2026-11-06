import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { idleBuildGrab, idleDirector, needsFlaggedCode, parseFlags } from '../src/app/flags';

describe('?flags=', () => {
  it('reads a comma-separated list, ignoring empty entries', () => {
    expect([...parseFlags('?flags=build,cinematic')]).toEqual(['build', 'cinematic']);
    expect([...parseFlags('?body=mars&flags=,astrolife,')]).toEqual(['astrolife']);
    expect(parseFlags('?flags=').size).toBe(0);
    expect(parseFlags('').size).toBe(0);
    expect([...parseFlags('?al')]).toEqual(['astrolife']); // a souvenir link's short form (decision 27)
    expect([...parseFlags('?al=')]).toEqual(['astrolife']);
    expect([...parseFlags('?flags=build&al&debug')].sort()).toEqual(['astrolife', 'build']);
    expect(parseFlags('?alpha&flags=').size).toBe(0); // only the exact key
  });

  it('loads code only for the features that have it', () => {
    expect(needsFlaggedCode(parseFlags('?flags=operations'))).toBe(false);
    for (const flag of ['cinematic', 'build', 'astrolife']) expect(needsFlaggedCode(parseFlags(`?flags=${flag}`)), flag).toBe(true);
  });

  it('stand-ins do nothing: the director never starts, nothing is grabbed', () => {
    expect(idleDirector.start('overview', null as never, false)).toBe(false);
    expect(idleDirector.update(1, false, false, { top: 0, right: 0, bottom: 0, left: 0 })).toBe(false);
    expect(idleDirector.active).toBe(false);
    expect(idleDirector.eye).toBeInstanceOf(THREE.Vector3);
    expect(idleBuildGrab.update(0, null)).toEqual([]);
  });
});
