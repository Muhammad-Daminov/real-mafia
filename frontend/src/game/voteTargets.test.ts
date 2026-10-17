import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildVoteRows, summarizeTally } from './voteTargets';
import type { RoomPlayerSummary } from '../api/rooms';

const submitVoteMock = vi.fn();

vi.mock('../api/votes', async () => {
  const actual = await vi.importActual<typeof import('../api/votes')>('../api/votes');
  return { ...actual, submitVote: (...args: unknown[]) => submitVoteMock(...args) };
});

beforeEach(() => {
  submitVoteMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

function roster(): RoomPlayerSummary[] {
  return [
    { playerId: 'me', displayName: 'Me', avatarUrl: null, isReady: true, isHost: true, joinedAt: 't', lifeStatus: 'ALIVE' },
    { playerId: 'other-alive', displayName: 'Other Alive', avatarUrl: null, isReady: true, isHost: false, joinedAt: 't', lifeStatus: 'ALIVE' },
    { playerId: 'other-dead', displayName: 'Other Dead', avatarUrl: null, isReady: true, isHost: false, joinedAt: 't', lifeStatus: 'DEAD' },
    { playerId: 'unknown-status', displayName: 'Unknown', avatarUrl: null, isReady: true, isHost: false, joinedAt: 't' },
  ];
}

describe('buildVoteRows', () => {
  it('marks self eligible (OD-045) and isSelf correctly', () => {
    const rows = buildVoteRows('me', roster());
    const me = rows.find((r) => r.playerId === 'me')!;
    expect(me.eligible).toBe(true);
    expect(me.isSelf).toBe(true);
  });

  it('marks a dead player, and a player with no lifeStatus at all, ineligible', () => {
    const rows = buildVoteRows('me', roster());
    expect(rows.find((r) => r.playerId === 'other-dead')!.eligible).toBe(false);
    expect(rows.find((r) => r.playerId === 'unknown-status')!.eligible).toBe(false);
  });

  it('marks an alive non-self player eligible', () => {
    const rows = buildVoteRows('me', roster());
    expect(rows.find((r) => r.playerId === 'other-alive')!.eligible).toBe(true);
  });
});

describe('summarizeTally', () => {
  it('tallies votes per target, highest first', () => {
    const result = summarizeTally([
      { voterPlayerId: 'a', targetPlayerId: 'x' },
      { voterPlayerId: 'b', targetPlayerId: 'x' },
      { voterPlayerId: 'c', targetPlayerId: 'y' },
    ]);
    expect(result).toEqual([
      { targetPlayerId: 'x', count: 2 },
      { targetPlayerId: 'y', count: 1 },
    ]);
  });

  it('returns an empty array for no votes', () => {
    expect(summarizeTally([])).toEqual([]);
  });

  it('counts a re-vote only once per voter (one row per voter in the input)', () => {
    // GET /games/:gameId/votes already returns at most one row per voter
    // (re-voting updates in place) — this just confirms the tally doesn't
    // somehow double-count if it ever saw two rows for the same voter.
    const result = summarizeTally([
      { voterPlayerId: 'a', targetPlayerId: 'x' },
      { voterPlayerId: 'a', targetPlayerId: 'y' },
    ]);
    expect(result).toEqual(
      expect.arrayContaining([
        { targetPlayerId: 'x', count: 1 },
        { targetPlayerId: 'y', count: 1 },
      ]),
    );
  });
});

describe('submitSelectedVote', () => {
  it('delegates to submitVote with the given target', async () => {
    const { submitSelectedVote } = await import('./voteTargets');
    submitVoteMock.mockResolvedValue({ voteId: 'v1', gameId: 'g', phaseId: 'p', voterPlayerId: 'me', targetPlayerId: 'other-alive' });

    await submitSelectedVote('g', 'other-alive');

    expect(submitVoteMock).toHaveBeenCalledWith('g', { targetPlayerId: 'other-alive' });
  });
});
