import { apiFetch } from './client';
import type { TelegramUser } from './types';

/**
 * `GET /users/me` (../../../src/users/users.controller.ts) — `JwtGuard`-
 * protected, identity taken from the verified token server-side. Used by
 * the token-restore path (../store/authStore.ts) to populate `user` after
 * skipping `POST /auth/telegram` for a still-valid stored token, since a
 * restored token carries no profile fields of its own (see api/types.ts's
 * `TelegramUser` docstring on why `updatedAt` is optional here).
 */
export function fetchMe(): Promise<TelegramUser> {
  return apiFetch<TelegramUser>('/users/me');
}
