import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }));
vi.mock('../src/quality', () => ({ safeLocalStorage: () => memory }));
import { readLanguage, writeLanguage } from '../src/app/settings';

describe('default language', () => {
  beforeEach(() => { memory.getItem.mockReset(); memory.setItem.mockReset(); });
  it('uses Japanese for a new visit or an invalid saved value', () => {
    for (const value of [null, undefined, '', 'jp', 'invalid']) {
      memory.getItem.mockReturnValue(value);
      expect(readLanguage()).toBe('ja');
    }
  });
  it.each(['en', 'my', 'ja'] as const)('keeps the saved %s preference', lang => {
    memory.getItem.mockReturnValue(lang);
    expect(readLanguage()).toBe(lang);
  });
  it('uses Japanese if storage is blocked', () => {
    memory.getItem.mockImplementation(() => { throw new Error('blocked'); });
    expect(readLanguage()).toBe('ja');
  });
  it('saves an explicitly chosen language', () => {
    writeLanguage('en');
    expect(memory.setItem).toHaveBeenCalledWith('gse.lang', 'en');
  });
});
