import { describe, expect, it } from 'vitest';
import { BODIES, bodyById, bodyIndex } from '../src/data/bodies';

describe('body lookup by id', () => {
  it('finds every body and its index', () => {
    BODIES.forEach((body, i) => {
      expect(bodyById(body.id)).toBe(body);
      expect(bodyIndex(body.id)).toBe(i);
    });
  });

  it('gives no index for an unknown id', () => {
    expect(bodyIndex('vulcan')).toBe(-1);
  });
});
