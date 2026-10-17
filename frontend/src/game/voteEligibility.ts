/**
 * Pure mirror of `VoteService.castVote`'s only real target rule — alive
 * only. Unlike night actions, there is no self-target restriction (OD-045:
 * self-vote is explicitly allowed) and no team-exclusion concept at all in
 * `VoteService` — every alive player, including the caller, is a valid
 * vote target.
 */
export interface VoteRosterCandidate {
  playerId: string;
  alive: boolean;
}

export type VoteIneligibleReason = 'DEAD';

export interface VoteEligibility {
  eligible: boolean;
  reason: VoteIneligibleReason | null;
}

export function evaluateVoteTarget(candidate: VoteRosterCandidate): VoteEligibility {
  if (!candidate.alive) {
    return { eligible: false, reason: 'DEAD' };
  }
  return { eligible: true, reason: null };
}
