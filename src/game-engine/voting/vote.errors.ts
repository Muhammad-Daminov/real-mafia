import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error codes for day-vote casting (§16/OD-018/OD-020). Mirrors
 * `NightActionException`'s shape (`night-actions/night-action.errors.ts`).
 */
export enum VoteErrorCode {
  GAME_NOT_FOUND = 'GAME_NOT_FOUND',
  GAME_NOT_IN_VOTING_PHASE = 'GAME_NOT_IN_VOTING_PHASE',
  PLAYER_NOT_IN_GAME = 'PLAYER_NOT_IN_GAME',
  PLAYER_NOT_ALIVE = 'PLAYER_NOT_ALIVE',
  INVALID_TARGET = 'INVALID_TARGET',
}

const STATUS_BY_CODE: Record<VoteErrorCode, HttpStatus> = {
  [VoteErrorCode.GAME_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [VoteErrorCode.GAME_NOT_IN_VOTING_PHASE]: HttpStatus.CONFLICT,
  [VoteErrorCode.PLAYER_NOT_IN_GAME]: HttpStatus.NOT_FOUND,
  [VoteErrorCode.PLAYER_NOT_ALIVE]: HttpStatus.CONFLICT,
  [VoteErrorCode.INVALID_TARGET]: HttpStatus.UNPROCESSABLE_ENTITY,
};

export class VoteException extends HttpException {
  constructor(
    readonly code: VoteErrorCode,
    message: string,
  ) {
    super({ code, message }, STATUS_BY_CODE[code]);
  }
}
