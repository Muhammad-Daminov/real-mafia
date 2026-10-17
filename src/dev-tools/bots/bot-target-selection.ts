import { randomInt } from 'crypto';
import { RoleCode } from '@prisma/client';
import { shuffle, teamForRole } from '../../game-engine/roles';
import { NightAbilitySpec } from '../../game-engine/night-actions/role-abilities';

export interface RosterEntry {
  playerId: string;
  alive: boolean;
  roleCode: RoleCode;
}

/**
 * Pure mirror of `NightActionService.validateTargets`'s three rules
 * (alive, self-target, team-exclusion) — see that method
 * (../../game-engine/night-actions/night-action.service.ts) for the real
 * authority this only pre-selects a *candidate* for; the service itself
 * re-validates everything regardless, same as the frontend's own
 * `game/targetEligibility.ts` mirror (F4.1) does for the human UI.
 */
function isEligibleTarget(ability: NightAbilitySpec, selfPlayerId: string, candidate: RosterEntry): boolean {
  if (!candidate.alive) return false;
  if (candidate.playerId === selfPlayerId && !ability.allowSelfTarget) return false;
  if (ability.excludesTeam && teamForRole(candidate.roleCode) === ability.excludesTeam) return false;
  return true;
}

export interface NightTargetSelection {
  targetPlayerId: string;
  targetPlayerId2?: string;
}

/**
 * Picks a random VALID target (or pair, for Journalist's `INVESTIGATE_PAIR`)
 * from the full game roster — `null` when no eligible candidate exists
 * (e.g. every non-self alive player is excluded, or fewer than two alive
 * players remain for a pair-target ability). Uses `crypto.randomInt`/the
 * existing Fisher-Yates `shuffle` (../../game-engine/roles.ts), the same
 * fairness bar already applied to role dealing and room-code generation —
 * not because a dev bot's pick needs to be unbiased for any game-integrity
 * reason, but because reusing the one already-audited random-selection
 * primitive is simpler than inventing a second one.
 */
export function pickNightTargets(
  ability: NightAbilitySpec,
  selfPlayerId: string,
  roster: RosterEntry[],
): NightTargetSelection | null {
  const eligible = roster.filter((candidate) => isEligibleTarget(ability, selfPlayerId, candidate));

  if (!ability.pairTarget) {
    if (eligible.length === 0) return null;
    return { targetPlayerId: eligible[randomInt(eligible.length)]!.playerId };
  }

  if (eligible.length < 2) return null;
  const [first, second] = shuffle(eligible);
  return { targetPlayerId: first!.playerId, targetPlayerId2: second!.playerId };
}

/**
 * Picks a random vote target from every alive player — self included.
 * OD-045 (resolved, `VoteService.castVote`'s own docstring: "self-vote
 * allowed, so targetPlayerId === voter.id is a valid, ordinary case here")
 * allows voting for oneself, so a bot's candidate pool is never narrowed
 * to "everyone but me." There is no abstain action in `VoteService` (no
 * endpoint or target value means "no vote") — see OD-060 for why bots
 * therefore always cast a vote rather than ever abstaining.
 */
export function pickVoteTarget(aliveRoster: Pick<RosterEntry, 'playerId'>[]): string | null {
  if (aliveRoster.length === 0) return null;
  return aliveRoster[randomInt(aliveRoster.length)]!.playerId;
}
