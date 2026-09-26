import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginTelegramDto } from './dto/login-telegram.dto';
import {
  AUTH_TELEGRAM_RATE_LIMIT,
  AUTH_TELEGRAM_RATE_LIMIT_TTL_MS,
  AUTH_TELEGRAM_THROTTLER_NAME,
} from './auth.constants';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Public, unauthenticated endpoint — rate limited to 10 req/min per IP
   * (Master TZ §30's endpoint table, carried forward from v5.0 §32.1), which
   * is the "rate limit" step of the canonical command path (§6.3).
   */
  @Post('telegram')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    [AUTH_TELEGRAM_THROTTLER_NAME]: {
      limit: AUTH_TELEGRAM_RATE_LIMIT,
      ttl: AUTH_TELEGRAM_RATE_LIMIT_TTL_MS,
    },
  })
  login(@Body() dto: LoginTelegramDto) {
    return this.authService.loginWithTelegram(dto.initData, dto.launchToken);
  }
}
