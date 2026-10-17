import { RoleCode } from '@prisma/client';
import { primaryAbility } from '../../game-engine/night-actions/role-abilities';
import { pickNightTargets, pickVoteTarget, type RosterEntry } from './bot-target-selection';

function roster(overrides: Partial<RosterEntry>[] = []): RosterEntry[] {
  const base: RosterEntry[] = [
    { playerId: 'me', alive: true, roleCode: RoleCode.MAFIA },
    { playerId: 'teammate', alive: true, roleCode: RoleCode.DON },
    { playerId: 'town-alive', alive: true, roleCode: RoleCode.CIVILIAN },
    { playerId: 'town-dead', alive: false, roleCode: RoleCode.CIVILIAN },
  ];
  return [...base, ...(overrides as RosterEntry[])];
}

describe('pickNightTargets', () => {
  it('never picks a dead player', () => {
    const ability = primaryAbility(RoleCode.DETECTIVE)!;
    for (let i = 0; i < 20; i++) {
      const pick = pickNightTargets(ability, 'town-alive', roster());
      expect(pick).not.toBeNull();
      expect(pick!.targetPlayerId).not.toBe('town-dead');
    }
  });

  it('never picks self when the ability disallows self-target (Detective)', () => {
    const ability = primaryAbility(RoleCode.DETECTIVE)!;
    for (let i = 0; i < 20; i++) {
      const pick = pickNightTargets(ability, 'town-alive', roster());
      expect(pick!.targetPlayerId).not.toBe('town-alive');
    }
  });

  it("may pick self when the ability allows it (Doctor's PROTECT)", () => {
    const ability = primaryAbility(RoleCode.DOCTOR)!;
    const picks = new Set<string>();
    for (let i = 0; i < 50; i++) {
      picks.add(pickNightTargets(ability, 'town-alive', roster())!.targetPlayerId);
    }
    expect(picks.has('town-alive')).toBe(true);
  });

  it("never picks a known MAFIA-team member for MAFIA's KILL (excludesTeam)", () => {
    const ability = primaryAbility(RoleCode.MAFIA)!;
    for (let i = 0; i < 20; i++) {
      const pick = pickNightTargets(ability, 'me', roster());
      expect(pick!.targetPlayerId).not.toBe('teammate');
      expect(pick!.targetPlayerId).not.toBe('me');
    }
  });

  it("Maniac's KILL has no team exclusion — a mafia-team player is a valid pick", () => {
    const ability = primaryAbility(RoleCode.MANIAC)!;
    const picks = new Set<string>();
    for (let i = 0; i < 50; i++) {
      picks.add(pickNightTargets(ability, 'town-alive', roster())!.targetPlayerId);
    }
    expect(picks.has('teammate')).toBe(true);
  });

  it('returns null when no eligible target exists', () => {
    const ability = primaryAbility(RoleCode.DETECTIVE)!;
    const onlySelfAlive: RosterEntry[] = [{ playerId: 'me', alive: true, roleCode: RoleCode.DETECTIVE }];
    expect(pickNightTargets(ability, 'me', onlySelfAlive)).toBeNull();
  });

  it("Journalist's INVESTIGATE_PAIR returns two distinct eligible targets", () => {
    const ability = primaryAbility(RoleCode.JOURNALIST)!;
    for (let i = 0; i < 20; i++) {
      const pick = pickNightTargets(ability, 'me', roster());
      expect(pick).not.toBeNull();
      expect(pick!.targetPlayerId2).toBeDefined();
      expect(pick!.targetPlayerId).not.toBe(pick!.targetPlayerId2);
      expect(pick!.targetPlayerId).not.toBe('town-dead');
      expect(pick!.targetPlayerId2).not.toBe('town-dead');
    }
  });

  it('returns null for a pair-target ability with fewer than two eligible candidates', () => {
    const ability = primaryAbility(RoleCode.JOURNALIST)!;
    const onlyOneEligible: RosterEntry[] = [
      { playerId: 'me', alive: true, roleCode: RoleCode.JOURNALIST },
      { playerId: 'only-other', alive: true, roleCode: RoleCode.CIVILIAN },
    ];
    // Journalist disallows self-target, so only one eligible candidate remains.
    expect(pickNightTargets(ability, 'me', onlyOneEligible)).toBeNull();
  });
});

describe('pickVoteTarget', () => {
  it('may pick self — OD-045 allows self-vote', () => {
    const alive = [{ playerId: 'me' }];
    expect(pickVoteTarget(alive)).toBe('me');
  });

  it('returns null for an empty roster', () => {
    expect(pickVoteTarget([])).toBeNull();
  });

  it('picks only from the given roster', () => {
    const alive = [{ playerId: 'a' }, { playerId: 'b' }, { playerId: 'c' }];
    for (let i = 0; i < 30; i++) {
      expect(['a', 'b', 'c']).toContain(pickVoteTarget(alive));
    }
  });
});
