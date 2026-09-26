import { Injectable } from '@nestjs/common';
import { GamePhaseName, GameStatus, LifeStatus, Prisma } from '@prisma/client';
import { RoleAssignmentService } from './role-assignment.service';
import { RoleDistribution } from './roles';

export interface StartGameWritesInput {
  gameId: string;
  activePlayerIds: string[];
  roleDistribution: RoleDistribution;
}

export interface StartGameWritesResult {
  status: GameStatus;
  currentPhase: GamePhaseName;
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

    return { status, currentPhase };
  }
}
