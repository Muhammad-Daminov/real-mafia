import { Module } from '@nestjs/common';

/**
 * Gameplay domain module — the authority for role assignment, action
 * validation, night/vote resolution and the win evaluator (Master TZ §12, §16, §17).
 *
 * Intentionally empty: the engine itself is Phase 5+ work and several of its
 * behaviours are still gated behind blocking Open Decisions
 * (see docs/decisions/OPEN_DECISIONS.md). The module exists now so the
 * import-boundary rule of §37.5 / invariant I-33 is enforced from the very
 * first commit that adds real code here, rather than being retrofitted.
 *
 * INVARIANT I-33: this module MUST NOT import from `economy`, `store`,
 * `payments` or `referral`, directly or transitively. No purchased, gifted or
 * referral-granted entity may ever affect a game's outcome.
 */
@Module({})
export class GameEngineModule {}
