const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 4000;
/** Leave at least this much time between a bot's scheduled act and the
 * phase's own deadline — "always well before the phase ends," not
 * "exactly at the wire." */
const SAFETY_MARGIN_MS = 1000;

/**
 * A random 1-4s delay, capped so the bot still acts comfortably before
 * `endsAt` — `null` when there isn't enough runway left at all (the watcher
 * poll that discovers a phase could, in principle, run close to its
 * deadline; skipping this cycle and letting the phase simply advance
 * without that bot acting is safer than firing a task that would
 * immediately find itself stale anyway). Plain `Math.random()`, not
 * `crypto.randomInt` — this is cosmetic scheduling jitter, not a
 * game-fairness-relevant choice (contrast `bot-target-selection.ts`'s use
 * of `crypto.randomInt` for the actual target pick), same distinction
 * `SchedulerService.backoffDelayMs`'s own jitter already draws.
 */
export function randomBotActDelayMs(endsAt: Date | null, now: Date = new Date()): number | null {
  const roll = MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));

  if (!endsAt) return roll;

  const cap = endsAt.getTime() - now.getTime() - SAFETY_MARGIN_MS;
  if (cap <= 0) return null;

  return Math.min(roll, cap);
}
