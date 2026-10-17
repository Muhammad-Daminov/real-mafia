import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getGameStateMock = vi.fn();
const getRoomByCodeMock = vi.fn();
const getVoteTallyMock = vi.fn();

vi.mock('../api/games', async () => {
  const actual = await vi.importActual<typeof import('../api/games')>('../api/games');
  return { ...actual, getGameState: (...args: unknown[]) => getGameStateMock(...args) };
});

vi.mock('../api/rooms', async () => {
  const actual = await vi.importActual<typeof import('../api/rooms')>('../api/rooms');
  return { ...actual, getRoomByCode: (...args: unknown[]) => getRoomByCodeMock(...args) };
});

vi.mock('../api/votes', async () => {
  const actual = await vi.importActual<typeof import('../api/votes')>('../api/votes');
  return { ...actual, getVoteTally: (...args: unknown[]) => getVoteTallyMock(...args) };
});

beforeEach(() => {
  getGameStateMock.mockReset();
  getRoomByCodeMock.mockReset();
  getVoteTallyMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
  vi.useRealTimers();
});

function makeRoomSummary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    roomId: 'room-1',
    code: 'ABCDEF',
    visibility: 'PRIVATE',
    status: 'OPEN',
    rulesetMode: 'NORMAL',
    maxPlayers: 4,
    gameId: 'game-1',
    gameStatus: 'RUNNING',
    playerCount: 2,
    players: [
      { playerId: 'player-1', displayName: 'Me', avatarUrl: null, isReady: true, isHost: true, joinedAt: '2026-01-01T00:00:00.000Z', lifeStatus: 'ALIVE' },
      { playerId: 'player-2', displayName: 'Other', avatarUrl: null, isReady: true, isHost: false, joinedAt: '2026-01-01T00:01:00.000Z', lifeStatus: 'ALIVE' },
    ],
    ...overrides,
  };
}

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

describe('gameStore — setRoomCode / refetchRoster (F4.1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('setRoomCode sets roomCode and schedules a debounced initial roster fetch', async () => {
    const { useGameStore } = await import('./gameStore');
    getRoomByCodeMock.mockResolvedValue(makeRoomSummary());

    useGameStore.getState().setRoomCode('ABCDEF');

    expect(useGameStore.getState().roomCode).toBe('ABCDEF');
    expect(getRoomByCodeMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);

    expect(getRoomByCodeMock).toHaveBeenCalledWith('ABCDEF');
    expect(useGameStore.getState().roster).toEqual(makeRoomSummary().players);
  });

  it('refetchRoster is a no-op when roomCode is not known', async () => {
    const { useGameStore } = await import('./gameStore');
    await useGameStore.getState().refetchRoster();
    expect(getRoomByCodeMock).not.toHaveBeenCalled();
  });

  it('a burst of applyPhaseChanged calls coalesces into one roster refetch', async () => {
    const { useGameStore } = await import('./gameStore');
    getRoomByCodeMock.mockResolvedValue(makeRoomSummary());
    useGameStore.getState().setRoomCode('ABCDEF');
    await vi.advanceTimersByTimeAsync(150);
    getRoomByCodeMock.mockClear();

    useGameStore.getState().applyPhaseChanged({ from: 'NIGHT', to: 'NIGHT_RESOLUTION', round: 1 });
    await vi.advanceTimersByTimeAsync(50);
    useGameStore.getState().applyPhaseChanged({ from: 'NIGHT_RESOLUTION', to: 'LAST_WORD', round: 1 });

    expect(getRoomByCodeMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(getRoomByCodeMock).toHaveBeenCalledTimes(1);
  });

  it('treats an absent `players` field as "no roster" rather than crashing', async () => {
    const { useGameStore } = await import('./gameStore');
    getRoomByCodeMock.mockResolvedValue(makeRoomSummary({ players: undefined }));
    useGameStore.getState().setRoomCode('ABCDEF');

    await vi.advanceTimersByTimeAsync(150);

    expect(useGameStore.getState().roster).toBeNull();
  });

  it('drops a roster response superseded by a later refetch before it resolves', async () => {
    const { useGameStore } = await import('./gameStore');
    useGameStore.getState().setRoomCode('ABCDEF');
    await vi.advanceTimersByTimeAsync(150);
    getRoomByCodeMock.mockClear();

    let resolveFirst!: (value: ReturnType<typeof makeRoomSummary>) => void;
    getRoomByCodeMock.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    const firstRefetch = useGameStore.getState().refetchRoster();

    getRoomByCodeMock.mockResolvedValueOnce(
      makeRoomSummary({ players: [{ playerId: 'player-1', displayName: 'Me', avatarUrl: null, isReady: true, isHost: true, joinedAt: '2026-01-01T00:00:00.000Z', lifeStatus: 'DEAD' }] }),
    );
    await useGameStore.getState().refetchRoster(); // second call resolves first

    expect(useGameStore.getState().roster).toEqual([
      { playerId: 'player-1', displayName: 'Me', avatarUrl: null, isReady: true, isHost: true, joinedAt: '2026-01-01T00:00:00.000Z', lifeStatus: 'DEAD' },
    ]);

    resolveFirst(makeRoomSummary()); // stale — must not clobber state
    await firstRefetch;

    expect(useGameStore.getState().roster![0]!.lifeStatus).toBe('DEAD');
  });

  it('reset() clears roomCode/roster and persists the clear', async () => {
    const { useGameStore } = await import('./gameStore');
    getRoomByCodeMock.mockResolvedValue(makeRoomSummary());
    useGameStore.getState().setRoomCode('ABCDEF');
    await vi.advanceTimersByTimeAsync(150);

    useGameStore.getState().reset();

    expect(useGameStore.getState().roomCode).toBeNull();
    expect(useGameStore.getState().roster).toBeNull();
  });
});

