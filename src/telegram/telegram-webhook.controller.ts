import { Body, Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { TelegramWebhookSecretGuard } from './guards/telegram-webhook-secret.guard';
import { TelegramWebhookService } from './telegram-webhook.service';
import type { TelegramUpdate } from './telegram-update.types';

/**
 * B-T2: `POST /telegram/webhook` — public (no `JwtGuard`, this is
 * Telegram calling us, not an app user), gated instead by
 * `TelegramWebhookSecretGuard`. Task item 3: "after secret validation
 * always return 200 to Telegram, even if sending fails" — `@HttpCode(200)`
 * because Nest's own POST default is 201. `handleUpdate` itself never
 * throws for anything short of the guard's own 401 (every "ignore/don't
 * send" case already returns normally inside the service), but the
 * try/catch here is the backstop for a genuinely unexpected error too —
 * a 200 either way is better than Telegram queuing endless retries of an
 * update that will never succeed.
 */
@Controller('telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(private readonly webhook: TelegramWebhookService) {}

  @Post('webhook')
  @UseGuards(TelegramWebhookSecretGuard)
  @HttpCode(200)
  async handleUpdate(@Body() update: TelegramUpdate): Promise<{ ok: true }> {
    try {
      await this.webhook.handleUpdate(update);
    } catch (error) {
      this.logger.warn(`TelegramWebhookController: handleUpdate threw: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    return { ok: true };
  }
}
