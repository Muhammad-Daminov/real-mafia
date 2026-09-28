export interface CastVoteRecord {
  voterPlayerId: string;
  targetPlayerId: string;
}

export interface VoteResolutionOutcome {
  /** null when no execution occurs this round (no votes cast, or a tie for the top spot — OD-018). */
  executionTarget: string | null;
}

/**
 * §16/OD-018 (verbatim): "on a tie for highest vote count, no execution
 * occurs this round; resolution proceeds directly to WIN_CHECK then NIGHT
 * (round+1). No revote, no random tiebreak." Plurality otherwise — the
 * single target with strictly more votes than every other target is
 * executed; there is no minimum-participation/majority threshold stated
 * anywhere in §16, so one vote for an otherwise-unvoted target is enough to
 * win outright once nobody else ties it.
 *
 * Pure function — no I/O, no wall-clock, same determinism bar as
 * `resolveNightActions` (§17.4). `VoteResolutionService` owns reading the
 * round's `GameVote` rows and writing the outcome back; this function only
 * decides *who*, if anyone, is executed.
 */
export function resolveVotes(votes: CastVoteRecord[]): VoteResolutionOutcome {
  if (votes.length === 0) {
    return { executionTarget: null };
  }

  const tally = new Map<string, number>();
  for (const vote of votes) {
    tally.set(vote.targetPlayerId, (tally.get(vote.targetPlayerId) ?? 0) + 1);
  }

  const maxVotes = Math.max(...tally.values());
  const topTargets = [...tally.entries()].filter(([, count]) => count === maxVotes);

  if (topTargets.length !== 1) {
    return { executionTarget: null }; // OD-018: a tie for the top spot executes nobody.
  }

  return { executionTarget: topTargets[0][0] };
}
