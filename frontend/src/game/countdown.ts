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
export function formatCountdown(phaseEndsAt: string | null, nowMs: number): string | null {
  if (!phaseEndsAt) {
    return null;
  }

  const endsAtMs = new Date(phaseEndsAt).getTime();
  if (Number.isNaN(endsAtMs)) {
    return null;
  }

  const remainingMs = endsAtMs - nowMs;
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
