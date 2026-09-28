import { IsNotEmpty, IsString } from 'class-validator';

/** §16/OD-020. The game id is a route param, not body. */
export class CastVoteDto {
  @IsNotEmpty()
  @IsString()
  clientRequestId!: string;

  /** OD-045: may equal the voter's own player id (self-vote is allowed). */
  @IsNotEmpty()
  @IsString()
  targetPlayerId!: string;
}
