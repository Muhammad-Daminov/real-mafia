import type { ThrottlerOptions } from '@nestjs/throttler';

/**
 * B-H1: the moderate "command endpoint" rate limit — create/join/ready/
 * start/night-action/vote, every state-changing `POST` (and, for
 * simplicity/uniform protection, the handful of `GET` reads sharing a
 * controller with one) behind `JwtGuard`. Deliberately separate from
 * `auth.constants.ts`'s stricter `/auth/telegram` limit — different
 * endpoints, different budgets, each module that needs this imports
 * `ThrottlerModule.forRoot(commandThrottlerOptions())` itself (the same
 * per-module registration shape `AuthModule` already established; see
 * that module's own `ThrottlerModule.forRoot` call) rather than one global
 * registration, since `@nestjs/throttler`'s `ThrottlerModule` isn't
 * `@Global()` and each consumer needs `THROTTLER_OPTIONS`/storage in its
 * own injector scope regardless.
 *
 * In-memory storage (`@nestjs/throttler`'s own default
 * `ThrottlerStorageService`) — correct for this app's current single-
 * instance deployment, but a known limitation the moment a second
 * instance/replica exists (each gets its own independent counter, so the
 * *effective* limit across N replicas is N times this value) — see
 * OPEN_DECISIONS.md.
 */
export const COMMAND_THROTTLER_NAME = 'command';

export function commandRateLimit(): number {
  return Number(process.env.COMMAND_RATE_LIMIT) || 60;
}

export function commandRateLimitTtlMs(): number {
  return Number(process.env.COMMAND_RATE_LIMIT_TTL_MS) || 60_000;
}

export function commandThrottlerOptions(): ThrottlerOptions[] {
  return [
    {
      name: COMMAND_THROTTLER_NAME,
      limit: commandRateLimit(),
      ttl: commandRateLimitTtlMs(),
    },
  ];
}
