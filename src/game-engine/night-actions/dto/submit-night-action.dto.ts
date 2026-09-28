import { ActionType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** §17.1/§17.3. The game id is a route param, not body. */
export class SubmitNightActionDto {
  @IsNotEmpty()
  @IsString()
  clientRequestId!: string;

  @IsEnum(ActionType)
  actionType!: ActionType;

  @IsNotEmpty()
  @IsString()
  targetPlayerId!: string;

  /** Journalist's INVESTIGATE_PAIR second target — omitted for every other action. */
  @IsOptional()
  @IsString()
  targetPlayerId2?: string;
}
