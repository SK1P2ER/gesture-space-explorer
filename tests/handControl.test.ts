import { describe, expect, it } from 'vitest';
import { ACCEPTS } from '../src/app/modes';
import { STRING_KEYS, t } from '../src/ui/i18n';
import { canRestartTracking, type TrackingStatus } from '../src/ui/hud';

describe('🖐 Turn on hand control', () => {
  it.each(['err.disconnected', 'err.tracker', 'err.tracking-stopped', 'err.denied', 'err.not-found', 'err.unknown'] as const)(
    'is offered after %s', (reason) => {
      expect(canRestartTracking({ kind: 'keyboard', reason })).toBe(true);
    });

  it.each<TrackingStatus>([
    { kind: 'loading', progress: 0.5 },
    { kind: 'tracking', delegate: 'GPU' },
    { kind: 'keyboard', reason: 'err.insecure' }, // a retry can't add HTTPS
    { kind: 'keyboard', reason: 'err.unsupported' }, // or a camera API
  ])('is not offered while $kind $reason', (status) => {
    expect(canRestartTracking(status)).toBe(false);
  });

  it('works in every mode and has its label in every language', () => {
    for (const accepts of Object.values(ACCEPTS)) expect(accepts.has('restartTracking')).toBe(true);
    expect(STRING_KEYS).toContain('handControlStart');
    for (const lang of ['en', 'my', 'ja'] as const) expect(t('handControlStart', lang)).not.toBe('');
  });
});
