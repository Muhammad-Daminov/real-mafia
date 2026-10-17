import { ApiError } from '../api/client';
import { uz } from '../messages/uz';

/**
 * Maps a day-vote submission failure to a friendly Uzbek message. Backend
 * error codes are `VoteErrorCode`
 * (../../../src/game-engine/voting/vote.errors.ts) — every member of that
 * enum has an entry in `uz.errors` (see `messages/uz.ts`). Same shape as
 * `errors/nightActionErrorMessages.ts`'s `describeNightActionError`.
 */
export function describeVoteError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && error.code in uz.errors) {
      return uz.errors[error.code as keyof typeof uz.errors];
    }
    return error.message || uz.errors.generic;
  }
  return uz.errors.network;
}
