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

  it('a stored token that looks valid locally but the server rejects (fetchMe fails) falls through to initData login', async () => {
    getStoredTokenMock.mockReturnValue(makeToken(Math.floor(Date.now() / 1000) + 3600));
    const { ApiError } = await import('../api/client');
    fetchMeMock.mockRejectedValue(new ApiError('Unauthorized', 401));
    getRawInitDataMock.mockReturnValue('raw-init-data');
    authenticateWithTelegramMock.mockResolvedValue({ accessToken: 'fresh-jwt', user: fakeUser });

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().authenticate();

    expect(authenticateWithTelegramMock).toHaveBeenCalled();
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
