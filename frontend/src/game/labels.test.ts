import { describe, expect, it } from 'vitest';
import { phaseLabel, roleInfo, teamLabel } from './labels';
import { uz } from '../messages/uz';

describe('phaseLabel', () => {
  it('returns the uz label for every phase the backend enum defines', () => {
    const phases = [
      'LOBBY',
      'ROLE_REVEAL',
      'NIGHT',
      'NIGHT_RESOLUTION',
      'MORNING',
      'DISCUSSION',
      'VOTING',
      'VOTE_RESOLUTION',
      'LAST_WORD',
      'EXECUTION',
      'WIN_CHECK',
      'GAME_OVER',
    ] as const;

    for (const phase of phases) {
      expect(phaseLabel(phase)).toBe(uz.phases[phase]);
      expect(phaseLabel(phase)).not.toBe(uz.phases.unknown);
    }
  });

  it('falls back to the unknown label for an unrecognized phase', () => {
    expect(phaseLabel('SOME_FUTURE_PHASE')).toBe(uz.phases.unknown);
  });
});

describe('roleInfo', () => {
  it('returns a name + ability for every role the backend enum defines', () => {
    const roles = [
      'MAFIA',
      'DON',
      'DETECTIVE',
      'SHERIFF',
      'DOCTOR',
      'BODYGUARD',
      'MANIAC',
      'JOURNALIST',
      'CIVILIAN',
    ] as const;

    for (const role of roles) {
      const info = roleInfo(role);
      expect(info.name).toBe(uz.roles[role].name);
      expect(info.ability.length).toBeGreaterThan(0);
    }
  });

  it('falls back to the unknown role entry for an unrecognized code', () => {
    expect(roleInfo('SOME_FUTURE_ROLE')).toEqual(uz.roles.unknown);
  });
});

describe('teamLabel', () => {
  it('returns the uz label for every known team', () => {
    expect(teamLabel('TOWN')).toBe(uz.teams.TOWN);
    expect(teamLabel('MAFIA')).toBe(uz.teams.MAFIA);
    expect(teamLabel('NEUTRAL')).toBe(uz.teams.NEUTRAL);
  });

  it('falls back to the raw value for an unrecognized team', () => {
    expect(teamLabel('SOME_FUTURE_TEAM')).toBe('SOME_FUTURE_TEAM');
  });
});
