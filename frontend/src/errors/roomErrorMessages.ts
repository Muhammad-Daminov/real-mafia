import { ApiError } from '../api/client';
import { uz } from '../messages/uz';

/**
 * Maps a room-command failure to a friendly Uzbek message. Backend error
 * codes are `RoomErrorCode` (../../../src/rooms/rooms.errors.ts) — every
 * member of that enum has an entry in `uz.errors` (see `messages/uz.ts`).
 * An `ApiError` with no `code` (e.g. a validation 400 from class-validator,
 * or any non-`RoomException` failure) falls back to its own `message`; a
 * non-`ApiError` (network failure) falls back to `uz.errors.network`.
 */
export function describeRoomError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && error.code in uz.errors) {
      return uz.errors[error.code as keyof typeof uz.errors];
    }
    return error.message || uz.errors.generic;
  }
  return uz.errors.network;
}
