import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API_URL = 'http://localhost:3000';

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
  vi.stubEnv('VITE_API_URL', API_URL);
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('sessionStorage', createFakeSessionStorage());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('authenticateWithTelegram', () => {
  it('POSTs to /auth/telegram with initData only when no launchToken is given', async () => {
    const { authenticateWithTelegram } = await import('./client');
    const body = { accessToken: 'jwt', user: { id: 'u1' } };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    const result = await authenticateWithTelegram('raw-init-data');

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/auth/telegram`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ initData: 'raw-init-data' }),
      }),
    );
    expect(result).toEqual(body);
  });

  it('includes launchToken in the body when provided', async () => {
    const { authenticateWithTelegram } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'jwt', user: {} }), { status: 200 }),
    );

    await authenticateWithTelegram('raw-init-data', 'launch-token-1');

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/auth/telegram`,
      expect.objectContaining({
        body: JSON.stringify({ initData: 'raw-init-data', launchToken: 'launch-token-1' }),
      }),
    );
  });

  it('throws ApiError with the backend message on a non-2xx response', async () => {
    const { authenticateWithTelegram, ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 400, message: 'Telegram initData eskirgan' }), {
        status: 400,
      }),
    );

    await expect(authenticateWithTelegram('stale-init-data')).rejects.toMatchObject(
      new ApiError('Telegram initData eskirgan', 400),
    );
  });

  it('never attaches an Authorization header (this endpoint is unauthenticated)', async () => {
    const { authenticateWithTelegram, setToken } = await import('./client');
    setToken('some-stale-token');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'jwt', user: {} }), { status: 200 }),
    );

    await authenticateWithTelegram('raw-init-data');

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.has('Authorization')).toBe(false);
  });
});

describe('apiFetch', () => {
  it('attaches Authorization: Bearer <token> when a token is set', async () => {
    const { apiFetch, setToken } = await import('./client');
    setToken('jwt-123');
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await apiFetch('/games/abc');

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${API_URL}/games/abc`);
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-123');
  });

  it('omits Authorization when no token is set', async () => {
    const { apiFetch, setToken } = await import('./client');
    setToken(null);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await apiFetch('/games/abc');

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.has('Authorization')).toBe(false);
  });

  it('throws ApiError on a non-2xx response, joining a class-validator-style message array', async () => {
    const { apiFetch, ApiError } = await import('./client');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 400, message: ['field a is required', 'field b is required'] }), {
        status: 400,
      }),
    );

    await expect(apiFetch('/rooms')).rejects.toMatchObject(
      new ApiError('field a is required, field b is required', 400),
    );
  });

  it('clears the token (memory + sessionStorage) on a 401 response', async () => {
    const { apiFetch, setToken, getToken, getStoredToken } = await import('./client');
    setToken('jwt-123');
    expect(getStoredToken()).toBe('jwt-123');

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 401, message: 'Unauthorized' }), { status: 401 }),
    );

    await expect(apiFetch('/users/me')).rejects.toThrow();

    expect(getToken()).toBeNull();
    expect(getStoredToken()).toBeNull();
  });

  it('does not clear the token on a non-401 error (e.g. 403)', async () => {
    const { apiFetch, setToken, getToken } = await import('./client');
    setToken('jwt-123');

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'NOT_HOST', message: 'not the host' }), { status: 403 }),
    );

    await expect(apiFetch('/rooms/r1/host-transfer')).rejects.toThrow();

    expect(getToken()).toBe('jwt-123');
  });
});

describe('setToken / getStoredToken (OD-F1-003 sessionStorage persistence)', () => {
  it('persists the token to sessionStorage so it survives a fresh module load (simulating a reload)', async () => {
    const { setToken } = await import('./client');
    setToken('jwt-persisted');

    vi.resetModules();
    const { getStoredToken } = await import('./client');
    expect(getStoredToken()).toBe('jwt-persisted');
  });

  it('removes the token from sessionStorage when set back to null', async () => {
    const { setToken, getStoredToken } = await import('./client');
    setToken('jwt-a');
    expect(getStoredToken()).toBe('jwt-a');

    setToken(null);
    expect(getStoredToken()).toBeNull();
  });
});
