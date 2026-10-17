import type { RoomPlayerSummary } from '../api/rooms';
import { submitVote, type CastVoteResponse, type VoteTallyEntry } from '../api/votes';
import { evaluateVoteTarget } from './voteEligibility';
import { isAlivePlayer } from './nightTargets';

export interface VoteRow {
  playerId: string;
  displayName: string;
  isSelf: boolean;
  eligible: boolean;
}

/** Builds one row per roster entry for the day-vote picker — every alive
 * player, including self (OD-045), is eligible. Reuses `nightTargets.ts`'s
 * `isAlivePlayer` (same optional-tolerant "unrecognized = not alive"
 * rule) rather than duplicating it. */
export function buildVoteRows(myPlayerId: string, roster: RoomPlayerSummary[]): VoteRow[] {
  return roster.map((player) => {
    const result = evaluateVoteTarget({ playerId: player.playerId, alive: isAlivePlayer(player) });
    return {
      playerId: player.playerId,
      displayName: player.displayName,
      isSelf: player.playerId === myPlayerId,
      eligible: result.eligible,
    };
  });
}

export function submitSelectedVote(gameId: string, targetPlayerId: string): Promise<CastVoteResponse> {
  return submitVote(gameId, { targetPlayerId });
}

export interface TallyCount {
  targetPlayerId: string;
  count: number;
}

/** `GET /games/:gameId/votes` returns one row per voter, not pre-aggregated
 * counts (`api/votes.ts`'s `VoteTallyEntry[]`) — this tallies them
 * client-side for the live-count display, highest first. */
export function summarizeTally(tally: VoteTallyEntry[]): TallyCount[] {
  const counts = new Map<string, number>();
  for (const vote of tally) {
    counts.set(vote.targetPlayerId, (counts.get(vote.targetPlayerId) ?? 0) + 1);
  }
  return [...counts.entries()].map(([targetPlayerId, count]) => ({ targetPlayerId, count })).sort((a, b) => b.count - a.count);
}
