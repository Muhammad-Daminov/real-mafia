import { describe, expect, it } from 'vitest';
import { resolveNightScreenState } from './NightScreen';

describe('resolveNightScreenState', () => {
  it('is "dead" for a DEAD player, regardless of role', () => {
    expect(resolveNightScreenState('DEAD', 'SHERIFF')).toBe('dead');
    expect(resolveNightScreenState('DEAD', 'CIVILIAN')).toBe('dead');
  });

  it('is "dead" for a LEFT player', () => {
    expect(resolveNightScreenState('LEFT', 'DETECTIVE')).toBe('dead');
  });

  it('is "sleeping" for an alive CIVILIAN (no night action)', () => {
    expect(resolveNightScreenState('ALIVE', 'CIVILIAN')).toBe('sleeping');
  });

  it('is "sleeping" when the role is not yet known (null)', () => {
    expect(resolveNightScreenState('ALIVE', null)).toBe('sleeping');
  });

  it('is "sleeping" for an unrecognized role code (safe fallback)', () => {
    expect(resolveNightScreenState('ALIVE', 'SOME_FUTURE_ROLE' as never)).toBe('sleeping');
  });

  it('is "acting" for every alive role that has a night action', () => {
    const acting = ['MAFIA', 'DON', 'DETECTIVE', 'SHERIFF', 'DOCTOR', 'BODYGUARD', 'MANIAC', 'JOURNALIST'] as const;
    for (const role of acting) {
      expect(resolveNightScreenState('ALIVE', role)).toBe('acting');
    }
  });

  it('never misrenders as "dead" when myLifeStatus has not loaded yet (null)', () => {
    expect(resolveNightScreenState(null, 'SHERIFF')).toBe('acting');
  });
});
