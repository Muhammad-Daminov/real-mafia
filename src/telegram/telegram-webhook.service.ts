import { Injectable, Logger } from '@nestjs/common';
import { TelegramApiClient } from './telegram-api.client';
import type { TelegramUpdate } from './telegram-update.types';

/** Task item 4: "ignore updates older than a reasonable window" — Telegram
 * redelivers a webhook it couldn't confirm delivery of, never minutes
 * late under normal operation; this only ever discards a genuinely stale
 * retry (e.g. the endpoint was down for a while), not a normal-latency one. */
const MAX_UPDATE_AGE_SECONDS = 5 * 60;

/** Task item 4: "bounded, e.g. last 1000" — a FIFO eviction, not an LRU;
 * Telegram's own retry window is short, so the oldest entries are safe to
 * drop long before 1000 more updates arrive in practice. */
const MAX_REMEMBERED_UPDATE_IDS = 1000;

/** uz, short, friendly — what the game is, one or two lines (task item 2).
 * Exported so the test can assert the exact copy sent, not just "a string". */
export const START_GREETING_TEXT =
  'REAL MAFIA — do‘stlar bilan birga o‘ynaladigan yolg‘on va shubha o‘yini.\n' +
  'Boshlash uchun pastdagi tugmani bosing!';

export const PLAY_BUTTON_TEXT = "O'ynash";

/**
 * B-T2: `POST /telegram/webhook`'s handler, behind
 * `TelegramWebhookSecretGuard`. Handles exactly one thing — a `message`
 * whose text is `/start` or `/start <payload>` — and ignores every other
 * update shape with a 200 (the controller always returns 200 once the
 * secret has checked out; this service never throws for an update it
 * doesn't recognize). The payload itself (`ref_<code>`/`room_<code>`,
 * MASTER_TZ.md §637-642) is read by nothing here — see OD-062
 * (`docs/decisions/OPEN_DECISIONS.md`) for why that's a deliberate gap in
 * this minimal slice, not an oversight.
 */
@Injectable()
export class TelegramWebhookService {
  private readonly logger = new Logger(TelegramWebhookService.name);

  /** `Set` for O(1) membership, parallel array for FIFO eviction order —
   * task item 4's own in-memory, bounded dedupe. */
  private readonly seenUpdateIds = new Set<number>();
  private readonly seenUpdateOrder: number[] = [];

  constructor(private readonly telegramApi: TelegramApiClient) {}

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!update || typeof update.update_id !== 'number') {
      return;
    }

    if (this.seenUpdateIds.has(update.update_id)) {
      return;
    }
    this.remember(update.update_id);

    const message = update.message;
    if (!message) {
      return;
    }

    if (typeof message.date === 'number') {
      const ageSeconds = Math.floor(Date.now() / 1000) - message.date;
      if (ageSeconds > MAX_UPDATE_AGE_SECONDS) {
        return;
      }
    }

    if (!isStartCommand(message.text)) {
      return;
    }

    // Task item 3: never send to a bot, or to a negative/reserved chat id
    // (groups, channels) — /start only ever makes sense in a real private
    // chat with a human.
    if (message.from?.is_bot || message.chat.id < 0) {
      return;
    }

    await this.sendStartReply(message.chat.id);
  }

  private remember(updateId: number): void {
    this.seenUpdateIds.add(updateId);
    this.seenUpdateOrder.push(updateId);
    if (this.seenUpdateOrder.length > MAX_REMEMBERED_UPDATE_IDS) {
      const oldest = this.seenUpdateOrder.shift();
      if (oldest !== undefined) {
        this.seenUpdateIds.delete(oldest);
      }
    }
  }

  private async sendStartReply(chatId: number): Promise<void> {
    const miniAppUrl = process.env.MINI_APP_URL;
    if (!miniAppUrl) {
      this.logger.warn('TelegramWebhookService: MINI_APP_URL is not configured, skipping /start reply');
      return;
    }

    try {
      const response = await this.telegramApi.callMethod('sendMessage', {
        chat_id: chatId,
        text: START_GREETING_TEXT,
        reply_markup: {
          inline_keyboard: [[{ text: PLAY_BUTTON_TEXT, web_app: { url: miniAppUrl } }]],
        },
      });

      // Task item 3: "log status only; never log message bodies, tokens
      // or user ids beyond what existing code already logs" — no chat_id,
      // no response body, just the status.
      if (!response.ok) {
        this.logger.warn(`TelegramWebhookService: sendMessage failed with status ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`TelegramWebhookService: sendMessage threw: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
}

/** `/start` or `/start <payload>` — the `@BotUsername` suffix Telegram
 * sometimes appends in group chats is out of scope (private-chat-only
 * command, task's own literal text match). */
function isStartCommand(text: string | undefined): boolean {
  if (typeof text !== 'string') return false;
  const [command] = text.trim().split(/\s+/);
  return command === '/start';
}