describe('gameStore — lastDeaths: the day-start/elimination announcement (F5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('a roster refetch that finds a newly-dead player sets lastDeaths, tagged NIGHT when leaving NIGHT', async () => {
    const { useGameStore } = await import('./gameStore');
    getRoomByCodeMock.mockResolvedValueOnce(makeRoomSummary());
    useGameStore.getState().setRoomCode('ABCDEF');
    await vi.advanceTimersByTimeAsync(150); // seeds the initial (all-alive) roster snapshot

    getRoomByCodeMock.mockResolvedValueOnce(
      makeRoomSummary({
        players: [
          { playerId: 'player-1', displayName: 'Me', avatarUrl: null, isReady: true, isHost: true, joinedAt: 't', lifeStatus: 'ALIVE' },
          { playerId: 'player-2', displayName: 'Other', avatarUrl: null, isReady: true, isHost: false, joinedAt: 't', lifeStatus: 'DEAD' },
        ],
      }),
    );
    useGameStore.getState().applyPhaseChanged({ from: 'NIGHT', to: 'NIGHT_RESOLUTION', round: 1 });
    await vi.advanceTimersByTimeAsync(150);

    expect(useGameStore.getState().lastDeaths).toEqual({ playerIds: ['player-2'], context: 'NIGHT' });
  });

  it('tags the diff VOTE when the transition left VOTING', async () => {
    const { useGameStore } = await import('./gameStore');
    getRoomByCodeMock.mockResolvedValueOnce(makeRoomSummary());
    useGameStore.getState().setRoomCode('ABCDEF');
    await vi.advanceTimersByTimeAsync(150);

    getRoomByCodeMock.mockResolvedValueOnce(
      makeRoomSummary({
        players: [
          { playerId: 'player-1', displayName: 'Me', avatarUrl: null, isReady: true, isHost: true, joinedAt: 't', lifeStatus: 'DEAD' },
          { playerId: 'player-2', displayName: 'Other', avatarUrl: null, isReady: true, isHost: false, joinedAt: 't', lifeStatus: 'ALIVE' },
        ],
      }),
    );
    useGameStore.getState().applyPhaseChanged({ from: 'VOTING', to: 'VOTE_RESOLUTION', round: 1 });
    await vi.advanceTimersByTimeAsync(150);

    expect(useGameStore.getState().lastDeaths).toEqual({ playerIds: ['player-1'], context: 'VOTE' });
  });

  it('clears to null once a later refetch finds no new deaths', async () => {
    const { useGameStore } = await import('./gameStore');
    getRoomByCodeMock.mockResolvedValueOnce(makeRoomSummary());
    useGameStore.getState().setRoomCode('ABCDEF');
    await vi.advanceTimersByTimeAsync(150);

    getRoomByCodeMock.mockResolvedValueOnce(
      makeRoomSummary({
        players: [
          { playerId: 'player-1', displayName: 'Me', avatarUrl: null, isReady: true, isHost: true, joinedAt: 't', lifeStatus: 'ALIVE' },
          { playerId: 'player-2', displayName: 'Other', avatarUrl: null, isReady: true, isHost: false, joinedAt: 't', lifeStatus: 'DEAD' },
        ],
      }),
    );
    useGameStore.getState().applyPhaseChanged({ from: 'NIGHT', to: 'NIGHT_RESOLUTION', round: 1 });
    await vi.advanceTimersByTimeAsync(150);
    expect(useGameStore.getState().lastDeaths).not.toBeNull();

    getRoomByCodeMock.mockResolvedValueOnce(makeRoomSummary({ players: [] })); // no change, nothing new
    useGameStore.getState().applyPhaseChanged({ from: 'MORNING', to: 'DISCUSSION', round: 1 });
    await vi.advanceTimersByTimeAsync(150);

    expect(useGameStore.getState().lastDeaths).toBeNull();
  });
});

