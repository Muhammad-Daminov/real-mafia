import { Injectable } from '@nestjs/common';
import { ActionType, Prisma, RoleCode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CommandRequestService } from '../../common/command-requests/command-request.service';
import { teamForRole } from '../roles';
import { abilityForActionType, NightAbilitySpec } from './role-abilities';
import { NightActionErrorCode, NightActionException } from './night-action.errors';

const ENDPOINT_SUBMIT_NIGHT_ACTION = 'POST /games/:gameId/night-actions';

export interface SubmitActionInput {
  userId: string;
  gameId: string;
  clientRequestId: string;
  actionType: ActionType;
  targetPlayerId: string;
  targetPlayerId2?: string | null;
}

export interface SubmittedActionResponse {
  actionId: string;
  gameId: string;
  phaseId: string;
  actionType: ActionType;
  actionSlot: number;
  targetPlayerId: string;
  targetPlayerId2: string | null;
}

/**
 * §17.1-§17.3: night-action submission. `game_actions` is not in §10.3's
 * restricted-field list (games.status/current_phase/round, game_players.
 * life_status, role assignments, game_results.winner_team) — it's a brand
 * new table, not a write to any of those fields — so this service writes it
 * directly under its own `games` row lock (§6.3's general "every
 * state-changing command holds the game row lock" rule, the same discipline
 * every other command in this codebase already follows), with no need to
 * route through `GameLifecycleService`.
 *
 * OD-028 (default: allowed, update-in-place): resubmitting during the same
 * NIGHT phase updates the existing `(game, phase, actor, slot)` row rather
 * than being rejected — see the upsert below. This is a different mechanism
 * from `CommandRequestService`'s idempotency: that layer replays an
 * *identical* retried request (same `clientRequestId`); OD-028 covers a
 * player deliberately changing their mind with a *new* `clientRequestId`.
 */
