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

describe('readStoredToken / writeStoredToken', () => {
  it('returns null when nothing has been written', async () => {
    const { readStoredToken } = await import('./tokenStorage');
    expect(readStoredToken()).toBeNull();
  });

  it('round-trips a written token', async () => {
    const { readStoredToken, writeStoredToken } = await import('./tokenStorage');
    writeStoredToken('token-abc');
    expect(readStoredToken()).toBe('token-abc');
  });

  it('removes the stored token when written with null', async () => {
    const { readStoredToken, writeStoredToken } = await import('./tokenStorage');
    writeStoredToken('token-abc');
    writeStoredToken(null);
    expect(readStoredToken()).toBeNull();
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

    const { readStoredToken, writeStoredToken } = await import('./tokenStorage');
    expect(() => writeStoredToken('x')).not.toThrow();
    expect(readStoredToken()).toBeNull();
  });
});
