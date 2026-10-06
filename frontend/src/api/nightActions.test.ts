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

describe('submitNightAction', () => {
  it('POSTs /games/:gameId/night-actions with a fresh clientRequestId and attaches the bearer token', async () => {
    const { submitNightAction } = await import('./nightActions');
    const { setToken } = await import('./client');
    setToken('jwt-abc');

    const body = {
      actionId: 'action-1',
      gameId: 'game-1',
      phaseId: 'phase-1',
      actionType: 'INVESTIGATE' as const,
      actionSlot: 0,
      targetPlayerId: 'player-2',
      targetPlayerId2: null,
    };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    const result = await submitNightAction('game-1', { actionType: 'INVESTIGATE', targetPlayerId: 'player-2' });

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/games/game-1/night-actions`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          clientRequestId: 'fixed-uuid-1',
          actionType: 'INVESTIGATE',
          targetPlayerId: 'player-2',
        }),
      }),
    );
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-abc');
    expect(result).toEqual(body);
  });

  it('includes targetPlayerId2 only when provided (Journalist pair-target)', async () => {
    const { submitNightAction } = await import('./nightActions');
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          actionId: 'a',
          gameId: 'g',
          phaseId: 'p',
          actionType: 'INVESTIGATE_PAIR',
          actionSlot: 0,
          targetPlayerId: 'p1',
          targetPlayerId2: 'p2',
        }),
        { status: 200 },
      ),
    );

    await submitNightAction('game-1', { actionType: 'INVESTIGATE_PAIR', targetPlayerId: 'p1', targetPlayerId2: 'p2' });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(init!.body as string)).toEqual({
      clientRequestId: 'fixed-uuid-1',
      actionType: 'INVESTIGATE_PAIR',
      targetPlayerId: 'p1',
      targetPlayerId2: 'p2',
    });
  });

  it('generates a new clientRequestId on every call', async () => {
    const randomUUID = vi.fn<() => string>().mockReturnValueOnce('uuid-a').mockReturnValueOnce('uuid-b');
    vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID });

    const { submitNightAction } = await import('./nightActions');
    const makeResponse = () =>
      new Response(
        JSON.stringify({
          actionId: 'a',
          gameId: 'g',
          phaseId: 'p',
          actionType: 'SHOOT',
          actionSlot: 0,
          targetPlayerId: 'p1',
          targetPlayerId2: null,
        }),
        { status: 200 },
      );
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse()).mockResolvedValueOnce(makeResponse());

    await submitNightAction('game-1', { actionType: 'SHOOT', targetPlayerId: 'p1' });
    await submitNightAction('game-1', { actionType: 'SHOOT', targetPlayerId: 'p1' });

    const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init!.body as string).clientRequestId);
    expect(bodies).toEqual(['uuid-a', 'uuid-b']);
  });

  it.each([
    ['GAME_NOT_IN_NIGHT_PHASE', 409],
    ['PLAYER_NOT_ALIVE', 409],
    ['ROLE_HAS_NO_SUCH_ACTION', 403],
    ['ABILITY_ALREADY_USED', 409],
    ['DOCTOR_REPEAT_PROTECTION', 409],
    ['INVALID_TARGET', 422],
  ])('surfaces a %s %i as ApiError.code/status', async (code, status) => {
    const { submitNightAction } = await import('./nightActions');
    const { ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code, message: 'nope' }), { status }),
    );

    await expect(submitNightAction('game-1', { actionType: 'SHOOT', targetPlayerId: 'p1' })).rejects.toMatchObject({
      code,
      status,
    });
    await expect(submitNightAction('game-1', { actionType: 'SHOOT', targetPlayerId: 'p1' })).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
