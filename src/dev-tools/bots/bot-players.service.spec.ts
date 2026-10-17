import 'dotenv/config';
import { randomUUID } from 'crypto';
import { GamePhaseName, GameStatus, LifeStatus, RoleCode, RoomVisibility, RulesetMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CommandRequestService } from '../../common/command-requests/command-request.service';
import { SchedulerService } from '../../common/scheduling/scheduler.service';
import { RoleAssignmentService } from '../../game-engine/role-assignment.service';
import { GameLifecycleService } from '../../game-engine/game-lifecycle.service';
import { PhaseTransitionService } from '../../game-engine/phase-transition.service';
import { NightResolutionService } from '../../game-engine/night-actions/night-resolution.service';
import { VoteResolutionService } from '../../game-engine/voting/vote-resolution.service';
import { NightActionService } from '../../game-engine/night-actions/night-action.service';
import { VoteService } from '../../game-engine/voting/vote.service';
import { RealtimeEventService } from '../../common/realtime/realtime-event.service';
import { RoomsService } from '../../rooms/rooms.service';
import { BotPlayersService } from './bot-players.service';
import { DEV_BOT_ACT_TASK_KIND, devBotActDedupeKey } from './dev-bot-action.scheduled-task';

/**
 * B-D2: runs against a real PostgreSQL database, same convention as
 * `rooms.service.spec.ts`/`phase-transition.service.spec.ts` — the whole
 * point of this slice is that bots act through the real, lock-holding
 * service paths, which a mock cannot exercise.
 */
