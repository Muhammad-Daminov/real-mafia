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

/**
 * The real cause behind the last failed `authenticate()` call — invisible
 * before this (every failure collapsed into the same uz "session expired"
 * text in Telegram). Only `?debug=1` renders this; normal users keep the
 * existing uz message (`App.tsx` is unchanged).
 */
export type AuthFailureKind = 'network' | 'http' | 'no_initdata' | 'restored_token_rejected';

export interface AuthFailureDetail {
  kind: AuthFailureKind;
  /** e.g. `'POST /auth/telegram'` or `'GET /users/me'` — absent for `no_initdata`, which never reaches a network call. */
  endpoint?: string;
  /** HTTP status, when the failure actually got a response (`ApiError`). */
  status?: number;
  /** Backend error code (`ApiError.code`), when the response body carried one. */
  code?: string;
  message: string;
}

interface AuthState {
  status: AuthStatus;
  user: TelegramUser | null;
  error: string | null;
  /** The detail behind `error`/`session_expired`/`not_in_telegram` —
   * `null` while `idle`/`authenticating`/`authenticated`. */
  failure: AuthFailureDetail | null;
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

/**
 * A stored token is only "genuinely invalid" if the server explicitly said
 * so (401) — anything else (network failure, 5xx) is transient and tells us
 * nothing about the token itself. This distinction is what item 4's fix
 * hinges on: falling through to `authenticateWithTelegram` on a transient
 * failure would spend the one-time `initData` (OD-F1-001) chasing a
 * problem a plain retry of *this* call would have fixed on its own, and —
 * worse — land on a misleading `session_expired` if that `initData` was
 * already consumed earlier in this same tab (e.g. a reconnect-triggered
 * re-`authenticate()`), even though the original token might still be
 * perfectly fine.
 */
function isGenuineRejection(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function classifyApiFailure(error: unknown, endpoint: string, restoredToken: boolean): AuthFailureDetail {
  if (error instanceof ApiError) {
    return {
      kind: restoredToken ? 'restored_token_rejected' : 'http',
      endpoint,
      status: error.status,
      code: error.code,
      message: error.message,
    };
  }
  return {
    kind: restoredToken ? 'restored_token_rejected' : 'network',
    endpoint,
    message: error instanceof Error ? error.message : String(error),
  };
}

/** Plain-English one-liner for the debug screen — e.g. `"POST
 * /auth/telegram -> 400 INIT_DATA_INVALID"` or `"network error (request
 * never reached the server)"`. Never shown to normal users (`App.tsx`'s
 * uz-only error branches are unchanged). */
export function describeAuthFailure(detail: AuthFailureDetail | null): string | null {
  if (!detail) return null;

  switch (detail.kind) {
    case 'no_initdata':
      return `no initData available (${detail.message})`;
    case 'network':
      return `${detail.endpoint ? `${detail.endpoint} -> ` : ''}network error (request never reached the server)`;
    case 'http':
      return `${detail.endpoint} -> ${detail.status}${detail.code ? ` ${detail.code}` : ''}`;
    case 'restored_token_rejected':
      return detail.status
        ? `stored token rejected: ${detail.endpoint} -> ${detail.status}${detail.code ? ` ${detail.code}` : ''}`
        : `stored token rejected: ${detail.endpoint} -> network error (request never reached the server)`;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  user: null,
  error: null,
  failure: null,

  authenticate: async () => {
    set({ status: 'authenticating', error: null, failure: null });

    const stored = getStoredToken();
    if (stored && !isTokenExpired(stored)) {
      setToken(stored);
      try {
        const user = await fetchMe();
        set({ status: 'authenticated', user, error: null, failure: null });
        return stored;
      } catch (error) {
        const failure = classifyApiFailure(error, 'GET /users/me', true);

        if (!isGenuineRejection(error)) {
          // Transient (network/5xx) — see isGenuineRejection's docstring.
          // Surface directly as a retryable error instead of falling
          // through to a fresh initData login.
          set({ status: 'error', user: null, error: failure.message, failure });
          return null;
        }
        // 401: the token really is invalid server-side — fall through to
        // the normal initData login below. `failure` is overwritten by
        // whatever that attempt itself produces (success included).
      }
    }

    let initData: string;
    try {
      initData = getRawInitData();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure: AuthFailureDetail = { kind: 'no_initdata', message };

      if (error instanceof NotInTelegramError) {
        set({ status: 'not_in_telegram', error: message, failure });
        return null;
      }
      set({ status: 'error', error: message, failure });
      return null;
    }

    try {
      const response = await authenticateWithTelegram(initData);
      setToken(response.accessToken);
      set({ status: 'authenticated', user: response.user, error: null, failure: null });
      return response.accessToken;
    } catch (error) {
      setToken(null);
      const failure = classifyApiFailure(error, 'POST /auth/telegram', false);
      set({ status: isRetryable(error) ? 'error' : 'session_expired', user: null, error: failure.message, failure });
      return null;
    }
  },
}));
