import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Master TZ §30.1's `POST /auth/telegram` contract. `launchToken` is optional
 * per §22.2 — a user who isn't entering via a room-scoped deep link
 * authenticates without one.
 */
export class LoginTelegramDto {
  @IsNotEmpty()
  @IsString()
  initData!: string;

  @IsOptional()
  @IsNotEmpty()
  @IsString()
  launchToken?: string;
}