describe('gameStore — myVote / voteTally (F5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('applyVoteSubmitted sets myVote from the POST /votes response', async () => {
    const { useGameStore } = await import('./gameStore');
    useGameStore.getState().applyVoteSubmitted({
      voteId: 'v1',
      gameId: 'game-1',
      phaseId: 'phase-1',
      voterPlayerId: 'player-1',
      targetPlayerId: 'player-2',
    });

    expect(useGameStore.getState().myVote).toBe('player-2');
  });

  it('applyPhaseChanged clears myVote and voteTally on every phase change', async () => {
    const { useGameStore } = await import('./gameStore');
    useGameStore.setState({ gameId: 'game-1' }); // refetchVoteTally no-ops without one
    useGameStore.getState().applyVoteSubmitted({
      voteId: 'v1',
      gameId: 'game-1',
      phaseId: 'phase-1',
      voterPlayerId: 'player-1',
      targetPlayerId: 'player-2',
    });
    getVoteTallyMock.mockResolvedValue([{ voterPlayerId: 'player-1', targetPlayerId: 'player-2' }]);
    useGameStore.getState().applyPhaseChanged({ from: 'DISCUSSION', to: 'VOTING', round: 1 });
    await vi.advanceTimersByTimeAsync(150);
    expect(useGameStore.getState().voteTally).not.toBeNull();

    useGameStore.getState().applyPhaseChanged({ from: 'VOTING', to: 'VOTE_RESOLUTION', round: 1 });

    expect(useGameStore.getState().myVote).toBeNull();
    expect(useGameStore.getState().voteTally).toBeNull(); // cleared immediately, before the new refetch resolves
  });

  it('applyVoteCast schedules a debounced tally refetch (not a patch from the event payload)', async () => {
    const { useGameStore } = await import('./gameStore');
    getGameStateMock.mockResolvedValue(makeSnapshot());
    await useGameStore.getState().initFromGameId('game-1');

    getVoteTallyMock.mockResolvedValue([{ voterPlayerId: 'player-1', targetPlayerId: 'player-2' }]);
    useGameStore.getState().applyVoteCast();

    expect(getVoteTallyMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(getVoteTallyMock).toHaveBeenCalledWith('game-1');
    expect(useGameStore.getState().voteTally).toEqual([{ voterPlayerId: 'player-1', targetPlayerId: 'player-2' }]);
  });

  it('refetchVoteTally is a no-op when gameId is not known', async () => {
    const { useGameStore } = await import('./gameStore');
    await useGameStore.getState().refetchVoteTally();
    expect(getVoteTallyMock).not.toHaveBeenCalled();
  });

  it('drops a vote-tally response superseded by a later refetch before it resolves', async () => {
    const { useGameStore } = await import('./gameStore');
    getGameStateMock.mockResolvedValue(makeSnapshot());
    await useGameStore.getState().initFromGameId('game-1');

    let resolveFirst!: (value: { voterPlayerId: string; targetPlayerId: string }[]) => void;
    getVoteTallyMock.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    const firstRefetch = useGameStore.getState().refetchVoteTally();

    getVoteTallyMock.mockResolvedValueOnce([{ voterPlayerId: 'player-1', targetPlayerId: 'player-3' }]);
    await useGameStore.getState().refetchVoteTally(); // second call resolves first

    expect(useGameStore.getState().voteTally).toEqual([{ voterPlayerId: 'player-1', targetPlayerId: 'player-3' }]);

    resolveFirst([{ voterPlayerId: 'player-1', targetPlayerId: 'player-2' }]); // stale
    await firstRefetch;

    expect(useGameStore.getState().voteTally).toEqual([{ voterPlayerId: 'player-1', targetPlayerId: 'player-3' }]);
  });
});

