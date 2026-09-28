import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A minimal fake of the `socket.io-client` `Socket` surface this module
 * actually uses (`on`, `onAny`, `disconnect`, `removeAllListeners`) — no
 * real network I/O, per the task's test instructions. `emit` here is the
 * test's own trigger helper (fires the handler registered via `.on`), not
 * the real Socket.IO client-to-server emit.
 */
function createFakeSocket() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  let anyHandler: ((eventName: string, ...args: unknown[]) => void) | null = null;

  return {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(cb);
      handlers.set(event, list);
    }),
    onAny: vi.fn((cb: (eventName: string, ...args: unknown[]) => void) => {
      anyHandler = cb;
    }),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    // test-only helpers, not part of the real Socket type
    __trigger(event: string, ...args: unknown[]) {
      for (const cb of handlers.get(event) ?? []) cb(...args);
      anyHandler?.(event, ...args);
    },
  };
}

const ioMock = vi.fn();
const authenticateMock = vi.fn();
const getRoomByCodeMock = vi.fn();

vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => ioMock(...args) }));
vi.mock('../store/authStore', () => ({
  useAuthStore: { getState: () => ({ authenticate: authenticateMock }) },
}));
vi.mock('../api/rooms', async () => {
  const actual = await vi.importActual<typeof import('../api/rooms')>('../api/rooms');
  return { ...actual, getRoomByCode: (...args: unknown[]) => getRoomByCodeMock(...args) };
});

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
  ioMock.mockReset();
  authenticateMock.mockReset();
  authenticateMock.mockResolvedValue('fresh-token');
  getRoomByCodeMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('connectSocket / socket status transitions', () => {
  it('connects to the /game namespace with an auth callback carrying gameId, and sets status connecting then connected', async () => {
    const fake = createFakeSocket();
    ioMock.mockReturnValue(fake);

    const { connectSocket } = await import('./socketClient');
    const { useSocketStore } = await import('../store/socketStore');

    connectSocket('game-abc');

    expect(ioMock).toHaveBeenCalledWith(
      'http://localhost:3000/game',
      expect.objectContaining({ auth: expect.any(Function) }),
    );
    expect(useSocketStore.getState().status).toBe('connecting');

    fake.__trigger('connect');
    expect(useSocketStore.getState().status).toBe('connected');
  });

  it('appends the received event (name + payload) to the event log via onAny, for any event including connect', async () => {
    const fake = createFakeSocket();
    ioMock.mockReturnValue(fake);

    const { connectSocket } = await import('./socketClient');
    const { useSocketStore } = await import('../store/socketStore');

    connectSocket('game-abc');
    fake.__trigger('PHASE_CHANGED', { from: 'NIGHT', to: 'MORNING', round: 1 });

    const [entry] = useSocketStore.getState().eventLog;
    expect(entry?.name).toBe('PHASE_CHANGED');
    expect(entry?.payload).toEqual({ from: 'NIGHT', to: 'MORNING', round: 1 });
  });

  it('on connect_error, sets status error and attempts exactly one re-auth per error episode', async () => {
    const fake = createFakeSocket();
    ioMock.mockReturnValue(fake);

    const { connectSocket } = await import('./socketClient');
    const { useSocketStore } = await import('../store/socketStore');

    connectSocket('game-abc');

    fake.__trigger('connect_error', new Error('jwt expired'));
    expect(useSocketStore.getState().status).toBe('error');
    expect(useSocketStore.getState().lastError).toBe('jwt expired');
    expect(authenticateMock).toHaveBeenCalledTimes(1);

    // A second connect_error in the same episode (no intervening 'connect')
    // must not trigger a second re-auth attempt.
    fake.__trigger('connect_error', new Error('jwt expired'));
    expect(authenticateMock).toHaveBeenCalledTimes(1);
  });

  it('resets the re-auth attempt flag after a successful connect, allowing one more attempt on a later error episode', async () => {
    const fake = createFakeSocket();
    ioMock.mockReturnValue(fake);

    const { connectSocket } = await import('./socketClient');

    connectSocket('game-abc');
    fake.__trigger('connect_error', new Error('jwt expired'));
    expect(authenticateMock).toHaveBeenCalledTimes(1);

    fake.__trigger('connect');
    fake.__trigger('connect_error', new Error('jwt expired again'));
    expect(authenticateMock).toHaveBeenCalledTimes(2);
  });

  it('on disconnect, sets status disconnected with the reason as lastError', async () => {
    const fake = createFakeSocket();
    ioMock.mockReturnValue(fake);

    const { connectSocket } = await import('./socketClient');
    const { useSocketStore } = await import('../store/socketStore');

    connectSocket('game-abc');
    fake.__trigger('connect');
    fake.__trigger('disconnect', 'transport close');

    expect(useSocketStore.getState().status).toBe('disconnected');
    expect(useSocketStore.getState().lastError).toBe('transport close');
  });
});

