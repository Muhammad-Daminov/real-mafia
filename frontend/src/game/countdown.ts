/**
 * F3/OD-F3-002: a plain local countdown — `nowMs` is read from this
 * device's own clock (`Date.now()` by the caller), compared directly
 * against `phaseEndsAt` (a server-issued ISO timestamp). No backend
 * endpoint exists anywhere in this project exposing server time/clock
 * offset (grepped `src/` and `frontend/src/` for `serverTime`/`/time` —
 * none), so there is no way to correct for client clock skew without
 * inventing a new backend contract, out of scope for this slice (task
 * instruction: "do NOT modify the backend"). A client with a skewed local
 * clock sees a countdown off by that same skew — logged as OD-F3-002
 * rather than silently accepted as "fine."
 *
 * Returns `null` for a non-timed phase (`phaseEndsAt === null` — e.g.
 * `GAME_OVER`, or state not yet loaded) rather than a fabricated value.
 */
/** Shared by `formatCountdown`/`countdownFraction` — `null` (not parseable,
 * or no deadline at all) rather than `NaN`/negative, clamped to >= 0. */
function remainingSeconds(phaseEndsAt: string | null, nowMs: number): number | null {
  if (!phaseEndsAt) return null;

  const endsAtMs = new Date(phaseEndsAt).getTime();
  if (Number.isNaN(endsAtMs)) return null;

  return Math.max(0, Math.ceil((endsAtMs - nowMs) / 1000));
}

export function formatCountdown(phaseEndsAt: string | null, nowMs: number): string | null {
  const totalSeconds = remainingSeconds(phaseEndsAt, nowMs);
  if (totalSeconds === null) return null;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * F7b: `InGameShell`'s circular countdown ring fill, `0..1`. There is no
 * phase-duration endpoint anywhere in this codebase (same gap
 * `formatCountdown`'s own docstring already found) — a ring that claimed
 * to show "fraction of total phase time" would have to guess a duration
 * it doesn't have. Instead this is an honest, duration-free sweep: the
 * seconds-within-the-current-minute, same number already visible in
 * `formatCountdown`'s `:SS` half, just drawn as a ring instead of digits —
 * never a claim about how much of the *phase* is left. `0` for a
 * non-timed phase or an unparseable deadline, same safe default as
 * `formatCountdown`'s `null`.
 */
export function countdownFraction(phaseEndsAt: string | null, nowMs: number): number {
  const totalSeconds = remainingSeconds(phaseEndsAt, nowMs);
  if (totalSeconds === null) return 0;

  return (totalSeconds % 60) / 60;
}
