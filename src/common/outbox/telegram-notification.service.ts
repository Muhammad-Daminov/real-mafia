import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PermanentTaskError, RetryAfterError, SchedulerService } from '../scheduling/scheduler.service';
import { TELEGRAM_MESSAGE_TASK_KIND, TelegramMessageTaskPayload } from './outbox-task-kinds';

/**
 * §19/§25 (v5.0)/OD-051: the outbox dispatcher's `TELEGRAM_MESSAGE` consumer —
 * the dispatch-side counterpart of `GameLifecycleService`'s enqueue calls.
 * Registers a handler on the same shared `scheduled_tasks` table
 * `PhaseTransitionService`/`GameLifecycleService` already use for
 * `PHASE_ADVANCE_CHECK` (OD-043 explicitly reserved that table's retry/backoff
 * policy for "the outbox dispatcher later" — no separate `outbox_events`
 * table, see OD-051).
 *
 * Errors thrown by `deliver` propagate to `SchedulerService.pollOnce`'s
 * existing catch block, which still owns every retry decision (OD-053):
 *  - 400/403 (bot blocked, chat not found, user never started the bot) are
 *    genuinely permanent — retrying burns all `maxAttempts` for an outcome
 *    that can never change, so these throw `PermanentTaskError` and the task
 *    is marked terminal `FAILED` after exactly one attempt.
 *  - 429 (rate limited) is transient but Telegram tells us how long to wait
 *    (`parameters.retry_after`) — thrown as `RetryAfterError` so `fail()`'s
 *    own backoff computation is floored at that value instead of guessing.
 *  - 5xx and network failures are unchanged: a plain `Error`, retried under
 *    `fail()`'s normal exponential-backoff/max-attempts machinery.
 * No second retry mechanism is introduced — both typed errors are consumed
 * by `SchedulerService` itself (`PermanentTaskError`/`RetryAfterError`), and
 * both still terminate in `fail()`/`failPermanently()`, the same two outcomes
 * every other `scheduled_tasks` consumer already has available.
 */
@Injectable()
export class TelegramNotificationService implements OnModuleInit {
  private readonly logger = new Logger(TelegramNotificationService.name);

  constructor(private readonly scheduler: SchedulerService) {}

  onModuleInit(): void {
    this.scheduler.registerHandler(TELEGRAM_MESSAGE_TASK_KIND, async (payload) => {
      await this.deliver(payload as unknown as TelegramMessageTaskPayload);
    });
  }

  async deliver(payload: TelegramMessageTaskPayload): Promise<void> {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      throw new Error('TelegramNotificationService: BOT_TOKEN is not configured');
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: payload.telegramId, text: renderText(payload) }),
    });

    if (response.ok) {
      return;
    }

    const status = response.status;
    const body = await response.text().catch(() => '');
    const message = `Telegram sendMessage failed with status ${status}: ${body}`;

    if (status === 400 || status === 403) {
      // The taskId + status warn (no message text — the body may carry the
      // recipient's chat_id/description) is logged by SchedulerService's
      // pollOnce, which knows the taskId this deliver() call doesn't.
      throw new PermanentTaskError(message, status);
    }

    if (status === 429) {
      const retryAfterSec = parseRetryAfterSeconds(body);
      if (retryAfterSec !== null) {
        throw new RetryAfterError(message, retryAfterSec * 1000);
      }
    }

    throw new Error(message);
  }
}

/**
 * Telegram's 429 body shape: `{"ok":false,"error_code":429,"description":"...",
 * "parameters":{"retry_after":<seconds>}}`. Returns null (falling through to
 * the normal backoff path) if the body doesn't parse or carries no usable value.
 */
function parseRetryAfterSeconds(body: string): number | null {
  try {
    const parsed = JSON.parse(body) as { parameters?: { retry_after?: number } };
    const retryAfter = parsed.parameters?.retry_after;
    return typeof retryAfter === 'number' ? retryAfter : null;
  } catch {
    return null;
  }
}

/**
 * OD-052: interim, non-localized copy. §21 requires every user-facing string
 * — explicitly including "push/outbox notifications" — to exist in uz/ru/en,
 * but no prior slice stores a per-user locale (`User` has no `locale`
 * column) and no product copy has been supplied for any bot notification.
 * Both are genuinely unspecified, not guessed as final here — isolated in
 * this one function so real localized templates can replace it later without
 * touching the enqueue call sites or the delivery/retry mechanism.
 */
function renderText(payload: TelegramMessageTaskPayload): string {
  switch (payload.event) {
    case 'GAME_FINISHED':
      return `Game over! Winner: ${payload.winnerTeam}.`;
  }
}
