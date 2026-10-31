import { describe, expect, it } from 'vitest';
import { resetIfAsked } from '../src/app/settings';

/** A localStorage stand-in with the calls resetIfAsked uses. */
function fakeStorage(items: Record<string, string>) {
  const map = new Map(Object.entries(items));
  return {
    map,
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('?reset: a first visit for user tests', () => {
  it('forgets every key the app saved, and only those', () => {
    const store = fakeStorage({
      'gse.quality': 'low', 'gse.autoTier': '{}', 'gse.passport': '{}', 'gse.build.jezero': '[]', 'gse.help': '1',
      'another.app': 'kept', gsex: 'kept',
    });
    expect(resetIfAsked('?reset', store)).toBe('');
    expect([...store.map.keys()]).toEqual(['another.app', 'gsex']);
  });

  it('does nothing unless the address asks', () => {
    const store = fakeStorage({ 'gse.quality': 'low' });
    expect(resetIfAsked('', store)).toBeNull();
    expect(resetIfAsked('?base=jezero&debug', store)).toBeNull();
    expect(resetIfAsked('?resets', store)).toBeNull();
    expect(store.map.size).toBe(1);
  });

  it('drops only `reset` from the address; the rest stays as typed', () => {
    const store = fakeStorage({});
    expect(resetIfAsked('?reset&base=jezero', store)).toBe('?base=jezero');
    expect(resetIfAsked('?base=jezero&reset=1&flags=build,cinematic&debug', store)).toBe('?base=jezero&flags=build,cinematic&debug');
    expect(resetIfAsked('?re%73et', store)).toBe(''); // an encoded name is still `reset`
  });

  it('blocked storage is no error', () => {
    expect(resetIfAsked('?reset&body=saturn', null)).toBe('?body=saturn');
    const throwing = { get length(): number { throw new DOMException('blocked', 'SecurityError'); }, key: () => null, removeItem: () => {} };
    expect(resetIfAsked('?reset', throwing)).toBe('');
  });
});
