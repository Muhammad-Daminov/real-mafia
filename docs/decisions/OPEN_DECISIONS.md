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

These seven were BLOCKING in MASTER_TZ.md §42.1 and were resolved by the product
owner ahead of the Phase 2 Room/Game schema. This is an **addendum**, not a spec
edit: MASTER_TZ.md §42.1 still lists them as OPEN/BLOCKING. Where the two disagree,
these decisions are the later and therefore governing word — the Master TZ should
be amended to match at the next revision.

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
- Total: 24 resolved (17 in v6.0 + 7 by the 2026-09-25 addendum), 0 open+blocking,
  10 open+non-blocking (34 IDs, OD-001 through OD-034).
