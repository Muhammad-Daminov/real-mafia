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

## OPEN and BLOCKING — implementation of the dependent feature MUST NOT proceed

| ID | Title | Blocks |
|---|---|---|
| OD-013 | Host Transfer | Phase 2: Room/Game lifecycle |
| OD-014 | Lobby Readiness Rule | Phase 4: Lobby |
| OD-015 | Disconnect / Abandonment Policy | Phase 6: Roles/actions |
| OD-018 | Vote Tie Policy | Phase: Engine (vote resolution) |
| OD-020 | Vote Visibility and Vote Change | Phase: Engine (voting) |
| OD-023 | Host Powers and Cancellation Authority | Phase: Engine / Admin |
| OD-024 | Role Reveal on Death / Post-Game | Phase: Engine (death, game over) |

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

- OD-013–OD-015, OD-018, OD-020, OD-023, OD-024, OD-021, OD-026, OD-028, OD-029
  retain their full v5.0 question/options/consequences text (MASTER_TZ.md §42.3,
  referencing v5.0 §48.3) — not reproduced here; consult that source text before
  proposing a resolution.
- OD-031–OD-034 are new in v6.0 (MASTER_TZ.md §42.2/§42.1) and non-blocking, each with a
  stated default already reflected in the spec body (§12.4, §25.5, §28.4).
- Total: 17 resolved, 7 open+blocking, 10 open+non-blocking (34 IDs, OD-001 through OD-034).
