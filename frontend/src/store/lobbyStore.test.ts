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

describe('lobbyStore — enter', () => {
  it('enterFromCreate seeds state with myIsHost=true and playerCount=1', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromCreate(createdRoom);

    const s = useLobbyStore.getState();
    expect(s.roomId).toBe('room-1');
    expect(s.gameId).toBe('game-1');
    expect(s.code).toBe('ABCDEF');
    expect(s.playerCount).toBe(1);
    expect(s.myIsHost).toBe(true);
    expect(s.myIsReady).toBe(false);
    expect(s.gameStatus).toBe('LOBBY');
  });

  it('enterFromJoin seeds state with myIsHost=false and myPlayerId from the response', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromJoin('ABCDEF', joinedRoom);

    const s = useLobbyStore.getState();
    expect(s.roomId).toBe('room-1');
    expect(s.code).toBe('ABCDEF');
    expect(s.playerCount).toBe(2);
    expect(s.myPlayerId).toBe('player-2');
    expect(s.myIsHost).toBe(false);
  });
});

describe('lobbyStore — realtime event reducers', () => {
  it('applyPlayerJoined updates playerCount from the event payload (authoritative)', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromCreate(createdRoom);

    useLobbyStore.getState().applyPlayerJoined({
      roomId: 'room-1',
      gameId: 'game-1',
      playerId: 'player-2',
      playerCount: 2,
      maxPlayers: 8,
    });

    expect(useLobbyStore.getState().playerCount).toBe(2);
  });

  it('applyPlayerLeft updates playerCount from the event payload', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromCreate(createdRoom);
    useLobbyStore.setState({ playerCount: 3 });

    useLobbyStore.getState().applyPlayerLeft({
      roomId: 'room-1',
      gameId: 'game-1',
      playerId: 'player-2',
      playerCount: 2,
      newHostPlayerId: null,
      roomClosed: false,
    });

    expect(useLobbyStore.getState().playerCount).toBe(2);
  });

  it('applyReadySet only updates myIsReady when the event is about myPlayerId', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromJoin('ABCDEF', joinedRoom);

    useLobbyStore.getState().applyReadySet({
      roomId: 'room-1',
      gameId: 'game-1',
      playerId: 'someone-else',
      isReady: true,
    });
    expect(useLobbyStore.getState().myIsReady).toBe(false);

    useLobbyStore.getState().applyReadySet({
      roomId: 'room-1',
      gameId: 'game-1',
      playerId: 'player-2',
      isReady: true,
    });
    expect(useLobbyStore.getState().myIsReady).toBe(true);
  });

  it('applyHostTransferred for a joiner (known myPlayerId) compares newHostPlayerId directly', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromJoin('ABCDEF', joinedRoom);
    expect(useLobbyStore.getState().myIsHost).toBe(false);

    useLobbyStore.getState().applyHostTransferred({
      roomId: 'room-1',
      gameId: 'game-1',
      previousHostPlayerId: 'player-1',
      newHostPlayerId: 'player-2',
    });
    expect(useLobbyStore.getState().myIsHost).toBe(true);

    useLobbyStore.getState().applyHostTransferred({
      roomId: 'room-1',
      gameId: 'game-1',
      previousHostPlayerId: 'player-2',
      newHostPlayerId: 'player-3',
    });
    expect(useLobbyStore.getState().myIsHost).toBe(false);
  });

  it('applyHostTransferred for the creator (unknown myPlayerId) loses host on any transfer while currently host', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromCreate(createdRoom);
    expect(useLobbyStore.getState().myIsHost).toBe(true);
    expect(useLobbyStore.getState().myPlayerId).toBeNull();

    useLobbyStore.getState().applyHostTransferred({
      roomId: 'room-1',
      gameId: 'game-1',
      previousHostPlayerId: 'creator-player-id',
      newHostPlayerId: 'player-2',
    });

    expect(useLobbyStore.getState().myIsHost).toBe(false);
  });

  it('applyPhaseChanged updates currentPhase', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromCreate(createdRoom);

    useLobbyStore.getState().applyPhaseChanged({ from: 'LOBBY', to: 'ROLE_REVEAL', round: 0 });

    expect(useLobbyStore.getState().currentPhase).toBe('ROLE_REVEAL');
  });

  it('events for a different gameId are ignored', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromCreate(createdRoom);

    useLobbyStore.getState().applyPlayerJoined({
      roomId: 'other-room',
      gameId: 'other-game',
      playerId: 'x',
      playerCount: 99,
      maxPlayers: 8,
    });

    expect(useLobbyStore.getState().playerCount).toBe(1);
  });
});

describe('lobbyStore — refetchSnapshot', () => {
  it('merges the REST snapshot into state (used on every socket (re)connect)', async () => {
    const { useLobbyStore } = await import('./lobbyStore');
    useLobbyStore.getState().enterFromJoin('ABCDEF', joinedRoom);

    getRoomByCodeMock.mockResolvedValue({
      roomId: 'room-1',
      code: 'ABCDEF',
      visibility: 'PRIVATE',
      status: 'OPEN',
      rulesetMode: 'NORMAL',
      maxPlayers: 8,
      gameId: 'game-1',
      gameStatus: 'LOBBY',
      playerCount: 3,
    });

    await useLobbyStore.getState().refetchSnapshot();

    expect(getRoomByCodeMock).toHaveBeenCalledWith('ABCDEF');
    const s = useLobbyStore.getState();
    expect(s.playerCount).toBe(3);
    expect(s.visibility).toBe('PRIVATE');
    expect(s.rulesetMode).toBe('NORMAL');
    expect(s.snapshotLoading).toBe(false);
    expect(s.snapshotError).toBeNull();
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
