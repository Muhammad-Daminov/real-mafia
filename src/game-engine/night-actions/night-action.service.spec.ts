import 'dotenv/config';
import { randomUUID } from 'crypto';
import { ActionType, GamePhaseName, GameStatus, LifeStatus, Prisma, RoleCode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CommandRequestService } from '../../common/command-requests/command-request.service';
import { NightActionService } from './night-action.service';
import { NightActionErrorCode, NightActionException } from './night-action.errors';

/**
 * §17.1-§17.3: `NightActionService` integration tests against real Postgres,
 * same style as `phase-transition.service.spec.ts` — seeds a RUNNING game
 * directly via Prisma so each test can pin roles/life-status precisely.
 */
describe('NightActionService (integration)', () => {
  const prisma = new PrismaService();
  const service = new NightActionService(prisma, new CommandRequestService());

  const TEST_TELEGRAM_PREFIX = 'night-action-test-';
  let createdUserIds: string[] = [];
  let createdRoomIds: string[] = [];
  let createdGameIds: string[] = [];

  const makeUser = async () => {
    const user = await prisma.user.create({
      data: { telegramId: `${TEST_TELEGRAM_PREFIX}${randomUUID()}`, firstName: 'Test' },
    });
    createdUserIds.push(user.id);
    return user;
  };

  interface SeedPlayerSpec {
    roleCode: RoleCode;
    lifeStatus?: LifeStatus;
  }

  const seedNightGame = async (players: SeedPlayerSpec[]) => {
    const host = await makeUser();
    const room = await prisma.room.create({
      data: { code: randomUUID().slice(0, 6).toUpperCase(), maxPlayers: 10, creatorUserId: host.id },
    });
    createdRoomIds.push(room.id);

    const game = await prisma.game.create({
      data: {
        roomId: room.id,
        status: GameStatus.RUNNING,
        currentPhase: GamePhaseName.NIGHT,
        round: 1,
        rulesVersion: '6.0.0',
        configSnapshot: {} as unknown as Prisma.InputJsonValue,
      },
    });
    createdGameIds.push(game.id);

    await prisma.gamePhase.create({
      data: {
        gameId: game.id,
        phase: GamePhaseName.NIGHT,
        round: 1,
        startedAt: new Date(Date.now() - 5_000),
        endsAt: new Date(Date.now() + 60_000),
      },
    });

    const gamePlayers: { id: string; userId: string; roleCode: RoleCode }[] = [];
    for (const spec of players) {
      const user = await makeUser();
      const gp = await prisma.gamePlayer.create({
        data: {
          gameId: game.id,
          userId: user.id,
          lifeStatus: spec.lifeStatus ?? LifeStatus.ALIVE,
        },
      });
      await prisma.gameRoleAssignment.create({
        data: { gameId: game.id, playerId: gp.id, roleCode: spec.roleCode },
      });
      gamePlayers.push({ ...gp, userId: user.id, roleCode: spec.roleCode });
    }

    return { game, gamePlayers };
  };

  afterEach(async () => {
    if (createdUserIds.length) {
      await prisma.commandRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
    }
    if (createdGameIds.length) {
      await prisma.gameAction.deleteMany({ where: { gameId: { in: createdGameIds } } });
      await prisma.roleAbilityUsage.deleteMany({ where: { gameId: { in: createdGameIds } } });
      await prisma.gameRoleAssignment.deleteMany({ where: { gameId: { in: createdGameIds } } });
      await prisma.gamePhase.deleteMany({ where: { gameId: { in: createdGameIds } } });
      await prisma.gamePlayer.deleteMany({ where: { gameId: { in: createdGameIds } } });
      await prisma.game.deleteMany({ where: { id: { in: createdGameIds } } });
    }
    if (createdRoomIds.length) {
      await prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds = [];
    createdRoomIds = [];
    createdGameIds = [];
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('accepts a valid submission and persists it against the active NIGHT phase', async () => {
    const { game, gamePlayers } = await seedNightGame([
      { roleCode: RoleCode.DOCTOR },
      { roleCode: RoleCode.CIVILIAN },
    ]);
    const doctor = gamePlayers[0];
    const civilian = gamePlayers[1];

    const response = await service.submitAction({
      userId: doctor.userId,
      gameId: game.id,
      clientRequestId: randomUUID(),
      actionType: ActionType.PROTECT,
      targetPlayerId: civilian.id,
    });

    expect(response.actionType).toBe(ActionType.PROTECT);
    expect(response.targetPlayerId).toBe(civilian.id);

    const saved = await prisma.gameAction.findUniqueOrThrow({ where: { id: response.actionId } });
    expect(saved.actorPlayerId).toBe(doctor.id);
  });

  it('rejects submission from a dead player', async () => {
    const { game, gamePlayers } = await seedNightGame([
      { roleCode: RoleCode.DOCTOR, lifeStatus: LifeStatus.DEAD },
      { roleCode: RoleCode.CIVILIAN },
    ]);
    const doctor = gamePlayers[0];
    const civilian = gamePlayers[1];

    await expect(
      service.submitAction({
        userId: doctor.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        actionType: ActionType.PROTECT,
        targetPlayerId: civilian.id,
      }),
    ).rejects.toMatchObject({ code: NightActionErrorCode.PLAYER_NOT_ALIVE } as Partial<NightActionException>);
  });

  it('rejects submission when the game is not in NIGHT phase', async () => {
    const { game, gamePlayers } = await seedNightGame([
      { roleCode: RoleCode.DOCTOR },
      { roleCode: RoleCode.CIVILIAN },
    ]);
    await prisma.game.update({ where: { id: game.id }, data: { currentPhase: GamePhaseName.MORNING } });
    const doctor = gamePlayers[0];
    const civilian = gamePlayers[1];

    await expect(
      service.submitAction({
        userId: doctor.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        actionType: ActionType.PROTECT,
        targetPlayerId: civilian.id,
      }),
    ).rejects.toMatchObject({ code: NightActionErrorCode.GAME_NOT_IN_NIGHT_PHASE });
  });

  it("rejects an action type the player's role cannot perform", async () => {
    const { game, gamePlayers } = await seedNightGame([
      { roleCode: RoleCode.CIVILIAN },
      { roleCode: RoleCode.CIVILIAN },
    ]);
    const civilian = gamePlayers[0];
    const other = gamePlayers[1];

    await expect(
      service.submitAction({
        userId: civilian.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        actionType: ActionType.KILL,
        targetPlayerId: other.id,
      }),
    ).rejects.toMatchObject({ code: NightActionErrorCode.ROLE_HAS_NO_SUCH_ACTION });
  });

  it('rejects an invalid target (not in the game)', async () => {
    const { game, gamePlayers } = await seedNightGame([{ roleCode: RoleCode.DOCTOR }]);
    const doctor = gamePlayers[0];

    await expect(
      service.submitAction({
        userId: doctor.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        actionType: ActionType.PROTECT,
        targetPlayerId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: NightActionErrorCode.INVALID_TARGET });
  });

  it('rejects targeting a dead player', async () => {
    const { game, gamePlayers } = await seedNightGame([
      { roleCode: RoleCode.DOCTOR },
      { roleCode: RoleCode.CIVILIAN, lifeStatus: LifeStatus.DEAD },
    ]);
    const doctor = gamePlayers[0];
    const deadCivilian = gamePlayers[1];

    await expect(
      service.submitAction({
        userId: doctor.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        actionType: ActionType.PROTECT,
        targetPlayerId: deadCivilian.id,
      }),
    ).rejects.toMatchObject({ code: NightActionErrorCode.INVALID_TARGET });
  });

  it('rejects Mafia targeting a fellow Mafia-team member', async () => {
    const { game, gamePlayers } = await seedNightGame([
      { roleCode: RoleCode.MAFIA },
      { roleCode: RoleCode.DON },
    ]);
    const mafia = gamePlayers[0];
    const don = gamePlayers[1];

    await expect(
      service.submitAction({
        userId: mafia.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        actionType: ActionType.KILL,
        targetPlayerId: don.id,
      }),
    ).rejects.toMatchObject({ code: NightActionErrorCode.INVALID_TARGET });
  });

  it('rejects self-targeting for a role without the self-target exception', async () => {
    const { game, gamePlayers } = await seedNightGame([{ roleCode: RoleCode.DETECTIVE }]);
    const detective = gamePlayers[0];

    await expect(
      service.submitAction({
        userId: detective.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        actionType: ActionType.INVESTIGATE,
        targetPlayerId: detective.id,
      }),
    ).rejects.toMatchObject({ code: NightActionErrorCode.INVALID_TARGET });
  });

  it('allows Doctor self-targeting once, then rejects the ONCE_PER_GAME repeat via the usage counter', async () => {
    const { game, gamePlayers } = await seedNightGame([{ roleCode: RoleCode.DOCTOR }]);
    const doctor = gamePlayers[0];

    await service.submitAction({
      userId: doctor.userId,
      gameId: game.id,
      clientRequestId: randomUUID(),
      actionType: ActionType.PROTECT,
      targetPlayerId: doctor.id,
    });

    // Simulate resolution having consumed the self-protect usage (submission
    // itself never increments it — only NightResolutionService does, at
    // NIGHT_RESOLUTION — so this test seeds the counter directly).
    await prisma.roleAbilityUsage.create({
      data: { gameId: game.id, playerId: doctor.id, ability: 'DOCTOR_SELF_PROTECT', usedCount: 1 },
    });

    await expect(
      service.submitAction({
        userId: doctor.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        actionType: ActionType.PROTECT,
        targetPlayerId: doctor.id,
      }),
    ).rejects.toMatchObject({ code: NightActionErrorCode.ABILITY_ALREADY_USED });
  });

  it('rejects a Doctor repeating the same non-self target on the very next night (OD-004)', async () => {
    const { game, gamePlayers } = await seedNightGame([
      { roleCode: RoleCode.DOCTOR },
      { roleCode: RoleCode.CIVILIAN },
    ]);
    const doctor = gamePlayers[0];
    const civilian = gamePlayers[1];

    // Round 1 submission, then close that phase and open round 2's NIGHT.
    await service.submitAction({
      userId: doctor.userId,
      gameId: game.id,
      clientRequestId: randomUUID(),
      actionType: ActionType.PROTECT,
      targetPlayerId: civilian.id,
    });

    const round1Phase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId: game.id } });
    await prisma.gamePhase.update({ where: { id: round1Phase.id }, data: { endedAt: new Date() } });
    await prisma.gamePhase.create({
      data: {
        gameId: game.id,
        phase: GamePhaseName.NIGHT,
        round: 2,
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(
      service.submitAction({
        userId: doctor.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        actionType: ActionType.PROTECT,
        targetPlayerId: civilian.id,
      }),
    ).rejects.toMatchObject({ code: NightActionErrorCode.DOCTOR_REPEAT_PROTECTION });
  });

  it('resubmitting with a new clientRequestId updates the existing row in place (OD-028)', async () => {
    const { game, gamePlayers } = await seedNightGame([
      { roleCode: RoleCode.DOCTOR },
      { roleCode: RoleCode.CIVILIAN },
      { roleCode: RoleCode.MAFIA },
    ]);
    const doctor = gamePlayers[0];
    const civilian = gamePlayers[1];
    const mafiaTarget = gamePlayers[2];

    const first = await service.submitAction({
      userId: doctor.userId,
      gameId: game.id,
      clientRequestId: randomUUID(),
      actionType: ActionType.PROTECT,
      targetPlayerId: civilian.id,
    });

    const second = await service.submitAction({
      userId: doctor.userId,
      gameId: game.id,
      clientRequestId: randomUUID(),
      actionType: ActionType.PROTECT,
      targetPlayerId: mafiaTarget.id,
    });

    expect(second.actionId).toBe(first.actionId);
    expect(second.targetPlayerId).toBe(mafiaTarget.id);

    const rows = await prisma.gameAction.findMany({ where: { gameId: game.id, actorPlayerId: doctor.id } });
    expect(rows).toHaveLength(1);
  });

  it('replays an identical retried clientRequestId instead of double-submitting', async () => {
    const { game, gamePlayers } = await seedNightGame([
      { roleCode: RoleCode.DOCTOR },
      { roleCode: RoleCode.CIVILIAN },
    ]);
    const doctor = gamePlayers[0];
    const civilian = gamePlayers[1];
    const clientRequestId = randomUUID();

    const first = await service.submitAction({
      userId: doctor.userId,
      gameId: game.id,
      clientRequestId,
      actionType: ActionType.PROTECT,
      targetPlayerId: civilian.id,
    });

    const replay = await service.submitAction({
      userId: doctor.userId,
      gameId: game.id,
      clientRequestId,
      actionType: ActionType.PROTECT,
      targetPlayerId: civilian.id,
    });

    expect(replay).toEqual(first);

    const rows = await prisma.gameAction.findMany({ where: { gameId: game.id, actorPlayerId: doctor.id } });
    expect(rows).toHaveLength(1);
  });

  it('two concurrent submissions from different players do not corrupt the round action set', async () => {
    const { game, gamePlayers } = await seedNightGame([
      { roleCode: RoleCode.DOCTOR },
      { roleCode: RoleCode.DETECTIVE },
      { roleCode: RoleCode.CIVILIAN },
    ]);
    const doctor = gamePlayers[0];
    const detective = gamePlayers[1];
    const civilian = gamePlayers[2];

    await Promise.all([
      service.submitAction({
        userId: doctor.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        actionType: ActionType.PROTECT,
        targetPlayerId: civilian.id,
      }),
      service.submitAction({
        userId: detective.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        actionType: ActionType.INVESTIGATE,
        targetPlayerId: civilian.id,
      }),
    ]);

    const rows = await prisma.gameAction.findMany({ where: { gameId: game.id } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.actorPlayerId))).toEqual(new Set([doctor.id, detective.id]));
  });

  it('getMyActions never returns another player\'s submission', async () => {
    const { game, gamePlayers } = await seedNightGame([
      { roleCode: RoleCode.DOCTOR },
      { roleCode: RoleCode.DETECTIVE },
      { roleCode: RoleCode.CIVILIAN },
    ]);
    const doctor = gamePlayers[0];
    const detective = gamePlayers[1];
    const civilian = gamePlayers[2];

    await service.submitAction({
      userId: doctor.userId,
      gameId: game.id,
      clientRequestId: randomUUID(),
      actionType: ActionType.PROTECT,
      targetPlayerId: civilian.id,
    });
    await service.submitAction({
      userId: detective.userId,
      gameId: game.id,
      clientRequestId: randomUUID(),
      actionType: ActionType.INVESTIGATE,
      targetPlayerId: civilian.id,
    });

    const mine = await service.getMyActions({ userId: doctor.userId, gameId: game.id });
    expect(mine).toHaveLength(1);
    expect(mine[0].actionType).toBe(ActionType.PROTECT);
  });
});
