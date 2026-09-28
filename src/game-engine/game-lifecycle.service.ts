import { Injectable } from '@nestjs/common';
import { GamePhaseName, GameStatus, LifeStatus, Prisma, WinnerTeam } from '@prisma/client';
import { SchedulerService } from '../common/scheduling/scheduler.service';
import { RoleAssignmentService } from './role-assignment.service';
import { RoleDistribution } from './roles';
import {
  PHASE_ADVANCE_TASK_KIND,
  PhaseAdvanceTaskPayload,
  phaseAdvanceDedupeKey,
} from './scheduled-task-kinds';

/**
 * §14.2's per-phase durations in seconds, computed once at StartGame and
 * frozen into `Game.configSnapshot.phaseDurationsSec` (§14.3). Defined here
 * (not imported from `rooms/start-game.config.ts`) so `game-engine` never
 * depends on `rooms` — the same one-directional discipline OD-041 already
 * applies to `RoleDistribution`, just expressed as a structural duplicate
 * instead of a shared import, since `rooms` is the one computing this value
 * from room/player state game-engine has no business knowing about.
 */
export interface PhaseDurationsSec {
  ROLE_REVEAL: number;
  NIGHT: number;
  MORNING: number;
  LAST_WORD: number | null;
  DISCUSSION: number;
  VOTING: number;
}

export interface StartGameWritesInput {
  gameId: string;
  activePlayerIds: string[];
  roleDistribution: RoleDistribution;
  phaseDurationsSec: PhaseDurationsSec;
}

export interface StartGameWritesResult {
  status: GameStatus;
  currentPhase: GamePhaseName;
}

export interface TransitionPhaseInput {
  gameId: string;
  /** id of the currently-active (`endedAt: null`) GamePhase row being closed. */
  closePhaseId: string;
  toPhase: GamePhaseName;
  round: number;
  /** null for transient phases and GAME_OVER (§10.1: never timed). */
  endsAt: Date | null;
  /** §9: GAME_OVER also finalizes Game.status/finishedAt. */
  gameOver: boolean;
  /**
   * §16.3/§10.3: required whenever `gameOver` is true — `GAME_OVER` is only
   * ever reached via `computeNextPhase`'s `ctx.hasWinner` branches (see
   * `phase-graph.ts`), so a winner (or `DRAW`, OD-046) always exists by the
   * time this is set. Must be omitted/null when `gameOver` is false.
   */
  winnerTeam?: WinnerTeam | null;
}

/**
 * §10.3: "only the Game Engine may write `games.status`/`current_phase`/
 * `round`, `game_players.life_status`, role assignments, or
 * `game_results.winner_team`." This service owns exactly those StartGame-
 * scoped writes: LOBBY->RUNNING / LOBBY->ROLE_REVEAL, WAITING->ALIVE for every
 * seated player, and role dealing (delegated to RoleAssignmentService).
 *
 * `Game.startedAt`, `rulesVersion`, and `configSnapshot` are deliberately
 * NOT written here — §10.3's field list doesn't name them, and they remain
 * the calling command's (RoomsService's) own write, in the same transaction.
 *
 * Takes no lock of its own: the caller holds the `SELECT games ... FOR
 * UPDATE` lock and the open transaction for the whole StartGame command;
 * this service only performs its share of the writes within it.
 */
@Injectable()
export class GameLifecycleService {
  constructor(
    private readonly roleAssignment: RoleAssignmentService,
    private readonly scheduler: SchedulerService,
  ) {}

  async startGame(
    tx: Prisma.TransactionClient,
    input: StartGameWritesInput,
  ): Promise<StartGameWritesResult> {
    await tx.gamePlayer.updateMany({
      where: { id: { in: input.activePlayerIds } },
      data: { lifeStatus: LifeStatus.ALIVE },
    });

    await this.roleAssignment.dealRoles(tx, {
      gameId: input.gameId,
      activePlayerIds: input.activePlayerIds,
      roleDistribution: input.roleDistribution,
    });

    const status = GameStatus.RUNNING;
    const currentPhase = GamePhaseName.ROLE_REVEAL;

    await tx.game.update({
      where: { id: input.gameId },
      data: { status, currentPhase },
    });

    // §19: `game_phases.ends_at` is the sole timer authority — a game cannot
    // be RUNNING without an active phase row for the transition engine to act
    // on. Round 0 per OD-042 (ROLE_REVEAL is pre-game; round 1 starts at the
    // first NIGHT).
    const now = new Date();
    const endsAt = new Date(now.getTime() + input.phaseDurationsSec.ROLE_REVEAL * 1000);
    await tx.gamePhase.create({
      data: {
        gameId: input.gameId,
        phase: currentPhase,
        round: 0,
        startedAt: now,
        endsAt,
      },
    });

    await this.enqueuePhaseAdvanceCheck(tx, input.gameId, endsAt);

    return { status, currentPhase };
  }

