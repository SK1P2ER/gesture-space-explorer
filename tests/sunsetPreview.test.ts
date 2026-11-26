import { describe, expect, it } from 'vitest';
import { MANUAL_TIME_INTENTS, PRESET_DRIFT_MS, SunsetPreview } from '../src/app/sunsetPreview';

const T0 = Date.UTC(2026, 10, 26, 3, 0);
const SUNSET1 = T0 + 9 * 3600e3;
const SUNSET2 = SUNSET1 + 24.6 * 3600e3;

describe('SunsetPreview', () => {
  it('starts only when the clock actually moved', () => {
    const p = new SunsetPreview();
    expect(p.sunsetApplied(T0, T0, 'jezero')).toBe(false); // no sunset soon / blocked: nothing to restore
    expect(p.active).toBe(false);
    expect(p.sunsetApplied(T0, SUNSET1, null)).toBe(false); // not at a base
    expect(p.sunsetApplied(T0, SUNSET1, 'jezero')).toBe(true);
    expect(p.state).toEqual({ original: T0, baseId: 'jezero', preset: 'golden', presetTime: SUNSET1 });
  });

  it('repeated activation keeps the first original', () => {
    const p = new SunsetPreview();
    p.sunsetApplied(T0, SUNSET1, 'jezero');
    p.sunsetApplied(SUNSET1 + 5000, SUNSET2, 'jezero');
    p.sunsetApplied(SUNSET2, SUNSET2, 'jezero'); // a later tap with no sunset ahead: still the same preview
    expect(p.state?.original).toBe(T0);
  });

  it('restore returns the exact original once and ends the preview', () => {
    const p = new SunsetPreview();
    p.sunsetApplied(T0, SUNSET1, 'jezero');
    p.sunsetApplied(SUNSET1, SUNSET2, 'jezero');
    expect(p.restore()).toBe(T0);
    expect(p.active).toBe(false);
    expect(p.restore()).toBeNull();
  });

  it('a manual time change discards it; speed, direction and pause do not', () => {
    for (const keep of ['setTimeSpeed', 'timeScale', 'timeDial', 'reverseTime', 'togglePause', 'toggleLanguage', 'rotate', 'zoom']) {
      const p = new SunsetPreview();
      p.sunsetApplied(T0, SUNSET1, 'jezero');
      p.intent(keep);
      expect(p.active, keep).toBe(true);
    }
    expect(MANUAL_TIME_INTENTS).toEqual(['timeNow', 'timeJump']);
    for (const manual of MANUAL_TIME_INTENTS) {
      const p = new SunsetPreview();
      p.sunsetApplied(T0, SUNSET1, 'jezero');
      p.intent(manual);
      expect(p.active, manual).toBe(false);
      expect(p.restore()).toBeNull();
    }
  });

  it('leaving Explore or the base discards it; a new preview saves a new original', () => {
    const p = new SunsetPreview();
    p.sunsetApplied(T0, SUNSET1, 'jezero');
    p.sync(true, 'jezero');
    expect(p.active).toBe(true);
    p.sync(false, 'jezero'); // Return to orbit / Esc
    expect(p.active).toBe(false);
    p.sunsetApplied(SUNSET1, SUNSET2, 'jezero');
    expect(p.state?.original).toBe(SUNSET1);
    p.sync(true, null); // left the base
    expect(p.active).toBe(false);
    p.sunsetApplied(T0, SUNSET1, 'jezero');
    p.sunsetApplied(SUNSET1, SUNSET2, 'other'); // another base: its own preview
    expect(p.state).toMatchObject({ original: SUNSET1, baseId: 'other', preset: 'golden' });
  });

  it('no sunset available does nothing, even after a previous preview ended', () => {
    const p = new SunsetPreview();
    p.sunsetApplied(T0, T0, 'jezero');
    expect(p.active).toBe(false);
    p.sunsetApplied(T0, SUNSET1, 'jezero');
    p.discard();
    p.sunsetApplied(SUNSET1, SUNSET1, 'jezero');
    expect(p.active).toBe(false);
  });

  it('presets: the original is saved once; Day → Golden → Night → Restore returns exactly to it; the active label follows', () => {
    const p = new SunsetPreview();
    const DAY = T0 + 2 * 3600e3, GOLD = T0 + 8 * 3600e3, NIGHT = T0 + 15 * 3600e3;
    p.presetApplied('day', T0, DAY, 'jezero');
    p.presetApplied('golden', DAY + 123, GOLD, 'jezero');
    p.presetApplied('night', GOLD + 77, NIGHT, 'jezero');
    expect(p.state).toEqual({ original: T0, baseId: 'jezero', preset: 'night', presetTime: NIGHT });
    expect(p.activePreset(NIGHT)).toBe('night');
    expect(p.activePreset(NIGHT + PRESET_DRIFT_MS)).toBe('night');
    expect(p.activePreset(NIGHT + PRESET_DRIFT_MS + 1)).toBeNull(); // drifted: no label, Restore still offered
    expect(p.active).toBe(true);
    expect(p.restore()).toBe(T0);
    expect(p.activePreset(T0)).toBeNull();
  });

  it('a preset after the base panel near-sunset jump keeps that jump original; a preset at the current time still starts a session', () => {
    const p = new SunsetPreview();
    p.sunsetApplied(T0, SUNSET1, 'jezero');
    p.presetApplied('day', SUNSET1, T0 + 3600e3, 'jezero');
    expect(p.state?.original).toBe(T0);
    const q = new SunsetPreview();
    q.presetApplied('day', T0, T0, 'jezero');
    expect(q.state).toMatchObject({ original: T0, preset: 'day' });
    expect(q.presetApplied('day', T0, T0, null)).toBe(true); // not at a base: unchanged
  });

  it('presets follow the same discard rules (Now / a date, leaving Explore or the base); speed and pause keep them', () => {
    for (const keep of ['setTimeSpeed', 'timeScale', 'reverseTime', 'togglePause']) {
      const p = new SunsetPreview(); p.presetApplied('night', T0, SUNSET1, 'jezero'); p.intent(keep);
      expect(p.state?.original, keep).toBe(T0);
    }
    for (const manual of MANUAL_TIME_INTENTS) {
      const p = new SunsetPreview(); p.presetApplied('night', T0, SUNSET1, 'jezero'); p.intent(manual);
      expect(p.active, manual).toBe(false);
    }
    const p = new SunsetPreview(); p.presetApplied('day', T0, SUNSET1, 'jezero'); p.sync(false, 'jezero');
    expect(p.restore()).toBeNull();
  });
});
