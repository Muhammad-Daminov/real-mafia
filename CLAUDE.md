# REAL MAFIA — Agent Rules

## Source of truth

The single source of truth for product/technical behavior is
`docs/00-master/MASTER_TZ.md` (Master Technical & Product Specification v6.0).
Authority hierarchy (per the spec's §1.1): Open Decision > Master Specification >
ADR > Domain/State Machine spec > API/Realtime contract > implementation detail >
developer/agent preference.

Open Decisions status (which are resolved, which are open/blocking, which are
open/non-blocking) is tracked in `docs/decisions/OPEN_DECISIONS.md`, derived from
MASTER_TZ.md §42.

## Never invent gameplay behavior

Never invent gameplay behavior that is not specified in MASTER_TZ.md. If something
is ambiguous or missing:

1. Check `docs/decisions/OPEN_DECISIONS.md` and MASTER_TZ.md §42 first.
2. If it maps to an existing Open Decision (OD-XXX), **stop** implementing that
   piece. Do not guess a default that isn't explicitly stated in the spec.
3. If it's genuinely new (not covered by any existing OD), write it up as a new
   Open Decision (in `docs/decisions/OPEN_DECISIONS.md`) and stop — do not
   implement around it.

## Blocking Open Decisions

A feature gated behind a **BLOCKING** Open Decision (see
`docs/decisions/OPEN_DECISIONS.md`) MUST NOT be implemented until that decision is
resolved. A dependent endpoint returns `RULE_NOT_APPROVED` rather than shipping
invented behavior. Non-blocking Open Decisions have a stated default in the spec
and MAY be implemented against that default, but the gap must stay visible (e.g.
in `docs/audit/GAP_REPORT.md` or a TODO referencing the OD id).

## Module boundaries (I-33)

`game-engine` (the domain layer: role assignment, action validation, night/vote
resolution, win evaluator) MUST NOT import anything from `economy`, `store`,
`payments`, or `referral` modules — directly or transitively. Those modules MUST
NOT import from `game-engine` either. No purchased, gifted, or referral-granted
entity may ever affect game state, validation, resolution, or the win evaluator.
This is invariant I-33 and is enforced by a CI import-boundary lint plus property
tests — treat any code path that would blur this boundary as a design error, not
an edge case to special-case around.

## One slice per session

Work on exactly one small, coherent slice per session. Do not touch unrelated
code while doing so — no drive-by refactors, no unrelated cleanups, even if you
notice something else that looks wrong (note it instead, don't fix it in the same
change).

## Read before you write

Before changing any code, read the current state of what you're touching and its
immediate neighbors: Prisma schema (`prisma/schema.prisma`), migrations
(`prisma/migrations/`), the relevant game engine code, auth, telegram integration,
realtime/WebSocket layer, chat, economy, and any existing tests that cover the
area. Do not assume — verify against the actual files.

## Migrations only

Never use `prisma db push`. All schema changes go through
`prisma migrate dev` (locally) / `prisma migrate deploy` (in the pipeline) —
migrations only, always committed to `prisma/migrations/`.

## Don't weaken tests or constraints to make them pass

Never loosen a test's assertions, skip/disable a test, or relax a database
constraint, validation rule, or lock just to make something "pass" or "work."
If a test or constraint is failing, fix the underlying code, or stop and raise
the conflict — do not make the check lie.
