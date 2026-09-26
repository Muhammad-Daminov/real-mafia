import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error codes for room creation, joining, leaving, readiness, and host
 * transfer (Master TZ §15.1-15.3, §32).
 *
 * ROOM_NOT_FOUND and HOST_ALREADY_HOSTING are named directly in §32's error
 * table. GAME_FULL and PLAYER_ALREADY_JOINED are v5.0 §33.2 codes that carry
 * forward per §32 but aren't reproduced in this doc (same class of gap as
 * OD-035's launch-token codes). GAME_NOT_JOINABLE is new — see OD-036.
 * ROOM_NOT_IN_LOBBY, PLAYER_NOT_IN_GAME, NOT_HOST, and TARGET_NOT_IN_GAME are
 * new — see OD-037 (docs/decisions/OPEN_DECISIONS.md) for why each is needed
 * and its rationale. NOT_ENOUGH_PLAYERS is new — see OD-040. CONFIG_INVALID
 * is a v5.0 §33.2 carry-forward code, named verbatim in §13.2's own text.
 */
export enum RoomErrorCode {
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  HOST_ALREADY_HOSTING = 'HOST_ALREADY_HOSTING',
  GAME_NOT_JOINABLE = 'GAME_NOT_JOINABLE',
  GAME_FULL = 'GAME_FULL',
  PLAYER_ALREADY_JOINED = 'PLAYER_ALREADY_JOINED',
  ROOM_NOT_IN_LOBBY = 'ROOM_NOT_IN_LOBBY',
  PLAYER_NOT_IN_GAME = 'PLAYER_NOT_IN_GAME',
  NOT_HOST = 'NOT_HOST',
  TARGET_NOT_IN_GAME = 'TARGET_NOT_IN_GAME',
  NOT_ENOUGH_PLAYERS = 'NOT_ENOUGH_PLAYERS',
  CONFIG_INVALID = 'CONFIG_INVALID',
}

const STATUS_BY_CODE: Record<RoomErrorCode, HttpStatus> = {
  [RoomErrorCode.ROOM_NOT_FOUND]: HttpStatus.NOT_FOUND, // 404
  [RoomErrorCode.HOST_ALREADY_HOSTING]: HttpStatus.CONFLICT, // 409
  [RoomErrorCode.GAME_NOT_JOINABLE]: HttpStatus.CONFLICT, // 409
  [RoomErrorCode.GAME_FULL]: HttpStatus.CONFLICT, // 409
  [RoomErrorCode.PLAYER_ALREADY_JOINED]: HttpStatus.CONFLICT, // 409
  [RoomErrorCode.ROOM_NOT_IN_LOBBY]: HttpStatus.CONFLICT, // 409
  [RoomErrorCode.PLAYER_NOT_IN_GAME]: HttpStatus.NOT_FOUND, // 404
  [RoomErrorCode.NOT_HOST]: HttpStatus.FORBIDDEN, // 403
  [RoomErrorCode.TARGET_NOT_IN_GAME]: HttpStatus.NOT_FOUND, // 404
  [RoomErrorCode.NOT_ENOUGH_PLAYERS]: HttpStatus.CONFLICT, // 409
  [RoomErrorCode.CONFIG_INVALID]: HttpStatus.UNPROCESSABLE_ENTITY, // 422
};

/**
 * Carries the stable `code` in the response body alongside the HTTP status,
 * matching the error-model shape of §32.
 */
export class RoomException extends HttpException {
  constructor(
    readonly code: RoomErrorCode,
    message: string,
  ) {
    super({ code, message }, STATUS_BY_CODE[code]);
  }
}
