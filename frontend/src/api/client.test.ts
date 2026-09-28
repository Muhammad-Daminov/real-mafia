import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API_URL = 'http://localhost:3000';

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', API_URL);
  vi.stubGlobal('fetch', vi.fn());
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
});