@Injectable()
export class NightActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commandRequests: CommandRequestService,
  ) {}

  async submitAction(input: SubmitActionInput): Promise<SubmittedActionResponse> {
    const key = {
      userId: input.userId,
      endpoint: ENDPOINT_SUBMIT_NIGHT_ACTION,
      clientRequestId: input.clientRequestId,
    };

    try {
      return await this.submitActionTransaction(input, key);
    } catch (error) {
      const replay = await this.commandRequests.recoverReplay(this.prisma, key, error);

      if (replay) {
        return replay.body as unknown as SubmittedActionResponse;
      }

      throw error;
    }
  }

  private async submitActionTransaction(
    input: SubmitActionInput,
    key: { userId: string; endpoint: string; clientRequestId: string },
  ): Promise<SubmittedActionResponse> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM games WHERE id = ${input.gameId}::uuid FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new NightActionException(NightActionErrorCode.GAME_NOT_FOUND, 'O‘yin topilmadi');
      }

      const replay = await this.commandRequests.findExisting(tx, key);
      if (replay) {
        return replay.body as unknown as SubmittedActionResponse;
      }

      const game = await tx.game.findUniqueOrThrow({
        where: { id: input.gameId },
        select: { status: true, currentPhase: true },
      });

      if (game.status !== 'RUNNING' || game.currentPhase !== 'NIGHT') {
        throw new NightActionException(
          NightActionErrorCode.GAME_NOT_IN_NIGHT_PHASE,
          'Hozir tungi harakat qilib bo‘lmaydi',
        );
      }

      const actor = await tx.gamePlayer.findUnique({
        where: { gameId_userId: { gameId: input.gameId, userId: input.userId } },
        select: { id: true, lifeStatus: true },
      });

      if (!actor) {
        throw new NightActionException(
          NightActionErrorCode.PLAYER_NOT_IN_GAME,
          'Siz bu o‘yinda emassiz',
        );
      }

      if (actor.lifeStatus !== 'ALIVE') {
        throw new NightActionException(
          NightActionErrorCode.PLAYER_NOT_ALIVE,
          'O‘lik o‘yinchi harakat qila olmaydi',
        );
      }

      const assignment = await tx.gameRoleAssignment.findUniqueOrThrow({
        where: { playerId: actor.id },
        select: { roleCode: true },
      });

      const ability = abilityForActionType(assignment.roleCode, input.actionType);

      if (!ability) {
        throw new NightActionException(
          NightActionErrorCode.ROLE_HAS_NO_SUCH_ACTION,
          'Rolingiz bu harakatni bajara olmaydi',
        );
      }

      if (ability.frequency === 'ONCE_PER_GAME') {
        await this.assertAbilityNotUsed(tx, input.gameId, actor.id, 'SHERIFF_SHOOT');
      }

      await this.validateTargets(tx, input, actor.id, ability);

      // Doctor-specific sub-limits, both narrower than the general
      // per-ability ONCE_PER_GAME check above (Doctor's ability itself is
      // EVERY_NIGHT; only self-targeting is capped, OD-003, and repeating
      // the same non-self target on consecutive nights is separately
      // forbidden, OD-004).
      if (assignment.roleCode === RoleCode.DOCTOR && input.actionType === ActionType.PROTECT) {
        if (input.targetPlayerId === actor.id) {
          await this.assertAbilityNotUsed(tx, input.gameId, actor.id, 'DOCTOR_SELF_PROTECT');
        }
        await this.assertNoConsecutiveDoctorRepeat(tx, input.gameId, actor.id, input.targetPlayerId);
      }

      const activePhase = await tx.gamePhase.findFirstOrThrow({
        where: { gameId: input.gameId, endedAt: null },
      });

      const targetPlayerId2 = ability.pairTarget ? (input.targetPlayerId2 ?? null) : null;

      const existing = await tx.gameAction.findUnique({
        where: {
          gameId_phaseId_actorPlayerId_actionSlot: {
            gameId: input.gameId,
            phaseId: activePhase.id,
            actorPlayerId: actor.id,
            actionSlot: ability.slot,
          },
        },
      });

      const saved = existing
        ? await tx.gameAction.update({
            where: { id: existing.id },
            data: {
              targetPlayerId: input.targetPlayerId,
              targetPlayerId2,
              result: Prisma.JsonNull,
            },
          })
        : await tx.gameAction.create({
            data: {
              gameId: input.gameId,
              phaseId: activePhase.id,
              actorPlayerId: actor.id,
              actionType: input.actionType,
              actionSlot: ability.slot,
              targetPlayerId: input.targetPlayerId,
              targetPlayerId2,
            },
          });

      const response: SubmittedActionResponse = {
        actionId: saved.id,
        gameId: input.gameId,
        phaseId: activePhase.id,
        actionType: saved.actionType,
        actionSlot: saved.actionSlot,
        targetPlayerId: saved.targetPlayerId,
        targetPlayerId2: saved.targetPlayerId2,
      };

      await this.commandRequests.record(tx, key, {
        status: 200,
        body: response as unknown as Prisma.InputJsonValue,
      });

      return response;
    });
  }

  async getMyActions(input: { userId: string; gameId: string }): Promise<SubmittedActionResponse[]> {
    const actor = await this.prisma.gamePlayer.findUnique({
      where: { gameId_userId: { gameId: input.gameId, userId: input.userId } },
      select: { id: true },
    });

    if (!actor) {
      throw new NightActionException(NightActionErrorCode.PLAYER_NOT_IN_GAME, 'Siz bu o‘yinda emassiz');
    }

    const activePhase = await this.prisma.gamePhase.findFirst({
      where: { gameId: input.gameId, endedAt: null },
    });

    if (!activePhase) {
      return [];
    }

    const actions = await this.prisma.gameAction.findMany({
      where: { gameId: input.gameId, phaseId: activePhase.id, actorPlayerId: actor.id },
      orderBy: { actionSlot: 'asc' },
    });

    return actions.map((a) => ({
      actionId: a.id,
      gameId: a.gameId,
      phaseId: a.phaseId,
      actionType: a.actionType,
      actionSlot: a.actionSlot,
      targetPlayerId: a.targetPlayerId,
      targetPlayerId2: a.targetPlayerId2,
    }));
  }

  private async assertAbilityNotUsed(
    tx: Prisma.TransactionClient,
    gameId: string,
    playerId: string,
    ability: 'SHERIFF_SHOOT' | 'DOCTOR_SELF_PROTECT',
  ): Promise<void> {
    const usage = await tx.roleAbilityUsage.findUnique({
      where: { gameId_playerId_ability: { gameId, playerId, ability } },
    });

    if (usage && usage.usedCount > 0) {
      throw new NightActionException(
        NightActionErrorCode.ABILITY_ALREADY_USED,
        'Bu qobiliyat allaqachon ishlatilgan',
      );
    }
  }

  /** OD-004 default: no consecutive-night repeat of the same PROTECT target. */
  private async assertNoConsecutiveDoctorRepeat(
    tx: Prisma.TransactionClient,
    gameId: string,
    doctorPlayerId: string,
    targetPlayerId: string,
  ): Promise<void> {
    const activePhase = await tx.gamePhase.findFirstOrThrow({
      where: { gameId, endedAt: null },
    });

    const previous = await tx.gameAction.findFirst({
      where: {
        gameId,
        actorPlayerId: doctorPlayerId,
        actionType: ActionType.PROTECT,
        phaseId: { not: activePhase.id },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (previous && previous.targetPlayerId === targetPlayerId) {
      throw new NightActionException(
        NightActionErrorCode.DOCTOR_REPEAT_PROTECTION,
        'Ketma-ket ikki kecha bir xil o‘yinchini himoya qilib bo‘lmaydi',
      );
    }
  }

  /** §17.3: per-role target rules, IDOR-safe (`WHERE id = :id AND gameId = :gameId`, never a bare id lookup). */
  private async validateTargets(
    tx: Prisma.TransactionClient,
    input: SubmitActionInput,
    actorPlayerId: string,
    ability: NightAbilitySpec,
  ): Promise<void> {
    const targetIds = ability.pairTarget
      ? [input.targetPlayerId, input.targetPlayerId2 ?? null]
      : [input.targetPlayerId];

    if (ability.pairTarget) {
      if (!input.targetPlayerId2) {
        throw new NightActionException(
          NightActionErrorCode.INVALID_TARGET,
          'Jurnalist ikkita nishonni tanlashi kerak',
        );
      }
      if (input.targetPlayerId === input.targetPlayerId2) {
        throw new NightActionException(
          NightActionErrorCode.INVALID_TARGET,
          'Ikkita nishon har xil bo‘lishi kerak',
        );
      }
    }

    for (const targetId of targetIds) {
      if (!targetId) continue;

      if (targetId === actorPlayerId && !ability.allowSelfTarget) {
        throw new NightActionException(
          NightActionErrorCode.INVALID_TARGET,
          'O‘zingizni nishonga ololmaysiz',
        );
      }

      const target = await tx.gamePlayer.findFirst({
        where: { id: targetId, gameId: input.gameId },
        select: { id: true, lifeStatus: true },
      });

      if (!target) {
        throw new NightActionException(
          NightActionErrorCode.INVALID_TARGET,
          'Nishon bu o‘yinda topilmadi',
        );
      }

      if (target.lifeStatus !== 'ALIVE') {
        throw new NightActionException(
          NightActionErrorCode.INVALID_TARGET,
          'Nishon tirik bo‘lishi kerak',
        );
      }

      if (ability.excludesTeam) {
        const targetAssignment = await tx.gameRoleAssignment.findUnique({
          where: { playerId: target.id },
          select: { roleCode: true },
        });

        if (targetAssignment && teamForRole(targetAssignment.roleCode) === ability.excludesTeam) {
          throw new NightActionException(
            NightActionErrorCode.INVALID_TARGET,
            'Bu nishonni tanlab bo‘lmaydi',
          );
        }
      }
    }
  }
}
