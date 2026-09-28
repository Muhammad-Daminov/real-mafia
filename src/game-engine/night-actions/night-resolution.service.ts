import { Injectable } from '@nestjs/common';
import { LifeStatus, Prisma } from '@prisma/client';
import { GameLifecycleService } from '../game-lifecycle.service';
import { ActionResult, resolveNightActions, RosterEntry, SubmittedAction } from './night-resolution';

export interface ResolveRoundInput {
  gameId: string;
  /** id of the NIGHT `GamePhase` row whose submissions are being resolved (already closed by the caller). */
  nightPhaseId: string;
}

export interface ResolveRoundResult {
  deathsOccurred: boolean;
  /**
   * §17.5/OD-050: the round's dead player ids (verbatim from
   * `resolveNightActions`'s `deaths`, no role field per OD-024), returned
   * — not emitted here — so the caller can broadcast `MULTIPLE_DEATHS` only
   * after its own transaction commits, same discipline as `deathsOccurred`.
   */
  deaths: string[];
  /**
   * §17.5/OD-048: the round's private per-actor results, returned (not
   * emitted here) so the caller can broadcast them only after its own
   * transaction commits — same discipline as `deathsOccurred` already
   * required, see `PhaseTransitionService.advancePhase`'s docstring.
   */
  results: ActionResult[];
}

/**
 * §17.4: the I/O shell around `resolveNightActions`'s pure decision function.
 * Reads the round's roster + submitted `GameAction` rows, applies the §12.4
 * priority order, and writes the outcome back — life-state deaths through
 * `GameLifecycleService` (§10.3 restricted field), everything else
 * (`GameAction.result`, `RoleAbilityUsage`) directly, since neither table is
 * in §10.3's restricted-write list.
 *
 * Always called from within `PhaseTransitionService.advancePhase`'s existing
 * `games` row lock/transaction — takes no lock of its own.
 */
@Injectable()
export class NightResolutionService {
  constructor(private readonly gameLifecycle: GameLifecycleService) {}

  async resolveRound(
    tx: Prisma.TransactionClient,
    input: ResolveRoundInput,
  ): Promise<ResolveRoundResult> {
    const players = await tx.gamePlayer.findMany({
      where: { gameId: input.gameId },
      select: {
        id: true,
        lifeStatus: true,
        roleAssignment: { select: { roleCode: true } },
      },
    });

    const roster: RosterEntry[] = players
      .filter((p) => p.roleAssignment !== null)
      .map((p) => ({
        playerId: p.id,
        roleCode: p.roleAssignment!.roleCode,
        alive: p.lifeStatus === LifeStatus.ALIVE,
      }));

    const actionRows = await tx.gameAction.findMany({
      where: { gameId: input.gameId, phaseId: input.nightPhaseId },
    });

    const actions: SubmittedAction[] = actionRows.map((a) => ({
      actorPlayerId: a.actorPlayerId,
      actionType: a.actionType,
      targetPlayerId: a.targetPlayerId,
      targetPlayerId2: a.targetPlayerId2,
    }));

    const outcome = resolveNightActions(roster, actions);

    if (outcome.deaths.length > 0) {
      await this.gameLifecycle.applyDeaths(tx, input.gameId, outcome.deaths);
    }

    for (const result of outcome.results) {
      await tx.gameAction.updateMany({
        where: {
          gameId: input.gameId,
          phaseId: input.nightPhaseId,
          actorPlayerId: result.actorPlayerId,
          actionType: result.actionType,
        },
        data: { result: result.result as Prisma.InputJsonValue },
      });
    }

    for (const increment of outcome.abilityUsageIncrements) {
      await tx.roleAbilityUsage.upsert({
        where: {
          gameId_playerId_ability: {
            gameId: input.gameId,
            playerId: increment.playerId,
            ability: increment.ability,
          },
        },
        create: {
          gameId: input.gameId,
          playerId: increment.playerId,
          ability: increment.ability,
          usedCount: 1,
        },
        update: { usedCount: { increment: 1 } },
      });
    }

    return { deathsOccurred: outcome.deaths.length > 0, deaths: outcome.deaths, results: outcome.results };
  }
}
