import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

/** B-D1: `count` is the number of bots *requested*; the service caps it to
 * the room's remaining capacity — see `DevToolsService.fillBots`. */
export class FillBotsDto {
  @IsInt()
  @Min(1)
  count!: number;

  @IsOptional()
  @IsBoolean()
  ready?: boolean;
}
