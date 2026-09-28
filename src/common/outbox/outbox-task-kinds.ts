/**
 * §19/§25 (v5.0, "unchanged in mechanism")/OD-051: the outbox dispatcher's
 * scheduled-task `kind` discriminators, opaque to `SchedulerService` exactly
 * like `game-engine/scheduled-task-kinds.ts`'s `PHASE_ADVANCE_CHECK` — kept
 * in `common/outbox/` (not `game-engine/`) because a producer of
 * `TELEGRAM_MESSAGE` need not be `game-engine` forever (§19/§25 also name
 * `WALLET_CREDIT`/`STARS_REFUND`/`REFERRAL_REWARD_NOTIFY` as future topics on
 * this same table, owned by `economy`/`payments`/`referral` once those exist —
 * see OD-051).
 */
export const TELEGRAM_MESSAGE_TASK_KIND = 'TELEGRAM_MESSAGE';

/**
 * OD-051: this slice's only concrete `event`. Structured facts, not
 * pre-rendered text — see `telegram-notification.service.ts`'s `renderText`
 * for why (OD-052).
 */
export interface TelegramMessageTaskPayload {
  telegramId: string;
  event: 'GAME_FINISHED';
  gameId: string;
  winnerTeam: string;
}
