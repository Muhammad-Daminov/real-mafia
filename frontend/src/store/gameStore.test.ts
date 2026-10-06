import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getGameStateMock = vi.fn();

vi.mock('../api/games', async () => {
  const actual = await vi.importActual<typeof import('../api/games')>('../api/games');
  return { ...actual, getGameState: (...args: unknown[]) => getGameStateMock(...args) };
});

beforeEach(() => {
  getGameStateMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

function makeSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    gameId: 'game-1',
    status: 'RUNNING',
    currentPhase: 'NIGHT',
    round: 1,
    phaseEndsAt: '2026-01-01T00:05:00.000Z',
    myPlayerId: 'player-1',
    myLifeStatus: 'ALIVE',
    myRoleCode: null,
    myTeam: null,
    teammates: [],
    ...overrides,
  };
}

describe('gameStore — initFromGameId', () => {
  it('fetches the snapshot and populates state, including a null role before ROLE_REVEAL', async () => {
    const { useGameStore } = await import('./gameStore');
    getGameStateMock.mockResolvedValue(makeSnapshot({ currentPhase: 'LOBBY', round: 0, phaseEndsAt: null }));

    await useGameStore.getState().initFromGameId('game-1');

    const s = useGameStore.getState();
    expect(s.gameId).toBe('game-1');
    expect(s.phase).toBe('LOBBY');
    expect(s.myRoleCode).toBeNull();
    expect(s.myTeam).toBeNull();
    expect(s.teammates).toEqual([]);
    expect(s.stateLoading).toBe(false);
    expect(s.stateError).toBeNull();
  });

  it('a real dealt role/team comes back populated, with teammates for a mafia-team caller', async () => {
    const { useGameStore } = await import('./gameStore');
    getGameStateMock.mockResolvedValue(
      makeSnapshot({
        myRoleCode: 'DON',
        myTeam: 'MAFIA',
        teammates: [{ playerId: 'player-2', roleCode: 'MAFIA' }],
      }),
    );

    await useGameStore.getState().initFromGameId('game-1');

    const s = useGameStore.getState();
    expect(s.myRoleCode).toBe('DON');
    expect(s.myTeam).toBe('MAFIA');
    expect(s.teammates).toEqual([{ playerId: 'player-2', roleCode: 'MAFIA' }]);
  });

  it('resets roleRevealDismissed on a fresh init', async () => {
    const { useGameStore } = await import('./gameStore');
    getGameStateMock.mockResolvedValue(makeSnapshot({ myRoleCode: 'CIVILIAN', myTeam: 'TOWN' }));
    await useGameStore.getState().initFromGameId('game-1');
    useGameStore.getState().dismissRoleReveal();
    expect(useGameStore.getState().roleRevealDismissed).toBe(true);

    getGameStateMock.mockResolvedValue(makeSnapshot({ myRoleCode: 'CIVILIAN', myTeam: 'TOWN' }));
    await useGameStore.getState().initFromGameId('game-2');
    expect(useGameStore.getState().roleRevealDismissed).toBe(false);
  });

  it('clears gameId back to null on a definitive PLAYER_NOT_IN_GAME 404, so routing falls through to Home', async () => {
    const { ApiError } = await import('../api/client');
    const { useGameStore } = await import('./gameStore');
    getGameStateMock.mockRejectedValue(new ApiError('Siz bu o‘yinda emassiz', 404, 'PLAYER_NOT_IN_GAME'));

    await useGameStore.getState().initFromGameId('stale-game-id');

    const s = useGameStore.getState();
    expect(s.gameId).toBeNull(); // not left dangling — App.tsx's routing is gated on this
    expect(s.stateError).toBeTruthy();
  });

  it('leaves gameId set on a transient/network failure, so a retry still has something to retry', async () => {
    const { useGameStore } = await import('./gameStore');
    getGameStateMock.mockRejectedValue(new Error('network error'));

    await useGameStore.getState().initFromGameId('game-1');

    const s = useGameStore.getState();
    expect(s.gameId).toBe('game-1');
    expect(s.stateError).toBeTruthy();
  });
});

describe('gameStore — applyRoleRevealed', () => {
  it('sets myRoleCode/myTeam/teammates from the socket payload', async () => {
    const { useGameStore } = await import('./gameStore');
    useGameStore.getState().applyRoleRevealed({
      roleCode: 'DETECTIVE',
      team: 'TOWN',
      teammates: [],
    });

    const s = useGameStore.getState();
    expect(s.myRoleCode).toBe('DETECTIVE');
    expect(s.myTeam).toBe('TOWN');
    expect(s.teammates).toEqual([]);
  });

  it('carries teammates through for a mafia-team payload', async () => {
    const { useGameStore } = await import('./gameStore');
    useGameStore.getState().applyRoleRevealed({
      roleCode: 'MAFIA',
      team: 'MAFIA',
      teammates: [{ playerId: 'player-3', roleCode: 'DON' }],
    });

    expect(useGameStore.getState().teammates).toEqual([{ playerId: 'player-3', roleCode: 'DON' }]);
  });
});

