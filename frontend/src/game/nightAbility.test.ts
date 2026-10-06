import { describe, expect, it } from 'vitest';
import { abilitiesForRole, hasNightAction, primaryAbility, teamForRole } from './nightAbility';

describe('hasNightAction', () => {
  it('is false only for CIVILIAN', () => {
    expect(hasNightAction('CIVILIAN')).toBe(false);
  });

  it('is true for every other role the backend enum defines', () => {
    const acting = ['MAFIA', 'DON', 'DETECTIVE', 'SHERIFF', 'DOCTOR', 'BODYGUARD', 'MANIAC', 'JOURNALIST'] as const;
    for (const role of acting) {
      expect(hasNightAction(role)).toBe(true);
    }
  });
});

describe('primaryAbility', () => {
  it('is null for CIVILIAN', () => {
    expect(primaryAbility('CIVILIAN')).toBeNull();
  });

  it("is Don's KILL, not its secondary CHECK", () => {
    expect(primaryAbility('DON')?.actionType).toBe('KILL');
  });

  it.each([
    ['DETECTIVE', 'INVESTIGATE'],
    ['SHERIFF', 'SHOOT'],
    ['DOCTOR', 'PROTECT'],
    ['BODYGUARD', 'GUARD'],
    ['JOURNALIST', 'INVESTIGATE_PAIR'],
    ['MAFIA', 'KILL'],
    ['MANIAC', 'KILL'],
  ] as const)('%s primary ability is %s', (role, actionType) => {
    expect(primaryAbility(role)?.actionType).toBe(actionType);
  });
});

describe('abilitiesForRole', () => {
  it('Don has two abilities: primary KILL and secondary CHECK', () => {
    const abilities = abilitiesForRole('DON');
    expect(abilities).toHaveLength(2);
    expect(abilities.find((a) => a.actionType === 'KILL')?.primary).toBe(true);
    expect(abilities.find((a) => a.actionType === 'CHECK')?.primary).toBe(false);
  });

  it("Doctor's PROTECT allows self-target; every other ability does not", () => {
    expect(abilitiesForRole('DOCTOR')[0]!.allowSelfTarget).toBe(true);
    expect(abilitiesForRole('DETECTIVE')[0]!.allowSelfTarget).toBe(false);
    expect(abilitiesForRole('MANIAC')[0]!.allowSelfTarget).toBe(false);
  });

  it("Journalist's INVESTIGATE_PAIR is the only pair-target ability", () => {
    expect(abilitiesForRole('JOURNALIST')[0]!.pairTarget).toBe(true);
    expect(abilitiesForRole('DETECTIVE')[0]!.pairTarget).toBe(false);
  });

  it("MAFIA/DON's KILL and DON's CHECK exclude MAFIA-team targets; MANIAC's KILL does not", () => {
    expect(abilitiesForRole('MAFIA')[0]!.excludesTeam).toBe('MAFIA');
    expect(abilitiesForRole('DON').find((a) => a.actionType === 'KILL')!.excludesTeam).toBe('MAFIA');
    expect(abilitiesForRole('DON').find((a) => a.actionType === 'CHECK')!.excludesTeam).toBe('MAFIA');
    expect(abilitiesForRole('MANIAC')[0]!.excludesTeam).toBeUndefined();
  });
});

describe('teamForRole', () => {
  it.each([
    ['CIVILIAN', 'TOWN'],
    ['DETECTIVE', 'TOWN'],
    ['SHERIFF', 'TOWN'],
    ['DOCTOR', 'TOWN'],
    ['BODYGUARD', 'TOWN'],
    ['JOURNALIST', 'TOWN'],
    ['MAFIA', 'MAFIA'],
    ['DON', 'MAFIA'],
    ['MANIAC', 'NEUTRAL'],
  ] as const)('%s is %s', (role, team) => {
    expect(teamForRole(role)).toBe(team);
  });
});
