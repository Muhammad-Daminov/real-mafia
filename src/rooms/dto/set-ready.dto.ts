import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';

/** Master TZ §15.3 / OD-037 (OD-014: display-only, does not gate StartGame). */
export class SetReadyDto {
  @IsNotEmpty()
  @IsString()
  clientRequestId!: string;

  @IsBoolean()
  isReady!: boolean;
}
