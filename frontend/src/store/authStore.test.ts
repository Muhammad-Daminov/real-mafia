import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getRawInitDataMock = vi.fn();
const authenticateWithTelegramMock = vi.fn();
const setTokenMock = vi.fn();
const getStoredTokenMock = vi.fn();
const fetchMeMock = vi.fn();

class FakeNotInTelegramError extends Error {}

vi.mock('../telegram/initData', () => ({
  getRawInitData: () => getRawInitDataMock(),
  NotInTelegramError: FakeNotInTelegramError,
}));

vi.mock('../api/users', () => ({
  fetchMe: () => fetchMeMock(),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ApiError: actual.ApiError,
    authenticateWithTelegram: (...args: unknown[]) => authenticateWithTelegramMock(...args),
    setToken: (...args: unknown[]) => setTokenMock(...args),
    getStoredToken: () => getStoredTokenMock(),
  };
});

function base64UrlEncode(json: unknown): string {
  return btoa(JSON.stringify(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(exp: number): string {
  return `${base64UrlEncode({ alg: 'HS256' })}.${base64UrlEncode({ sub: 'u1', telegramId: 't1', exp })}.sig`;
}

const fakeUser = {
  id: 'u1',
  telegramId: 't1',
  username: null,
  firstName: 'A',
  lastName: null,
  avatar: null,
  createdAt: 'x',
};

beforeEach(() => {
  getRawInitDataMock.mockReset();
  authenticateWithTelegramMock.mockReset();
  setTokenMock.mockReset();
  getStoredTokenMock.mockReset();
  fetchMeMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('authStore.authenticate — token restore path (OD-F1-003)', () => {
  it('valid (unexpired) stored token: skips initData login entirely, uses GET /users/me to populate the user', async () => {
    getStoredTokenMock.mockReturnValue(makeToken(Math.floor(Date.now() / 1000) + 3600));
    fetchMeMock.mockResolvedValue(fakeUser);

    const { useAuthStore } = await import('./authStore');
    const token = await useAuthStore.getState().authenticate();

    expect(getRawInitDataMock).not.toHaveBeenCalled();
    expect(authenticateWithTelegramMock).not.toHaveBeenCalled();
    expect(fetchMeMock).toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user).toEqual(fakeUser);
    expect(token).not.toBeNull();
  });

  it('expired stored token: falls through to the normal initData login flow', async () => {
    getStoredTokenMock.mockReturnValue(makeToken(Math.floor(Date.now() / 1000) - 10));
    getRawInitDataMock.mockReturnValue('raw-init-data');
    authenticateWithTelegramMock.mockResolvedValue({ accessToken: 'fresh-jwt', user: fakeUser });

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(fetchMeMock).not.toHaveBeenCalled();
    expect(authenticateWithTelegramMock).toHaveBeenCalledWith('raw-init-data');
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('missing stored token: falls through to the normal initData login flow', async () => {
    getStoredTokenMock.mockReturnValue(null);
    getRawInitDataMock.mockReturnValue('raw-init-data');
    authenticateWithTelegramMock.mockResolvedValue({ accessToken: 'fresh-jwt', user: fakeUser });

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(fetchMeMock).not.toHaveBeenCalled();
    expect(authenticateWithTelegramMock).toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('a stored token that looks valid locally but the server rejects with 401 falls through to initData login', async () => {
    getStoredTokenMock.mockReturnValue(makeToken(Math.floor(Date.now() / 1000) + 3600));
    const { ApiError } = await import('../api/client');
    fetchMeMock.mockRejectedValue(new ApiError('Unauthorized', 401));
    getRawInitDataMock.mockReturnValue('raw-init-data');
    authenticateWithTelegramMock.mockResolvedValue({ accessToken: 'fresh-jwt', user: fakeUser });

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(authenticateWithTelegramMock).toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().failure).toBeNull();
  });
});

describe('authStore.authenticate — item 4 fix: a transient restore failure must not fall through', () => {
  it('a network failure on GET /users/me does NOT attempt initData login — stays a retryable error', async () => {
    getStoredTokenMock.mockReturnValue(makeToken(Math.floor(Date.now() / 1000) + 3600));
    fetchMeMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    // The one-time initData (OD-F1-001) is never spent chasing a problem
    // that wasn't the token's fault — and the stored token itself is left
    // alone (setToken(null) is never called here), so a plain retry of
    // this same call can succeed once connectivity returns.
    expect(getRawInitDataMock).not.toHaveBeenCalled();
    expect(authenticateWithTelegramMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('error');
    expect(useAuthStore.getState().failure).toMatchObject({
      kind: 'restored_token_rejected',
      endpoint: 'GET /users/me',
    });
  });

  it('a 500 from GET /users/me (not a genuine rejection) also does NOT fall through to initData', async () => {
    getStoredTokenMock.mockReturnValue(makeToken(Math.floor(Date.now() / 1000) + 3600));
    const { ApiError } = await import('../api/client');
    fetchMeMock.mockRejectedValue(new ApiError('Internal Server Error', 500));

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(authenticateWithTelegramMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('error');
    expect(useAuthStore.getState().failure).toMatchObject({
      kind: 'restored_token_rejected',
      endpoint: 'GET /users/me',
      status: 500,
    });
  });

  it('a genuine 401 rejection, by contrast, still falls through and can reach authenticated', async () => {
    getStoredTokenMock.mockReturnValue(makeToken(Math.floor(Date.now() / 1000) + 3600));
    const { ApiError } = await import('../api/client');
    fetchMeMock.mockRejectedValue(new ApiError('Unauthorized', 401));
    getRawInitDataMock.mockReturnValue('raw-init-data');
    authenticateWithTelegramMock.mockResolvedValue({ accessToken: 'fresh-jwt', user: fakeUser });

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(authenticateWithTelegramMock).toHaveBeenCalledWith('raw-init-data');
    expect(useAuthStore.getState().status).toBe('authenticated');
  });
});

describe('authStore.authenticate — login-error-to-status mapping', () => {
  it('a 4xx ApiError from POST /auth/telegram maps to session_expired (no Retry-auth case)', async () => {
    getStoredTokenMock.mockReturnValue(null);
    getRawInitDataMock.mockReturnValue('raw-init-data');
    const { ApiError } = await import('../api/client');
    authenticateWithTelegramMock.mockRejectedValue(new ApiError('Telegram initData allaqachon ishlatilgan', 400));

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(useAuthStore.getState().status).toBe('session_expired');
    expect(useAuthStore.getState().error).toBe('Telegram initData allaqachon ishlatilgan');
  });

  it('a 5xx ApiError maps to error (retryable via "Retry auth")', async () => {
    getStoredTokenMock.mockReturnValue(null);
    getRawInitDataMock.mockReturnValue('raw-init-data');
    const { ApiError } = await import('../api/client');
    authenticateWithTelegramMock.mockRejectedValue(new ApiError('Internal Server Error', 500));

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(useAuthStore.getState().status).toBe('error');
  });

  it('a network failure (not an ApiError at all) maps to error (retryable)', async () => {
    getStoredTokenMock.mockReturnValue(null);
    getRawInitDataMock.mockReturnValue('raw-init-data');
    authenticateWithTelegramMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(useAuthStore.getState().status).toBe('error');
  });

  it('not running inside Telegram still maps to not_in_telegram, unaffected by the restore path', async () => {
    getStoredTokenMock.mockReturnValue(null);
    getRawInitDataMock.mockImplementation(() => {
      throw new FakeNotInTelegramError('nope');
    });

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(useAuthStore.getState().status).toBe('not_in_telegram');
  });
});

describe('authStore.authenticate — failure.kind mapping', () => {
  it('no_initdata: NotInTelegramError from getRawInitData', async () => {
    getStoredTokenMock.mockReturnValue(null);
    getRawInitDataMock.mockImplementation(() => {
      throw new FakeNotInTelegramError('nope');
    });

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(useAuthStore.getState().failure).toMatchObject({ kind: 'no_initdata' });
  });

  it('http: an ApiError from POST /auth/telegram, with status + code preserved', async () => {
    getStoredTokenMock.mockReturnValue(null);
    getRawInitDataMock.mockReturnValue('raw-init-data');
    const { ApiError } = await import('../api/client');
    authenticateWithTelegramMock.mockRejectedValue(new ApiError('Bad initData', 400, 'INIT_DATA_INVALID'));

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(useAuthStore.getState().failure).toMatchObject({
      kind: 'http',
      endpoint: 'POST /auth/telegram',
      status: 400,
      code: 'INIT_DATA_INVALID',
    });
  });

  it('network: a non-ApiError (plain fetch failure) from POST /auth/telegram', async () => {
    getStoredTokenMock.mockReturnValue(null);
    getRawInitDataMock.mockReturnValue('raw-init-data');
    authenticateWithTelegramMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(useAuthStore.getState().failure).toMatchObject({
      kind: 'network',
      endpoint: 'POST /auth/telegram',
    });
  });

  it('restored_token_rejected: a transient GET /users/me failure (see the item-4-fix suite above for the full behavior)', async () => {
    getStoredTokenMock.mockReturnValue(makeToken(Math.floor(Date.now() / 1000) + 3600));
    fetchMeMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(useAuthStore.getState().failure).toMatchObject({
      kind: 'restored_token_rejected',
      endpoint: 'GET /users/me',
    });
  });

  it('a successful authenticate() (either path) clears failure back to null', async () => {
    getStoredTokenMock.mockReturnValue(null);
    getRawInitDataMock.mockReturnValue('raw-init-data');
    authenticateWithTelegramMock.mockResolvedValue({ accessToken: 'fresh-jwt', user: fakeUser });

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(useAuthStore.getState().failure).toBeNull();
  });
});

describe('describeAuthFailure', () => {
  it('returns null for no failure', async () => {
    const { describeAuthFailure } = await import('./authStore');
    expect(describeAuthFailure(null)).toBeNull();
  });

  it('formats http with status + code', async () => {
    const { describeAuthFailure } = await import('./authStore');
    expect(
      describeAuthFailure({ kind: 'http', endpoint: 'POST /auth/telegram', status: 400, code: 'INIT_DATA_INVALID', message: 'x' }),
    ).toBe('POST /auth/telegram -> 400 INIT_DATA_INVALID');
  });

  it('formats http with status but no code', async () => {
    const { describeAuthFailure } = await import('./authStore');
    expect(describeAuthFailure({ kind: 'http', endpoint: 'POST /auth/telegram', status: 500, message: 'x' })).toBe(
      'POST /auth/telegram -> 500',
    );
  });

  it('formats network with an endpoint', async () => {
    const { describeAuthFailure } = await import('./authStore');
    expect(describeAuthFailure({ kind: 'network', endpoint: 'POST /auth/telegram', message: 'x' })).toBe(
      'POST /auth/telegram -> network error (request never reached the server)',
    );
  });

  it('formats no_initdata with the underlying message', async () => {
    const { describeAuthFailure } = await import('./authStore');
    expect(describeAuthFailure({ kind: 'no_initdata', message: 'Not running inside Telegram.' })).toBe(
      'no initData available (Not running inside Telegram.)',
    );
  });

  it('formats restored_token_rejected with a status', async () => {
    const { describeAuthFailure } = await import('./authStore');
    expect(
      describeAuthFailure({ kind: 'restored_token_rejected', endpoint: 'GET /users/me', status: 401, message: 'x' }),
    ).toBe('stored token rejected: GET /users/me -> 401');
  });

  it('formats restored_token_rejected without a status (network failure)', async () => {
    const { describeAuthFailure } = await import('./authStore');
    expect(describeAuthFailure({ kind: 'restored_token_rejected', endpoint: 'GET /users/me', message: 'x' })).toBe(
      'stored token rejected: GET /users/me -> network error (request never reached the server)',
    );
  });
});
