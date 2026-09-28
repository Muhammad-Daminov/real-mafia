# Open Decisions Status (from MASTER_TZ.md §42)

Source of truth: `docs/00-master/MASTER_TZ.md` §42 (Open Decisions). This file is a
working index derived from that section — if the two ever disagree, the Master TZ wins.

Rule: implementation MUST NOT invent an answer for an OPEN decision. A dependent
endpoint/feature returns `RULE_NOT_APPROVED` (or is simply not built) until the
product owner resolves it. **BLOCKING** decisions gate the start of their listed
phase entirely.

## RESOLVED (v6.0) — safe to implement against

| ID | Title | Resolution |
|---|---|---|
| OD-001 | Session architecture | Resolved (v5.0) |
| OD-002 | Mafia kill policy | Don override, else majority, tie = no kill |
| OD-003 | Doctor self-protection | Once per game |
| OD-004 | Doctor repeat protection | No consecutive-night repeat |
| OD-005 | Doctor stacking | Moot — §12.6 |
| OD-006 | Doctor protection scope/feedback | Night-kill only, silent |
| OD-007 | API versioning | Resolved (v5.0) |
| OD-008 | Timer infrastructure | Resolved (v5.0) |
| OD-011 | Prisma vs raw SQL | Resolved (v5.0) |
| OD-012 | Worker deployment | Resolved (v5.0) |
| OD-016 | Role distribution | §13.1 fixed table |
| OD-017 | Phase durations | §14.2 fixed table |
| OD-019 | Detective result semantics | Binary MAFIA/NOT_MAFIA flag |
| OD-022 | Dead player visibility | Dead-only chat channel, no live night-action spectating |
| OD-025 | Mafia teammate reveal timing | Immediate at ROLE_REVEAL |
| OD-027 | First-night kill | Allowed |
| OD-030 | Localization scope | uz/ru/en, MUST |

## RESOLVED by product-owner addendum (2026-09-25)

Seven of these were BLOCKING in MASTER_TZ.md §42.1 and were resolved by the product
owner after v6.0 was issued; OD-035 is a new decision recorded the same day. This is an **addendum**, not a spec edit: MASTER_TZ.md
§42.1 still lists them as OPEN/BLOCKING. Where the two disagree, these decisions are
the later and therefore governing word — the Master TZ should be amended to match at
the next revision.

### OD-013 — Host Transfer · RESOLVED
Decision: if the host's GamePlayer becomes LEFT (left in lobby), or is
DISCONNECTED for longer than 120 seconds at any point (lobby or running),
host_player_id transfers automatically to the remaining non-LEFT player with
the earliest joined_at. No claim command, no manual transfer in V1.

### OD-014 — Lobby Readiness Rule · RESOLVED
Decision: StartGame requires only playerCount >= minPlayers for the row in
§13.1. is_ready is a display-only signal and does not gate StartGame. Host
may start regardless of how many players are marked ready.

### OD-015 — Disconnect / Abandonment Policy · RESOLVED
Decision: a DISCONNECTED alive player remains ALIVE and stays in the game.
They simply submit no action/vote for phases they miss (validated as absence,
not as a special state). No automatic LEFT transition, no automatic action,
no forced removal, in V1. Reconnect resumes normal participation with no
special-casing needed.

### OD-018 — Vote Tie Policy · RESOLVED
Decision: on a tie for highest vote count, no execution occurs this round;
resolution proceeds directly to WIN_CHECK then NIGHT (round+1). No revote,
no random tiebreak.

### OD-020 — Vote Visibility and Vote Change · RESOLVED
Decision: (a) individual votes are PUBLIC in real time — a VOTE_CAST event
(PUBLIC visibility) fires on every cast/change. (b) A player may change their
vote any number of times before the VOTING deadline; changing a vote is an
UPDATE of their existing game_votes row (same unique constraint,
game_id+phase_id+voter_player_id), not a new insert, and re-emits VOTE_CAST.

### OD-023 — Host Powers and Cancellation Authority · RESOLVED
Decision: host may CancelGame only while status = LOBBY. Host has no power to
cancel a RUNNING or PAUSED game (operator/SuperAdmin only, per §41.3/§28.3).
Host has no discussion-skip power in V1. No kick-player power in V1.

### OD-024 — Role Reveal on Death / Post-Game · RESOLVED
Decision: a player's role is NOT revealed publicly at the moment of death
during NIGHT_RESOLUTION or EXECUTION (PLAYER_DIED/PLAYER_EXECUTED events carry
no role field). At GAME_OVER, every participant's role and team is revealed
unconditionally in the GAME_FINISHED event and game_results.summary, per
§16.3 (already normative, unaffected by this OD — this OD governs only
mid-game visibility, which is: none).