describe('gameStore — applyPhaseChanged', () => {
  it('sets phase/round immediately from the payload, then refetches to pick up the new phaseEndsAt', async () => {
    const { useGameStore } = await import('./gameStore');
    await useGameStore.getState().initFromGameId('game-1'); // seeds gameId
    getGameStateMock.mockResolvedValue(makeSnapshot({ currentPhase: 'DISCUSSION', round: 2, phaseEndsAt: '2026-01-01T00:10:00.000Z' }));

    useGameStore.getState().applyPhaseChanged({ from: 'NIGHT', to: 'DISCUSSION', round: 2 });

    // Immediate, synchronous effect of the event itself.
    expect(useGameStore.getState().phase).toBe('DISCUSSION');
    expect(useGameStore.getState().round).toBe(2);

    await vi.waitFor(() => {
      expect(useGameStore.getState().phaseEndsAt).toBe('2026-01-01T00:10:00.000Z');
    });
  });

  it('does nothing (no refetch) when no gameId is known yet', async () => {
    const { useGameStore } = await import('./gameStore');
    useGameStore.getState().applyPhaseChanged({ from: 'LOBBY', to: 'ROLE_REVEAL', round: 0 });

    expect(useGameStore.getState().phase).toBe('ROLE_REVEAL');
    expect(getGameStateMock).not.toHaveBeenCalled();
  });
});

describe('gameStore — refetchState: stale/out-of-order responses', () => {
  it('drops a response superseded by a later refetch before it resolves', async () => {
    const { useGameStore } = await import('./gameStore');
    await useGameStore.getState().initFromGameId('game-1');

    let resolveFirst!: (value: ReturnType<typeof makeSnapshot>) => void;
    getGameStateMock.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    const firstRefetch = useGameStore.getState().refetchState();

    getGameStateMock.mockResolvedValueOnce(makeSnapshot({ round: 9 }));
    await useGameStore.getState().refetchState(); // second call resolves first

    expect(useGameStore.getState().round).toBe(9);

    resolveFirst(makeSnapshot({ round: 1 })); // stale — must not clobber state
    await firstRefetch;

    expect(useGameStore.getState().round).toBe(9);
  });

  it('is a no-op when gameId is null', async () => {
    const { useGameStore } = await import('./gameStore');
    await useGameStore.getState().refetchState();
    expect(getGameStateMock).not.toHaveBeenCalled();
  });
});

describe('gameStore — reset', () => {
  it('clears state and invalidates in-flight requests', async () => {
    const { useGameStore } = await import('./gameStore');
    await useGameStore.getState().initFromGameId('game-1');

    useGameStore.getState().reset();

    const s = useGameStore.getState();
    expect(s.gameId).toBeNull();
    expect(s.myRoleCode).toBeNull();
    expect(s.roleRevealDismissed).toBe(false);
  });
});

describe('gameStore — applyActionSubmitted (F4)', () => {
  it('sets mySubmittedAction from the POST /night-actions response', async () => {
    const { useGameStore } = await import('./gameStore');
    useGameStore.getState().applyActionSubmitted({
      actionId: 'a1',
      gameId: 'game-1',
      phaseId: 'phase-1',
      actionType: 'INVESTIGATE',
      actionSlot: 0,
      targetPlayerId: 'player-2',
      targetPlayerId2: null,
    });

    expect(useGameStore.getState().mySubmittedAction).toEqual({
      actionType: 'INVESTIGATE',
      targetPlayerId: 'player-2',
      targetPlayerId2: null,
    });
  });
});

describe('gameStore — applyNightResult (F4)', () => {
  it('sets nightResult to the event name + payload', async () => {
    const { useGameStore } = await import('./gameStore');
    useGameStore.getState().applyNightResult('DETECTIVE_RESULT', { flag: 'MAFIA' });

    expect(useGameStore.getState().nightResult).toEqual({
      event: 'DETECTIVE_RESULT',
      payload: { flag: 'MAFIA' },
    });
  });
});

describe('gameStore — applyPhaseChanged clears submission/result state (F4)', () => {
  it('clears mySubmittedAction on every phase change', async () => {
    const { useGameStore } = await import('./gameStore');
    await useGameStore.getState().initFromGameId('game-1');
    useGameStore.getState().applyActionSubmitted({
      actionId: 'a1',
      gameId: 'game-1',
      phaseId: 'phase-1',
      actionType: 'SHOOT',
      actionSlot: 0,
      targetPlayerId: 'player-2',
      targetPlayerId2: null,
    });
    expect(useGameStore.getState().mySubmittedAction).not.toBeNull();

    getGameStateMock.mockResolvedValue(makeSnapshot({ currentPhase: 'NIGHT_RESOLUTION', round: 1 }));
    useGameStore.getState().applyPhaseChanged({ from: 'NIGHT', to: 'NIGHT_RESOLUTION', round: 1 });

    expect(useGameStore.getState().mySubmittedAction).toBeNull();
  });

  it('keeps nightResult when leaving NIGHT (so the next phase screen can show it)', async () => {
    const { useGameStore } = await import('./gameStore');
    await useGameStore.getState().initFromGameId('game-1');
    useGameStore.getState().applyNightResult('SHERIFF_RESULT', { died: true });

    getGameStateMock.mockResolvedValue(makeSnapshot({ currentPhase: 'NIGHT_RESOLUTION', round: 1 }));
    useGameStore.getState().applyPhaseChanged({ from: 'NIGHT', to: 'NIGHT_RESOLUTION', round: 1 });

    expect(useGameStore.getState().nightResult).toEqual({ event: 'SHERIFF_RESULT', payload: { died: true } });
  });

  it('clears nightResult once a fresh NIGHT starts', async () => {
    const { useGameStore } = await import('./gameStore');
    await useGameStore.getState().initFromGameId('game-1');
    useGameStore.getState().applyNightResult('SHERIFF_RESULT', { died: true });

    getGameStateMock.mockResolvedValue(makeSnapshot({ currentPhase: 'NIGHT', round: 2 }));
    useGameStore.getState().applyPhaseChanged({ from: 'DISCUSSION', to: 'NIGHT', round: 2 });

    expect(useGameStore.getState().nightResult).toBeNull();
  });
});
