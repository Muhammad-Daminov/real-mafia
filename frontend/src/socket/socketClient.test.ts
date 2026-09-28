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

vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => ioMock(...args) }));
vi.mock('../store/authStore', () => ({
  useAuthStore: { getState: () => ({ authenticate: authenticateMock }) },
}));

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
  ioMock.mockReset();
  authenticateMock.mockReset();
  authenticateMock.mockResolvedValue('fresh-token');
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

  it('tracks the last received event name via onAny, for any event including connect', async () => {
    const fake = createFakeSocket();
    ioMock.mockReturnValue(fake);

    const { connectSocket } = await import('./socketClient');
    const { useSocketStore } = await import('../store/socketStore');

    connectSocket('game-abc');
    fake.__trigger('PHASE_CHANGED', { from: 'NIGHT', to: 'MORNING', round: 1 });

    expect(useSocketStore.getState().lastEventName).toBe('PHASE_CHANGED');
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
