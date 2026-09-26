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
- Total: 30 resolved (17 in v6.0 + 9 by the 2026-09-25 addendum +
  OD-037/OD-038/OD-039/OD-040 recorded 2026-09-26), 0 open+blocking, 10
  open+non-blocking (40 IDs, OD-001 through OD-040).
