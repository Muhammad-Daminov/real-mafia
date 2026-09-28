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

describe('createRoom', () => {
  it('POSTs /rooms with a fresh clientRequestId, maxPlayers, and rulesetMode, and attaches the bearer token', async () => {
    const { createRoom } = await import('./rooms');
    const { setToken } = await import('./client');
    setToken('jwt-abc');

    const body: import('./rooms').CreatedRoom = {
      roomId: 'room-1',
      code: 'ABCDEF',
      gameId: 'game-1',
      maxPlayers: 8,
      rulesetMode: 'NORMAL',
      visibility: 'PRIVATE',
    };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 201 }));

    const result = await createRoom({ maxPlayers: 8, rulesetMode: 'NORMAL' });

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/rooms`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          clientRequestId: 'fixed-uuid-1',
          maxPlayers: 8,
          rulesetMode: 'NORMAL',
        }),
      }),
    );
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-abc');
    expect(result).toEqual(body);
  });

  it('generates a new clientRequestId on every call', async () => {
    const randomUUID = vi.fn<() => string>().mockReturnValueOnce('uuid-a').mockReturnValueOnce('uuid-b');
    vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID });

    const { createRoom } = await import('./rooms');
    const makeResponse = () =>
      new Response(
        JSON.stringify({ roomId: 'r', code: 'C', gameId: 'g', maxPlayers: 8, rulesetMode: 'NORMAL', visibility: 'PRIVATE' }),
        { status: 201 },
      );
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(makeResponse()));

    await createRoom({ maxPlayers: 8, rulesetMode: 'NORMAL' });
    await createRoom({ maxPlayers: 8, rulesetMode: 'NORMAL' });

    const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init?.body as string).clientRequestId);
    expect(bodies).toEqual(['uuid-a', 'uuid-b']);
  });

  it('throws ApiError with the RoomException {code, message} shape on failure', async () => {
    const { createRoom } = await import('./rooms');
    const { ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'CONFIG_INVALID', message: 'maxPlayers out of range' }), {
        status: 422,
      }),
    );

    await expect(createRoom({ maxPlayers: 99, rulesetMode: 'NORMAL' })).rejects.toMatchObject(
      new ApiError('maxPlayers out of range', 422, 'CONFIG_INVALID'),
    );
  });
});
