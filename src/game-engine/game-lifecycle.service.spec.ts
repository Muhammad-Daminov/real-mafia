import 'dotenv/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../common/scheduling/scheduler.service';
import { RoleAssignmentService } from './role-assignment.service';
import { GameLifecycleService } from './game-lifecycle.service';
import { RoleDistribution } from './roles';
import { phaseAdvanceDedupeKey } from './scheduled-task-kinds';
import { TELEGRAM_MESSAGE_TASK_KIND, TelegramMessageTaskPayload } from '../common/outbox/outbox-task-kinds';
import { GamePhaseName } from '@prisma/client';

/**
 * §10.3 authority fix: games.status/current_phase and game_players.life_status
 * (and role assignments) are Game-Engine-only writes. This test exercises
 * GameLifecycleService directly — not through RoomsService — proving the
 * write now happens through the correct module boundary, per the cleanup
 * item following ed21194/4fccf10.
 */
describe('GameLifecycleService (integration)', () => {
  const prisma = new PrismaService();
  const roleAssignment = new RoleAssignmentService();
  const scheduler = new SchedulerService(prisma);
  const service = new GameLifecycleService(roleAssignment, scheduler);

  const TEST_TELEGRAM_PREFIX = 'game-lifecycle-test-';
  let createdUserIds: string[] = [];
  let createdRoomId: string | null = null;
  let createdGameId: string | null = null;

  const distribution: RoleDistribution = {
    mafia: 1,
    don: 0,
    detective: 0,
    sheriff: 0,
    doctor: 1,
    bodyguard: 0,
    maniac: 0,
    journalist: 0,
    civilian: 2,
  };

  const makeUser = async () => {
    const user = await prisma.user.create({
      data: { telegramId: `${TEST_TELEGRAM_PREFIX}${randomUUID()}`, firstName: 'Test' },
    });
    createdUserIds.push(user.id);
    return user;
  };

  afterEach(async () => {
    if (createdGameId) {
      await prisma.scheduledTask.deleteMany({
        where: { dedupeKey: phaseAdvanceDedupeKey(createdGameId) },
      });
      await prisma.scheduledTask.deleteMany({
        where: {
          kind: TELEGRAM_MESSAGE_TASK_KIND,
          payload: { path: ['gameId'], equals: createdGameId },
        },
      });
      await prisma.gameResult.deleteMany({ where: { gameId: createdGameId } });
      await prisma.gameRoleAssignment.deleteMany({ where: { gameId: createdGameId } });
      await prisma.gamePhase.deleteMany({ where: { gameId: createdGameId } });
      await prisma.gamePlayer.deleteMany({ where: { gameId: createdGameId } });
      await prisma.game.deleteMany({ where: { id: createdGameId } });
    }
    if (createdRoomId) {
      await prisma.room.deleteMany({ where: { id: createdRoomId } });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds = [];
    createdRoomId = null;
    createdGameId = null;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('writes games.status/current_phase, game_players.life_status, and role assignments — all inside the passed transaction', async () => {
    const host = await makeUser();
    const others = await Promise.all([makeUser(), makeUser(), makeUser()]);

    const room = await prisma.room.create({
      data: { code: randomUUID().slice(0, 6).toUpperCase(), maxPlayers: 4, creatorUserId: host.id },
    });
    createdRoomId = room.id;

    const game = await prisma.game.create({ data: { roomId: room.id } });
    createdGameId = game.id;

    const players = await Promise.all(
      [host, ...others].map((u) =>
        prisma.gamePlayer.create({ data: { gameId: game.id, userId: u.id } }),
      ),
    );

    const activePlayerIds = players.map((p) => p.id);

    const phaseDurationsSec = {
      ROLE_REVEAL: 15,
      NIGHT: 45,
      MORNING: 15,
      LAST_WORD: 20,
      DISCUSSION: 90,
      VOTING: 41,
    };

    const beforeCall = Date.now();
    const result = await prisma.$transaction((tx) =>
      service.startGame(tx, {
        gameId: game.id,
        activePlayerIds,
        roleDistribution: distribution,
        phaseDurationsSec,
      }),
    );

    expect(result.status).toBe('RUNNING');
    expect(result.currentPhase).toBe('ROLE_REVEAL');

    // §19: games.status/current_phase can never be observed RUNNING without a
    // matching active game_phases row — the transition engine has nothing to
    // act on otherwise.
    const activePhase = await prisma.gamePhase.findFirstOrThrow({
      where: { gameId: game.id, endedAt: null },
    });
    expect(activePhase.phase).toBe('ROLE_REVEAL');
    expect(activePhase.round).toBe(0); // OD-042: ROLE_REVEAL is pre-game, round 0.
    expect(activePhase.endsAt).not.toBeNull();
    const endsAtMs = activePhase.endsAt!.getTime();
    expect(endsAtMs).toBeGreaterThanOrEqual(beforeCall + phaseDurationsSec.ROLE_REVEAL * 1000);
    expect(endsAtMs).toBeLessThan(beforeCall + (phaseDurationsSec.ROLE_REVEAL + 5) * 1000);

    const persistedGame = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(persistedGame.status).toBe('RUNNING');
    expect(persistedGame.currentPhase).toBe('ROLE_REVEAL');
    // §10.3 does not restrict these — GameLifecycleService must not touch them.
    expect(persistedGame.startedAt).toBeNull();
    expect(persistedGame.rulesVersion).toBeNull();

    const persistedPlayers = await prisma.gamePlayer.findMany({
      where: { gameId: game.id },
    });
    expect(persistedPlayers.every((p) => p.lifeStatus === 'ALIVE')).toBe(true);

    const assignments = await prisma.gameRoleAssignment.findMany({
      where: { gameId: game.id },
    });
    expect(assignments).toHaveLength(4);
    expect(new Set(assignments.map((a) => a.playerId)).size).toBe(4);

    // §19/OD-043: startGame must also schedule the follow-up check so the
    // transition engine is self-perpetuating from the first phase onward.
    const scheduledTask = await prisma.scheduledTask.findFirstOrThrow({
      where: { dedupeKey: phaseAdvanceDedupeKey(game.id) },
    });
    expect(scheduledTask.kind).toBe('PHASE_ADVANCE_CHECK');
    expect(scheduledTask.status).toBe('PENDING');
    expect((scheduledTask.payload as { gameId: string }).gameId).toBe(game.id);
    expect(scheduledTask.runAt.getTime()).toBe(endsAtMs);
  });

  describe('GAME_FINISHED outbox notifications (§19/§25, OD-051)', () => {
    const seedFinishableGame = async (
      dealtInCount: number,
      leftInLobbyCount: number,
      botDealtInCount = 0,
    ) => {
      const host = await makeUser();
      const room = await prisma.room.create({
        data: { code: randomUUID().slice(0, 6).toUpperCase(), maxPlayers: 8, creatorUserId: host.id },
      });
      createdRoomId = room.id;

      const game = await prisma.game.create({
        data: { roomId: room.id, status: 'RUNNING', currentPhase: GamePhaseName.WIN_CHECK, round: 1 },
      });
      createdGameId = game.id;

      const activePhase = await prisma.gamePhase.create({
        data: { gameId: game.id, phase: GamePhaseName.WIN_CHECK, round: 1, startedAt: new Date(), endsAt: null },
      });

      const dealtInPlayers: { gp: { id: string }; user: { telegramId: string } }[] = [];
      for (let i = 0; i < dealtInCount; i++) {
        const user = await makeUser();
        const gp = await prisma.gamePlayer.create({
          data: { gameId: game.id, userId: user.id, lifeStatus: 'ALIVE' },
        });
        await prisma.gameRoleAssignment.create({
          data: { gameId: game.id, playerId: gp.id, roleCode: 'CIVILIAN' },
        });
        dealtInPlayers.push({ gp, user });
      }

      // A player who left the lobby before StartGame: a GamePlayer row
      // exists for this game, but no role was ever dealt — must NOT receive
      // a GAME_FINISHED notification.
      for (let i = 0; i < leftInLobbyCount; i++) {
        const user = await makeUser();
        await prisma.gamePlayer.create({
          data: { gameId: game.id, userId: user.id, lifeStatus: 'LEFT' },
        });
      }

      // B-D1: a dealt-in *bot* player — must never receive a GAME_FINISHED
      // notification either, same as a real player who left before start.
      for (let i = 0; i < botDealtInCount; i++) {
        const user = await prisma.user.create({
          data: { telegramId: `-${Date.now()}${i}bot`, firstName: `Bot ${i}`, isBot: true },
        });
        createdUserIds.push(user.id);
        const gp = await prisma.gamePlayer.create({
          data: { gameId: game.id, userId: user.id, lifeStatus: 'ALIVE' },
        });
        await prisma.gameRoleAssignment.create({
          data: { gameId: game.id, playerId: gp.id, roleCode: 'CIVILIAN' },
        });
      }

      return { game, activePhase, dealtInPlayers };
    };

    it('enqueues one TELEGRAM_MESSAGE task per dealt-in player, none for a player who left before StartGame', async () => {
      const { game, activePhase, dealtInPlayers } = await seedFinishableGame(2, 1);

      await prisma.$transaction((tx) =>
        service.transitionPhase(tx, {
          gameId: game.id,
          closePhaseId: activePhase.id,
          toPhase: GamePhaseName.GAME_OVER,
          round: 1,
          endsAt: null,
          gameOver: true,
          winnerTeam: 'TOWN',
        }),
      );

      const tasks = await prisma.scheduledTask.findMany({
        where: { kind: TELEGRAM_MESSAGE_TASK_KIND, payload: { path: ['gameId'], equals: game.id } },
      });

      expect(tasks).toHaveLength(2); // never 3 — the left-in-lobby player is excluded
      const telegramIds = tasks.map((t) => (t.payload as unknown as TelegramMessageTaskPayload).telegramId).sort();
      expect(telegramIds).toEqual(dealtInPlayers.map((p) => p.user.telegramId).sort());
      for (const task of tasks) {
        const payload = task.payload as unknown as TelegramMessageTaskPayload;
        expect(payload.event).toBe('GAME_FINISHED');
        expect(payload.winnerTeam).toBe('TOWN');
        expect(task.status).toBe('PENDING');
      }
    });

    it('B-D1: enqueues no TELEGRAM_MESSAGE task for a dealt-in bot player, even though it was dealt a role', async () => {
      const { game, activePhase, dealtInPlayers } = await seedFinishableGame(2, 0, 3);

      await prisma.$transaction((tx) =>
        service.transitionPhase(tx, {
          gameId: game.id,
          closePhaseId: activePhase.id,
          toPhase: GamePhaseName.GAME_OVER,
          round: 1,
          endsAt: null,
          gameOver: true,
          winnerTeam: 'TOWN',
        }),
      );

      const tasks = await prisma.scheduledTask.findMany({
        where: { kind: TELEGRAM_MESSAGE_TASK_KIND, payload: { path: ['gameId'], equals: game.id } },
      });

      // 2 real dealt-in players, never the 3 bots also dealt in above.
      expect(tasks).toHaveLength(2);
      const telegramIds = tasks.map((t) => (t.payload as unknown as TelegramMessageTaskPayload).telegramId).sort();
      expect(telegramIds).toEqual(dealtInPlayers.map((p) => p.user.telegramId).sort());
      expect(telegramIds.some((id) => id.startsWith('-'))).toBe(false);
    });

    it('a rollback after the GameResult write already ran enqueues no TELEGRAM_MESSAGE task', async () => {
      const { game, activePhase } = await seedFinishableGame(2, 0);

      await expect(
        prisma.$transaction(async (tx) => {
          await service.transitionPhase(tx, {
            gameId: game.id,
            closePhaseId: activePhase.id,
            toPhase: GamePhaseName.GAME_OVER,
            round: 1,
            endsAt: null,
            gameOver: true,
            winnerTeam: 'TOWN',
          });
          // Deaths/enqueue already ran above, inside this same transaction —
          // force a rollback after that write to prove it doesn't survive.
          throw new Error('simulated failure after GameResult/outbox writes');
        }),
      ).rejects.toThrow('simulated failure after GameResult/outbox writes');

      const persistedGame = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
      expect(persistedGame.status).toBe('RUNNING'); // rolled back

      const gameResult = await prisma.gameResult.findUnique({ where: { gameId: game.id } });
      expect(gameResult).toBeNull();

      const tasks = await prisma.scheduledTask.findMany({
        where: { kind: TELEGRAM_MESSAGE_TASK_KIND, payload: { path: ['gameId'], equals: game.id } },
      });
      expect(tasks).toHaveLength(0);
    });
  });
});
