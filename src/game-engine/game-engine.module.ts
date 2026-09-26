import { Module } from '@nestjs/common';
import { SchedulingModule } from '../common/scheduling/scheduling.module';
import { RoleAssignmentService } from './role-assignment.service';
import { GameLifecycleService } from './game-lifecycle.service';
import { PhaseTransitionService } from './phase-transition.service';

/**
 * Gameplay domain module — the authority for role assignment, action
 * validation, night/vote resolution and the win evaluator (Master TZ §12, §16, §17).
 *
 * `RoleAssignmentService` (OD-041) deals roles. `GameLifecycleService`
 * (post-Slice-2 cleanup) owns §10.3's StartGame- and phase-transition-scoped
 * writes (games.status/current_phase/round, game_players.life_status,
 * game_phases rows) that had previously — incorrectly — lived directly in
 * RoomsService. `PhaseTransitionService` (§10.2/§19) owns the phase state
 * machine itself: it holds the `games` row lock and decides what the next
 * phase is, then delegates the write to `GameLifecycleService`, the same
 * split of responsibility StartGame already established. Night-action
 * resolution, vote-counting/elimination, and the win evaluator remain
 * separate later slices — see `phase-graph.ts`'s docstring for exactly how
 * that scope boundary shows up in the transition logic today.
 *
 * INVARIANT I-33: this module MUST NOT import from `economy`, `store`,
 * `payments` or `referral`, directly or transitively. No purchased, gifted or
 * referral-granted entity may ever affect a game's outcome.
 */
@Module({
  imports: [SchedulingModule],
  providers: [RoleAssignmentService, GameLifecycleService, PhaseTransitionService],
  exports: [RoleAssignmentService, GameLifecycleService, PhaseTransitionService],
})
export class GameEngineModule {}