  /**
   * §10.3's other restricted writes: `games.current_phase`/`round` and the
   * `game_phases` history row transition. Called by `PhaseTransitionService`,
   * which owns the lock, the transaction, and the decision of *what* the next
   * phase is (§10.2) — this method only performs the write, exactly the same
   * division of responsibility as `startGame` above and `RoleAssignmentService`
   * (OD-041).
   */
  async transitionPhase(
    tx: Prisma.TransactionClient,
    input: TransitionPhaseInput,
  ): Promise<void> {
    const now = new Date();

    await tx.gamePhase.update({
      where: { id: input.closePhaseId },
      data: { endedAt: now },
    });

    await tx.gamePhase.create({
      data: {
        gameId: input.gameId,
        phase: input.toPhase,
        round: input.round,
        startedAt: now,
        endsAt: input.endsAt,
      },
    });

    await tx.game.update({
      where: { id: input.gameId },
      data: {
        currentPhase: input.toPhase,
        round: input.round,
        ...(input.gameOver
          ? { status: GameStatus.FINISHED, finishedAt: now }
          : {}),
      },
    });

    if (input.gameOver) {
      if (!input.winnerTeam) {
        throw new Error(
          `GameLifecycleService.transitionPhase: GAME_OVER for game ${input.gameId} with no winnerTeam (§16.3 invariant violated)`,
        );
      }

      await tx.gameResult.create({
        data: { gameId: input.gameId, winnerTeam: input.winnerTeam },
      });
    }

    if (input.endsAt !== null) {
      await this.enqueuePhaseAdvanceCheck(tx, input.gameId, input.endsAt);
    }
  }

  /**
   * §17.4/§16/§10.3: the one `game_players.life_status` write §10.3 reserves
   * to the Game Engine, shared by both death sources this codebase has today
   * — `NightResolutionService` (§17.4, `resolveNightActions`'s deaths) and
   * `VoteResolutionService` (§16/§10.4, the day's execution target). Neither
   * caller's death-application logic differs from the other's (both reduce
   * to "these player ids are now DEAD"), so this is one shared method, not a
   * pair of near-duplicates. The `lifeStatus: ALIVE` guard makes a duplicate
   * call idempotent — dying twice is a no-op, not an error — matching
   * `startGame`'s same defensive shape for its own bulk `ALIVE` write.
   */
  async applyDeaths(
    tx: Prisma.TransactionClient,
    gameId: string,
    playerIds: string[],
  ): Promise<void> {
    if (playerIds.length === 0) {
      return;
    }

    await tx.gamePlayer.updateMany({
      where: { id: { in: playerIds }, gameId, lifeStatus: LifeStatus.ALIVE },
      data: { lifeStatus: LifeStatus.DEAD },
    });
  }

  /**
   * §19: keeps the transition engine self-perpetuating — a per-game "check
   * this game's next deadline" task rather than one process sweeping every
   * RUNNING game. Nothing in §19/OD-008 mandates a global sweep instead;
   * per-game tasks are the natural reading of "`game_phases.ends_at` as sole
   * authority" (each row already names its own deadline) and keep the
   * scheduler's claim scan bounded by *due* work instead of *all live games*.
   * `dedupeKey` makes a repeated call for the same game a no-op rather than
   * piling up duplicate pending tasks (OD-043).
   */
  private async enqueuePhaseAdvanceCheck(
    tx: Prisma.TransactionClient,
    gameId: string,
    endsAt: Date,
  ): Promise<void> {
    await this.scheduler.enqueue(tx, {
      kind: PHASE_ADVANCE_TASK_KIND,
      payload: { gameId } satisfies PhaseAdvanceTaskPayload,
      runAt: endsAt,
      dedupeKey: phaseAdvanceDedupeKey(gameId),
    });
  }
}
