import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Launch token lifetime ceiling (Master TZ §22.2: "<= 15 min TTL").
 *
 * This is the maximum the spec permits, and is also enforced as a CHECK
 * constraint on `game_launch_tokens` so a caller cannot exceed it.
 */
export const LAUNCH_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Error codes for launch token consumption.
 *
 * Per OD-035 (docs/decisions/OPEN_DECISIONS.md): §22.2 specifies the launch
 * token protocol, but §32's error table carries no token codes — they live in
 * v5.0 §33.2, which v6.0 both supersedes (§1.3) and references. These codes
 * were resolved by the product owner and are an addition to §32.
 *
 * Stable machine-readable codes are never localized (§27.1); only the
 * accompanying message is.
 */
export enum LaunchTokenErrorCode {
  NOT_FOUND = 'LAUNCH_TOKEN_NOT_FOUND',
  EXPIRED = 'LAUNCH_TOKEN_EXPIRED',
  ALREADY_USED = 'LAUNCH_TOKEN_ALREADY_USED',
  ROOM_MISMATCH = 'LAUNCH_TOKEN_ROOM_MISMATCH',
}

const STATUS_BY_CODE: Record<LaunchTokenErrorCode, HttpStatus> = {
  [LaunchTokenErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND, // 404
  [LaunchTokenErrorCode.EXPIRED]: HttpStatus.GONE, // 410
  [LaunchTokenErrorCode.ALREADY_USED]: HttpStatus.CONFLICT, // 409
  [LaunchTokenErrorCode.ROOM_MISMATCH]: HttpStatus.CONFLICT, // 409
};

/**
 * Carries the stable `code` in the response body alongside the HTTP status,
 * matching the error-model shape of §32.
 */
export class LaunchTokenException extends HttpException {
  constructor(
    readonly code: LaunchTokenErrorCode,
    message: string,
  ) {
    super({ code, message }, STATUS_BY_CODE[code]);
  }
}
