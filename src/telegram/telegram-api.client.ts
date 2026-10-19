import { Injectable } from '@nestjs/common';

/**
 * B-T2: the raw "POST to api.telegram.org/bot&lt;token&gt;/&lt;method&gt;"
 * call, extracted so `TelegramWebhookService`'s `/start` reply and
 * `common/outbox/telegram-notification.service.ts`'s `deliver` share one
 * BOT_TOKEN lookup and one fetch shape instead of two independent copies
 * (task: "reuse the existing Telegram sending mechanism and BOT_TOKEN
 * handling"). Deliberately as thin as `TelegramNotificationService.deliver`
 * itself was before this slice — no retry/backoff here, that stays each
 * caller's own concern (the outbox's is `SchedulerService`'s; the
 * webhook's is "best effort, log status only," per task item 3).
 */
@Injectable()
export class TelegramApiClient {
  callMethod(method: string, body: Record<string, unknown>): Promise<Response> {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      throw new Error('TelegramApiClient: BOT_TOKEN is not configured');
    }

    return fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}
