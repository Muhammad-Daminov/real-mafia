import { create } from 'zustand';
import { ApiError, authenticateWithTelegram, getStoredToken, setToken } from '../api/client';
import { fetchMe } from '../api/users';
import { getRawInitData, NotInTelegramError } from '../telegram/initData';
import { isTokenExpired } from '../auth/jwt';
import type { TelegramUser } from '../api/types';

/**
 * `session_expired` is distinct from `error`: OD-F1-003's whole point is
 * that a 4xx from `POST /auth/telegram` (bad/expired/replayed `initData`,
 * `TelegramReplayGuardService`) can never be fixed by retrying with the
 * same `initData` — Telegram only issues a fresh one when the Mini App is
 * actually relaunched. `error` stays reserved for genuinely retryable
 * failures (network failure, 5xx) where a "Retry auth" button makes sense.
 */
export type AuthStatus =
  | 'idle'
  | 'authenticating'
  | 'authenticated'
  | 'not_in_telegram'
  | 'error'
  | 'session_expired';

interface AuthState {
  status: AuthStatus;
  user: TelegramUser | null;
  error: string | null;
  /**
   * Runs on app start: restores a still-valid stored token
   * (sessionStorage, OD-F1-003) if one exists, skipping `POST
   * /auth/telegram` entirely; otherwise (or if the restore attempt itself
   * fails) falls through to the normal Telegram `initData` login. Also
   * reused as the re-auth attempt on socket `connect_error` (see
   * socketClient.ts) — returns the fresh token on success so the caller
   * can retry the socket connect without waiting on a state subscription.
   */
  authenticate: () => Promise<string | null>;
}

/** `ApiError.status < 500` from the login call is never retry-worthy — see `AuthStatus`'s docstring. */
function isRetryable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  user: null,
  error: null,

  authenticate: async () => {
    set({ status: 'authenticating', error: null });

    const stored = getStoredToken();
    if (stored && !isTokenExpired(stored)) {
      setToken(stored);
      try {
        const user = await fetchMe();
        set({ status: 'authenticated', user, error: null });
        return stored;
      } catch {
        // Restore failed (401 already cleared the stored token via
        // apiFetch, or a network/5xx hiccup) — fall through to the normal
        // initData login below rather than getting stuck.
      }
    }

    let initData: string;
    try {
      initData = getRawInitData();
    } catch (error) {
      if (error instanceof NotInTelegramError) {
        set({ status: 'not_in_telegram', error: error.message });
        return null;
      }
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      return null;
    }

    try {
      const response = await authenticateWithTelegram(initData);
      setToken(response.accessToken);
      set({ status: 'authenticated', user: response.user, error: null });
      return response.accessToken;
    } catch (error) {
      setToken(null);
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      set({ status: isRetryable(error) ? 'error' : 'session_expired', user: null, error: message });
      return null;
    }
  },
}));
