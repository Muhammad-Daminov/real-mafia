import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getRoomByCodeMock = vi.fn();

vi.mock('../api/rooms', async () => {
  const actual = await vi.importActual<typeof import('../api/rooms')>('../api/rooms');
  return { ...actual, getRoomByCode: (...args: unknown[]) => getRoomByCodeMock(...args) };
});

beforeEach(() => {
  getRoomByCodeMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
  vi.useRealTimers();
});

const createdRoom = {
  roomId: 'room-1',
  code: 'ABCDEF',
  gameId: 'game-1',
  maxPlayers: 8,
  rulesetMode: 'NORMAL' as const,
  visibility: 'PRIVATE' as const,
};

const joinedRoom = {
  roomId: 'room-1',
  gameId: 'game-1',
  playerId: 'player-2',
  playerCount: 2,
  maxPlayers: 8,
};

function makeSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    roomId: 'room-1',
    code: 'ABCDEF',
    visibility: 'PRIVATE',
    status: 'OPEN',
    rulesetMode: 'NORMAL',
    maxPlayers: 8,
    gameId: 'game-1',
    gameStatus: 'LOBBY',
    playerCount: 2,
    players: [
      {
        playerId: 'player-1',
        displayName: 'Host',
        avatarUrl: null,
        isReady: false,
        isHost: true,
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        playerId: 'player-2',
        displayName: 'Second',
        avatarUrl: 'https://t.me/i/second.jpg',
        isReady: true,
        isHost: false,
        joinedAt: '2026-01-01T00:01:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('lobbyStore — enter', () => {
  it('enterFromCreate seeds state with myIsHost=true, playerCount=1, players=null (not yet fetched)', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromCreate(createdRoom);

    const s = useLobbyStore.getState();
    expect(s.roomId).toBe('room-1');
    expect(s.playerCount).toBe(1);
    expect(s.myIsHost).toBe(true);
    expect(s.myPlayerId).toBeNull();
    expect(s.players).toBeNull();
  });

  it('enterFromJoin seeds state with myIsHost=false and myPlayerId from the response', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromJoin('ABCDEF', joinedRoom);

    const s = useLobbyStore.getState();
    expect(s.roomId).toBe('room-1');
    expect(s.code).toBe('ABCDEF');
    expect(s.myPlayerId).toBe('player-2');
    expect(s.myIsHost).toBe(false);
  });
});

describe('lobbyStore — refetchSnapshot: roster + derived my* fields', () => {
  it('merges the roster and derives myIsHost/myIsReady for a joiner by matching myPlayerId', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromJoin('ABCDEF', joinedRoom); // myPlayerId = player-2
    getRoomByCodeMock.mockResolvedValue(makeSnapshot());

    await useLobbyStore.getState().refetchSnapshot();

    const s = useLobbyStore.getState();
    expect(s.players).toHaveLength(2);
    expect(s.myPlayerId).toBe('player-2');
    expect(s.myIsHost).toBe(false);
    expect(s.myIsReady).toBe(true);
    expect(s.playerCount).toBe(2);
  });

  it('resolves the creator\'s own playerId from the roster (sole host) on the first fetch, then pins it', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromCreate(createdRoom); // myPlayerId unknown, myIsHost=true
    getRoomByCodeMock.mockResolvedValue(
      makeSnapshot({
        playerCount: 1,
        players: [
          {
            playerId: 'creator-player-id',
            displayName: 'Creator',
            avatarUrl: null,
            isReady: false,
            isHost: true,
            joinedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );

    await useLobbyStore.getState().refetchSnapshot();

    expect(useLobbyStore.getState().myPlayerId).toBe('creator-player-id');
    expect(useLobbyStore.getState().myIsHost).toBe(true);

    // A later refetch (after a host transfer away) must not re-derive
    // myPlayerId from "whichever entry is host" — it's already pinned.
    getRoomByCodeMock.mockResolvedValue(
      makeSnapshot({
        playerCount: 2,
        players: [
          {
            playerId: 'creator-player-id',
            displayName: 'Creator',
            avatarUrl: null,
            isReady: false,
            isHost: false,
            joinedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            playerId: 'other-player-id',
            displayName: 'Other',
            avatarUrl: null,
            isReady: false,
            isHost: true,
            joinedAt: '2026-01-01T00:01:00.000Z',
          },
        ],
      }),
    );
    await useLobbyStore.getState().refetchSnapshot();

    expect(useLobbyStore.getState().myPlayerId).toBe('creator-player-id');
    expect(useLobbyStore.getState().myIsHost).toBe(false);
  });

  it('treats an absent `players` field as "not in room": resets to Home with a notice', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromJoin('ABCDEF', joinedRoom);

    const snapshotWithoutPlayers = makeSnapshot();
    delete (snapshotWithoutPlayers as { players?: unknown }).players;
    getRoomByCodeMock.mockResolvedValue(snapshotWithoutPlayers);

    await useLobbyStore.getState().refetchSnapshot();

    const s = useLobbyStore.getState();
    expect(s.roomId).toBeNull();
    expect(s.players).toBeNull();
    expect(s.notice).toBeTruthy();
  });

  it('is a no-op when there is no code yet', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    await useLobbyStore.getState().refetchSnapshot();
    expect(getRoomByCodeMock).not.toHaveBeenCalled();
  });

  it('records snapshotError on failure without touching other state', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromCreate(createdRoom);
    getRoomByCodeMock.mockRejectedValue(new Error('boom'));

    await useLobbyStore.getState().refetchSnapshot();

    const s = useLobbyStore.getState();
    expect(s.snapshotError).toBe('boom');
    expect(s.snapshotLoading).toBe(false);
    expect(s.roomId).toBe('room-1');
  });

  it('ignores a stale (superseded) response — only the latest request\'s result is applied', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromJoin('ABCDEF', joinedRoom);

    let resolveFirst!: (v: unknown) => void;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    getRoomByCodeMock.mockReturnValueOnce(firstPromise);
    const firstCall = useLobbyStore.getState().refetchSnapshot();

    getRoomByCodeMock.mockResolvedValueOnce(makeSnapshot({ playerCount: 99 }));
    const secondCall = useLobbyStore.getState().refetchSnapshot();
    await secondCall;
    expect(useLobbyStore.getState().playerCount).toBe(99);

    // The first (slower) request now resolves after the second already
    // applied — it must be dropped, not overwrite the newer state.
    resolveFirst(makeSnapshot({ playerCount: 2 }));
    await firstCall;

    expect(useLobbyStore.getState().playerCount).toBe(99);
  });
});

