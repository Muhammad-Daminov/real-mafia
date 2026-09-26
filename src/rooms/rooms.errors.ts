import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error codes for room creation and joining (Master TZ §15.1, §15.2, §32).
 *
 * ROOM_NOT_FOUND and HOST_ALREADY_HOSTING are named directly in §32's error
 * table. GAME_FULL and PLAYER_ALREADY_JOINED are v5.0 §33.2 codes that carry
 * forward per §32 but aren't reproduced in this doc (same class of gap as
 * OD-035's launch-token codes). GAME_NOT_JOINABLE is new — see OD-036
 * (docs/decisions/OPEN_DECISIONS.md) for why it's needed and its rationale.
 */
export enum RoomErrorCode {
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  HOST_ALREADY_HOSTING = 'HOST_ALREADY_HOSTING',
  GAME_NOT_JOINABLE = 'GAME_NOT_JOINABLE',
  GAME_FULL = 'GAME_FULL',
  PLAYER_ALREADY_JOINED = 'PLAYER_ALREADY_JOINED',
}

const STATUS_BY_CODE: Record<RoomErrorCode, HttpStatus> = {
  [RoomErrorCode.ROOM_NOT_FOUND]: HttpStatus.NOT_FOUND, // 404
  [RoomErrorCode.HOST_ALREADY_HOSTING]: HttpStatus.CONFLICT, // 409
  [RoomErrorCode.GAME_NOT_JOINABLE]: HttpStatus.CONFLICT, // 409
  [RoomErrorCode.GAME_FULL]: HttpStatus.CONFLICT, // 409
  [RoomErrorCode.PLAYER_ALREADY_JOINED]: HttpStatus.CONFLICT, // 409
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
