import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerService } from '../scheduling/scheduler.service';
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
 * Any error thrown by `deliver` (network failure, non-2xx Telegram response)
 * propagates unchanged to `SchedulerService.pollOnce`'s existing catch block,
 * which calls `fail()` — the same bounded-exponential-backoff/max-attempts
 * machinery every other `scheduled_tasks` consumer already gets. No
 * retryable-vs-permanent error classification is introduced here — a 4xx
 * (e.g. user blocked the bot) simply retries until `maxAttempts` and lands in
 * the terminal `FAILED` status like any other exhausted task, per this
 * slice's explicit instruction not to build a second retry mechanism.
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

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Telegram sendMessage failed with status ${response.status}: ${body}`);
    }
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
