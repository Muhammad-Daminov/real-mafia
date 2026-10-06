import { describe, expect, it } from 'vitest';
import { eligibleTargetIds, evaluateTarget } from './targetEligibility';
import { primaryAbility } from './nightAbility';

describe('evaluateTarget', () => {
  it('rejects self-target for a role that disallows it (Detective)', () => {
    const ability = primaryAbility('DETECTIVE')!;
    const result = evaluateTarget(ability, 'me', { playerId: 'me', alive: true });
    expect(result).toEqual({ eligible: false, reason: 'SELF' });
  });

  it("allows self-target for Doctor's PROTECT", () => {
    const ability = primaryAbility('DOCTOR')!;
    const result = evaluateTarget(ability, 'me', { playerId: 'me', alive: true });
    expect(result).toEqual({ eligible: true, reason: null });
  });

  it('rejects a dead candidate regardless of role', () => {
    const ability = primaryAbility('SHERIFF')!;
    const result = evaluateTarget(ability, 'me', { playerId: 'other', alive: false });
    expect(result).toEqual({ eligible: false, reason: 'DEAD' });
  });

  it("excludes a known-MAFIA-team candidate for MAFIA's KILL", () => {
    const ability = primaryAbility('MAFIA')!;
    const result = evaluateTarget(ability, 'me', { playerId: 'other', alive: true, roleCode: 'DON' });
    expect(result).toEqual({ eligible: false, reason: 'EXCLUDED_TEAM' });
  });

  it("does not exclude a MAFIA-team candidate for Maniac's KILL (no excludesTeam)", () => {
    const ability = primaryAbility('MANIAC')!;
    const result = evaluateTarget(ability, 'me', { playerId: 'other', alive: true, roleCode: 'DON' });
    expect(result).toEqual({ eligible: true, reason: null });
  });

  it('does not exclude a candidate by team when the candidate role is unknown (non-teammate)', () => {
    const ability = primaryAbility('MAFIA')!;
    const result = evaluateTarget(ability, 'me', { playerId: 'other', alive: true });
    expect(result).toEqual({ eligible: true, reason: null });
  });

  it('a plain town-role candidate is eligible for Detective', () => {
    const ability = primaryAbility('DETECTIVE')!;
    const result = evaluateTarget(ability, 'me', { playerId: 'other', alive: true });
    expect(result).toEqual({ eligible: true, reason: null });
  });
});

describe('eligibleTargetIds', () => {
  it('filters a roster down to only the eligible ids', () => {
    const ability = primaryAbility('MAFIA')!;
    const roster = [
      { playerId: 'me', alive: true },
      { playerId: 'teammate', alive: true, roleCode: 'DON' as const },
      { playerId: 'dead-town', alive: false },
      { playerId: 'alive-town', alive: true },
    ];

    expect(eligibleTargetIds(ability, 'me', roster)).toEqual(['alive-town']);
  });
});