describe('lobbyStore — realtime events schedule a debounced/coalesced refetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('a single lobby event triggers exactly one refetch after the debounce window', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromJoin('ABCDEF', joinedRoom);
    getRoomByCodeMock.mockResolvedValue(makeSnapshot());

    useLobbyStore.getState().applyPlayerJoined({
      roomId: 'room-1',
      gameId: 'game-1',
      playerId: 'player-3',
      playerCount: 3,
      maxPlayers: 8,
    });

    expect(getRoomByCodeMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(getRoomByCodeMock).toHaveBeenCalledTimes(1);
  });

  it('a burst of PLAYER_JOINED/LEFT/READY_CHANGED/HOST_TRANSFERRED within the window coalesces into one refetch', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromJoin('ABCDEF', joinedRoom);
    getRoomByCodeMock.mockResolvedValue(makeSnapshot());
    const lobby = useLobbyStore.getState();

    lobby.applyPlayerJoined({ roomId: 'room-1', gameId: 'game-1', playerId: 'p3', playerCount: 3, maxPlayers: 8 });
    await vi.advanceTimersByTimeAsync(50);
    lobby.applyReadySet({ roomId: 'room-1', gameId: 'game-1', playerId: 'player-2', isReady: true });
    await vi.advanceTimersByTimeAsync(50);
    lobby.applyHostTransferred({
      roomId: 'room-1',
      gameId: 'game-1',
      previousHostPlayerId: 'player-1',
      newHostPlayerId: 'player-2',
    });
    await vi.advanceTimersByTimeAsync(50);
    lobby.applyPlayerLeft({
      roomId: 'room-1',
      gameId: 'game-1',
      playerId: 'p3',
      playerCount: 2,
      newHostPlayerId: null,
      roomClosed: false,
    });

    expect(getRoomByCodeMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(getRoomByCodeMock).toHaveBeenCalledTimes(1);
  });

  it('events for a different gameId are ignored (no refetch scheduled)', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromJoin('ABCDEF', joinedRoom);

    useLobbyStore.getState().applyPlayerJoined({
      roomId: 'other-room',
      gameId: 'other-game',
      playerId: 'x',
      playerCount: 99,
      maxPlayers: 8,
    });

    await vi.advanceTimersByTimeAsync(200);
    expect(getRoomByCodeMock).not.toHaveBeenCalled();
  });

  it('applyPhaseChanged updates currentPhase directly, without scheduling a refetch', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromCreate(createdRoom);

    useLobbyStore.getState().applyPhaseChanged({ from: 'LOBBY', to: 'ROLE_REVEAL', round: 0 });

    expect(useLobbyStore.getState().currentPhase).toBe('ROLE_REVEAL');
    await vi.advanceTimersByTimeAsync(200);
    expect(getRoomByCodeMock).not.toHaveBeenCalled();
  });

  it('reset() cancels a pending scheduled refetch', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromJoin('ABCDEF', joinedRoom);
    getRoomByCodeMock.mockResolvedValue(makeSnapshot());

    useLobbyStore.getState().applyPlayerJoined({
      roomId: 'room-1',
      gameId: 'game-1',
      playerId: 'p3',
      playerCount: 3,
      maxPlayers: 8,
    });
    useLobbyStore.getState().reset();

    await vi.advanceTimersByTimeAsync(200);
    expect(getRoomByCodeMock).not.toHaveBeenCalled();
  });
});

describe('canStartGame', () => {
  it('disables with NOT_HOST when not host', async () => {
    const { canStartGame } = await import('./lobbyStore');
    expect(canStartGame({ myIsHost: false, playerCount: 10, gameStatus: 'LOBBY' })).toEqual({
      enabled: false,
      reasonKey: 'NOT_HOST',
    });
  });

  it('disables with NOT_ENOUGH_PLAYERS below the 4-player floor', async () => {
    const { canStartGame } = await import('./lobbyStore');
    expect(canStartGame({ myIsHost: true, playerCount: 3, gameStatus: 'LOBBY' })).toEqual({
      enabled: false,
      reasonKey: 'NOT_ENOUGH_PLAYERS',
    });
  });

  it('disables with NOT_IN_LOBBY when the game status is not LOBBY', async () => {
    const { canStartGame } = await import('./lobbyStore');
    expect(canStartGame({ myIsHost: true, playerCount: 4, gameStatus: 'RUNNING' })).toEqual({
      enabled: false,
      reasonKey: 'NOT_IN_LOBBY',
    });
  });

  it('enables when host, >=4 players, and gameStatus is LOBBY — readiness is never checked (OD-014)', async () => {
    const { canStartGame } = await import('./lobbyStore');
    expect(canStartGame({ myIsHost: true, playerCount: 4, gameStatus: 'LOBBY' })).toEqual({
      enabled: true,
      reasonKey: null,
    });
  });
});
