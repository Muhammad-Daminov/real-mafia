import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error codes for `GET /games/:gameId/state` (§31, OD-059). Mirrors
 * `NightActionException`'s shape (`src/game-engine/night-actions/night-action.errors.ts`)
 * — a stable `code` in the response body alongside the HTTP status. Only one
 * code: whether the game doesn't exist or the caller simply isn't a player
 * in it, the response is identical (404, "not in this game") — same
 * collapsing `getMyActions`/`VoteService` already use, so this endpoint
 * never confirms or denies a gameId's existence to a non-member.
 */
export enum GameStateErrorCode {
  PLAYER_NOT_IN_GAME = 'PLAYER_NOT_IN_GAME',
}

const STATUS_BY_CODE: Record<GameStateErrorCode, HttpStatus> = {
  [GameStateErrorCode.PLAYER_NOT_IN_GAME]: HttpStatus.NOT_FOUND,
};

export class GameStateException extends HttpException {
  constructor(
    readonly code: GameStateErrorCode,
    message: string,
  ) {
    super({ code, message }, STATUS_BY_CODE[code]);
  }
}
