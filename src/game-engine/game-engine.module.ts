import { Module } from '@nestjs/common';
import { RoleAssignmentService } from './role-assignment.service';

/**
 * Gameplay domain module — the authority for role assignment, action
 * validation, night/vote resolution and the win evaluator (Master TZ §12, §16, §17).
 *
 * First real code here (OD-041): `RoleAssignmentService`, the StartGame
 * Slice 2 role dealer. The rest of the engine (action validation, night/vote
 * resolution, win evaluator) remains Phase 5+ work, several parts still
 * gated behind blocking Open Decisions (see docs/decisions/OPEN_DECISIONS.md).
 *
 * INVARIANT I-33: this module MUST NOT import from `economy`, `store`,
 * `payments` or `referral`, directly or transitively. No purchased, gifted or
 * referral-granted entity may ever affect a game's outcome.
 */
@Module({
  providers: [RoleAssignmentService],
  exports: [RoleAssignmentService],
})
export class GameEngineModule {}
