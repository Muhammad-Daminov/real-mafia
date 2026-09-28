import { Module } from '@nestjs/common';
import { SchedulingModule } from '../common/scheduling/scheduling.module';
import { RealtimeModule } from '../common/realtime/realtime.module';
import { CommandRequestService } from '../common/command-requests/command-request.service';
import { RoleAssignmentService } from './role-assignment.service';
import { GameLifecycleService } from './game-lifecycle.service';
import { PhaseTransitionService } from './phase-transition.service';
import { NightActionService } from './night-actions/night-action.service';
import { NightResolutionService } from './night-actions/night-resolution.service';
import { NightActionsController } from './night-actions/night-actions.controller';
import { VoteService } from './voting/vote.service';
import { VoteResolutionService } from './voting/vote-resolution.service';
import { VotingController } from './voting/voting.controller';
// win-evaluator.ts is a pure function with no service/provider of its own —
// PhaseTransitionService calls it directly (see its own docstring).

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
 * split of responsibility StartGame already established. `NightActionService`
 * (§17.1-§17.3) validates and persists night-action submissions;
 * `NightResolutionService` (§17.4) applies the §12.4 priority order at
 * NIGHT -> NIGHT_RESOLUTION, called from inside `PhaseTransitionService`'s own
 * lock. `VoteService` (§16/OD-018/OD-020) validates and persists day-vote
 * casts; `VoteResolutionService` (§16/§10.4) applies OD-018's plurality/tie
 * rule at VOTING -> VOTE_RESOLUTION, same calling convention as night
 * resolution. `win-evaluator.ts`'s pure `evaluateWinCondition` (§16.1,
 * OD-046) is called directly by `PhaseTransitionService` at NIGHT_RESOLUTION
 * and WIN_CHECK — it has no provider of its own, the same "pure function,
 * no DI" shape as `resolveNightActions`/`resolveVotes`. `PhaseTransitionService`
 * also broadcasts `PHASE_CHANGED`/`GAME_FINISHED` (§20, OD-047), each
 * night round's private per-actor results (§17.5/OD-048 — `DON_CHECK_RESULT`,
 * `SHERIFF_RESULT`, `GUARD_CONSUMED`, `DETECTIVE_RESULT`,
 * `DOCTOR_PROTECT_RESULT`, `JOURNALIST_RESULT`), and `MULTIPLE_DEATHS`
 * (§17.5/OD-050 — PUBLIC, only when a night kills more than one player) via
 * `common/realtime`'s
 * `RealtimeEventService`, post-commit. `VoteService` broadcasts `VOTE_CAST`
 * (OD-020a) the same way, from its own `$transaction` — see both services'
 * docstrings for the commit-ordering discipline. `RoomsService` (outside this
 * module, in `rooms/`) broadcasts its six room/lobby events the same way,
 * over the *same* `game:{gameId}` channel — OD-049 established that a Room's
 * first `Game` row exists (in `LOBBY` status) from the moment of creation, so
 * there is no separate pre-game channel to design; `startGame` reuses
 * `PHASE_CHANGED` itself for its `LOBBY -> ROLE_REVEAL` write, which doesn't
 * go through `PhaseTransitionService`.
 *
 * INVARIANT I-33: this module MUST NOT import from `economy`, `store`,
 * `payments` or `referral`, directly or transitively. No purchased, gifted or
 * referral-granted entity may ever affect a game's outcome.
 */
@Module({
  imports: [SchedulingModule, RealtimeModule],
  controllers: [NightActionsController, VotingController],
  providers: [
    RoleAssignmentService,
    GameLifecycleService,
    PhaseTransitionService,
    NightActionService,
    NightResolutionService,
    VoteService,
    VoteResolutionService,
    CommandRequestService,
  ],
  exports: [RoleAssignmentService, GameLifecycleService, PhaseTransitionService],
})
export class GameEngineModule {}
