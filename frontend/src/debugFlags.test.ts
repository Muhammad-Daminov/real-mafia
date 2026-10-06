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

describe('isDebugMode', () => {
  it('is true when the query string is exactly ?debug=1', async () => {
    const { isDebugMode } = await import('./debugFlags');
    expect(isDebugMode('?debug=1')).toBe(true);
  });

  it('is true when debug=1 is one of several query params', async () => {
    const { isDebugMode } = await import('./debugFlags');
    expect(isDebugMode('?foo=bar&debug=1&baz=1')).toBe(true);
  });

  it('is false with no query string', async () => {
    const { isDebugMode } = await import('./debugFlags');
    expect(isDebugMode('')).toBe(false);
  });

  it('is false for any other debug value', async () => {
    const { isDebugMode } = await import('./debugFlags');
    expect(isDebugMode('?debug=true')).toBe(false);
    expect(isDebugMode('?debug=0')).toBe(false);
    expect(isDebugMode('?debug')).toBe(false);
  });

  it('is false when debug is absent entirely', async () => {
    const { isDebugMode } = await import('./debugFlags');
    expect(isDebugMode('?foo=bar')).toBe(false);
  });

  it('is unaffected by ?dev=1 (the two flags are independent)', async () => {
    const { isDebugMode } = await import('./debugFlags');
    expect(isDebugMode('?dev=1')).toBe(false);
  });
});

describe('isDevMode (no persisted flag yet)', () => {
  it('is true when the query string is exactly ?dev=1', async () => {
    const { isDevMode } = await import('./debugFlags');
    expect(isDevMode('?dev=1')).toBe(true);
  });

  it('is true when both ?debug=1 and ?dev=1 are present', async () => {
    const { isDevMode } = await import('./debugFlags');
    expect(isDevMode('?debug=1&dev=1')).toBe(true);
  });

  it('is false when only ?debug=1 is present (debug alone never implies dev)', async () => {
    const { isDevMode } = await import('./debugFlags');
    expect(isDevMode('?debug=1')).toBe(false);
  });

  it('is false with neither flag present', async () => {
    const { isDevMode } = await import('./debugFlags');
    expect(isDevMode('')).toBe(false);
    expect(isDevMode('?foo=bar')).toBe(false);
  });

  it('is false for any other dev value', async () => {
    const { isDevMode } = await import('./debugFlags');
    expect(isDevMode('?dev=true')).toBe(false);
    expect(isDevMode('?dev=0')).toBe(false);
  });
});

describe('persistDevModeFromUrl + isDevMode: sessionStorage persistence', () => {
  it('does nothing when ?dev=1 is absent — isDevMode stays false', async () => {
    const { persistDevModeFromUrl, isDevMode } = await import('./debugFlags');
    persistDevModeFromUrl('?foo=bar');
    expect(isDevMode('')).toBe(false);
  });

  it('persists ?dev=1 so a later check with NO query string still reports true (simulates in-app navigation dropping the query string)', async () => {
    const { persistDevModeFromUrl, isDevMode } = await import('./debugFlags');
    persistDevModeFromUrl('?dev=1');

    expect(isDevMode('')).toBe(true);
  });

  it('once persisted, stays true even if a later URL has no query string at all, across repeated checks', async () => {
    const { persistDevModeFromUrl, isDevMode } = await import('./debugFlags');
    persistDevModeFromUrl('?dev=1');

    expect(isDevMode('')).toBe(true);
    expect(isDevMode('?foo=bar')).toBe(true);
    expect(isDevMode('/lobby')).toBe(true);
  });

  it('degrades to a no-op/false instead of throwing when sessionStorage itself throws', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
    });

    const { persistDevModeFromUrl, isDevMode } = await import('./debugFlags');
    expect(() => persistDevModeFromUrl('?dev=1')).not.toThrow();
    // No persisted flag (storage disabled) and no query flag this time —
    // falls back to false rather than throwing.
    expect(isDevMode('')).toBe(false);
  });
});
