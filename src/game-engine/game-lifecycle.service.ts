import { Injectable } from '@nestjs/common';
import { GamePhaseName, GameStatus, LifeStatus, Prisma } from '@prisma/client';
import { RoleAssignmentService } from './role-assignment.service';
import { RoleDistribution } from './roles';

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
  constructor(private readonly roleAssignment: RoleAssignmentService) {}

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
    await tx.gamePhase.create({
      data: {
        gameId: input.gameId,
        phase: currentPhase,
        round: 0,
        startedAt: now,
        endsAt: new Date(now.getTime() + input.phaseDurationsSec.ROLE_REVEAL * 1000),
      },
    });

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
  }
}
