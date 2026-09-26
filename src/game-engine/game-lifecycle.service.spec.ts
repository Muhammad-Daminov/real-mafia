import 'dotenv/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../common/scheduling/scheduler.service';
import { RoleAssignmentService } from './role-assignment.service';
import { GameLifecycleService } from './game-lifecycle.service';
import { RoleDistribution } from './roles';
import { phaseAdvanceDedupeKey } from './scheduled-task-kinds';

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
});