describe('gameStore — applyGameFinished (F5/F5.1)', () => {
  it('sets a provisional gameResult (winnerTeam only) from the GAME_FINISHED payload', async () => {
    const { useGameStore } = await import('./gameStore');
    useGameStore.getState().applyGameFinished('TOWN');

    expect(useGameStore.getState().gameResult).toEqual({ winnerTeam: 'TOWN', finishedAt: null, players: null });
  });

  it('accepts a null winnerTeam without crashing', async () => {
    const { useGameStore } = await import('./gameStore');
    useGameStore.getState().applyGameFinished(null);

    expect(useGameStore.getState().gameResult).toEqual({ winnerTeam: null, finishedAt: null, players: null });
  });

  it('reset() clears gameResult back to null', async () => {
    const { useGameStore } = await import('./gameStore');
    useGameStore.getState().applyGameFinished('MAFIA');
    useGameStore.getState().reset();

    expect(useGameStore.getState().gameResult).toBeNull();
  });

  it('triggers a getGameState refetch so the full role reveal arrives', async () => {
    const { useGameStore } = await import('./gameStore');
    await useGameStore.getState().initFromGameId('game-1'); // seeds gameId
    getGameStateMock.mockClear();
    getGameStateMock.mockResolvedValue(
      makeSnapshot({
        status: 'FINISHED',
        currentPhase: 'GAME_OVER',
        result: {
          winnerTeam: 'TOWN',
          finishedAt: '2026-01-01T00:20:00.000Z',
          players: [{ playerId: 'player-1', displayName: 'Me', roleCode: 'CIVILIAN', team: 'TOWN', lifeStatus: 'ALIVE' }],
        },
      }),
    );

    useGameStore.getState().applyGameFinished('TOWN');
    await vi.waitFor(() => {
      expect(useGameStore.getState().gameResult?.players).not.toBeNull();
    });

    expect(getGameStateMock).toHaveBeenCalledWith('game-1');
    expect(useGameStore.getState().gameResult).toEqual({
      winnerTeam: 'TOWN',
      finishedAt: '2026-01-01T00:20:00.000Z',
      players: [{ playerId: 'player-1', displayName: 'Me', roleCode: 'CIVILIAN', team: 'TOWN', lifeStatus: 'ALIVE' }],
    });
  });
});

