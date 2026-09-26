import { IsNotEmpty, IsString } from 'class-validator';

/** Master TZ §15.3 / OD-037 (OD-013: explicit handoff, distinct from leave's automatic transfer). */
export class TransferHostDto {
  @IsNotEmpty()
  @IsString()
  clientRequestId!: string;

  @IsNotEmpty()
  @IsString()
  targetPlayerId!: string;
}
