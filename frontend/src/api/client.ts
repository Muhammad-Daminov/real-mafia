import { requireApiUrl } from '../config/env';
import { readStoredToken, writeStoredToken } from '../auth/tokenStorage';
import type { ApiErrorBody, LoginResponse } from './types';

/**
 * OD-F1-003: an in-memory variable is still the source of truth read on
 * every request (`getToken`), but `setToken` also persists to
 * `sessionStorage` (../auth/tokenStorage.ts) — see that OD for why this
 * deviates from "memory only". `getStoredToken` is the app-start restore
 * path's entry point; it does not itself populate `currentToken` — the
 * caller (auth store) decides whether the stored token is still usable
 * (not expired) before calling `setToken` with it.
 */
let currentToken: string | null = null;

export function getToken(): string | null {
  return currentToken;
}

export function setToken(token: string | null): void {
  currentToken = token;
  writeStoredToken(token);
}

export function getStoredToken(): string | null {
  return readStoredToken();
}

export class ApiError extends Error {
  readonly status: number;
  /**
   * Set only for `RoomException`-shaped bodies (`{ code, message }`,
   * ../../../src/rooms/rooms.errors.ts) — undefined for the generic Nest
   * `{ statusCode, message, error }` shape, which has no such field.
   */
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function messageFrom(body: unknown, fallback: string): string {
  const candidate = body as Partial<ApiErrorBody> | null;
  const message = candidate?.message;

  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message) && message.length > 0) {
    return message.join(', ');
  }
  return fallback;
}

function codeFrom(body: unknown): string | undefined {
  const candidate = body as Partial<ApiErrorBody> | null;
  return typeof candidate?.code === 'string' ? candidate.code : undefined;
}

/**
 * Typed fetch wrapper that attaches `Authorization: Bearer <token>` from the
 * in-memory store whenever one is set. Callers that must run unauthenticated
 * (`authenticateWithTelegram` below) go through plain `fetch` instead.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');

  if (currentToken) {
    headers.set('Authorization', `Bearer ${currentToken}`);
  }

  const response = await fetch(`${requireApiUrl()}${path}`, { ...init, headers });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);

    // A 401 from any authenticated call means the current token is no
    // longer usable server-side (expired, rejected, whatever the cause) —
    // clear it (memory + sessionStorage) so nothing keeps retrying with it.
    if (response.status === 401) {
      setToken(null);
    }

    throw new ApiError(messageFrom(body, response.statusText), response.status, codeFrom(body));
  }

  return response.json() as Promise<T>;
}

/**
 * `POST /auth/telegram` (src/auth/auth.controller.ts) — public, unauthenticated.
 * Does not go through `apiFetch` since it must never attach a stale bearer
 * token, and a 400 here (bad/expired/replayed initData) is this function's
 * own well-defined failure mode, not a generic `apiFetch` caller's problem.
 */
export async function authenticateWithTelegram(
  initData: string,
  launchToken?: string,
): Promise<LoginResponse> {
  const response = await fetch(`${requireApiUrl()}/auth/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(launchToken ? { initData, launchToken } : { initData }),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new ApiError(messageFrom(body, 'Telegram authentication failed'), response.status);
  }

  return response.json() as Promise<LoginResponse>;
}