describe('gameStore — gameResult REST source (F5.1)', () => {
  const resultPayload = {
    winnerTeam: 'MAFIA' as const,
    finishedAt: '2026-01-01T00:30:00.000Z',
    players: [
      { playerId: 'player-1', displayName: 'Me', roleCode: 'CIVILIAN' as const, team: 'TOWN' as const, lifeStatus: 'DEAD' as const },
      { playerId: 'player-2', displayName: 'Other', roleCode: 'MAFIA' as const, team: 'MAFIA' as const, lifeStatus: 'ALIVE' as const },
    ],
  };

  it('initFromGameId populates gameResult straight away when the snapshot is already FINISHED (reload path)', async () => {
    const { useGameStore } = await import('./gameStore');
    getGameStateMock.mockResolvedValue(
      makeSnapshot({ status: 'FINISHED', currentPhase: 'GAME_OVER', result: resultPayload }),
    );

    await useGameStore.getState().initFromGameId('game-1');

    const s = useGameStore.getState();
    expect(s.status).toBe('FINISHED');
    expect(s.gameResult).toEqual(resultPayload);
  });

  it('refetchState populates gameResult once the game has finished', async () => {
    const { useGameStore } = await import('./gameStore');
    await useGameStore.getState().initFromGameId('game-1');
    expect(useGameStore.getState().gameResult).toBeNull();

    getGameStateMock.mockResolvedValue(
      makeSnapshot({ status: 'FINISHED', currentPhase: 'GAME_OVER', result: resultPayload }),
    );
    await useGameStore.getState().refetchState();

    expect(useGameStore.getState().gameResult).toEqual(resultPayload);
  });

  it('a snapshot with no result field (not yet FINISHED) leaves gameResult untouched', async () => {
    const { useGameStore } = await import('./gameStore');
    getGameStateMock.mockResolvedValue(makeSnapshot());

    await useGameStore.getState().initFromGameId('game-1');

    expect(useGameStore.getState().gameResult).toBeNull();
  });

  it('REST wins when a later REST result disagrees with an earlier GAME_FINISHED event', async () => {
    const { useGameStore } = await import('./gameStore');
    await useGameStore.getState().initFromGameId('game-1');

    useGameStore.getState().applyGameFinished('TOWN'); // provisional, event-sourced
    expect(useGameStore.getState().gameResult).toEqual({ winnerTeam: 'TOWN', finishedAt: null, players: null });

    getGameStateMock.mockResolvedValue(
      makeSnapshot({ status: 'FINISHED', currentPhase: 'GAME_OVER', result: resultPayload }), // disagrees: MAFIA
    );
    await useGameStore.getState().refetchState();

    expect(useGameStore.getState().gameResult).toEqual(resultPayload); // REST (MAFIA) wins over the event (TOWN)
  });

  it('a GAME_FINISHED event arriving after REST already supplied the full result is ignored', async () => {
    const { useGameStore } = await import('./gameStore');
    getGameStateMock.mockResolvedValue(
      makeSnapshot({ status: 'FINISHED', currentPhase: 'GAME_OVER', result: resultPayload }),
    );
    await useGameStore.getState().initFromGameId('game-1');
    expect(useGameStore.getState().gameResult).toEqual(resultPayload);

    useGameStore.getState().applyGameFinished('TOWN'); // stale/late event, disagrees with REST

    expect(useGameStore.getState().gameResult).toEqual(resultPayload); // unchanged — REST already won
  });

  it('an unrecognized winnerTeam string is stored as-is rather than guessed or dropped', async () => {
    const { useGameStore } = await import('./gameStore');
    getGameStateMock.mockResolvedValue(
      makeSnapshot({
        status: 'FINISHED',
        currentPhase: 'GAME_OVER',
        result: { ...resultPayload, winnerTeam: 'SOME_FUTURE_TEAM' },
      }),
    );

    await useGameStore.getState().initFromGameId('game-1');

    expect(useGameStore.getState().gameResult?.winnerTeam).toBe('SOME_FUTURE_TEAM');
  });
});
