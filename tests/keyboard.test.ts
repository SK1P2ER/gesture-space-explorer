import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { keyToIntent } from '../src/input/keyboard';

const k = (key: string) => keyToIntent(key, config.keyboard);

describe('keyToIntent', () => {
  it('maps navigation keys', () => {
    expect(k('ArrowLeft')).toEqual({ type: 'prev' });
    expect(k('ArrowRight')).toEqual({ type: 'next' });
    expect(k('Enter')).toEqual({ type: 'select' });
    expect(k(' ')).toEqual({ type: 'togglePause' });
  });

  it('zooms in on ArrowUp and out on ArrowDown', () => {
    const up = k('ArrowUp');
    const down = k('ArrowDown');
    expect(up?.type === 'zoom' && up.factor).toBeLessThan(1);
    expect(down?.type === 'zoom' && down.factor).toBeGreaterThan(1);
  });

  it('[ and ] change time speed in opposite directions', () => {
    const slower = k('[');
    const faster = k(']');
    expect(slower?.type === 'timeScale' && faster?.type === 'timeScale').toBe(true);
    if (slower?.type === 'timeScale' && faster?.type === 'timeScale') {
      expect(slower.factor * faster.factor).toBeCloseTo(1);
    }
  });

  it('accepts both cases for letter shortcuts', () => {
    expect(k('d')).toEqual(k('D'));
    expect(k('l')).toEqual({ type: 'toggleLanguage' });
  });

  it('P takes a photo, W toggles the watermark', () => {
    expect(k('p')).toEqual({ type: 'photo' });
    expect(k('P')).toEqual({ type: 'photo' });
    expect(k('w')).toEqual({ type: 'toggleWatermark' });
  });

  it('ignores unmapped keys', () => {
    expect(k('x')).toBeNull();
  });
});
