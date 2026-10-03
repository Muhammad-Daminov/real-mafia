import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API_URL = 'http://localhost:3000';

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', API_URL);
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('fillBots', () => {
  it('POSTs /dev/rooms/:code/fill-bots with {count, ready} and attaches the bearer token', async () => {
    const { fillBots } = await import('./devTools');
    const { setToken } = await import('./client');
    setToken('jwt-abc');

    const body: import('./rooms').RoomSummary = {
      roomId: 'room-1',
      code: 'ABCDEF',
      visibility: 'PRIVATE',
      status: 'OPEN',
      rulesetMode: 'NORMAL',
      maxPlayers: 8,
      gameId: 'game-1',
      gameStatus: 'LOBBY',
      playerCount: 4,
      players: [
        { playerId: 'p1', displayName: 'Host', avatarUrl: null, isReady: false, isHost: true, joinedAt: 't' },
        { playerId: 'p2', displayName: 'Bot 2', avatarUrl: null, isReady: true, isHost: false, joinedAt: 't' },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 201 }));

    const result = await fillBots('ABCDEF', 3, true);

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/dev/rooms/ABCDEF/fill-bots`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ count: 3, ready: true }),
      }),
    );
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-abc');
    expect(result).toEqual(body);
  });

  it('URL-encodes the code into the path', async () => {
    const { fillBots } = await import('./devTools');
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          roomId: 'r',
          code: 'AB CD',
          visibility: 'PRIVATE',
          status: 'OPEN',
          rulesetMode: 'NORMAL',
          maxPlayers: 8,
          gameId: 'g',
          gameStatus: 'LOBBY',
          playerCount: 1,
        }),
        { status: 200 },
      ),
    );

    await fillBots('AB CD/EF', 1, false);

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${API_URL}/dev/rooms/${encodeURIComponent('AB CD/EF')}/fill-bots`);
  });

  it('throws ApiError(404) when dev tools are disabled on the backend (route not registered)', async () => {
    const { fillBots } = await import('./devTools');
    const { ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 404, message: 'Cannot POST /dev/rooms/ABCDEF/fill-bots' }), {
        status: 404,
      }),
    );

    await expect(fillBots('ABCDEF', 3, false)).rejects.toMatchObject(
      new ApiError('Cannot POST /dev/rooms/ABCDEF/fill-bots', 404),
    );
  });

  it('throws ApiError(403) for a caller who is not an active member of the room', async () => {
    const { fillBots } = await import('./devTools');
    const { ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Siz bu xonaning aʻzosi emassiz' }), { status: 403 }),
    );

    await expect(fillBots('ABCDEF', 3, false)).rejects.toMatchObject(
      new ApiError('Siz bu xonaning aʻzosi emassiz', 403),
    );
  });
});