### OD-035 — Launch Token Error Codes · RESOLVED
Decision: `consume()` rejects with distinct codes per failure mode —
`LAUNCH_TOKEN_NOT_FOUND` (404), `LAUNCH_TOKEN_EXPIRED` (410),
`LAUNCH_TOKEN_ALREADY_USED` (409), `LAUNCH_TOKEN_ROOM_MISMATCH` (409).
Rationale: §22.2 specifies the launch-token protocol but §32's error table
carries no token codes — they live in v5.0 §33.2, which v6.0 both supersedes
(§1.3) and references (§32's "all v5.0 §33.2 codes carry forward"). Same
carry-forward gap as the `POST /auth/telegram` rate limit. Distinct codes are
chosen over one opaque code because the Mini App must distinguish "your link
expired, get a fresh one" from a hard failure; tokens are opaque 256-bit
randoms, so there is no practical oracle to exploit. These codes are an
addition to §32 and should be folded into the Master TZ at the next revision.

### OD-036 — Join-Time "Game No Longer Joinable" Error Code · RESOLVED
Decision: `POST /rooms/:code/join` rejects with `GAME_NOT_JOINABLE` (409,
non-retryable) when the resolved game's status is anything other than
`LOBBY`. Every non-`LOBBY` status is folded into this single code —
`RUNNING`, `PAUSED`, `FINISHED`, and `CANCELLED` are not distinguished from
one another (and `DRAFT` is moot: §15.1 creates a game directly in `LOBBY`,
so a join attempt can never observe `DRAFT`). `CANCELLED` was explicitly
considered for its own code and rejected: from the joining client's
perspective, "this game was cancelled" and "this game already finished" /
"this game is already running" all resolve to the same next action — stop
trying to join this one, look for or create another — so a separate code
would add a distinction with no behavioral consequence for the client.
Rationale: §15.2 specifies "same validation order and codes as v5.0 §15.2"
including a status=LOBBY check, but that v5.0 code isn't reproduced in §32's
error table (same carry-forward-gap class as OD-035's launch-token codes and
the `POST /auth/telegram` rate limit). `GAME_NOT_JOINABLE` is chosen over
reusing `ROOM_NOT_FOUND` because the room and its code both still exist and
are valid — only this particular game has moved past the joinable window —
and a client needs to tell "wrong/expired code" apart from "you're too late
for this one" to render a sensible message. This code is an addition to §32
and should be folded into the Master TZ at the next revision.

### OD-037 — Leave / Ready / Host-Transfer Endpoint Mechanics · RESOLVED
Context: §15.3 says only "unchanged mechanism from v5.0 §15.3-15.5 with
`groupId`→`roomId` terminology only" — but the v5.0 document itself isn't
present in this repo (v6.0 §1.2 states it supersedes v5.0 in full and is
self-contained), and §30.1's endpoint table lists no path, method, request,
or response shape for leaving, readiness, or host transfer at all. This is a
deeper carry-forward gap than OD-035/OD-036 (those were missing error codes
for an otherwise-specified mechanism; here the endpoint contract itself is
unspecified). OD-013 (host transfer policy) and OD-014 (readiness policy)
already resolve the *underlying rule*; this decision pins down the concrete
endpoints needed to exercise them, following the same reasoning discipline.

Decision:
- Three endpoints, all `bearer`, all requiring `clientRequestId` (§19) and
  going through the same `CommandRequestService` idempotency contract as
  `POST /rooms` and `POST /rooms/:code/join`:
  - `POST /rooms/:id/leave` — body `{ clientRequestId }`.
  - `POST /rooms/:id/ready` — body `{ clientRequestId, isReady: boolean }`.
  - `POST /rooms/:id/host-transfer` — body `{ clientRequestId, targetPlayerId }`.
- All three key off the room's **id**, not its shareable code — by this
  point the caller is already a seated player, not someone resolving a room
  from a code/deep-link, so id (not a second code lookup) is the natural key.
- All three run inside a transaction holding `SELECT games ... FOR UPDATE`
  on the game row, per §6.3/§19's explicit invariant that "every
  state-changing command executes inside one transaction holding a row lock
  on the Room/Game" — this is not a new decision, just applying the
  already-stated boundary to three more commands.
- All three are LOBBY-only (`ROOM_NOT_FOUND` 404 if the room/game can't be
  resolved at all — reusing the existing code, same semantics as join;
  `ROOM_NOT_IN_LOBBY` 409 if the game exists but has left `LOBBY`). This
  follows from OD-015 (resolved): once `RUNNING`, an unwanted departure is
  handled as passive absence (disconnect), not an explicit leave action — a
  "leave" concept mid-game isn't defined anywhere, so this endpoint doesn't
  invent one.
- `PLAYER_NOT_IN_GAME` (404): the caller has no `GamePlayer` row for this
  game, or their row's `lifeStatus` is already `LEFT`. Both cases collapse
  to the same code — "you are not currently seated here" — rather than
  distinguishing "never joined" from "already left."
- Leave: sets the caller's `GamePlayer.lifeStatus` to `LEFT`. If the caller
  was host, host transfers automatically per OD-013 (earliest `joinedAt`
  among remaining non-`LEFT` players). If no non-`LEFT` player remains, the
  lobby is empty: `Game.status` → `CANCELLED` and `Room.status` → `CLOSED`,
  directly implementing the §8.5 lifecycle mapping ("CLOSED = last game
  FINISHED/CANCELLED and no new game started") rather than leaving an
  abandoned, unreachable LOBBY game occupying a room code indefinitely.
  Response: `{ roomId, gameId, playerId, playerCount, newHostPlayerId,
  roomClosed }`. Re-joining after `LEFT` is not offered here — that's
  OD-021 (open/non-blocking, default "prohibited"), already enforced by
  `POST /rooms/:code/join`'s existing `PLAYER_ALREADY_JOINED` check, which
  doesn't distinguish a fresh row from a `LEFT` one.
- Ready: sets the caller's `GamePlayer.isReady` to the requested value.
  Response: `{ roomId, gameId, playerId, isReady }`. Per OD-014, this is a
  display-only signal — it gates nothing here and isn't expected to gate
  `StartGame` when that endpoint is built.
- Host-transfer: only the *current* host may call it (`NOT_HOST`, 403,
  re-checked inside the lock so a second concurrent transfer request from a
  now-stale host is rejected, not raced). The target must resolve to a
  current non-`LEFT` `GamePlayer` in the same game (`TARGET_NOT_IN_GAME`,
  404). Transferring to yourself is treated as a harmless no-op (200,
  unchanged host) rather than inventing a distinct error code for a case
  with no ambiguity. Response: `{ roomId, gameId, previousHostPlayerId,
  newHostPlayerId }`. This is the *explicit* handoff path, kept as its own
  endpoint distinct from leave's automatic transfer per §15.3's plural
  "Leaving, Ready/Unready, Host [transfer]" framing, which reads as three
  related but separate operations, not one shared code path.

All four new codes (`ROOM_NOT_IN_LOBBY`, `PLAYER_NOT_IN_GAME`, `NOT_HOST`,
`TARGET_NOT_IN_GAME`) plus the three endpoint response shapes above are
additions to §30.1/§32 and should be folded into the Master TZ at the next
revision, same as OD-035/OD-036.

### OD-038 — Public Room Browser: Pagination Shape, Ordering, Response Fields · RESOLVED
Context: §8.2 states `GET /rooms/public` "lists open `PUBLIC` rooms with free
slots — paginated, rate-limited, no private room ever listed," and §34's Redis
table names a cache key `cache:rooms:public:page:{n}` (3s TTL, "read from
PostgreSQL directly" if Redis is down) for it — but neither section states the
query parameter names, default/max page size, sort order, or the exact
per-room response fields. Same carry-forward-gap class as OD-035/036/037.

Decision:
- **Pagination is page-number based**, not cursor-based: `?page` (1-indexed,
  default 1) and `?limit` (default 20, max 50). This isn't a free invention —
  the `cache:rooms:public:page:{n}` key literally names a page number, which
  only makes sense as a cache key for page-based (not cursor-based)
  pagination, so the spec already implies the shape even though §30.1 doesn't
  spell it out. The specific defaults (20/50) have no textual source and are
  chosen as conventional, conservative values for a browse UI.
- **"Open" resolves to `Room.status = OPEN` AND the active game's status is
  `LOBBY`.** §8.5's lifecycle table maps `OPEN` to "no active game, or
  DRAFT/LOBBY," but every room created via `POST /rooms` always has an active
  game created directly in `LOBBY` (§15.1 — `DRAFT` is never reached), so in
  practice this collapses to exactly `LOBBY`, consistent with OD-036's
  join-time LOBBY check.
- **"With free slots" is `playerCount < maxPlayers`**, using the established
  LEFT-exclusion convention from OD-037 (a `LEFT` player doesn't hold a slot)
  — same rule already applied to join's capacity check and leave's roster
  count, applied here for consistency rather than re-litigated.
- **Response fields per room**: `roomId`, `code`, `maxPlayers`, `rulesetMode`,
  `playerCount`, `createdAt`. `code` is included because it's the only
  existing mechanism to act on a listed room — `POST /rooms/:code/join`
  is code-keyed, not id-keyed, and this slice doesn't add an id-based join
  path — so a listing without it would be browsable but not actionable.
  `creatorUserId` / any User-identifying field is deliberately excluded: no
  spec text asks for it, and a public, browse-without-joining listing is not
  the place to default to exposing another user's identity when nothing
  requires it (§29.1's spirit — Room binding must not leak more than it has
  to). Internal fields (`visibility`, `status` — always `PUBLIC`/`OPEN` by
  construction of the query — `id` of the Game, host info) are omitted as
  redundant or irrelevant to a pre-join decision.
- **Default order is newest-first (`createdAt DESC`).** Not stated anywhere.
  "Soonest-to-fill" (by live player count) was considered and rejected
  because player count is a derived/computed value, not a stored, indexed
  column — sorting by it would force computing and sorting every matching
  room's count before paginating, defeating the "index-backed, not an
  offset-scan" requirement this endpoint is held to. `createdAt` is an
  indexed column that gives a stable, efficient sort.

This decision (pagination shape, defaults, field list, ordering) is an
addition to §8.2/§30.1 and should be folded into the Master TZ at the next
revision, same as OD-035/036/037.

### OD-039 — Room-Creation `visibility` Field: Name, Optionality, Default · RESOLVED
Context: §8.1 fixes the allowed values (`visibility ∈ {PRIVATE, PUBLIC}` —
confirmed no third state anywhere in the schema/spec) and §8.2 says the
create flow "User picks size, mode (Normal/Fast), visibility," but neither
section states the request field's name, whether it's required, or what
happens if the caller omits it. OD-038 flagged this as a known gap (that
slice found `GET /rooms/public` was unreachable through the real create
endpoint) without deciding the contract; this decision closes it.

Decision: the field is named `visibility` (matches the `RoomVisibility`
column/enum name directly — no reason to rename it in the DTO), is
**optional**, and **defaults to `PRIVATE`** when omitted. Rationale: this
mirrors the column's own `@default(PRIVATE)` in `prisma/schema.prisma`, so
the DTO default and the DB default agree rather than silently diverging.
`PRIVATE` is also the safer default on its own merits — a room a user
creates without explicitly choosing "public" should not become discoverable
by strangers by accident. This is an addition to §8.2/§30.1 and should be
folded into the Master TZ at the next revision, same as OD-035–038.

### OD-040 — StartGame Endpoint Contract (Slice 1: Validation + Status Transition) · RESOLVED
Context: §10.2's phase diagram names `LOBBY --> ROLE_REVEAL : StartGame` and
§13.2/§14.2 describe StartGame's validation and config-freezing rules in
detail, but **no HTTP endpoint for StartGame appears anywhere in §30.1** —
not even a path stub, unlike leave/ready/host-transfer where OD-037 at least
had OD-013/014's policy layer to build on. This is the same
deeper-than-error-codes gap class as OD-037. This decision covers only what
Slice 1 (validation + status transition) needs; role assignment (creating
`GameRoleAssignment`-equivalent rows) is explicitly out of scope here — those
models don't exist in the schema yet and this decision does not design them.

Decision:
- **`POST /rooms/:id/start`** — id-keyed like leave/ready/host-transfer (the
  caller is already seated), `bearer`, `clientRequestId` required, same
  `CommandRequestService`/`recoverReplay` idempotency contract as every other
  room command, `SELECT games ... FOR UPDATE` per §6.3/§19.
- **Host-only.** No spec text says otherwise, and every other host-scoped
  power in this codebase (cancel, host-transfer) is host-only; reuses the
  existing `NOT_HOST` (403) code from OD-037 rather than inventing a
  synonym for the identical failure mode.
- **Minimum player count is the fixed constant 4** — not room-specific and
  not derived from the room's `maxPlayers`. §13.1's distribution table's
  *lowest defined row* is 4 players; §13.2 requires "the joined player count
  has [a] row in this table," and no row exists below 4 for any room
  configuration. A room's `maxPlayers` is a ceiling on who *can* join, not a
  floor on when the host *may* start — those are different concerns, and
  the table settles the floor unambiguously. Player count uses the same
  LEFT-exclusion convention as every other roster count in this module
  (OD-037). Failure code: `NOT_ENOUGH_PLAYERS` (409) — a new code, since no
  v5.0/v6.0 text names this specific failure. `CONFIG_INVALID` (422) is
  reused verbatim from §13.2's own text for the (currently unreachable, but
  spec-mandated) "player count has no matching row" case — join's existing
  4-24 bound plus this same 4-player floor mean every reachable count 4-24
  always has a row, so this path exists for defense-in-depth, not because a
  live gap in validation elsewhere could otherwise be hit today.
- **Readiness does NOT gate start**, per OD-014 (already resolved): "StartGame
  requires only playerCount >= minPlayers... is_ready is a display-only
  signal and does not gate StartGame. Host may start regardless of how many
  players are marked ready." No ready-related check or error code exists in
  this endpoint — implementing one would contradict an already-resolved
  decision, not fill a gap.
- **Wrong-status failures reuse `ROOM_NOT_IN_LOBBY`** (409, OD-037) — calling
  start on an already-`RUNNING`, `CANCELLED`, `FINISHED`, or `PAUSED` game is
  the same "not currently LOBBY" failure mode already named for leave/ready/
  host-transfer, not a distinct code.
- **Resulting state**: `Game.status` → `RUNNING`, `Game.currentPhase` →
  `ROLE_REVEAL` (directly, per the phase diagram — there is no intermediate
  "STARTING" phase in the schema's `GamePhaseName` enum, so none is
  invented), `Game.startedAt` → now, `Game.rulesVersion` → `"6.0.0"` (§13.1's
  fixed value). Every currently-seated non-`LEFT` `GamePlayer.lifeStatus` →
  `ALIVE` (from `WAITING`) — this is a life-status transition, not a role
  assignment, and has no other spec-described exit from `WAITING`; leaving it
  at `WAITING` into a `RUNNING` game would be a worse gap than setting it.
  `Room.status` → `IN_PROGRESS` (§8.5's mapping: `IN_PROGRESS` = `RUNNING`/
  `PAUSED`), which is also what makes `HOST_ALREADY_HOSTING` (§15.1) and the
  room disappearing from `GET /rooms/public` actually reachable through the
  real API for the first time — both already implemented against this
  status value, previously only reachable in tests via a forced Prisma write.
- **`config_snapshot` is populated, but only with the fields this slice
  itself computes or validates against**: `rulesVersion`, `roomId`,
  `rulesetMode`, `minPlayers` (4), `maxPlayers` (24 — §13.1's table ceiling,
  an engine-wide bound documenting the table's range, not this room's chosen
  cap, which is a separate concern already captured on the Room row itself),
  `roleDistribution` (the §13.1 row for the actual seated count — the same
  row this slice's validation already looked up), `phaseDurationsSec` (§14.2,
  computed from seated count + ruleset mode), `lastWordEnabled` (derived from
  `rulesetMode` per §13.3). The remaining fields in §14.1's full JSON shape
  (`mafiaKillPolicy`, `doctorSelfProtection`, `doctorRepeatProtection`,
  `doctorProtectionScope`, `detectiveResultSemantics`, `tiePolicy`,
  `voteVisibility`, `revealRoleOnDeath`, `firstNightKillAllowed`,
  `maxNightDeaths`, `chatEnabled`, `language`) are deliberately **not**
  embedded yet — they are already-resolved OD defaults, but nothing in this
  slice reads or validates them, and embedding them here would be deciding
  night-action/voting/chat scope from inside a lobby-transition slice. The
  slices that actually consume each field (night resolution, voting, chat)
  should add it to `config_snapshot` when built — the JSON column is
  additive, so this is a safe deferral, not a breaking one.
- **Role assignment is explicitly not this decision's concern.** No
  `Role`/`GameRoleAssignment`-equivalent table exists in the schema yet, so
  nothing is stubbed for it — Slice 2 owns designing and creating those
  tables and rows; this slice only guarantees `config_snapshot.roleDistribution`
  is frozen and available for Slice 2 to consume as its input.

This is an addition to §30.1/§32 and should be folded into the Master TZ at
the next revision, same as OD-035–039.

### OD-041 — StartGame Slice 2: Role Assignment Ownership, Atomicity, Persistence, Randomness, Visibility · RESOLVED
Context: §12.1 names the mechanism ("`RoleDefinition` (catalog) +
`GameRoleAssignment` (immutable per-player link) + `RoleBehavior` (strategy
object)") and §10.3 states "only the Game Engine may write ...role
assignments," but nothing in §10-§14 specifies *when within the StartGame
command* dealing happens, what the persisted shape looks like beyond the
mechanism's name, what randomness primitive to use, or how a player later
reads their own role. Five sub-decisions, resolved together:

1. **Module ownership: `src/game-engine/`, not `src/rooms/`.** This one isn't
   actually open — CLAUDE.md already states it explicitly ("`game-engine` (the
   domain layer: role assignment, action validation, night/vote resolution,
   win evaluator)"), and `game-engine.module.ts`'s own docstring already names
   role assignment as its reason to exist. `RoomsService` continues to own the
   `POST /rooms/:id/start` endpoint, its transaction, and its `FOR UPDATE`
   lock (that's lobby orchestration — who can start, is it LOBBY, etc.); it
   calls a new `RoleAssignmentService` (in `game-engine`) *from inside* that
   already-open transaction to perform the actual role-assignment writes.
   `rooms -> game-engine` is not a boundary violation — I-33's rule (enforced
   by `.dependency-cruiser.cjs`) is one-directional: `game-engine` must never
   import `economy`/`store`/`payments`/`referral`, and they must never import
   it back. It says nothing about `rooms -> game-engine`, and the reverse
   direction (`game-engine` importing anything from `rooms`) is avoided here:
   `RoleAssignmentService.dealRoles` takes a plain `{ gameId, activePlayerIds,
   roleDistribution }` and a transaction client, never a `Room`/`CreatedRoom`
   type — `game-engine` has zero knowledge of the rooms module existing.
   **Pre-existing, out-of-scope note**: §10.3 also names `games.status`/
   `current_phase`/`round`/`game_players.life_status` as Game-Engine-only
   writes, but Slice 1 (already committed, ed21194) writes those directly
   from `RoomsService` — a real, narrow §10.3 mismatch, but refactoring
   already-shipped Slice 1 code is a drive-by change this decision does not
   make. Flagged as a known gap, not fixed here.
2. **Dealing is atomic with Slice 1's transaction — folded into the same
   `startGameTransaction`, same `FOR UPDATE` lock, not a separate step.**
   §6.3's architectural principle ("every state-changing command executes
   inside one transaction holding a row lock on the Room/Game") frames
   StartGame as one command; a `RUNNING` game with no dealt roles would be an
   invalid, spec-unaccounted-for intermediate state with no defined recovery
   path. Rather than introduce one, this decision eliminates the window: role
   assignment happens inside Slice 1's existing transaction, before commit.
   If dealing fails for any reason, the whole `StartGame` call fails and the
   game stays in `LOBBY` — same all-or-nothing guarantee as every other
   command in this module.
3. **Persistence: a new `GameRoleAssignment` table, not a field on
   `GamePlayer`.** §12.1 names it as its own artifact ("immutable per-player
   link"), which a dedicated insert-only table expresses more faithfully than
   a mutable column on an already-mutable `GamePlayer` row. `playerId` is
   `@unique` (not part of a composite key) — a `GamePlayer` row already scopes
   to exactly one game, so "at most one assignment per playerId" already
   means "exactly one role per seated player per game." **No `RoleDefinition`
   catalog table is added this slice** — the 9 roles and their team
   membership are a fixed, code-level mapping (`src/game-engine/roles.ts`),
   same treatment as §13.1's distribution table in Slice 1. A DB-editable
   catalog is Phase 16 (SuperAdmin content) work, not a Phase 4/5 lobby-to-
   game-start concern; adding one now would be speculative infrastructure for
   a requirement that doesn't exist yet. `RoleBehavior` (the strategy object)
   is explicitly code, not data, per §12.1's own wording — not persisted at
   all, and irrelevant to dealing (it's night-action resolution, Phase 6).
4. **Randomness: Fisher-Yates shuffle using `crypto.randomInt`**, the same
   primitive already used for room-code generation earlier in this project.
   `randomInt(i + 1)` at each step of the standard backward Fisher-Yates walk
   returns a uniform integer in `[0, i]` inclusive — Node's `crypto.randomInt`
   is documented to reject and retry outside the unbiased range internally
   rather than using a modulo reduction, so unlike `Math.random() * n | 0`
   there is no small-range bias toward low indices. Fisher-Yates itself is the
   standard unbiased shuffle: each of the `n!` permutations of the role list
   is equally likely, which is what "no mechanism that lets any party bias
   outcomes" requires here — nobody, including the server operator, gets a
   lever to prefer one player for one role.
5. **No role-visibility read endpoint in this slice.** §20 (Realtime,
   unchanged from v5.0) already defines the delivery mechanism for a player's
   own role: a private WebSocket event on the `game:{gameId}:player:{playerId}`
   channel — not a REST read. This codebase has no WebSocket/realtime layer
   at all yet (no gateway module exists anywhere in `src/`), so building a
   REST "get my role" endpoint now would invent a delivery mechanism the spec
   doesn't call for at this phase, ahead of the realtime slice that's
   supposed to own it. This slice guarantees the data exists and is
   queryable (`GameRoleAssignment`, one row per player) — exposing it is
   explicitly the realtime/WebSocket slice's job, not built here.

This is an addition to §10.2/§12.1/§30 and should be folded into the Master TZ
at the next revision, same as OD-035–040.

### OD-042 — Round Boundary Definition · RESOLVED
Context: §9/§10 and the `games_round_non_negative`/`game_phases_round_non_negative`
CHECK constraints establish that `round` "starts at 0 (pre-game) and only ever
advances," and §10.2's phase diagram has exactly one cycle-repeat edge
(`WIN_CHECK --> NIGHT : no winner`), but nothing in §9-§14 or §19 states the
precise moment the counter increments — that specific boundary point is not
textual in MASTER_TZ.md.

Decision (product owner, 2026-09-26): round increments when a `NIGHT` phase
begins. `ROLE_REVEAL` is round 0 (pre-game); the first `NIGHT` starts round 1;
every phase between that `NIGHT` and the next one (its `NIGHT_RESOLUTION`,
`MORNING`, `DISCUSSION`, `VOTING`, `VOTE_RESOLUTION`, optional `LAST_WORD`/
`EXECUTION`, `WIN_CHECK`) shares round 1's number; the next `NIGHT` (reached
via `WIN_CHECK`'s "no winner" edge) starts round 2, and so on. `GAME_OVER`
carries whatever round was active when the winner was determined — reaching
it never bumps the counter again.

The rejected alternative (bump the counter at `WIN_CHECK` itself, before the
loop back to `NIGHT`) is functionally near-identical — `WIN_CHECK --> NIGHT`
is the only repeat edge — but would make `WIN_CHECK`'s own `game_phases` row
carry the *next* round's number instead of the round it's actually concluding,
which reads worse in the audit history (`game_phases`/future `game_events`).

This is an addition to §9/§10.2/§19 and should be folded into the Master TZ at
the next revision, same as OD-035–041.

### OD-043 — Scheduled-Task Worker Operational Parameters · RESOLVED
Context: §19 (v5.0 §21, carried forward "unchanged in mechanism") names the
timer mechanism precisely — "`scheduled_tasks` table, `FOR UPDATE SKIP
LOCKED` polling, lease-based claiming, `game_phases.ends_at` as sole
authority" — but the v5.0 source text that would spell out concrete
operational numbers is not reproduced anywhere in this repository (only the
mechanism-level bullet survives into MASTER_TZ.md v6.0). Four numeric/policy
parameters are needed to actually run a worker and have no textual source:
poll interval, lease duration, retry/backoff policy, and max attempts before
a task is abandoned.

Decision (product owner, 2026-09-26), four sub-points:

1. **Poll interval: 1 second.** Fine enough relative to the shortest timed
   phase (10s `ROLE_REVEAL`/`MORNING` in Fast mode, §14.2) that a phase's
   actual advance lags its `ends_at` by ~1s on average; cheap enough that
   idle `SELECT ... FOR UPDATE SKIP LOCKED` polling against an empty due-set
   is not a meaningful DB load concern at this scale.
2. **Lease duration: 30 seconds.** `advancePhase` (§10.2/§10.3) is a single
   row-locked, sub-second transaction, so 30s is generous headroom for a GC
   pause or transient DB slowness while still recovering an abandoned task
   well within any phase's duration if the worker that claimed it crashes
   before calling `complete`/`fail`.
3. **Retry/backoff policy: bounded exponential backoff with jitter** — base
   5s, doubling, capped at 5 minutes, ±20% jitter. This is the exact policy
   §19/§25 already mandates for the (not-yet-built) outbox dispatcher;
   applying it here too means the one shared `scheduled_tasks` table has a
   single retry shape regardless of which future consumer (phase transitions
   now, the outbox dispatcher later) enqueued a given row, rather than two
   divergent policies on one table.
4. **Max attempts: 10.** At the backoff policy above, 10 attempts spans a few
   minutes up to ~5 minutes per retry at the cap — enough to ride out a
   transient DB blip or a rolling deploy without a permanently-broken task
   polling forever; a task exceeding this moves to a terminal `FAILED` status
   (this table's equivalent of the outbox's future DLQ) for manual/admin
   inspection rather than being deleted or retried indefinitely.

The `scheduled_tasks` table's own column shape (kind discriminator, JSON
payload, `run_at`, status enum, `lease_owner`/`lease_expires_at`,
`attempt_count`) is not itself a product/gameplay decision — no spec text
names these columns, the same way `game_phases`'s own column shape (§19's
prior slice) was engineering judgment applied to a named mechanism, not a
literal transcription. It is documented in the migration and
`scheduling.module.ts`'s docstring rather than repeated here.

This is an addition to §19/§21 (v5.0) and should be folded into the Master TZ
at the next revision, same as OD-035–042.

### OD-044 — Night-Action Edge Cases: Sheriff Shot, Maniac Self-Target, Early-Completion Gate · RESOLVED
Context: §12.3/§12.4/§17 fully specify the night-action model and the 9-step
resolution priority, but three specific interactions are not settled by the
text. Three sub-points, resolved together:

1. **Sheriff's shot vs. target team.** §12.4 step 7's note reads: "...one
   from Sheriff's shot if the Sheriff hit an innocent per OD-002x, see
   note)". No `OD-002x` exists anywhere in MASTER_TZ.md or this file — it is
   a dangling reference with no recoverable resolution text (distinct from
   `OD-002`, "Mafia kill policy," which governs something else entirely).
   Decision: treat it as a spec-text artifact. A Sheriff's `SHOOT` is a
   standard kill attempt — subject to Doctor/Bodyguard protection exactly
   like any other pending kill (as the same note's own preceding sentence
   already states) — with no different outcome based on whether the target
   turns out to be `MAFIA`, `TOWN`, or `NEUTRAL`.
2. **Maniac self-targeting.** §12.3's Maniac row ("alive, any team including
   Mafia") never says "not self," unlike every other action ability, which
   either states "not self" explicitly or — Doctor's `PROTECT` alone —
   explicitly carves out self as allowed. Decision: Maniac cannot target
   itself with `KILL`. Doctor's safety ability is the sole designed
   exception to "not self"; a self-`KILL` option has no coherent purpose in
   a design with no other suicide mechanic.
3. **"All actions submitted" early-completion gate (§10.2).** The diagram
   names the trigger but not what "all" means once Don has an optional
   second ability (`CHECK`, "at most one per night") and Sheriff's only
   ability is once-per-game. Decision: `NIGHT` advances early once every
   `ALIVE` player whose role still has a *usable* night ability has
   submitted their **primary** slot (Mafia/Don/Maniac: `KILL`, Detective:
   `INVESTIGATE`, Sheriff: `SHOOT`, Doctor: `PROTECT`, Bodyguard: `GUARD`,
   Journalist: `INVESTIGATE_PAIR`). A Sheriff who has already spent their
   one-time `SHOOT` is removed from the expected-submitters set from that
   point on — they have nothing left to submit, ever. Don's optional `CHECK`
   never gates early completion, since abstaining from an optional ability
   is indistinguishable from still deciding; requiring it would pressure
   clients into auto-submitting a `CHECK` every night just to unblock the
   phase for everyone else, making an optional ability de facto mandatory.

A fourth candidate point — whether an ordinary Mafia member (or the Don) may
abstain from submitting a `KILL` vote on a given night — is **not** a new
open decision: OD-015 (resolved) already establishes the general principle
that absence is a legitimate outcome for any role's action ("They simply
submit no action/vote for phases they miss... No automatic LEFT transition,
no automatic action, no forced removal"), which extends without
modification to a connected player who simply chooses not to act. An
abstaining Mafia member's vote is not counted toward the majority tally in
§12.4 step 2.

This is an addition to §12.3/§12.4/§10.2 and should be folded into the
Master TZ at the next revision, same as OD-035–043.

### OD-045 — Day-Vote Self-Targeting · RESOLVED
Context: §16/OD-018/OD-020 fully specify vote tie policy and vote
visibility/change mechanics, but nothing in the Master TZ states whether a
player may cast their `VOTING`-phase vote for themselves. This is the same
class of gap OD-044b resolved for Maniac's `KILL` — a target-eligibility rule
the spec is silent on, not a design question requiring product judgment about
gameplay balance.

Decision: self-voting is allowed. Unlike every §12.3 night ability (each of
which explicitly states "not self" except Doctor's designed exception), the
day vote has no per-role target-restriction table at all — there is no
enumerated "not self" rule to be silent about the way Maniac's row was.
Classic Mafia/Werewolf voting conventionally permits self-voting (a
credible-innocent play to "clear" oneself), and prohibiting it would be
inventing a restriction with no textual basis, the opposite error from
OD-044b's reasoning (there, every sibling ability's explicit "not self"
made silence on Maniac read as an oversight, not a deliberate opening).

This is an addition to §16/the Master TZ's voting section and should be
folded into the Master TZ at the next revision, same as OD-035–044.

### OD-046 — Win Evaluator: Simultaneous Three-Faction Wipeout · RESOLVED
Context: §16.1's evaluator is given as an explicit if/else-if chain, quoted
here in full:

```text
if maniacAlive == 1 AND mafiaAlive == 0 AND townAlive == 0
    -> MANIAC wins
else if mafiaAlive == 0 AND maniacAlive == 0
    -> TOWN wins
else if mafiaAlive >= (townAlive + maniacAlive) AND maniacAlive == 0
    -> MAFIA wins
else if mafiaAlive == 1 AND maniacAlive == 1 AND townAlive == 0
    -> DUEL: no winner yet ...
         (... if both are somehow eliminated simultaneously,
          declared a DRAW — game ends with winner_team = null, summary flag "draw")
else
    -> no winner, continue
```

Two internal inconsistencies, both reachable given the night-resolution
engine already built (§12.4): a duel's last Mafia-team survivor and the
Maniac can submit mutual `KILL`s on the same night, and with no Doctor/
Bodyguard alive to intercept either (townAlive is already 0 in a duel), both
pending kills resolve — a genuine simultaneous double-elimination, not a
hypothetical.

1. **The pseudocode's branch order never reaches the prose's DRAW outcome.**
   The literal chain checks `mafiaAlive == 0 AND maniacAlive == 0 -> TOWN
   wins` (branch 2) with no `townAlive` condition at all. A simultaneous
   wipeout of all three factions (`mafiaAlive == maniacAlive == townAlive ==
   0`) satisfies branch 2 exactly as written and would be declared a TOWN
   win by the literal code — directly contradicting the very next paragraph's
   "declared a DRAW" for exactly this scenario. There is no explicit DRAW
   condition anywhere in the quoted chain; the prose describes a branch the
   pseudocode never encodes.

   Decision: insert an explicit DRAW check (`mafiaAlive == 0 AND maniacAlive
   == 0 AND townAlive == 0`) ahead of branch 2's `TOWN wins` check. This is
   the minimal change reconciling the code with the prose immediately below
   it, and the prose is unambiguous that this exact case must not be a TOWN
   win.

2. **DRAW's representation conflicts across the same section.** §16.1's prose
   says the draw case ends "with winner_team = null, summary flag 'draw'."
   §16.3, two paragraphs later, states the column's domain outright:
   "`game_results.winner_team ∈ {TOWN, MAFIA, NEUTRAL, DRAW}`" — DRAW is a
   member of the enumerated domain, not a null-plus-flag encoding, and no
   "summary flag" column is named anywhere in §33's schema tables.

   Decision: `game_results.winner_team` is a 4-valued enum (`TOWN`, `MAFIA`,
   `NEUTRAL`, `DRAW`), no separate flag column. §16.3's later, schema-specific
   statement governs over §16.1's looser prose paraphrase of the same
   outcome; building a distinct "summary flag" field is also out of this
   slice's scope (no post-game summary JSON is specified with named fields
   beyond `winner_team` — see the win-evaluator slice's non-goals).

This is an addition to §16.1/§16.3 and should be folded into the Master TZ at
the next revision, same as OD-035–045.

### OD-047 — Realtime Event Catalog for the First Delivery Slice · RESOLVED
Context: §20 states the transport ("Unchanged... from v5.0 §26.1–26.2, Socket.IO,
`/game` namespace, server-side-only room joins, JWT handshake auth, GamePlayer
resolution before any room join") and the room-naming scheme
(`game:{gameId}`, `game:{gameId}:player:{playerId}`, `game:{gameId}:team:{TEAM}`,
plus v6's new chat rooms), but the actual **event name/payload catalog** lives
in "v5.0 §18.5's table," which §17.5 explicitly extends rather than restates —
and v5.0's text is not present anywhere in this repository (same
carry-forward-gap class already hit for `game_actions`/`game_votes`/
`game_results`'s column shapes, OD-041/OD-046's precedent).

This slice is also deliberately narrower than "the realtime layer": per the
task's own framing, it ships phase-transition + `GAME_FINISHED` broadcasts
only, deferring private per-role night-action results (§17.5's
`SHERIFF_RESULT`/`DON_CHECK_RESULT`/`GUARD_CONSUMED`/`JOURNALIST_RESULT`),
`VOTE_CAST` (OD-020a), and room/lobby events to a follow-up slice — seven
distinct write-paths in one slice was assessed as too large to review and test
soundly at once (see the final report's self-assessment).

Decision, scoped to exactly what ships now:
1. **Event names**: `PHASE_CHANGED` (`{from, to, round}`, broadcast to
   `game:{gameId}`, fired once per externally-observable `advancePhase` call
   that actually advances — not once per internal transient-phase hop, since
   `NIGHT_RESOLUTION`/`VOTE_RESOLUTION`/`EXECUTION`/`WIN_CHECK` "never survive
   a commit" (§10.1) and are equally invisible to a polling client reading
   `games.current_phase`) and `GAME_FINISHED` (`{winnerTeam}`, broadcast to
   `game:{gameId}`, fired once when `PHASE_CHANGED.to === GAME_OVER`).
   Chosen to name exactly the two facts a polling client would otherwise have
   to notice via `GET /games/:gameId` polling — no new information, purely a
   push shortcut for existing REST-visible state (§20's realtime-is-additive
   principle).
2. **No sequence numbers / replay for these two events.** §21's "snapshot →
   WS connect with `lastSequence` → replay or resync" describes an
   event-sequence mechanism this codebase has no backing store for yet (no
   `game_events` table exists — that is itself unbuilt infrastructure, not
   this slice's job to retrofit). A client that is disconnected when
   `PHASE_CHANGED`/`GAME_FINISHED` fires simply does not receive it and must
   fall back to its next REST poll — explicitly logged as a known gap, per
   this slice's own non-goals, rather than building speculative backlog
   infrastructure to satisfy a replay algorithm whose storage layer doesn't
   exist.
3. **Connection protocol**: the client supplies both a bearer JWT (issued by
   the existing `/auth/telegram` flow, `handshake.auth.token`) and a
   `gameId` (`handshake.auth.gameId`) at connect time. The server verifies
   the JWT, resolves `GamePlayer(gameId, userId)`, and only then joins
   `game:{gameId}` and `game:{gameId}:player:{playerId}` — matching §20's
   "GamePlayer resolution before any room join" literally. A socket that
   fails either check is disconnected immediately, no partial room
   membership. This reuses the exact JWT the HTTP API already issues/verifies
   (same `JWT_SECRET`, same `{sub, telegramId}` payload shape as
   `JwtStrategy`) rather than inventing a second auth scheme.

This is an addition to §17.5/§20/§21 and should be folded into the Master TZ
at the next revision, same as OD-035–046.

### OD-048 — Missing Private Event Names: Detective and Doctor · RESOLVED
Context: §17.5's private-event catalog names exactly four events —
`SHERIFF_RESULT`, `DON_CHECK_RESULT`, `GUARD_CONSUMED`, `JOURNALIST_RESULT` —
covering Sheriff `SHOOT`, Don `CHECK`, Bodyguard `GUARD`, and Journalist
`INVESTIGATE_PAIR`. `NightResolutionService.resolveRound` (built in the
night-action slice) already produces a private per-actor result for two more
action types §12.3's "private information received" column also promises:
Detective's `INVESTIGATE` (`{flag: 'MAFIA'|'NOT_MAFIA'}`) and Doctor's
`PROTECT` (`{applied: true}`, OD-006's silent confirmation). Neither has a
named event in §17.5's catalog — the list is confirmed **not exhaustive**
relative to what the already-built resolution pipeline actually produces,
not a sign these two roles get no private event at all (§12.3 already
establishes they receive private information; only the *event name* for
delivering it over the socket is missing).

Decision: two additional event names, same `{ROLE}_RESULT`/`{ROLE}_ACTION`
naming convention as the existing four:
- `DETECTIVE_RESULT` — Detective's `INVESTIGATE`, payload `{flag}` (identical
  shape to what's already persisted in `GameAction.result` and returned by
  `GET .../night-actions/mine`).
- `DOCTOR_PROTECT_RESULT` — Doctor's `PROTECT`, payload `{applied}` (same
  reasoning).

No event exists for Mafia/Don/Maniac `KILL` or for a Mafia member's own vote
submission — §17.5 names none, and `NightResolutionService` itself pushes no
`ActionResult` for `KILL` (confirmed by reading its resolution code): a kill
submission has no private feedback to its actor beyond the outcome already
covered by the (separately out-of-scope, still-deferred) public death
event(s).

This is an addition to §17.5 and should be folded into the Master TZ at the
next revision, same as OD-035–047.

### OD-049 — Room/Lobby Realtime Events: Channel Scope, Names, Payloads · RESOLVED
Context: the realtime phase-2 report assessed room/lobby events as needing
"its own `room:{roomId}`-scoped realtime channel" not present in §20's
naming scheme, and deferred the whole area on that basis. Re-reading §8/§15
in full (not just §20) corrects that assessment:

**§8.4** (verbatim): "Membership, host authority, and every gameplay
permission resolve exclusively through `GamePlayer`... the only change is
that the surrounding context object is `Room`, not `TelegramGroup`."
**§15.1** (verbatim): "On success: `Room` row + `Game` row (`status =
LOBBY`), creator inserted as `GamePlayer` and `host_player_id`..." — confirmed
against `RoomsService.createRoomTransaction`'s actual code: a `Room` and its
`Game` (in `LOBBY` status) are created **atomically, in the same
transaction**, and every subsequent room member (`joinRoomTransaction`) is
inserted as a `GamePlayer` row scoped to that same `gameId`. There is no
"pre-Game" lobby state in this data model at all — the lobby **is** a `Game`
row, just one whose `status` happens to be `LOBBY` instead of `RUNNING`. Every
one of `RoomsService`'s six response DTOs (`CreatedRoom`, `JoinedRoom`,
`LeftRoom`, `ReadySet`, `HostTransferred`, `GameStarted`) already carries a
`gameId` field, confirming the code agrees with this reading.

Decision:
1. **No new channel.** `game:{gameId}` (§20's existing, already-implemented
   scope) is the correct broadcast scope for room/lobby events — a client
   connects to it once, at room-creation/join time, using the `gameId`
   already returned by `POST /rooms`/`POST /rooms/:code/join`, and **stays
   connected through the entire lifecycle** (`LOBBY` → `ROLE_REVEAL` →
   `RUNNING` → ... → `GAME_OVER`) — one channel, one connection, no
   reconnect/rejoin at the `StartGame` boundary, because it is the same
   `gameId` throughout. This corrects phase 2's assessment; no
   `room:{roomId}` scheme, no gateway change, no new `RealtimeEventService`
   method — `broadcastToGame` as built in phase 1 is already sufficient.
2. **Event names/payloads** (none named in §15.1–15.3 beyond "`ROOM_CREATED`/
   `GAME_CREATED` events" at creation, with no payload spec given — same
   carry-forward-gap class as OD-047/048): each event reuses its command's
   already-computed response DTO verbatim, the same "duplicates a pollable
   endpoint, invents no new shape" principle OD-047/048 already established.
   - `ROOM_CREATED` (create) — payload = `CreatedRoom`. §15.1 names both
     `ROOM_CREATED` and `GAME_CREATED`; this codebase creates Room+Game as one
     atomic aggregate op with one response object, so one event carries both
     facts rather than two events for a single write — inventing a second,
     differently-shaped event for the same atomic write would add a
     distinction with no payload difference to justify it. In practice no
     other socket can be connected to `game:{gameId}` yet at creation time
     (the creator's own socket, if connected at all, already has this data
     from the HTTP response) — wired for spec-fidelity and forward
     consistency, not because it currently reaches a second listener.
   - `PLAYER_JOINED` (join) — payload = `JoinedRoom`.
   - `PLAYER_LEFT` (leave) — payload = `LeftRoom`.
   - `PLAYER_READY_CHANGED` (setReady) — payload = `ReadySet`.
   - `HOST_TRANSFERRED` (transferHost) — payload = `HostTransferred`.
   - `startGame` emits no new bespoke event. It performs the `LOBBY ->
     ROLE_REVEAL` phase write directly (via `GameLifecycleService.startGame`,
     not through `PhaseTransitionService.advancePhase`), so phase 1's
     `PHASE_CHANGED` broadcast does **not** already cover it — confirmed by
     reading the code, not assumed. Rather than invent a seventh event name,
     `startGame` broadcasts the *same* `PHASE_CHANGED` event phase 1 already
     defined (`{from: 'LOBBY', to: currentPhase, round: 0}`, OD-042's round-0
     convention), so a connected client's phase-change handling stays uniform
     regardless of which service triggered the transition.
3. **Public-listing (`GET /rooms/public`) stays poll-only.** §8.2 describes it
   as a paginated, rate-limited discovery/browse endpoint — nothing in §8.2
   or §20 names a realtime channel for it, and a browsing client is by
   definition not yet a `GamePlayer` of any specific room it's browsing, so
   it cannot pass the existing (and intentionally unchanged, per this slice's
   non-goals) per-game membership check the gateway's auth middleware
   performs. Building this would need an entirely different, unscoped/global
   channel model — out of scope here, logged as a known gap, not attempted.

This is an addition to §15/§20 and should be folded into the Master TZ at the
next revision, same as OD-035–048.

### OD-050 — MULTIPLE_DEATHS: One-Death and Zero-Death Nights, Payload Shape · RESOLVED
Context: §17.5 (verbatim): "`MULTIPLE_DEATHS` (PUBLIC, when more than one
death occurs the same night — payload is a list, not a repeated single-death
event, so ordering never implies causation)." This is the only public
night-resolution event §17.5 names. It does not say what, if anything, is
broadcast when exactly one player dies, or when nobody dies. OD-024
(already resolved) separately establishes that death events carry no role
field at all ("PLAYER_DIED/PLAYER_EXECUTED events carry no role field") —
those two names appear there only as an illustrative example while resolving
the *role-reveal* question, not as an event this codebase has ever built or
that any OD actually mandates; grepping `src/` confirms neither name exists
anywhere in code before this slice.

Decision:
1. **The event name is taken literally.** §17.5's own wording — "when more
   than one death occurs" — is the trigger condition, not just a label:
   `MULTIPLE_DEATHS` fires if and only if `deaths.length > 1` for that night's
   resolution. `NightResolutionService.resolveRound` already computes this
   list (`resolveNightActions`'s `deaths: string[]`, deduplicated player ids,
   §12.4/OD-031 cap of 3) — reused verbatim as the payload, no new shape:
   `{ deaths: string[] }`. Per OD-024, no role field is included.
2. **Exactly one death: no public event fires this slice.** §17.5 names no
   single-death public event, and none exists anywhere in code today. A
   connected client already receives `PHASE_CHANGED` (`NIGHT ->
   NIGHT_RESOLUTION -> ...`) on the same night, and role-bearing players
   affected by the death receive their own private per-actor results
   (§17.5/OD-048) where applicable (e.g. a Sheriff learns `{died: true}`
   from their own `SHERIFF_RESULT`); a fully public "someone died" surface
   for the single-death case is a real gap, not silently invented here — it
   would need its own OD if/when a client actually needs it (candidate name
   `PLAYER_DIED`, not decided here).
3. **Zero deaths: no event, as expected** — nothing to announce; not a real
   gap, just the base case of rule 1.
4. **Execution (day-vote) deaths are out of scope for this event.** §17.5
   only names `MULTIPLE_DEATHS` in the night-resolution section; no
   equivalent public event is named for `EXECUTION`. An executed player's
   fate is already publicly derivable from `VOTE_CAST`'s live tally
   (OD-020a) plus the following `PHASE_CHANGED`, so this is treated as
   already covered rather than a gap requiring a new event — consistent with
   not inventing behavior §17.5 doesn't name.
5. **Emission point/ordering:** wired into `PhaseTransitionService.
   advancePhase`'s existing post-commit broadcast block (same as
   `PHASE_CHANGED`/`GAME_FINISHED`), emitted immediately after those two,
   still gated on the same `await this.prisma.$transaction(...)` having
   already resolved. §17.5/§20 state no required ordering relative to
   `PHASE_CHANGED`, and clients consume each event independently off the
   same already-committed state, so no ordering is load-bearing — placed
   after `PHASE_CHANGED` purely for source locality, not because ordering
   matters.

This is an addition to §17.5 and should be folded into the Master TZ at the
next revision, same as OD-035–049.

### OD-051 — Outbox Table Shape and First Concrete Topic Scope · RESOLVED
Context: §19 (line 600, verbatim): "Outbox (v5.0 §25): transactional outbox,
`FOR UPDATE SKIP LOCKED` dispatcher, bounded exponential backoff with jitter,
DLQ, at-least-once/duplicate-tolerant delivery. New topic: `STARS_REFUND`
(§25.5) and `REFERRAL_REWARD_NOTIFY` (§26.4), both following the identical
outbox contract — gameplay and economy notifications share one dispatcher and
one reliability model." The dispatcher table at line 1199 names five topics
total: `TELEGRAM_MESSAGE`, `STATS_PROCESS`, `WALLET_CREDIT` (§23.4),
`STARS_REFUND` (§25.5), `REFERRAL_REWARD_NOTIFY` (§26.4). v5.0 §25's actual
schema text (the section this is all "unchanged in mechanism" from) is not
reproduced anywhere in this repository — same carry-forward gap as v5.0 §18.5
(OD-048) and §21 (OD-043).

Two things are nonetheless already decided, not ambiguous:
1. **Purpose is clear and distinct from the realtime layer**: line 158's
   pipeline ("one transaction writing state + events + outbox + scheduled
   tasks") and line 720 ("a gameplay reward credit is enqueued as an
   outbox-triggered follow-up command... applied by the same dispatcher that
   delivers Telegram messages, so a wallet-credit failure can never roll back
   a completed game") both describe the outbox as the mechanism for
   external/cross-aggregate side effects that must survive independently of
   the triggering transaction — Telegram bot pushes to a player who may not
   be connected to the Mini App's Socket.IO session, and cross-aggregate
   follow-up commands (a wallet credit triggered by a finished game, §23.4).
   This is a different problem from realtime's `game:{gameId}` broadcast
   (OD-047/049/050), which only reaches a currently-connected socket.
2. **No new `outbox_events` table is needed.** OD-043 (recorded 2026-09-26,
   *before* this slice existed) already anticipated this exact question and
   answered it: its retry/backoff policy was deliberately applied to
   `scheduled_tasks` because "this is the exact policy §19/§25 already
   mandates for the (not-yet-built) outbox dispatcher; applying it here too
   means the one shared `scheduled_tasks` table has a single retry shape
   regardless of which future consumer (phase transitions now, the outbox
   dispatcher later) enqueued a given row." `ScheduledTask`'s `kind`/`payload`
   columns are already fully opaque/generic (never interpreted by
   `SchedulerService`) — exactly what an outbox topic needs. Building a
   second table would duplicate `FOR UPDATE SKIP LOCKED` claiming,
   backoff/jitter, and max-attempts logic for no gain, and contradict OD-043's
   own stated reasoning.

Decision, scope for what actually gets enqueued *today*:
3. Of the five named topics, `WALLET_CREDIT`/`STARS_REFUND`/
   `REFERRAL_REWARD_NOTIFY` have no producer: `economy`/`payments`/`referral`
   are still empty scaffold modules (`src/{economy,payments,referral}/*.module.ts`,
   no services, confirmed by reading each directory) — nothing to enqueue.
   `STATS_PROCESS` (§37-38, "derived/async statistics") has no producer or
   consumer built yet either and is unrelated to game-engine/rooms' current
   write paths. **Only `TELEGRAM_MESSAGE` has a real, concrete trigger
   available today.**
4. Within `TELEGRAM_MESSAGE`, this slice ships exactly one event:
   `GAME_FINISHED` — enqueued from `GameLifecycleService.transitionPhase`'s
   existing `gameOver` branch, in the same transaction as the `GameResult`
   insert, one task per dealt-in player (`roleAssignment` not null; a player
   who left the lobby before StartGame is excluded — they were never in the
   game). This is deliberately the smaller first cut per this slice's own
   instructions: §67's feature list only says "Telegram Bot notifications via
   outbox" with zero enumeration of concrete trigger events, and v5.0's
   detail is unavailable, so no other event (game start, "your turn",
   per-round pings) is invented against a spec that doesn't name it. See
   OD-052 for what's explicitly deferred.
5. **No new admin surface for exhausted (`FAILED`) outbox tasks.** This was
   already a known, logged gap for `scheduled_tasks` generally (no
   admin-visible surface for terminal `FAILED` rows); nothing about the
   outbox's at-least-once/DLQ framing in §19/§25 requires building that
   surface *now* — `FAILED` is already the correct terminal state per
   OD-043d, and §19's "DLQ" language is satisfied by that terminal status
   existing, whether or not anyone has built a UI to browse it yet. Adding an
   admin surface would be new functionality beyond "wire the second
   consumer," so it stays a known gap, not addressed here.

This is an addition to §19/§25 and should be folded into the Master TZ at the
next revision, same as OD-035–050.

### OD-052 — Outbox Notification Copy: Localization and Error Classification · RESOLVED
Context: §21 (line 966, verbatim): "Every user-facing string — Mini App UI,
bot messages, push/outbox notifications, error messages, store item
names/descriptions, referral share text — MUST exist in all three [uz/ru/en]."
No prior slice added a `locale` column to `User`, and no product copy for any
bot notification has been supplied anywhere in this repository or by the
product owner's addenda.

Decision:
1. **Real localized copy is out of scope for this slice** — it is a content/
   translation deliverable, not an engineering default an agent should
   invent. `TelegramNotificationService`'s `renderText` is a single,
   clearly-isolated function producing interim, non-localized (English)
   copy from the `TELEGRAM_MESSAGE` payload's structured `event`/`gameId`/
   `winnerTeam` fields — chosen as structured facts rather than pre-rendered
   text specifically so real i18n templates can replace `renderText` later
   without touching any enqueue call site or the delivery/retry mechanism.
   Logged here as a known gap requiring product-supplied uz/ru/en copy (and,
   before that, a `User.locale` column/read path) before this is genuinely
   spec-compliant.
2. **Telegram API delivery-error classification: no retryable-vs-permanent
   distinction.** A 4xx response (e.g. "bot was blocked by the user," a
   permanent condition no retry will fix) is treated identically to a 5xx or
   network failure — the handler throws in either case and lets
   `SchedulerService.pollOnce`'s existing catch block call `fail()`, which
   retries with OD-043c's backoff until OD-043d's `maxAttempts` (10), then
   moves to `FAILED`. This was an explicit instruction for this slice, not a
   default invented under time pressure: the alternative (recognizing "blocked
   the bot" and jumping straight to `FAILED`) would require a second retry
   mechanism, which the task scope explicitly ruled out. The cost is at most
   10 wasted delivery attempts (over OD-043c's backoff schedule, capped at
   5 minutes) against an unrecoverable target before the task reaches its
   correct terminal state — acceptable for a first cut.

   **Superseded by OD-053** for the 400/403/429 cases specifically — see below.
   The "no second retry mechanism" reasoning still holds for 5xx/network
   failures, which remain unclassified.

This is an addition to §21 and should be folded into the Master TZ at the
next revision, same as OD-035–051.

### OD-053 — Outbox Delivery Error Classification: Permanent vs. Rate-Limited · RESOLVED
Context: OD-052 point 2 accepted "burn up to 10 attempts against an
unrecoverable target" as the cost of not building a second retry mechanism.
Follow-up instruction: refine specifically the two Telegram error shapes
where that cost is avoidable without inventing a parallel retry system —
400/403 (permanent: bot blocked, chat not found, user never started the bot)
and 429 (transient but self-describing: the response names its own
`retry_after`).

Decision:
1. **No second retry mechanism was built.** Both new error paths still
   terminate in `SchedulerService`'s existing two outcomes
   (`fail()`/`FAILED`) — nothing outside `scheduler.service.ts` decides
   retry timing or terminal status.
2. **Minimal generic hook added to `SchedulerService`** (not
   Telegram-specific, so any future `scheduled_tasks` consumer can use it):
   two typed errors, `PermanentTaskError` (optional `statusCode`) and
   `RetryAfterError` (`retryAfterMs`). `pollOnce`'s catch block checks
   `instanceof` before falling through to the existing generic-`Error`
   path, so every consumer that doesn't throw these (today:
   `PHASE_ADVANCE_CHECK`) is unaffected.
3. **`PermanentTaskError` → `failPermanently()`**, a new `SchedulerService`
   method: sets `FAILED` immediately, bypassing the `attemptCount <
   maxAttempts` check `fail()` normally applies — so a 400/403 ends the task
   after exactly one attempt instead of OD-043d's 10. `pollOnce` logs a warn
   with `taskId` + `statusCode` only, not the thrown message — the response
   body (which Telegram embeds error text in) can carry the recipient's
   `chat_id`/description and is stored in `lastError` for later inspection,
   not put in the application log stream.
4. **`RetryAfterError` → `fail()` gains an optional `minRunAt` parameter.**
   `fail()`'s own OD-043c backoff computation still runs unconditionally;
   `minRunAt` (derived from Telegram's `retry_after` seconds) is only a
   floor — `runAt = max(backoffRunAt, minRunAt)`. If Telegram's 429 body
   doesn't parse or carries no `parameters.retry_after`, `deliver` falls
   through to a plain `Error`, i.e. the normal backoff path, per the
   instruction's explicit fallback.
5. **5xx and network failures are unchanged** — plain `Error`, full
   OD-043c/d backoff-then-`FAILED` lifecycle, per OD-052 point 2's original
   reasoning (unclassified failures still cost at most 10 attempts, which
   remains acceptable since neither is knowably permanent nor
   self-describing about retry timing the way 429 is).

This is an addition to §19 (scheduled-task consumer contract) and should be
folded into the Master TZ at the next revision, same as OD-035–052.

### OD-054 — CORS Origin Allow-List: Wildcard Handling and Unset Default · RESOLVED
Context: enabling CORS for the Mini App frontend (`src/common/config/cors.ts`,
`src/main.ts`, `src/common/realtime/realtime.gateway.ts`) needed two defaults
the task's own instructions didn't fully pin down: what happens if an
operator sets `CORS_ORIGINS=*` despite being told not to, and what the
allow-list should be when `CORS_ORIGINS` is unset at all (dev/test).

Decision:
1. **A literal `*` in `CORS_ORIGINS` is stripped, not honored.** "No
   wildcard in production" reads as an absolute invariant, not merely this
   module's own default — so `resolveCorsOrigins()` filters `*` out of
   the parsed list unconditionally (whether it's the whole value or one
   entry in a comma-separated list) rather than passing it through to the
   `cors` package's origin array. A misconfigured env var fails closed
   (falls back to the dev-only default below) instead of silently opening
   CORS to every origin.
2. **Unset default is `http://localhost:5173` only** — the Vite dev
   server's own default port (`frontend/vite.config.ts`), not an empty
   array (which would reject every browser request including local dev)
   and not a broader guess at a production frontend origin (none is named
   anywhere in this repo).

This is an addition to §6 (transport/CORS) and should be folded into the
Master TZ at the next revision, same as OD-035–053.

### OD-055 — `GET /rooms/:code` Player Roster: Membership Gate · RESOLVED
Context: B-R1 added a `players` roster to `RoomSummary`
(`RoomsService.getRoomByCode`) — display name, avatar, ready, host, joinedAt
per active player — for the frontend lobby (`frontend/docs/OPEN_DECISIONS.md`
OD-F2-001). Before adding it, checked who can actually call this endpoint:
`RoomsController` is `@UseGuards(JwtGuard)` at the class level (any
authenticated user), and `getRoomByCode` itself performs **no membership
check at all** — any authenticated user who knows/guesses a room code can
already fetch the aggregate `RoomSummary` (`playerCount`, `status`, etc.).
That access rule predates this slice and is unchanged here — "do not modify
the backend" boundaries elsewhere in this project's history apply to scope,
not to leaving a pre-existing gap unaddressed when it's directly relevant to
what's being built.

Decision: a roster is meaningfully more sensitive than an aggregate count
(it names people, even if only by their Telegram first/last name + avatar),
so **the new `players` field is gated to active members only** —
`getRoomByCode(code, requesterUserId?)` returns `players` only when
`requesterUserId` is an active (non-LEFT) `GamePlayer` of the room's game;
otherwise the field is omitted entirely (not `[]`, so "no data returned" is
distinguishable from "empty room"). The endpoint's own access rule (any
authenticated caller can still fetch the aggregate shape) is **not**
changed — narrowing that further was judged out of this slice's stated
scope ("Scope is ONLY this... if [already restricted to members], change
nothing about access"; it is not already restricted, so the new field gets
the restriction instead of the whole endpoint).

This is an addition to §8 (rooms) and should be folded into the Master TZ at
the next revision, same as OD-035–054.

### OD-056 — Dev-Only Bot Players: Identity Marker and Module Gating · RESOLVED
Context: B-D1 needed a way to fill a LOBBY room with synthetic players for
solo testing (`POST /dev/rooms/:code/fill-bots`, `src/dev-tools/`), and two
things the task's own wording left as "if the schema allows a non-breaking
way, otherwise rely on the reserved range and log an OD":

1. **How a bot is marked, for "skip bots" checks (e.g. the outbox).**
   Decision: added `User.isBot Boolean @default(false)` — a plain additive
   column (migration `20260928125437_add_user_is_bot`), non-breaking (every
   existing row defaults to `false`, no existing query's shape changes).
   This is the *authoritative* signal `GameLifecycleService
   .enqueueGameFinishedNotifications` filters on (`user: { isBot: false }`)
   — not string-parsing a `telegramId`. The reserved negative-number
   `telegramId` range (`-${Date.now()}${randomInt(1000,9999)}`,
   `DevToolsService.generateBotTelegramId`) is kept as a *second*,
   belt-and-suspenders guarantee — outside Telegram's real (always
   positive) id space, so a bot can never collide with a real account
   even if some future code path forgot to check `isBot` — not the sole
   signal, since the task allowed for a schema marker and one was
   possible here without breaking anything.
2. **How the module disappears entirely outside dev.** `DevToolsModule` is
   only ever added to `AppModule`'s `imports` via
   `resolveDevToolsImports()` (`src/dev-tools/dev-tools.config.ts`),
   evaluated once at `@Module()` decoration time (same timing
   `common/config/cors.ts`'s `resolveCorsOrigins()` already established as
   safe — env vars are set before Nest's module graph is built). Gated on
   `DEV_TOOLS_ENABLED === 'true' && NODE_ENV !== 'production'`; if
   `NODE_ENV=production` and `DEV_TOOLS_ENABLED` is set **at all** (any
   value, to also catch a stray/typo'd truthy-looking value, not just a
   literal `'true'`), the process throws synchronously before
   `main.ts`'s `app.listen()` is ever reached.

**Membership check reuses OD-055, not a bespoke one.** Fill-bots requires
the caller be an active member of the room ("host or not", per this task's
own wording) — rather than writing a second membership check,
`DevToolsService.fillBots` calls the same `RoomsService.getRoomByCode(code,
requesterUserId)` OD-055 already gates on `players` presence, and throws
`ForbiddenException` (403) when it comes back absent. One membership rule,
one place it's enforced.

This is a dev-tooling addition, not a Master TZ gameplay behavior — no §
section to fold it into.

## OPEN and BLOCKING — implementation of the dependent feature MUST NOT proceed

None. Every previously blocking decision is resolved (see the addendum above).

## OPEN and non-blocking — has a stated default, may proceed using it but must be logged as a known gap

| ID | Title | Required before | Default in force |
|---|---|---|---|
| OD-009 | Server region | Release gate | — |
| OD-010 | Error tracking vendor | Release gate | — |
| OD-021 | Re-join after leaving | Phase 4: Lobby | Prohibited |
| OD-026 | Early phase advance | Phase: Engine | Off |
| OD-028 | Changing a submitted action | Phase 6: Roles/actions | Allowed, update-in-place |
| OD-029 | Room expiry | Phase 10/11: Recovery | SHOULD ship |
| OD-031 | Max simultaneous night deaths cap | Phase 6: Roles/actions | 3 (§12.4) |
| OD-032 | Staff authentication mechanism | Phase 16: Admin | Local credentials + IP allowlist |
| OD-033 | Financial-record retention jurisdiction | Release gate | — |
| OD-034 | Wallet negative-balance handling after refund | Phase: Payments | Clamp display at 0, flag ledger deficit for admin review (§25.5) |

## Notes

- OD-021, OD-026, OD-028, OD-029 retain
  their full v5.0 question/options/consequences text (MASTER_TZ.md §42.3, referencing v5.0 §48.3) —
  not reproduced here; consult that source text before proposing a resolution.
  (OD-013, OD-014, OD-018, OD-020, OD-023, OD-024 were in this list until the
  2026-09-25 addendum resolved them.)
- OD-031–OD-034 are new in v6.0 (MASTER_TZ.md §42.2/§42.1) and non-blocking, each with a
  stated default already reflected in the spec body (§12.4, §25.5, §28.4).
- Total: 44 resolved (17 in v6.0 + 9 by the 2026-09-25 addendum +
  OD-037 through OD-054 recorded 2026-09-26/27/28), 0 open+blocking,
  10 open+non-blocking (54 IDs, OD-001 through OD-054).
