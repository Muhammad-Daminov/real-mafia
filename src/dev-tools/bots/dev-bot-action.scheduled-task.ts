import { GamePhaseName } from '@prisma/client';

/**
 * B-D2's own scheduled-task `kind` discriminator, registered only by
 * `BotPlayersService` (dev-tools) — mirrors `game-engine/
 * scheduled-task-kinds.ts`'s `PHASE_ADVANCE_TASK_KIND`: opaque to
 * `SchedulerService`, kept in its own file so the payload shape has one
 * source of truth for both the enqueue side and the handler side.
 */
export const DEV_BOT_ACT_TASK_KIND = 'DEV_BOT_ACT';

export interface DevBotActPayload {
  gameId: string;
  phaseId: string;
  /** NIGHT or VOTING only — the only two phases a bot ever acts in. */
  phase: GamePhaseName;
  playerId: string;
  userId: string;
}

/**
 * One task per (phase, bot) — OD-060: deliberately keyed so ANY existing
 * row (including an already-`DONE` one) blocks a second schedule for the
 * same bot in the same phase occurrence, not just an active one. See
 * `BotPlayersService.scheduleBotAct`'s own comment for why
 * `SchedulerService.enqueue`'s built-in active-only dedupe isn't enough on
 * its own here.
 */
export function devBotActDedupeKey(phaseId: string, playerId: string): string {
  return `dev-bot-act:${phaseId}:${playerId}`;
}
