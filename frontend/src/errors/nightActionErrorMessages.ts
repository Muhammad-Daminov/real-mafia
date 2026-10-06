import { ApiError } from '../api/client';
import { uz } from '../messages/uz';

/**
 * Maps a night-action submission failure to a friendly Uzbek message.
 * Backend error codes are `NightActionErrorCode`
 * (../../../src/game-engine/night-actions/night-action.errors.ts) — every
 * member of that enum has an entry in `uz.errors` (see `messages/uz.ts`).
 * Same shape as `errors/roomErrorMessages.ts`'s `describeRoomError` — kept
 * as its own named function per domain rather than a shared generic, so a
 * reader can tell which backend error-code enum a given screen is mapping
 * against without following an extra indirection.
 */
export function describeNightActionError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && error.code in uz.errors) {
      return uz.errors[error.code as keyof typeof uz.errors];
    }
    return error.message || uz.errors.generic;
  }
  return uz.errors.network;
}
