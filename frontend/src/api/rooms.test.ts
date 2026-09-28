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

describe('joinRoom', () => {
  it('POSTs /rooms/:code/join with the code as a route param (not body) and a fresh clientRequestId, attaching the bearer token', async () => {
    const { joinRoom } = await import('./rooms');
    const { setToken } = await import('./client');
    setToken('jwt-abc');

    const body: import('./rooms').JoinedRoom = {
      roomId: 'room-2',
      gameId: 'game-2',
      playerId: 'player-2',
      playerCount: 2,
      maxPlayers: 8,
    };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    const result = await joinRoom('ABCDEF');

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/rooms/ABCDEF/join`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ clientRequestId: 'fixed-uuid-1' }),
      }),
    );
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-abc');
    expect(result).toEqual(body);
  });

  it('URL-encodes the code into the path', async () => {
    const { joinRoom } = await import('./rooms');
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ roomId: 'r', gameId: 'g', playerId: 'p', playerCount: 1, maxPlayers: 8 }),
        { status: 200 },
      ),
    );

    await joinRoom('AB CD/EF');

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${API_URL}/rooms/${encodeURIComponent('AB CD/EF')}/join`);
  });

  it('generates a new clientRequestId on every call', async () => {
    const randomUUID = vi.fn<() => string>().mockReturnValueOnce('uuid-a').mockReturnValueOnce('uuid-b');
    vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID });

    const { joinRoom } = await import('./rooms');
    const makeResponse = () =>
      new Response(
        JSON.stringify({ roomId: 'r', gameId: 'g', playerId: 'p', playerCount: 1, maxPlayers: 8 }),
        { status: 200 },
      );
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(makeResponse()));

    await joinRoom('CODE1');
    await joinRoom('CODE1');

    const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init?.body as string).clientRequestId);
    expect(bodies).toEqual(['uuid-a', 'uuid-b']);
  });

  it('throws ApiError with status + backend error code on a join failure (e.g. GAME_FULL)', async () => {
    const { joinRoom } = await import('./rooms');
    const { ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'GAME_FULL', message: 'Room is full' }), { status: 409 }),
    );

    await expect(joinRoom('FULL01')).rejects.toMatchObject(new ApiError('Room is full', 409, 'GAME_FULL'));
  });

  it('throws ApiError with status + backend error code for a nonexistent room (ROOM_NOT_FOUND)', async () => {
    const { joinRoom } = await import('./rooms');
    const { ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'ROOM_NOT_FOUND', message: 'Room not found' }), { status: 404 }),
    );

    await expect(joinRoom('NOPE99')).rejects.toMatchObject(new ApiError('Room not found', 404, 'ROOM_NOT_FOUND'));
  });
});

describe('leaveRoom / setReady — room-id-keyed, share the same error-mapping path as createRoom/joinRoom', () => {
  it('leaveRoom POSTs /rooms/:roomId/leave (room id, not game id) with a fresh clientRequestId', async () => {
    const { leaveRoom } = await import('./rooms');
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ roomId: 'room-1', gameId: 'game-1', playerId: 'p1', playerCount: 1, newHostPlayerId: null, roomClosed: false }),
        { status: 200 },
      ),
    );

    await leaveRoom('room-1');

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/rooms/room-1/leave`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ clientRequestId: 'fixed-uuid-1' }) }),
    );
  });

  it('leaveRoom throws ApiError with status + backend error code on failure', async () => {
    const { leaveRoom } = await import('./rooms');
    const { ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'ROOM_NOT_FOUND', message: 'Room not found' }), { status: 404 }),
    );

    await expect(leaveRoom('missing-room')).rejects.toMatchObject(
      new ApiError('Room not found', 404, 'ROOM_NOT_FOUND'),
    );
  });

  it('setReady POSTs /rooms/:roomId/ready (room id) with isReady and a fresh clientRequestId', async () => {
    const { setReady } = await import('./rooms');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ roomId: 'room-1', gameId: 'game-1', playerId: 'p1', isReady: true }), {
        status: 200,
      }),
    );

    await setReady('room-1', true);

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/rooms/room-1/ready`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ clientRequestId: 'fixed-uuid-1', isReady: true }),
      }),
    );
  });

  it('setReady throws ApiError with status + backend error code on failure', async () => {
    const { setReady } = await import('./rooms');
    const { ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'PLAYER_NOT_IN_GAME', message: 'not in this game' }), { status: 404 }),
    );

    await expect(setReady('room-1', true)).rejects.toMatchObject(
      new ApiError('not in this game', 404, 'PLAYER_NOT_IN_GAME'),
    );
  });
});

