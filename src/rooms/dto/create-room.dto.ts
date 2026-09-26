import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { RoomVisibility, RulesetMode } from '@prisma/client';

/**
 * Master TZ §15.1 / §30.1. `clientRequestId` is required per §19's
 * idempotency mechanism — every state-changing command needs one.
 */
export class CreateRoomDto {
  @IsNotEmpty()
  @IsString()
  clientRequestId!: string;

  /**
   * §15.1: within §13.1's row range (4-24). The MVP client caps this at 12,
   * but that's a UI affordance, not a server limit — the server accepts the
   * engine's full range.
   */
  @IsInt()
  @Min(4)
  @Max(24)
  maxPlayers!: number;

  @IsEnum(RulesetMode)
  rulesetMode!: RulesetMode;

  /**
   * §8.1/§8.2, OD-039: optional, defaults to PRIVATE — mirrors the column's
   * own `@default(PRIVATE)` rather than diverging from it.
   */
  @IsOptional()
  @IsEnum(RoomVisibility)
  visibility: RoomVisibility = RoomVisibility.PRIVATE;
}
