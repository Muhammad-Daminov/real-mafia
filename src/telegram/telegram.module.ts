import { Module } from '@nestjs/common';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from './telegram-webhook.service';
import { TelegramApiClient } from './telegram-api.client';

/**
 * B-T2: unconditionally registered (unlike `DevToolsModule` — this route
 * is meant to be reachable in every environment once `TELEGRAM_WEBHOOK_SECRET`
 * is set; an unset secret already fails every request closed on its own,
 * see `TelegramWebhookSecretGuard`). `TelegramApiClient` is exported —
 * `common/outbox/telegram-notification.service.ts` isn't migrated to it
 * in this slice (out of scope), but a later one can import this module
 * instead of duplicating the fetch call a third time.
 */
@Module({
  controllers: [TelegramWebhookController],
  providers: [TelegramWebhookService, TelegramApiClient],
  exports: [TelegramApiClient],
})
export class TelegramModule {}