describe('getRoomByCode', () => {
  it('GETs /rooms/:code (no body) and returns the RoomSummary verbatim', async () => {
    const { getRoomByCode } = await import('./rooms');
    const body: import('./rooms').RoomSummary = {
      roomId: 'room-1',
      code: 'ABCDEF',
      visibility: 'PRIVATE',
      status: 'OPEN',
      rulesetMode: 'NORMAL',
      maxPlayers: 8,
      gameId: 'game-1',
      gameStatus: 'LOBBY',
      playerCount: 2,
    };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    const result = await getRoomByCode('ABCDEF');

    expect(fetch).toHaveBeenCalledWith(`${API_URL}/rooms/ABCDEF`, expect.objectContaining({}));
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.method).toBeUndefined();
    expect(result).toEqual(body);
  });

  it('URL-encodes the code', async () => {
    const { getRoomByCode } = await import('./rooms');
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

    await getRoomByCode('AB CD/EF');

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${API_URL}/rooms/${encodeURIComponent('AB CD/EF')}`);
  });

  it('throws ApiError with status + backend error code for a nonexistent room', async () => {
    const { getRoomByCode } = await import('./rooms');
    const { ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'ROOM_NOT_FOUND', message: 'Room not found' }), { status: 404 }),
    );

    await expect(getRoomByCode('NOPE99')).rejects.toMatchObject(
      new ApiError('Room not found', 404, 'ROOM_NOT_FOUND'),
    );
  });
});

describe('startGame', () => {
  it('POSTs /rooms/:id/start (room id) with a fresh clientRequestId', async () => {
    const { startGame } = await import('./rooms');
    const body: import('./rooms').GameStarted = {
      roomId: 'room-1',
      gameId: 'game-1',
      status: 'RUNNING',
      currentPhase: 'ROLE_REVEAL',
      playerCount: 4,
      rulesVersion: '6.0.0',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    const result = await startGame('room-1');

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/rooms/room-1/start`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ clientRequestId: 'fixed-uuid-1' }) }),
    );
    expect(result).toEqual(body);
  });

  it('throws ApiError with status + backend error code on failure (e.g. NOT_ENOUGH_PLAYERS)', async () => {
    const { startGame } = await import('./rooms');
    const { ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'NOT_ENOUGH_PLAYERS', message: 'O‘yinni boshlash uchun kamida 4 o‘yinchi kerak' }),
        { status: 409 },
      ),
    );

    await expect(startGame('room-1')).rejects.toMatchObject(
      new ApiError('O‘yinni boshlash uchun kamida 4 o‘yinchi kerak', 409, 'NOT_ENOUGH_PLAYERS'),
    );
  });

  it('throws ApiError NOT_HOST on failure for a non-host caller', async () => {
    const { startGame } = await import('./rooms');
    const { ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'NOT_HOST', message: 'Faqat xona egasi o‘yinni boshlay oladi' }), {
        status: 403,
      }),
    );

    await expect(startGame('room-1')).rejects.toMatchObject(
      new ApiError('Faqat xona egasi o‘yinni boshlay oladi', 403, 'NOT_HOST'),
    );
  });
});