describe('BotPlayersService (integration)', () => {
  const prisma = new PrismaService();
  const commandRequests = new CommandRequestService();
  const scheduler = new SchedulerService(prisma);
  const roleAssignment = new RoleAssignmentService();
  const gameLifecycle = new GameLifecycleService(roleAssignment, scheduler);
  const nightResolution = new NightResolutionService(gameLifecycle);
  const voteResolution = new VoteResolutionService(gameLifecycle);
  const realtime: { broadcastToGame: jest.Mock; sendToPlayer: jest.Mock } = {
    broadcastToGame: jest.fn(),
    sendToPlayer: jest.fn(),
  };
  const phaseTransition = new PhaseTransitionService(
    prisma,
    gameLifecycle,
    scheduler,
    nightResolution,
    voteResolution,
    realtime as unknown as RealtimeEventService,
  );
  const nightActions = new NightActionService(prisma, commandRequests);
  const votes = new VoteService(prisma, commandRequests, realtime as unknown as RealtimeEventService);
  const rooms = new RoomsService(prisma, commandRequests, gameLifecycle, realtime as unknown as RealtimeEventService);
  const botPlayers = new BotPlayersService(prisma, scheduler, nightActions, votes);
  // Plain construction never calls Nest lifecycle hooks — `onApplicationBootstrap`
  // (which would also start the real-time watcher interval, not wanted
  // here) is never invoked. Register just the handler so `scheduler.pollOnce()`
  // can claim/run DEV_BOT_ACT tasks; phase advancement in these tests goes
  // through `phaseTransition.advancePhase` directly, same as
  // rooms.service.spec.ts's B-R3 tests, so PHASE_ADVANCE_CHECK's own
  // handler is never needed here.
  scheduler.registerHandler(DEV_BOT_ACT_TASK_KIND, (payload) => botPlayers.handleBotAct(payload));

  const TEST_TELEGRAM_PREFIX = 'bot-players-test-';
  let createdUserIds: string[] = [];
  let createdRoomIds: string[] = [];

  const makeUser = async (opts: { isBot?: boolean } = {}) => {
    const user = await prisma.user.create({
      data: {
        telegramId: `${TEST_TELEGRAM_PREFIX}${randomUUID()}`,
        firstName: opts.isBot ? 'Bot' : 'Human',
        isBot: opts.isBot ?? false,
      },
    });
    createdUserIds.push(user.id);
    return user;
  };

  /** Seats one human host + 3 bots in a fresh 4-player room (distribution:
   * 1 MAFIA, 1 DOCTOR, 2 CIVILIAN — no Don/Detective/Sheriff/etc. at this
   * player count, so every acting role this slice cares about is covered)
   * and starts the real game via `RoomsService`. */
  const seedHumanPlusBotsGame = async () => {
    const host = await makeUser();
    const room = await rooms.createRoom({
      userId: host.id,
      clientRequestId: randomUUID(),
      maxPlayers: 4,
      rulesetMode: RulesetMode.NORMAL,
      visibility: RoomVisibility.PRIVATE,
    });
    createdRoomIds.push(room.roomId);

    const bots: Awaited<ReturnType<typeof makeUser>>[] = [];
    for (let i = 0; i < 3; i++) {
      const bot = await makeUser({ isBot: true });
      await rooms.joinRoom({ userId: bot.id, code: room.code, clientRequestId: randomUUID() });
      bots.push(bot);
    }

    const started = await rooms.startGame({ userId: host.id, roomId: room.roomId, clientRequestId: randomUUID() });
    return { host, bots, room, gameId: started.gameId };
  };

  const forcePhaseDue = async (gameId: string) => {
    const active = await prisma.gamePhase.findFirstOrThrow({ where: { gameId, endedAt: null } });
    await prisma.gamePhase.update({ where: { id: active.id }, data: { endsAt: new Date(Date.now() - 1_000) } });
    return active;
  };

  const forceAllDevBotTasksDue = async () => {
    await prisma.scheduledTask.updateMany({
      where: { kind: DEV_BOT_ACT_TASK_KIND, status: 'PENDING' },
      data: { runAt: new Date(Date.now() - 1_000) },
    });
  };

  afterEach(async () => {
    realtime.broadcastToGame.mockClear();
    realtime.sendToPlayer.mockClear();

    await prisma.scheduledTask.deleteMany({ where: { kind: DEV_BOT_ACT_TASK_KIND } });

    if (createdRoomIds.length) {
      const games = await prisma.game.findMany({ where: { roomId: { in: createdRoomIds } }, select: { id: true } });
      const gameIds = games.map((g) => g.id);

      if (gameIds.length) {
        await prisma.scheduledTask.deleteMany({ where: { dedupeKey: { in: gameIds.map((id) => `phase-advance:${id}`) } } });
        await prisma.gameVote.deleteMany({ where: { gameId: { in: gameIds } } });
        await prisma.gameAction.deleteMany({ where: { gameId: { in: gameIds } } });
        await prisma.gameResult.deleteMany({ where: { gameId: { in: gameIds } } });
        await prisma.roleAbilityUsage.deleteMany({ where: { gameId: { in: gameIds } } });
        await prisma.gameRoleAssignment.deleteMany({ where: { gameId: { in: gameIds } } });
        await prisma.gamePhase.deleteMany({ where: { gameId: { in: gameIds } } });
        await prisma.gamePlayer.deleteMany({ where: { gameId: { in: gameIds } } });
      }
      await prisma.game.deleteMany({ where: { roomId: { in: createdRoomIds } } });
      await prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } });
    }
    if (createdUserIds.length) {
      await prisma.commandRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdRoomIds = [];
    createdUserIds = [];
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('scanAndSchedule + the real NightActionService path', () => {
    it('schedules one DEV_BOT_ACT task per alive bot and, once due, submits a real night action for every role that has one', async () => {
      const { bots, gameId } = await seedHumanPlusBotsGame();

      await forcePhaseDue(gameId);
      const toNight = await phaseTransition.advancePhase(gameId);
      expect(toNight).toMatchObject({ advanced: true, to: 'NIGHT' });

      await botPlayers.scanAndSchedule();

      const botPlayerRows = await prisma.gamePlayer.findMany({
        where: { gameId, userId: { in: bots.map((b) => b.id) } },
        select: { id: true, userId: true, roleAssignment: { select: { roleCode: true } } },
      });
      expect(botPlayerRows).toHaveLength(3);

      const nightPhase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId, endedAt: null } });

      for (const bot of botPlayerRows) {
        const task = await prisma.scheduledTask.findFirst({
          where: { dedupeKey: devBotActDedupeKey(nightPhase.id, bot.id) },
        });
        expect(task).not.toBeNull();
        expect(task!.kind).toBe(DEV_BOT_ACT_TASK_KIND);
        expect(task!.status).toBe('PENDING');
      }

      await forceAllDevBotTasksDue();
      await scheduler.pollOnce();

      for (const bot of botPlayerRows) {
        const action = await prisma.gameAction.findFirst({ where: { gameId, actorPlayerId: bot.id } });
        if (bot.roleAssignment!.roleCode === RoleCode.CIVILIAN) {
          expect(action).toBeNull(); // no night action at all — must do nothing
        } else {
          expect(action).not.toBeNull(); // MAFIA (KILL) or DOCTOR (PROTECT) — real GameAction row
          expect(['MAFIA', 'DOCTOR']).toContain(bot.roleAssignment!.roleCode);
        }
      }

      const tasksAfter = await prisma.scheduledTask.findMany({ where: { kind: DEV_BOT_ACT_TASK_KIND } });
      expect(tasksAfter.every((t) => t.status === 'DONE')).toBe(true);
    });

    it('a second scanAndSchedule call before the first task completes does not double-schedule the same bot', async () => {
      const { gameId } = await seedHumanPlusBotsGame();
      await forcePhaseDue(gameId);
      await phaseTransition.advancePhase(gameId);

      await botPlayers.scanAndSchedule();
      await botPlayers.scanAndSchedule();

      const tasks = await prisma.scheduledTask.findMany({ where: { kind: DEV_BOT_ACT_TASK_KIND } });
      expect(tasks).toHaveLength(3); // exactly one per bot, not six
    });

    it('a second scanAndSchedule call after the first task is DONE still does not reschedule that bot for the same phase', async () => {
      const { gameId } = await seedHumanPlusBotsGame();
      await forcePhaseDue(gameId);
      await phaseTransition.advancePhase(gameId);

      await botPlayers.scanAndSchedule();
      await forceAllDevBotTasksDue();
      await scheduler.pollOnce(); // all three tasks now DONE

      await botPlayers.scanAndSchedule(); // same phase still active — must not re-add

      const tasks = await prisma.scheduledTask.findMany({ where: { kind: DEV_BOT_ACT_TASK_KIND } });
      expect(tasks).toHaveLength(3);
    });

    it('schedules no task at all for a DEAD bot', async () => {
      const { bots, gameId } = await seedHumanPlusBotsGame();
      await forcePhaseDue(gameId);
      await phaseTransition.advancePhase(gameId);

      const deadBotPlayer = await prisma.gamePlayer.findFirstOrThrow({
        where: { gameId, userId: bots[0].id },
      });
      await prisma.gamePlayer.update({ where: { id: deadBotPlayer.id }, data: { lifeStatus: LifeStatus.DEAD } });

      await botPlayers.scanAndSchedule();

      const nightPhase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId, endedAt: null } });
      const task = await prisma.scheduledTask.findFirst({
        where: { dedupeKey: devBotActDedupeKey(nightPhase.id, deadBotPlayer.id) },
      });
      expect(task).toBeNull();

      const tasks = await prisma.scheduledTask.findMany({ where: { kind: DEV_BOT_ACT_TASK_KIND } });
      expect(tasks).toHaveLength(2); // the other two bots only
    });
  });

  describe('handleBotAct — stale tasks no-op cleanly', () => {
    it('does nothing when the game is no longer RUNNING', async () => {
      const { bots, gameId } = await seedHumanPlusBotsGame();
      await forcePhaseDue(gameId);
      await phaseTransition.advancePhase(gameId);
      const nightPhase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId, endedAt: null } });
      const botPlayer = await prisma.gamePlayer.findFirstOrThrow({ where: { gameId, userId: bots[0].id } });

      await prisma.game.update({ where: { id: gameId }, data: { status: GameStatus.CANCELLED } });

      await expect(
        botPlayers.handleBotAct({
          gameId,
          phaseId: nightPhase.id,
          phase: GamePhaseName.NIGHT,
          playerId: botPlayer.id,
          userId: bots[0].id,
        } as never),
      ).resolves.toBeUndefined();

      const action = await prisma.gameAction.findFirst({ where: { gameId, actorPlayerId: botPlayer.id } });
      expect(action).toBeNull();
    });

    it('does nothing for a now-dead bot, without throwing', async () => {
      const { bots, gameId } = await seedHumanPlusBotsGame();
      await forcePhaseDue(gameId);
      await phaseTransition.advancePhase(gameId);
      const nightPhase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId, endedAt: null } });
      const botPlayer = await prisma.gamePlayer.findFirstOrThrow({ where: { gameId, userId: bots[0].id } });
      await prisma.gamePlayer.update({ where: { id: botPlayer.id }, data: { lifeStatus: LifeStatus.DEAD } });

      await expect(
        botPlayers.handleBotAct({
          gameId,
          phaseId: nightPhase.id,
          phase: GamePhaseName.NIGHT,
          playerId: botPlayer.id,
          userId: bots[0].id,
        } as never),
      ).resolves.toBeUndefined();

      const action = await prisma.gameAction.findFirst({ where: { gameId, actorPlayerId: botPlayer.id } });
      expect(action).toBeNull();
    });

    it('does nothing once the phase has already ended (stale task), without throwing', async () => {
      const { bots, gameId } = await seedHumanPlusBotsGame();
      await forcePhaseDue(gameId);
      await phaseTransition.advancePhase(gameId); // -> NIGHT
      const nightPhase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId, endedAt: null } });
      const botPlayer = await prisma.gamePlayer.findFirstOrThrow({ where: { gameId, userId: bots[0].id } });

      // Move the game past NIGHT before the (stale) task fires.
      await forcePhaseDue(gameId);
      await phaseTransition.advancePhase(gameId);

      await expect(
        botPlayers.handleBotAct({
          gameId,
          phaseId: nightPhase.id, // the now-ended NIGHT phase's id
          phase: GamePhaseName.NIGHT,
          playerId: botPlayer.id,
          userId: bots[0].id,
        } as never),
      ).resolves.toBeUndefined();

      const action = await prisma.gameAction.findFirst({ where: { gameId, actorPlayerId: botPlayer.id } });
      expect(action).toBeNull();
    });

    it('a rejected real-rules submission (invalid payload) is swallowed, not thrown', async () => {
      const { bots, gameId } = await seedHumanPlusBotsGame();
      await forcePhaseDue(gameId);
      await phaseTransition.advancePhase(gameId);
      const nightPhase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId, endedAt: null } });
      const botPlayer = await prisma.gamePlayer.findFirstOrThrow({ where: { gameId, userId: bots[0].id } });

      // VOTING payload during an actual NIGHT phase — VoteService will
      // reject with GAME_NOT_IN_VOTING_PHASE; must not throw out of handleBotAct.
      await expect(
        botPlayers.handleBotAct({
          gameId,
          phaseId: nightPhase.id,
          phase: GamePhaseName.VOTING,
          playerId: botPlayer.id,
          userId: bots[0].id,
        } as never),
      ).resolves.toBeUndefined();
    });
  });

  describe('VOTING phase — the real VoteService path', () => {
    it('casts a real vote for every alive bot, targeting an alive player', async () => {
      const { bots, gameId } = await seedHumanPlusBotsGame();

      // Drive straight to VOTING without any night action (civilians/no-op
      // roles aside, a night with no submitted kill simply has no deaths).
      await forcePhaseDue(gameId);
      await phaseTransition.advancePhase(gameId); // ROLE_REVEAL -> NIGHT
      await forcePhaseDue(gameId);
      await phaseTransition.advancePhase(gameId); // NIGHT -> NIGHT_RESOLUTION -> MORNING
      await forcePhaseDue(gameId);
      await phaseTransition.advancePhase(gameId); // MORNING -> DISCUSSION
      await forcePhaseDue(gameId);
      const toVoting = await phaseTransition.advancePhase(gameId); // DISCUSSION -> VOTING
      expect(toVoting).toMatchObject({ advanced: true, to: 'VOTING' });

      await botPlayers.scanAndSchedule();
      await forceAllDevBotTasksDue();
      await scheduler.pollOnce();

      const botPlayerIds = await prisma.gamePlayer.findMany({
        where: { gameId, userId: { in: bots.map((b) => b.id) } },
        select: { id: true },
      });
      const alivePlayerIds = new Set(
        (await prisma.gamePlayer.findMany({ where: { gameId, lifeStatus: LifeStatus.ALIVE }, select: { id: true } })).map(
          (p) => p.id,
        ),
      );

      for (const { id: playerId } of botPlayerIds) {
        const vote = await prisma.gameVote.findFirst({ where: { gameId, voterPlayerId: playerId } });
        expect(vote).not.toBeNull();
        expect(alivePlayerIds.has(vote!.targetPlayerId)).toBe(true);
      }
    });
  });

  describe('full game: 1 human + 3 bots reaches a terminal state with the human idle', () => {
    it('drives NIGHT/VOTING via bots only until the game is no longer RUNNING', async () => {
      const { host, gameId } = await seedHumanPlusBotsGame();
      void host; // never submits anything — proves the human stayed idle

      let iterations = 0;
      const MAX_ITERATIONS = 40;

      while (iterations < MAX_ITERATIONS) {
        iterations += 1;
        const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
        if (game.status !== GameStatus.RUNNING) break;

        const activePhase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId, endedAt: null } });

        if (activePhase.phase === GamePhaseName.NIGHT || activePhase.phase === GamePhaseName.VOTING) {
          await botPlayers.scanAndSchedule();
          await forceAllDevBotTasksDue();
          await scheduler.pollOnce();
        }

        await forcePhaseDue(gameId);
        await phaseTransition.advancePhase(gameId);
      }

      const finalGame = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
      expect(finalGame.status).toBe(GameStatus.FINISHED);
      expect(iterations).toBeLessThan(MAX_ITERATIONS);

      // The human (host) never called NightActionService/VoteService at
      // all in this test — every GameAction/GameVote row belongs to a bot.
      const botUserIds = (
        await prisma.gamePlayer.findMany({ where: { gameId }, select: { id: true, userId: true } })
      ).filter((p) => p.userId !== host.id);
      const actions = await prisma.gameAction.findMany({ where: { gameId } });
      const votesCast = await prisma.gameVote.findMany({ where: { gameId } });
      const botPlayerIds = new Set(botUserIds.map((p) => p.id));
      expect(actions.every((a) => botPlayerIds.has(a.actorPlayerId))).toBe(true);
      expect(votesCast.every((v) => botPlayerIds.has(v.voterPlayerId))).toBe(true);

      expect(realtime.broadcastToGame).toHaveBeenCalledWith(gameId, 'GAME_FINISHED', expect.anything());
    });
  });
});
