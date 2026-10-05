import { describe, expect, it } from 'vitest';
import { formatCountdown } from './countdown';

describe('formatCountdown', () => {
  it('returns null when phaseEndsAt is null (non-timed phase / not started)', () => {
    expect(formatCountdown(null, Date.parse('2026-01-01T00:00:00.000Z'))).toBeNull();
  });

  it('formats a sub-minute remainder as 00:SS', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const endsAt = '2026-01-01T00:00:30.000Z';
    expect(formatCountdown(endsAt, now)).toBe('00:30');
  });

  it('formats a multi-minute remainder as MM:SS', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const endsAt = '2026-01-01T00:02:05.000Z';
    expect(formatCountdown(endsAt, now)).toBe('02:05');
  });

  it('clamps to 00:00 instead of going negative once the deadline has passed', () => {
    const now = Date.parse('2026-01-01T00:01:00.000Z');
    const endsAt = '2026-01-01T00:00:30.000Z';
    expect(formatCountdown(endsAt, now)).toBe('00:00');
  });

  it('returns null for an unparseable phaseEndsAt instead of NaN:NaN', () => {
    expect(formatCountdown('not-a-date', Date.now())).toBeNull();
  });
});
