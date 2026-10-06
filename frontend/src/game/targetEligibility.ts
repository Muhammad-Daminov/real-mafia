import type { RoleCode } from '../api/games';
import { teamForRole, type NightAbilitySpec } from './nightAbility';

/**
 * Pure mirror of `NightActionService.validateTargets`'s three client-
 * checkable rules (self-target, alive, team-exclusion) — see that method
 * (../../../src/game-engine/night-actions/night-action.service.ts) for the
 * server-side authority this only pre-empts for UI purposes; the backend
 * re-validates everything regardless.
 *
 * Deliberately NOT wired to any live roster in this slice — OD-F4-001
 * (frontend/docs/OPEN_DECISIONS.md) found no endpoint that exposes a game
 * member's alive-status alongside their display name, so there is no real
 * `RosterCandidate[]` to evaluate at runtime yet. This helper exists ready
 * to wire in once that gap closes; tested here against synthetic rosters
 * only.
 */
export interface RosterCandidate {
  playerId: string;
  alive: boolean;
  /** Known only for the caller's own teammates (gameStore's `teammates`,
   * OD-025) or self — `undefined` for every other player, since no role
   * other than one's own/one's mafia teammates' is ever exposed client-side. */
  roleCode?: RoleCode;
}

export type IneligibleReason = 'SELF' | 'DEAD' | 'EXCLUDED_TEAM';

export interface TargetEligibility {
  eligible: boolean;
  reason: IneligibleReason | null;
}

export function evaluateTarget(
  ability: NightAbilitySpec,
  selfPlayerId: string,
  candidate: RosterCandidate,
): TargetEligibility {
  if (candidate.playerId === selfPlayerId && !ability.allowSelfTarget) {
    return { eligible: false, reason: 'SELF' };
  }

  if (!candidate.alive) {
    return { eligible: false, reason: 'DEAD' };
  }

  if (ability.excludesTeam && candidate.roleCode && teamForRole(candidate.roleCode) === ability.excludesTeam) {
    return { eligible: false, reason: 'EXCLUDED_TEAM' };
  }

  return { eligible: true, reason: null };
}

/** Convenience batch form — filters a roster down to just the eligible ids. */
export function eligibleTargetIds(ability: NightAbilitySpec, selfPlayerId: string, roster: RosterCandidate[]): string[] {
  return roster.filter((c) => evaluateTarget(ability, selfPlayerId, c).eligible).map((c) => c.playerId);
}
