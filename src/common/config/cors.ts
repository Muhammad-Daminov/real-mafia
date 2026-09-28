/**
 * Mini App frontend origin allow-list, shared by the HTTP CORS config
 * (`main.ts`) and the `/game` Socket.IO gateway's own `cors` option
 * (`common/realtime/realtime.gateway.ts`) so the two transports can never
 * drift apart — one list, two call sites.
 *
 * `CORS_ORIGINS` is a comma-separated list of exact origins (scheme +
 * host + port, no path), e.g. `https://app.example.com,https://admin.example.com`.
 * No wildcard is ever emitted — an unset/empty value falls back to the
 * local Vite dev server origin only (`http://localhost:5173`, matching
 * `frontend/vite.config.ts`'s default dev port), never `*`, so a forgotten
 * env var in production fails closed (rejecting the real frontend's
 * requests, loudly) rather than failing open.
 */
const DEFAULT_ORIGINS = ['http://localhost:5173'];

export function resolveCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;

  if (!raw) {
    return DEFAULT_ORIGINS;
  }

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    // "No wildcard '*' in production" is an absolute rule, not just this
    // module's default — a literal "*" in CORS_ORIGINS is dropped rather
    // than ever reaching the `cors` package's origin list, so a
    // misconfigured env var fails closed (falls back to the dev-only
    // default) instead of silently opening CORS to every origin.
    .filter((origin) => origin.length > 0 && origin !== '*');

  return origins.length > 0 ? origins : DEFAULT_ORIGINS;
}

/**
 * `GET`/`POST` are the only methods any controller in this codebase
 * declares (verified by grepping every `*.controller.ts` for
 * `@Get`/`@Post`/`@Put`/`@Patch`/`@Delete`) — `OPTIONS` preflight is
 * handled by the underlying `cors` package automatically and needs no
 * entry here.
 */
export function httpCorsOptions() {
  return {
    origin: resolveCorsOrigins(),
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  };
}
