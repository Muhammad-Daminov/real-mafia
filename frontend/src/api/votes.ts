import { apiFetch } from './client';

export interface SubmitVoteRequest {
  targetPlayerId: string;
}

/**
 * `VoteService.CastVoteResponse` (../../../src/game-engine/voting/vote.service.ts)
 * — returned verbatim by `POST /games/:gameId/votes`, no wrapper.
 */
export interface CastVoteResponse {
  voteId: string;
  gameId: string;
  phaseId: string;
  voterPlayerId: string;
  targetPlayerId: string;
}

/**
 * `VoteService.VoteTallyEntry` — every current-round vote, not just the
 * caller's own (OD-020(a): day-vote tallies are PUBLIC in real time, unlike
 * night actions' self-only read). One entry per voter; re-voting updates
 * that voter's existing entry in place rather than adding a second one.
 */
export interface VoteTallyEntry {
  voterPlayerId: string;
  targetPlayerId: string;
}

/**
 * `POST /games/:gameId/votes` (`CastVoteDto`/`VoteService.castVote`) —
 * `clientRequestId` is a fresh `crypto.randomUUID()` per call, same
 * idempotency convention every other state-changing call in this frontend
 * uses. OD-020(b): changing a vote before the deadline is a real update
 * (new `clientRequestId`, same mechanism as night actions' OD-028), not a
 * replay. OD-045: `targetPlayerId` may equal the caller's own player id —
 * self-vote is allowed by the backend, never rejected client-side either.
 * Every 4xx (`VoteErrorCode`,
 * ../../../src/game-engine/voting/vote.errors.ts) surfaces as
 * `ApiError.code`, same mechanism every other authenticated call uses.
 */
export function submitVote(gameId: string, request: SubmitVoteRequest): Promise<CastVoteResponse> {
  return apiFetch<CastVoteResponse>(`/games/${encodeURIComponent(gameId)}/votes`, {
    method: 'POST',
    body: JSON.stringify({ clientRequestId: crypto.randomUUID(), targetPlayerId: request.targetPlayerId }),
  });
}

/**
 * `GET /games/:gameId/votes` (`VoteService.getCurrentTally`) — every vote
 * cast for the game's *current* active phase (empty outside VOTING, since
 * no `GameVote` rows exist for any other phase). Membership in the game is
 * required to call it at all, but the payload itself is never filtered
 * down to the caller's own vote.
 */
export function getVoteTally(gameId: string): Promise<VoteTallyEntry[]> {
  return apiFetch<VoteTallyEntry[]>(`/games/${encodeURIComponent(gameId)}/votes`);
}
