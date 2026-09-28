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

## Known gap (not an open decision — verified, not ambiguous): backend CORS is not configured

`src/main.ts` never calls `app.enableCors()`, and no `CorsModule`/manual
header middleware exists anywhere in `src/`. A browser-based frontend
calling `POST /auth/telegram` from a different origin (any real dev setup —
Vite on `:5173`/a tunnel origin, backend on `:3000`/its own origin) will be
blocked by the browser's CORS check; only same-origin requests (e.g.
reverse-proxying both behind one host) work today. This is not something
this slice can fix without editing the backend, which is out of scope
("do NOT modify it"). Flagging so it isn't mistaken for a frontend bug when
`fetch` fails with a CORS error during manual testing.