describe('lobbyStore wiring (F2)', () => {
  it('applies PLAYER_JOINED / PLAYER_LEFT / PLAYER_READY_CHANGED / HOST_TRANSFERRED / PHASE_CHANGED to lobbyStore', async () => {
    const fake = createFakeSocket();
    ioMock.mockReturnValue(fake);

    const { connectSocket } = await import('./socketClient');
    const { useLobbyStore } = await import('../store/lobbyStore');

    useLobbyStore.getState().enterFromJoin('ABCDEF', {
      roomId: 'room-1',
      gameId: 'game-abc',
      playerId: 'player-2',
      playerCount: 2,
      maxPlayers: 8,
    });

    connectSocket('game-abc');
    fake.__trigger('connect');
    getRoomByCodeMock.mockClear(); // clear the reconnect-triggered refetch call below asserts separately

    fake.__trigger('PLAYER_JOINED', {
      roomId: 'room-1',
      gameId: 'game-abc',
      playerId: 'player-3',
      playerCount: 3,
      maxPlayers: 8,
    });
    expect(useLobbyStore.getState().playerCount).toBe(3);

    fake.__trigger('PLAYER_READY_CHANGED', {
      roomId: 'room-1',
      gameId: 'game-abc',
      playerId: 'player-2',
      isReady: true,
    });
    expect(useLobbyStore.getState().myIsReady).toBe(true);

    fake.__trigger('HOST_TRANSFERRED', {
      roomId: 'room-1',
      gameId: 'game-abc',
      previousHostPlayerId: 'player-1',
      newHostPlayerId: 'player-2',
    });
    expect(useLobbyStore.getState().myIsHost).toBe(true);

    fake.__trigger('PHASE_CHANGED', { from: 'LOBBY', to: 'ROLE_REVEAL', round: 0 });
    expect(useLobbyStore.getState().currentPhase).toBe('ROLE_REVEAL');

    fake.__trigger('PLAYER_LEFT', {
      roomId: 'room-1',
      gameId: 'game-abc',
      playerId: 'player-3',
      playerCount: 2,
      newHostPlayerId: null,
      roomClosed: false,
    });
    expect(useLobbyStore.getState().playerCount).toBe(2);
  });

  it('refetches the lobby snapshot on every (re)connect when a lobby is active', async () => {
    const fake = createFakeSocket();
    ioMock.mockReturnValue(fake);
    getRoomByCodeMock.mockResolvedValue({
      roomId: 'room-1',
      code: 'ABCDEF',
      visibility: 'PRIVATE',
      status: 'OPEN',
      rulesetMode: 'NORMAL',
      maxPlayers: 8,
      gameId: 'game-abc',
      gameStatus: 'LOBBY',
      playerCount: 5,
    });

    const { connectSocket } = await import('./socketClient');
    const { useLobbyStore } = await import('../store/lobbyStore');

    useLobbyStore.getState().enterFromJoin('ABCDEF', {
      roomId: 'room-1',
      gameId: 'game-abc',
      playerId: 'player-2',
      playerCount: 2,
      maxPlayers: 8,
    });

    connectSocket('game-abc');
    fake.__trigger('connect');
    expect(getRoomByCodeMock).toHaveBeenCalledTimes(1);

    // Reconnect after a drop: refetch fires again.
    fake.__trigger('disconnect', 'transport close');
    fake.__trigger('connect');
    expect(getRoomByCodeMock).toHaveBeenCalledTimes(2);
  });

  it('does not refetch on connect when no lobby is active (e.g. the debug screen)', async () => {
    const fake = createFakeSocket();
    ioMock.mockReturnValue(fake);

    const { connectSocket } = await import('./socketClient');

    connectSocket('game-abc');
    fake.__trigger('connect');

    expect(getRoomByCodeMock).not.toHaveBeenCalled();
  });
});

describe('disconnectSocket', () => {
  it('tears down listeners, disconnects the socket, and resets the store to idle', async () => {
    const fake = createFakeSocket();
    ioMock.mockReturnValue(fake);

    const { connectSocket, disconnectSocket } = await import('./socketClient');
    const { useSocketStore } = await import('../store/socketStore');

    connectSocket('game-abc');
    fake.__trigger('connect');

    disconnectSocket();

    expect(fake.removeAllListeners).toHaveBeenCalled();
    expect(fake.disconnect).toHaveBeenCalled();
    expect(useSocketStore.getState().status).toBe('idle');
  });

  it('is a no-op-safe call when nothing is connected yet', async () => {
    const { disconnectSocket, getSocket } = await import('./socketClient');

    expect(() => disconnectSocket()).not.toThrow();
    expect(getSocket()).toBeNull();
  });
});
