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

describe('readStoredGameId / writeStoredGameId', () => {
  it('returns null when nothing has been written', async () => {
    const { readStoredGameId } = await import('./gameIdStorage');
    expect(readStoredGameId()).toBeNull();
  });

  it('round-trips a written gameId', async () => {
    const { readStoredGameId, writeStoredGameId } = await import('./gameIdStorage');
    writeStoredGameId('game-1');
    expect(readStoredGameId()).toBe('game-1');
  });

  it('removes the stored gameId when written with null', async () => {
    const { readStoredGameId, writeStoredGameId } = await import('./gameIdStorage');
    writeStoredGameId('game-1');
    writeStoredGameId(null);
    expect(readStoredGameId()).toBeNull();
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

    const { readStoredGameId, writeStoredGameId } = await import('./gameIdStorage');
    expect(() => writeStoredGameId('game-1')).not.toThrow();
    expect(readStoredGameId()).toBeNull();
  });
});
