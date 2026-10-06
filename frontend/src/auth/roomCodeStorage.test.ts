import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createFakeSessionStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => void store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', createFakeSessionStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('readStoredRoomCode / writeStoredRoomCode', () => {
  it('returns null when nothing has been written', async () => {
    const { readStoredRoomCode } = await import('./roomCodeStorage');
    expect(readStoredRoomCode()).toBeNull();
  });

  it('round-trips a written room code', async () => {
    const { readStoredRoomCode, writeStoredRoomCode } = await import('./roomCodeStorage');
    writeStoredRoomCode('ABCDEF');
    expect(readStoredRoomCode()).toBe('ABCDEF');
  });

  it('removes the stored room code when written with null', async () => {
    const { readStoredRoomCode, writeStoredRoomCode } = await import('./roomCodeStorage');
    writeStoredRoomCode('ABCDEF');
    writeStoredRoomCode(null);
    expect(readStoredRoomCode()).toBeNull();
  });

  it('degrades to a no-op/null instead of throwing when sessionStorage itself throws', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
      removeItem: () => {
        throw new Error('storage disabled');
      },
    });

    const { readStoredRoomCode, writeStoredRoomCode } = await import('./roomCodeStorage');
    expect(() => writeStoredRoomCode('ABCDEF')).not.toThrow();
    expect(readStoredRoomCode()).toBeNull();
  });
});
