import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
});

describe('returnHome — end-screen state reset', () => {
  it('clears gameId, roomCode, role, and roster from gameStore, and the room from lobbyStore', async () => {
    const { useGameStore } = await import('../store/gameStore');
    const { useLobbyStore } = await import('../store/lobbyStore');
    const { returnHome } = await import('./returnHome');

    // Seed some in-game state directly, as if a game had been played.
    useGameStore.setState({
      gameId: 'game-1',
      roomCode: 'ABCDEF',
      myRoleCode: 'DETECTIVE',
      roster: [{ playerId: 'p1', displayName: 'Me', avatarUrl: null, isReady: true, isHost: true, joinedAt: 't', lifeStatus: 'ALIVE' }],
      gameResult: { winnerTeam: 'TOWN', finishedAt: '2026-01-01T00:20:00.000Z', players: [] },
    });
    useLobbyStore.setState({ roomId: 'room-1', code: 'ABCDEF' });

    returnHome();

    const gameState = useGameStore.getState();
    expect(gameState.gameId).toBeNull();
    expect(gameState.roomCode).toBeNull();
    expect(gameState.myRoleCode).toBeNull();
    expect(gameState.roster).toBeNull();
    expect(gameState.gameResult).toBeNull();

    const lobbyState = useLobbyStore.getState();
    expect(lobbyState.roomId).toBeNull();
    expect(lobbyState.code).toBeNull();
  });

  it('leaves both stores ready for a brand new room to be created immediately', async () => {
    const { useGameStore } = await import('../store/gameStore');
    const { useLobbyStore } = await import('../store/lobbyStore');
    const { returnHome } = await import('./returnHome');

    useGameStore.setState({ gameId: 'stale-game' });
    useLobbyStore.setState({ roomId: 'stale-room' });

    returnHome();

    // A fresh enterFromCreate right after returnHome must not inherit any
    // stale field — spot-check a couple of fields reset() is relied on for.
    useLobbyStore.getState().enterFromCreate({
      roomId: 'new-room',
      code: 'NEWCOD',
      gameId: 'new-game',
      maxPlayers: 8,
      rulesetMode: 'NORMAL',
      visibility: 'PRIVATE',
    });

    expect(useLobbyStore.getState().roomId).toBe('new-room');
    expect(useGameStore.getState().gameId).toBeNull(); // gameStore stays clean until the new game actually starts
  });
});
