import { Module } from '@nestjs/common';
import { RoleAssignmentService } from './role-assignment.service';
import { GameLifecycleService } from './game-lifecycle.service';

/**
 * Gameplay domain module — the authority for role assignment, action
 * validation, night/vote resolution and the win evaluator (Master TZ §12, §16, §17).
 *
 * `RoleAssignmentService` (OD-041) deals roles. `GameLifecycleService`
 * (post-Slice-2 cleanup) owns §10.3's other StartGame-scoped writes
 * (games.status/current_phase, game_players.life_status) that had
 * previously — incorrectly — lived directly in RoomsService. The rest of the
 * engine (action validation, night/vote resolution, win evaluator) remains
 * Phase 5+ work, several parts still gated behind blocking Open Decisions
 * (see docs/decisions/OPEN_DECISIONS.md).
 *
 * INVARIANT I-33: this module MUST NOT import from `economy`, `store`,
 * `payments` or `referral`, directly or transitively. No purchased, gifted or
 * referral-granted entity may ever affect a game's outcome.
 */
@Module({
  providers: [RoleAssignmentService, GameLifecycleService],
  exports: [RoleAssignmentService, GameLifecycleService],
})
export class GameEngineModule {}
