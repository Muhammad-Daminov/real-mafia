import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error codes for night-action submission (§17.1-§17.3). Mirrors
 * `RoomException`'s shape (`src/rooms/rooms.errors.ts`) — a stable `code` in
 * the response body alongside the HTTP status.
 */
export enum NightActionErrorCode {
  GAME_NOT_FOUND = 'GAME_NOT_FOUND',
  GAME_NOT_IN_NIGHT_PHASE = 'GAME_NOT_IN_NIGHT_PHASE',
  PLAYER_NOT_IN_GAME = 'PLAYER_NOT_IN_GAME',
  PLAYER_NOT_ALIVE = 'PLAYER_NOT_ALIVE',
  ROLE_HAS_NO_SUCH_ACTION = 'ROLE_HAS_NO_SUCH_ACTION',
  ABILITY_ALREADY_USED = 'ABILITY_ALREADY_USED',
  DOCTOR_REPEAT_PROTECTION = 'DOCTOR_REPEAT_PROTECTION',
  INVALID_TARGET = 'INVALID_TARGET',
}

const STATUS_BY_CODE: Record<NightActionErrorCode, HttpStatus> = {
  [NightActionErrorCode.GAME_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [NightActionErrorCode.GAME_NOT_IN_NIGHT_PHASE]: HttpStatus.CONFLICT,
  [NightActionErrorCode.PLAYER_NOT_IN_GAME]: HttpStatus.NOT_FOUND,
  [NightActionErrorCode.PLAYER_NOT_ALIVE]: HttpStatus.CONFLICT,
  [NightActionErrorCode.ROLE_HAS_NO_SUCH_ACTION]: HttpStatus.FORBIDDEN,
  [NightActionErrorCode.ABILITY_ALREADY_USED]: HttpStatus.CONFLICT,
  [NightActionErrorCode.DOCTOR_REPEAT_PROTECTION]: HttpStatus.CONFLICT,
  [NightActionErrorCode.INVALID_TARGET]: HttpStatus.UNPROCESSABLE_ENTITY,
};

export class NightActionException extends HttpException {
  constructor(
    readonly code: NightActionErrorCode,
    message: string,
  ) {
    super({ code, message }, STATUS_BY_CODE[code]);
  }
}
