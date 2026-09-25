# GAP REPORT — Codebase vs. MASTER_TZ.md v6.0

Generated: 2026-09-25. This is an audit only — no code was written or modified in
producing this report, per instruction. Source of truth: `docs/00-master/MASTER_TZ.md`.
Open Decisions status: `docs/decisions/OPEN_DECISIONS.md`.

## 1. Inventory of what currently exists

### 1.1 Backend modules (`src/`)

| Module | Files | What it does |
|---|---|---|
| `app` | `app.module.ts`, `app.controller.ts`, `app.service.ts` | NestJS root module, default Nest hello-world controller/service |
| `prisma` | `prisma/prisma.module.ts`, `prisma/prisma.service.ts` | Global Prisma client wrapper |
| `auth` | `auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `strategies/jwt.strategy.ts`, `guards/jwt.guard.ts` | Telegram `initData` HMAC verification + JWT issuance |
| `users` | `users.module.ts`, `users.controller.ts`, `users.service.ts`, `dto/create-user.dto.ts` | User list/create against a flat `User` table |

No other backend modules exist: no `room`, `game`, `game-engine`, `chat`, `economy`, `store`, `payments`, `referral`, `admin`, `realtime`/websocket gateway, `worker`, `i18n`, `outbox`, or `timer` module of any kind.

### 1.2 Prisma models / migrations

`prisma/schema.prisma` defines a single model: `User` (id, telegramId, username, firstName, lastName, avatar, level, xp, gamesPlayed, gamesWon, createdAt, updatedAt). Two migrations exist (`20260912091332_init`, `20260912091538_add_user`), both only touching `User`.

No `Room`, `Game`, `GamePlayer`, `GameRoleAssignment`, `RoleDefinition`, `game_phases`, `game_actions`, `game_events`, `game_results`, `scheduled_tasks`, `command_requests`, `game_chat_messages`, `role_ability_usage`, `Wallet`, `wallet_ledger_entries`, `cosmetic_items`, `user_cosmetics`, `user_equipped_cosmetics`, `diamond_packages`, `stars_transactions`, `referral_edges`, `referral_reward_tiers`, `staff_accounts`, `admin_audit_logs`, `game_launch_tokens`, `outbox`/`telegram_updates`, or `audit_logs` tables exist.

### 1.3 Endpoints

| Method & path | Guard | Notes |
|---|---|---|
| `GET /` | none | Nest default hello-world |
| `POST /auth/telegram` | none (public, as required) | `initData` → upsert `User` → JWT |
| `GET /users` | `JwtGuard` | Returns **all** users, unfiltered — see Finding F-02 |

No Room, Game, Chat, Wallet, Store, Payments, Referral, or Admin endpoints exist. §30 of the spec is entirely unimplemented.

### 1.4 WebSocket / realtime

None. No Socket.IO gateway, no `/game` namespace, no Redis adapter. `package.json` has no `socket.io`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `ioredis`, or `redis` dependency at all.

### 1.5 Workers

None. No `PROCESS_ROLE` switch, no timer scheduler, no outbox dispatcher, no janitor, no statistics processor, no payment reconciler, no referral processor. `package.json` has no queue library (BullMQ, etc.).

### 1.6 Tests

`test/app.e2e-spec.ts` — a single e2e test hitting the default `GET /` hello-world route. No unit tests exist under `src/` (no `*.spec.ts` files found anywhere in `src/`). No domain, economy, referral, chat, or module-boundary tests exist.

### 1.7 Frontend

`frontend/` is an untouched Vite + React + TypeScript scaffold (`App.tsx`, `main.tsx`, default assets). No Mini App screens, no Telegram WebApp SDK integration, no state management, no room/lobby/game/chat/store UI of any kind.

### 1.8 Infrastructure / config

No `.eslintrc`/dependency-cruiser boundary rule (module-boundary lint, I-33) — cannot exist yet since the modules it would gate don't exist. No i18n scaffolding (`i18n/uz.json` etc.) or `I18N_KEY_COVERAGE` CI check. No `docker-compose`, CI workflow files, or deployment config were found in the repo listing. `.env` exists (not inspected further — treated as local secret material) with presumably `BOT_TOKEN`/`JWT_SECRET`/DB connection only.

## 2. Compliance table by spec section

| Spec section | Topic | Status | Evidence |
|---|---|---|---|
| §5 Actors / §8 Room | Room model | **MISSING** | No `rooms` table, no room module |
| §9–10 Game lifecycle / phase FSM | Game engine | **MISSING** | No `Game`/`game_phases` model or engine code anywhere |
| §11 Player lifecycle | — | **MISSING** | No `GamePlayer` model |
| §12–13 Roles, distribution, night resolution | Game engine | **MISSING** | No role catalogue, no resolution pipeline |
| §14 Config/rule versioning | — | **MISSING** | No `config_snapshot`, no `rulesVersion` |
| §15 Lobby | — | **MISSING** | No join/ready/host logic |
| §16 Win conditions | — | **MISSING** | No win evaluator |
| §17 Night actions | — | **MISSING** | No `game_actions`, no validation pipeline |
| §18 In-app chat | — | **MISSING** | No chat module, no `game_chat_messages` |
| §19 Timers/concurrency/idempotency/events/outbox | — | **MISSING** | No `scheduled_tasks`, `command_requests`, `game_events`, or outbox table/dispatcher |
| §20 Realtime (WebSocket) | — | **MISSING** | No Socket.IO gateway or dependency |
| §21 Reconnect/recovery | — | **MISSING** | No snapshot endpoint |
| §22 Telegram Bot / Mini App integration | `initData` verification | **PARTIAL** | `src/auth/auth.service.ts:13-69` implements HMAC-SHA256 verification, freshness window, timing-safe compare — matches §22.2's core algorithm. **Missing**: replay cache (spec requires one, §22.2 "never persisting raw initData" + replay protection referenced from v5.0 §29.3), launch-token protocol (`game_launch_tokens`) entirely absent, no `/start`, `/help`, `/wallet`, `/paysupport` bot commands, no Bot API integration at all |
| §23 Economy: Wallet | — | **MISSING** | No `wallets` or `wallet_ledger_entries` table |
| §24 Cosmetics/Store | — | **MISSING** | No `cosmetic_items` etc. |
| §25 Telegram Stars payments | — | **MISSING** | No `stars_transactions`, no webhook handling |
| §26 Referral system | — | **MISSING** | No `referral_edges` |
| §27 Localization | — | **MISSING** | No i18n catalogs, `users.locale` field absent from schema |
| §28 SuperAdmin panel | — | **MISSING** | No admin module, no `staff_accounts` |
| §29 Auth/Authorization | Player JWT auth | **PARTIAL** | JWT issuance and `JwtGuard` exist (`src/auth/`); but see F-01/F-03/F-04 below for gaps against the spec's authorization model. No admin credential space (§28.4/§29) exists at all — **MISSING** |
| §30 HTTP API | — | **PARTIAL/MISSING** | Only `POST /auth/telegram` and `GET /users` exist; none of §30.1–30.4's endpoints exist |
| §31 Reconnect snapshot | — | **MISSING** | No `GET /games/:gameId/state` |
| §32 Error model | — | **MISSING** | No structured error-code system observed; NestJS default exceptions only |
| §33 Database schema | — | **MISSING** (1 of ~20 required tables exists) | `User` only, and even that diverges from spec (see F-05) |
| §34 Redis usage | — | **MISSING** | No Redis client dependency |
| §35 Background workers | — | **MISSING** | No worker process/role split |
| §36 Statistics/history/audit | — | **MISSING** | No `audit_logs`, `admin_audit_logs`, `user_stats` |
| §37 Security (extended) | Module-boundary lint (I-33), payment/admin/chat abuse controls | **MISSING** | No lint rule, no rate limiting anywhere, no `AdminGuard` |
| §38 Observability | — | **MISSING** | No metrics/logging/tracing setup found |
| §39 Frontend requirements | — | **MISSING** | Frontend is the default Vite scaffold |
| §40 Testing strategy | — | **MISSING** | Only the default e2e hello-world test exists |
| §41 Deployment/backup/perf/privacy | — | **MISSING** | No deployment manifests, no migration-only enforcement in CI (none found), no backup config |
| §42 Open Decisions | tracked | **N/A (docs only)** | Captured in `docs/decisions/OPEN_DECISIONS.md` this session |

No **CONFLICTS** were found — the existing code does not contradict the spec anywhere, it is simply a much smaller pre-Phase-2 subset of it. The one place worth flagging as a *soft* conflict is F-05 below (the `User` model's shape and semantics diverge from what §33.2 describes as the extended `users` table, e.g. `level`/`xp`/`gamesPlayed`/`gamesWon` fields that don't map to anything in the spec, while spec-required fields like `locale`, `referral_code`, `games_completed_count` are absent).

## 3. Findings, ranked by severity

### F-01 — CRITICAL: `GET /users` leaks every user's full record to any authenticated caller (IDOR / broad data exposure) — **RESOLVED**
- **Resolved**: replaced with `GET /users/me`, id taken from the verified JWT, explicit column projection, `findAll` removed — `src/users/users.controller.ts`, `src/users/users.service.ts`, `src/auth/types/authenticated-user.ts`; tests in `src/users/users.controller.spec.ts`.
- **Where**: `src/users/users.controller.ts:13-17`, `src/users/users.service.ts:9-15`.
- **What**: `findAll()` returns the entire `User` table (telegramId, username, first/last name, avatar, xp, level, win/loss counters) to any caller holding a valid JWT, with no filtering by requester identity and no pagination.
- **Spec basis**: v5.0's carried-forward authorization principle (MASTER_TZ.md §29: "authorization always resolved from PostgreSQL via `GamePlayer`, never from a client-supplied id") and the general privacy invariant (I-09, referenced §18.7) both establish that data must be scoped to what the caller is authorized to see. A bare list-all endpoint with no scoping violates that principle in spirit even though `GamePlayer` doesn't exist yet.
- **Smallest safe fix**: Until there is a legitimate multi-user listing use case defined in the spec (there isn't one in §30 — no `GET /users` endpoint appears anywhere in the HTTP API), remove this endpoint, or at minimum restrict it to returning only the caller's own record (`GET /users/me` semantics) until a real requirement is specified.

### F-02 — CRITICAL (forward-looking, blocks Phase 2+): Row-lock / transactional concurrency model is entirely absent
- **Where**: no `game`/`wallet` module exists yet to check, but this is the single most load-bearing mechanism in the whole spec (§6.3, §7, §19, §22, I-39) and nothing in the current code (`PrismaService`, `auth.service.ts`, `users.service.ts`) establishes the pattern (`SELECT ... FOR UPDATE`, single-transaction command execution, idempotency table) that every future command must follow.
- **Spec basis**: §6.3 "Canonical command path", §7 aggregates table, I-39 ("Gameplay and economy transactions never share a lock or a transaction boundary").
- **Why it matters now, not just later**: the `auth.service.ts` `upsert` call (line 95) is itself a small preview of the risk — it's a bare Prisma call with no explicit transaction, no idempotency key, and no row lock, which is fine for a simple upsert-by-unique-key today but sets a precedent. If the next slice (Room/Game) is built by extending this style rather than adopting the locking discipline from day one, every subsequent aggregate will need to be retrofitted.
- **Smallest safe fix**: Not a code fix today — a process note for the next slice: the first `game`/`room` write path implemented MUST establish `SELECT ... FOR UPDATE` + single-transaction-per-command + `command_requests` idempotency as the pattern before any second command is added, exactly as CLAUDE.md's "read before you write" and "one slice" rules imply.

### F-03 — HIGH: No `initData` replay cache — **RESOLVED**
- **Resolved**: single-use claim on the initData hash, Redis primary with PostgreSQL fallback, TTL pinned to the freshness window, fails closed — `src/auth/telegram-replay-guard.service.ts`, `src/auth/auth.service.ts`, `src/auth/auth.constants.ts`, migration `prisma/migrations/20260925065431_add_telegram_initdata_replay/`; tests in `src/auth/telegram-replay-guard.service.spec.ts` and `src/auth/auth.service.spec.ts`.
- **Where**: `src/auth/auth.service.ts:13-69`.
- **What**: The HMAC verification, freshness window (3600s), and timing-safe comparison are all correctly implemented. However, nothing prevents the same valid `initData` payload (and its still-valid hash) from being replayed multiple times within that 1-hour freshness window to repeatedly call `POST /auth/telegram` — each call re-verifies successfully and re-upserts/reissues a JWT.
- **Spec basis**: §22.2 says `initData` verification is "unchanged verbatim from v5.0 §29.3" which per §22.2's own description of the launch-token protocol includes "replay cache" as part of the trust model alongside HMAC verification and freshness window.
- **Smallest safe fix**: Add a short-TTL replay-guard keyed on the `hash` (or the full `initData` string) — e.g. a `telegram_init_replays` table or Redis `SETNX` with TTL matching the freshness window — rejecting a second use of the same hash. This is a small, isolated addition to `auth.service.ts` and doesn't require Room/Game to exist first.

### F-04 — HIGH (forward-looking): No launch-token protocol, so Room binding trust boundary has no foundation
- **Where**: N/A — doesn't exist yet.
- **What**: §22.2 requires `game_launch_tokens` (opaque, ≤15 min TTL, single-use) so the Mini App can never self-assert "I belong to Room X." Since Room doesn't exist yet this isn't a live vulnerability today, but `POST /auth/telegram` currently has no `launchToken` parameter at all, meaning the auth endpoint's contract will need to change shape (not just be extended) once Room lands — worth flagging now so the Room slice doesn't bolt token support on awkwardly.
- **Smallest safe fix**: Not for this session — track as a dependency for the Room/Lobby slice (Phase 4 per §43).

### F-05 — MEDIUM: Current `User` model diverges from the spec's `users` table and has no migration path planned
- **Where**: `prisma/schema.prisma:9-25`.
- **What**: Spec (§33.2) requires `users.locale` (default `'uz'`), `users.referral_code` (unique, not null), `users.games_completed_count` (int, default 0) as part of the base `users` table. None of these exist. Conversely, the current model has `level`, `xp`, `gamesPlayed`, `gamesWon` fields that don't correspond to anything in the spec — `gamesPlayed`/`gamesWon` look like an ad-hoc precursor to `user_stats` (§36) and `level`/`xp` don't map to any spec concept at all (the spec has no leveling/XP system).
- **Spec basis**: §33.2, §27.2, §26.5, §36.
- **Smallest safe fix**: Not urgent to fix today (no dependents yet), but the next Room/Game or Economy slice must not compound this — introduce `locale`/`referral_code`/`games_completed_count` via a proper migration when the slice that needs them lands, and get explicit product-owner sign-off before deciding whether to keep or drop `level`/`xp`/`gamesPlayed`/`gamesWon` (they may predate the v6.0 spec and be dead fields).

### F-06 — LOW: No rate limiting on `POST /auth/telegram` — **RESOLVED**
- **Resolved**: `@nestjs/throttler` at 10 req/min per IP — `src/auth/auth.controller.ts`, `src/auth/auth.module.ts`, `src/auth/auth.constants.ts`; per-IP accuracy behind the §6.1 load balancer requires `TRUST_PROXY_HOPS` (env-gated, off by default) in `src/main.ts`; tests in `src/auth/auth.throttle.spec.ts`.
- **Where**: `src/auth/auth.controller.ts:8-11`.
- **What**: Public, unauthenticated endpoint with no rate limiting (no `@nestjs/throttler` or equivalent dependency present).
- **Spec basis**: §37 security controls (carried forward from v5.0 §39) require rate limiting on the canonical command path (§6.3: "authentication → rate limit → ...").
- **Smallest safe fix**: Add `@nestjs/throttler` (or Redis-backed limiter once Redis exists) scoped to this endpoint. Small, isolated change.

### Not yet applicable / no evidence of the specific risks called out in the audit request
- **Economy/cosmetics affecting gameplay (I-33)**: no economy or game-engine code exists yet, so there is nothing to violate — flagged only so the *first* slice that introduces either module starts with the module-boundary lint in place (§37.5), not after.
- **Unsafe sequence generation**: no `game_events`/`game_chat_messages` sequence allocation code exists yet (§18.3, §24.2 of v5.0) — nothing to audit yet, but worth a reminder that the spec explicitly forbids `MAX(sequence)+1` in favor of a counter updated under the row lock.
- **Mixing gameplay and wallet writes in one transaction**: no such code exists yet — nothing to audit; the risk is purely forward-looking (I-39).

## 4. Step-by-step remediation plan (sliced)

Ordering follows the spec's own dependency-ordered phase table (§43), adjusted to fold in the findings above at the point they become relevant. Each row is one session-sized slice per CLAUDE.md's "one slice per session" rule.

1. **Slice: Fix `GET /users` exposure (F-01)** — remove or scope the endpoint. Independent of everything else; do first since it's a live data-exposure bug.
2. **Slice: `initData` replay cache (F-03)** — add replay protection to the existing auth flow. Independent, small, no schema dependents yet beyond one new table/Redis key.
3. **Slice: Rate limiting on public auth endpoint (F-06)** — add throttling. Independent, small.
4. **Slice: Foundation (spec Phase 1)** — i18n scaffolding (uz/ru/en catalogs + `I18N_KEY_COVERAGE` CI check), module-boundary lint config (even before the modules it guards exist, so it's enforced from the first commit that creates `game-engine`/`economy`), CI wiring.
5. **Slice: Database & domain model (spec Phase 2)** — add Room, Game, GamePlayer, and the rest of §33's gameplay tables via proper migrations (no `db push`); resolve F-05's `users` table gap (locale, referral_code, games_completed_count) in the same or an adjacent slice, with explicit product-owner sign-off on the fate of `level`/`xp`/`gamesPlayed`/`gamesWon`.
6. **Slice: Authentication extension (spec Phase 3)** — launch-token protocol (F-04), locale detection on first login, admin credential space stub. Depends on slice 5's schema.
7. **Slice: Room & Lobby (spec Phase 4)** — **blocked** until OD-013 (host transfer), OD-014 (readiness rule), OD-023 (host powers) are resolved by the product owner; OD-021 (re-join) has a default (prohibited) and may proceed. Do not implement host-transfer or readiness behavior speculatively.
8. **Slice: Game engine core (spec Phase 5)** — state machine skeleton, versioning, event sequencing (establish the row-lock + counter-under-lock discipline from F-02 here, as the first real precedent).
9. **Slices 9+ (roles, voting/win, chat, realtime, recovery, outbox, economy, payments, referral, admin, frontend, stats, security hardening, infra)** — follow §43's table and its per-phase blocking-OD gates exactly; consult `docs/decisions/OPEN_DECISIONS.md` before starting each phase, in particular Phase 6 (OD-024), Phase 7 (OD-018, OD-020), Phase 10 (OD-015), Phase 16 (OD-032).

No slice above authorizes writing game-engine, economy, store, payments, or referral code in the same session as another of those modules, per CLAUDE.md's module-boundary and one-slice rules — this plan is intentionally sequential, not a batch task list to execute all at once.
