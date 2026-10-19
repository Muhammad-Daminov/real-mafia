/**
 * Rate limit for `POST /auth/telegram`: 10 requests per minute per IP,
 * per the endpoint table carried forward into Master TZ §30 (v5.0 §32.1).
 * B-H1: env-configurable (`AUTH_TELEGRAM_RATE_LIMIT`/`_TTL_MS`), defaulting
 * to that same 10/60s — see `common/config/throttler.ts` for the sibling
 * "command endpoint" limit this one doesn't share a budget with.
 */
export const AUTH_TELEGRAM_THROTTLER_NAME = 'auth-telegram';
export const AUTH_TELEGRAM_RATE_LIMIT = Number(process.env.AUTH_TELEGRAM_RATE_LIMIT) || 10;
export const AUTH_TELEGRAM_RATE_LIMIT_TTL_MS = Number(process.env.AUTH_TELEGRAM_RATE_LIMIT_TTL_MS) || 60_000;

/**
 * How long a Telegram `initData` payload is accepted after it was issued
 * (Master TZ §22.2's "freshness window"). The replay guard's TTL is pinned to
 * the same window, so a payload is single-use for exactly as long as it is
 * otherwise valid.
 */
export const INIT_DATA_FRESHNESS_WINDOW_SECONDS = 3600;
