# Frontend Open Decisions

Companion to the backend's `../../docs/decisions/OPEN_DECISIONS.md` (not
edited here — this file is scoped to frontend-only ambiguities found while
building against the backend's actual, current contract). Same rule as the
backend: don't guess an answer for anything listed here as open; ship the
documented interim behavior and flag it.

## OD-F1-001 — No `refreshToken` in `/auth/telegram`'s response; token-expiry re-auth is not fully solvable client-side

**Context.** Master TZ §22.2's sequence diagram states:

```
API->>MA: { accessToken, refreshToken, roomId? }
```

but the actual implementation (`../../src/auth/auth.service.ts`,
`loginWithTelegram`) returns only:

```ts
{ accessToken, user, ...(roomId !== null ? { roomId } : {}) }
```

— no `refreshToken`, and there is no refresh endpoint anywhere in
`src/auth/`.

**Why this matters for F1.** The task asked for "reconnect and re-auth on
token expiry." Without a refresh token, the only way to get a new
`accessToken` is to re-run the whole `/auth/telegram` flow with a fresh
`initData`. But `initData` is single-use for the duration of its freshness
window (`TelegramReplayGuardService`, `INIT_DATA_FRESHNESS_WINDOW_SECONDS =
3600`) — the same raw `initData` string a session already authenticated
with will be rejected as a replay on a second attempt. Telegram's WebApp
`initData` is set once per Mini App launch and does not regenerate itself
while the app stays open in the same WebView session. So: a JWT that
actually expires (7-day `expiresIn`, unlikely mid-session but possible for
a long-lived tab) cannot be silently refreshed by this frontend alone —
only a full relaunch from Telegram (bot button / deep link) produces a new,
unconsumed `initData`.

**What's implemented (interim default, not invented as final).**
`authStore.authenticate()` re-reads whatever `initData`
`@telegram-apps/sdk` currently reports and re-POSTs it — this is a correct
"retry" for the case where the *first* auth attempt failed transiently
(network blip, backend restart), but is expected to fail with "Telegram
initData allaqachon ishlatilgan" (replay rejected) if a login already
succeeded once this session. `socketClient.ts` calls this same function
once per `connect_error` episode. No fake/local token refresh, no bypass.

**Left open:** whether the product wants (a) a real refresh-token endpoint
added to the backend, (b) a shorter-lived `accessToken` plus a
Mini-App-relaunch-triggered re-auth UX, or (c) something else — this is a
backend/product decision, not a frontend implementation detail, and this
slice does not modify the backend.

## OD-F1-002 — `connect_error` doesn't distinguish its cause

**Context.** `realtime.gateway.ts`'s namespace middleware
(`authenticate()`) throws a plain `Error` for three distinct failure
causes — missing token/gameId, JWT verification failure (including
expiry), and "not a player in this game" (wrong/stale `gameId`) — with no
status code or error code the client can branch on, only a free-text
`message`.

**Why this matters for F1.** "Re-auth on token expiry" ideally only fires
for the JWT-expiry case; re-authenticating is pointless if the real problem
is a wrong `gameId`.

**What's implemented (interim default).** `socketClient.ts` attempts
re-auth unconditionally on the first `connect_error` of an episode,
bounded to one attempt (`reAuthAttempted`) so a wrong `gameId` costs one
harmless extra `/auth/telegram` call, not a loop. If the product/backend
later wants this narrowed (e.g. the gateway emitting a structured
`{ code: 'TOKEN_EXPIRED' | 'NOT_A_PLAYER' | ... }` error), that's a backend
change out of this slice's scope.

## OD-F1-003 — JWT persisted to `sessionStorage`, not memory-only

**Context.** The original F1 slice stored the JWT in memory only, by
explicit instruction. In practice this collided head-on with OD-F1-001's
finding: `initData` is single-use for its whole freshness window
(`TelegramReplayGuardService`). A memory-only token means *any* full page
reload — including Vite's own HMR full-reload fallback during dev, or the
user simply refreshing — throws the token away and re-runs
`POST /auth/telegram` with the *same* `initData` string (Telegram doesn't
regenerate it mid-session), which the replay guard now correctly rejects.
"Retry auth" cannot fix this because it re-sends the identical already-used
payload. The Mini App became effectively single-use per Telegram launch
under the memory-only rule.

**Decision.** Deviate from "memory only": `api/client.ts`'s `setToken`
also writes through to `sessionStorage` (`auth/tokenStorage.ts`). On app
start, `authStore.authenticate()` reads the stored token, checks its `exp`
claim locally (`auth/jwt.ts`, decode-only — no signature verification,
purely a client-side "is this worth trying" heuristic; the backend's own
`JwtStrategy` remains the actual authority), and if unexpired, skips
`POST /auth/telegram` entirely and calls `GET /users/me` instead to
populate the profile. `initData` is only spent when there is no usable
stored token.

**Why `sessionStorage` and not `localStorage`.** `sessionStorage` is
cleared when the tab/WebView closes — a closed-then-reopened Mini App gets
a fresh Telegram launch, a fresh `initData`, and (correctly) no leftover
token from a previous session. `localStorage` would persist indefinitely
across separate Mini App launches, which is a bigger persistence footprint
than this problem calls for.

**XSS tradeoff, stated plainly.** Anything in `sessionStorage` is
readable by any script that can run in the page's origin (unlike an
`httpOnly` cookie). This trades a real theoretical exposure for fixing an
actual, currently-broken flow — accepted as a debug-slice tradeoff, not a
final security posture. The token is still a 7-day-lived bearer JWT either
way (`AuthModule`'s `expiresIn: '7d'`), so the exposure window this closes
in one place (a variable in memory) was never the tight bound the "memory
only" instruction implied.

## Resolved gap (was open, fixed on the backend side): CORS

**Originally flagged here:** `src/main.ts` never called `app.enableCors()`,
so a browser-based frontend calling the backend from a different origin
would be blocked by the browser's own CORS check.

**Status: fixed**, backend commit `61f67e3` (`fix(main): CORS allow-list
for the Mini App frontend`, backend OD-054,
`../../docs/decisions/OPEN_DECISIONS.md`). `main.ts` now calls
`app.enableCors(httpCorsOptions())`
(`src/common/config/cors.ts`), reading an allow-list from the `CORS_ORIGINS`
env var (comma-separated exact origins; a literal `*` is stripped, never
honored; unset defaults to `http://localhost:5173` only). The `/game`
Socket.IO gateway's own `cors` option reads the same allow-list, so HTTP
and websocket origins can't drift apart. This frontend's own
`VITE_API_URL`/tunnel origin needs to be present in the backend's
`CORS_ORIGINS` for requests to succeed — a deployment/env-config step, not
a code gap on either side anymore.
