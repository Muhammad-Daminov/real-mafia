import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * Constant-time string compare, same shape as `auth.service.ts`'s
 * `initData` hash check (length-check first — `timingSafeEqual` itself
 * throws on a length mismatch rather than returning `false` — then the
 * real constant-time comparison).
 */
function secretsMatch(expected: string, received: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(received);
  return expectedBuf.length === receivedBuf.length && timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * B-T2: `POST /telegram/webhook`'s only protection — Telegram's own
 * `X-Telegram-Bot-Api-Secret-Token` header (set via `setWebhook`'s
 * `secret_token`, see `scripts/telegram-set-webhook.ts`), compared
 * constant-time against `TELEGRAM_WEBHOOK_SECRET`. Fails CLOSED: an unset
 * `TELEGRAM_WEBHOOK_SECRET` refuses every request (401) rather than
 * accepting everything — the opposite of `common/config/cors.ts`'s
 * "unset falls back to a safe default" shape is deliberate here, since
 * there is no safe default for "no secret configured" on a route that
 * exists specifically to be hard to reach without one.
 */
@Injectable()
export class TelegramWebhookSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected) {
      throw new UnauthorizedException();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const received = request.header(SECRET_HEADER);

    if (!received || !secretsMatch(expected, received)) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
