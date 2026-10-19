import { describe, expect, it } from 'vitest';
import { countdownFraction, formatCountdown } from './countdown';

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

describe('countdownFraction (F7b)', () => {
  it('is 0 when phaseEndsAt is null (non-timed phase / not started)', () => {
    expect(countdownFraction(null, Date.parse('2026-01-01T00:00:00.000Z'))).toBe(0);
  });

  it('is 0 for an unparseable phaseEndsAt, never NaN', () => {
    expect(countdownFraction('not-a-date', Date.now())).toBe(0);
  });

  it('is 0 once the deadline has passed, never negative', () => {
    const now = Date.parse('2026-01-01T00:01:00.000Z');
    const endsAt = '2026-01-01T00:00:30.000Z';
    expect(countdownFraction(endsAt, now)).toBe(0);
  });

  it('tracks the seconds-within-the-minute remainder, matching formatCountdown\'s own :SS half', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const endsAt = '2026-01-01T00:02:15.000Z';
    expect(formatCountdown(endsAt, now)).toBe('02:15');
    expect(countdownFraction(endsAt, now)).toBeCloseTo(15 / 60);
  });

  it('is always within [0, 1)', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    for (const endsAt of ['2026-01-01T00:00:59.000Z', '2026-01-01T00:05:00.000Z', '2026-01-01T00:00:00.000Z']) {
      const fraction = countdownFraction(endsAt, now);
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThan(1);
    }
  });
});
