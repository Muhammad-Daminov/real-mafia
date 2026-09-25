import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TelegramReplayGuardService } from './telegram-replay-guard.service';
import { LaunchTokenService } from './launch-token.service';
import {
  AUTH_TELEGRAM_RATE_LIMIT,
  AUTH_TELEGRAM_RATE_LIMIT_TTL_MS,
  AUTH_TELEGRAM_THROTTLER_NAME,
} from './auth.constants';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: '7d',
      },
    }),
    ThrottlerModule.forRoot([
      {
        name: AUTH_TELEGRAM_THROTTLER_NAME,
        ttl: AUTH_TELEGRAM_RATE_LIMIT_TTL_MS,
        limit: AUTH_TELEGRAM_RATE_LIMIT,
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    TelegramReplayGuardService,
    LaunchTokenService,
  ],
  exports: [LaunchTokenService],
})
export class AuthModule {}
