import { describe, expect, it } from 'vitest';
import { resolvePersonalOutcome } from './GameEndScreen';

describe('resolvePersonalOutcome', () => {
  it('is true when myTeam matches the winning team', () => {
    expect(resolvePersonalOutcome('TOWN', 'TOWN')).toBe(true);
    expect(resolvePersonalOutcome('MAFIA', 'MAFIA')).toBe(true);
    expect(resolvePersonalOutcome('NEUTRAL', 'NEUTRAL')).toBe(true);
  });

  it('is false when myTeam does not match the winning team', () => {
    expect(resolvePersonalOutcome('TOWN', 'MAFIA')).toBe(false);
    expect(resolvePersonalOutcome('MAFIA', 'NEUTRAL')).toBe(false);
  });

  it('is null for a DRAW — no team "won"', () => {
    expect(resolvePersonalOutcome('TOWN', 'DRAW')).toBeNull();
  });

  it('is null when the result is not known yet (OD-F5-001 reload gap)', () => {
    expect(resolvePersonalOutcome('TOWN', null)).toBeNull();
  });

  it('is null when myTeam itself is not known', () => {
    expect(resolvePersonalOutcome(null, 'TOWN')).toBeNull();
  });

  it('covers every Team x WinnerTeam combination the backend defines (F5.1)', () => {
    const teams = ['TOWN', 'MAFIA', 'NEUTRAL'] as const;
    const winnerTeams = ['TOWN', 'MAFIA', 'NEUTRAL', 'DRAW'] as const;

    for (const myTeam of teams) {
      for (const winnerTeam of winnerTeams) {
        const outcome = resolvePersonalOutcome(myTeam, winnerTeam);
        if (winnerTeam === 'DRAW') {
          expect(outcome).toBeNull();
        } else {
          expect(outcome).toBe(myTeam === winnerTeam);
        }
      }
    }
  });

  it('F5.1: an unrecognized winnerTeam string never crashes and never guesses a win', () => {
    expect(resolvePersonalOutcome('TOWN', 'SOME_FUTURE_TEAM' as never)).toBe(false);
  });
});
