import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API_URL = 'http://localhost:3000';

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', API_URL);
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: vi.fn<() => string>(() => 'fixed-uuid-1') });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('submitVote', () => {
  it('POSTs /games/:gameId/votes with a fresh clientRequestId and attaches the bearer token', async () => {
    const { submitVote } = await import('./votes');
    const { setToken } = await import('./client');
    setToken('jwt-abc');

    const body = { voteId: 'v1', gameId: 'game-1', phaseId: 'phase-1', voterPlayerId: 'player-1', targetPlayerId: 'player-2' };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    const result = await submitVote('game-1', { targetPlayerId: 'player-2' });

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/games/game-1/votes`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ clientRequestId: 'fixed-uuid-1', targetPlayerId: 'player-2' }),
      }),
    );
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-abc');
    expect(result).toEqual(body);
  });

  it('allows targeting yourself (OD-045)', async () => {
    const { submitVote } = await import('./votes');
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ voteId: 'v1', gameId: 'g', phaseId: 'p', voterPlayerId: 'player-1', targetPlayerId: 'player-1' }),
        { status: 200 },
      ),
    );

    await submitVote('game-1', { targetPlayerId: 'player-1' });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(init!.body as string).targetPlayerId).toBe('player-1');
  });

  it('generates a new clientRequestId on every call (a re-vote is a real update, OD-020(b))', async () => {
    const randomUUID = vi.fn<() => string>().mockReturnValueOnce('uuid-a').mockReturnValueOnce('uuid-b');
    vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID });

    const { submitVote } = await import('./votes');
    const makeResponse = () =>
      new Response(
        JSON.stringify({ voteId: 'v', gameId: 'g', phaseId: 'p', voterPlayerId: 'player-1', targetPlayerId: 'player-2' }),
        { status: 200 },
      );
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse()).mockResolvedValueOnce(makeResponse());

    await submitVote('game-1', { targetPlayerId: 'player-2' });
    await submitVote('game-1', { targetPlayerId: 'player-3' });

    const ids = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init!.body as string).clientRequestId);
    expect(ids).toEqual(['uuid-a', 'uuid-b']);
  });

  it.each([
    ['GAME_NOT_FOUND', 404],
    ['GAME_NOT_IN_VOTING_PHASE', 409],
    ['PLAYER_NOT_ALIVE', 409],
    ['INVALID_TARGET', 422],
  ])('surfaces a %s %i as ApiError.code/status', async (code, status) => {
    const { submitVote } = await import('./votes');
    const { ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ code, message: 'nope' }), { status }));

    await expect(submitVote('game-1', { targetPlayerId: 'player-2' })).rejects.toMatchObject({ code, status });
    await expect(submitVote('game-1', { targetPlayerId: 'player-2' })).rejects.toBeInstanceOf(ApiError);
  });
});

describe('getVoteTally', () => {
  it('GETs /games/:gameId/votes and attaches the bearer token', async () => {
    const { getVoteTally } = await import('./votes');
    const { setToken } = await import('./client');
    setToken('jwt-abc');

    const body = [{ voterPlayerId: 'player-1', targetPlayerId: 'player-2' }];
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    const result = await getVoteTally('game-1');

    expect(fetch).toHaveBeenCalledWith(`${API_URL}/games/game-1/votes`, expect.anything());
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-abc');
    expect(result).toEqual(body);
  });

  it('surfaces a PLAYER_NOT_IN_GAME 404 as ApiError', async () => {
    const { getVoteTally } = await import('./votes');
    const { ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'PLAYER_NOT_IN_GAME', message: 'nope' }), { status: 404 }),
    );

    await expect(getVoteTally('game-1')).rejects.toBeInstanceOf(ApiError);
  });
});
