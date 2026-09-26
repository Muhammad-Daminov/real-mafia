import 'dotenv/config';
import { randomUUID } from 'crypto';
import { GamePhaseName, GameStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RoleAssignmentService } from './role-assignment.service';
import { GameLifecycleService, PhaseDurationsSec } from './game-lifecycle.service';
import { PhaseTransitionService } from './phase-transition.service';

/**
 * §10.2/§10.3/§19: PhaseTransitionService is the phase state machine's
 * correctness boundary. These tests build a RUNNING game directly via Prisma
 * (bypassing RoomsService/StartGame, same style as game-lifecycle.service.spec)
 * so each test can pin the active phase and its `ends_at` precisely.
 */
describe('PhaseTransitionService (integration)', () => {
  const prisma = new PrismaService();
  const gameLifecycle = new GameLifecycleService(new RoleAssignmentService());
  const service = new PhaseTransitionService(prisma, gameLifecycle);

  const TEST_TELEGRAM_PREFIX = 'phase-transition-test-';
  let createdUserIds: string[] = [];
  let createdRoomIds: string[] = [];
  let createdGameIds: string[] = [];

  const durations: PhaseDurationsSec = {
    ROLE_REVEAL: 15,
    NIGHT: 45,
    MORNING: 15,
    LAST_WORD: 20,
    DISCUSSION: 90,
    VOTING: 41,
  };

  const makeUser = async () => {
    const user = await prisma.user.create({
      data: { telegramId: `${TEST_TELEGRAM_PREFIX}${randomUUID()}`, firstName: 'Test' },
    });
    createdUserIds.push(user.id);
    return user;
  };

  interface SeedOptions {
    activePhase: GamePhaseName;
    round: number;
    endsAt: Date | null;
    lastWordEnabled?: boolean;
    status?: GameStatus;
  }

  const seedRunningGame = async (opts: SeedOptions) => {
    const host = await makeUser();
    const room = await prisma.room.create({
      data: { code: randomUUID().slice(0, 6).toUpperCase(), maxPlayers: 4, creatorUserId: host.id },
    });
    createdRoomIds.push(room.id);

    const game = await prisma.game.create({
      data: {
        roomId: room.id,
        status: opts.status ?? GameStatus.RUNNING,
        currentPhase: opts.activePhase,
        round: opts.round,
        rulesVersion: '6.0.0',
        configSnapshot: {
          phaseDurationsSec: durations,
          lastWordEnabled: opts.lastWordEnabled ?? true,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    createdGameIds.push(game.id);

    if (opts.status === undefined || opts.status === GameStatus.RUNNING) {
      await prisma.gamePhase.create({
        data: {
          gameId: game.id,
          phase: opts.activePhase,
          round: opts.round,
          startedAt: new Date(Date.now() - 60_000),
          endsAt: opts.endsAt,
        },
      });
    }

    return game;
  };

  afterEach(async () => {
    if (createdGameIds.length) {
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

  it('is a no-op (NOT_DUE) when the active timed phase has not yet reached ends_at', async () => {
    const game = await seedRunningGame({
      activePhase: GamePhaseName.NIGHT,
      round: 1,
      endsAt: new Date(Date.now() + 60_000),
    });

    const result = await service.advancePhase(game.id);

    expect(result).toMatchObject({ advanced: false, reason: 'NOT_DUE', from: 'NIGHT', to: 'NIGHT' });

    const persisted = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(persisted.currentPhase).toBe('NIGHT');
    expect(persisted.round).toBe(1);
  });

  it('transitions a due timed stable phase and cascades through the transient phase that follows it', async () => {
    const game = await seedRunningGame({
      activePhase: GamePhaseName.NIGHT,
      round: 1,
      endsAt: new Date(Date.now() - 1_000), // already due
    });

    const result = await service.advancePhase(game.id);

    // NIGHT (due) -> NIGHT_RESOLUTION (transient, cascades) -> MORNING (stable, stops here)
    expect(result).toEqual({ advanced: true, from: 'NIGHT', to: 'MORNING', round: 1 });

    const persistedGame = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(persistedGame.currentPhase).toBe('MORNING');
    expect(persistedGame.round).toBe(1);

    const phases = await prisma.gamePhase.findMany({
      where: { gameId: game.id },
      orderBy: { startedAt: 'asc' },
    });
    expect(phases.map((p) => p.phase)).toEqual(['NIGHT', 'NIGHT_RESOLUTION', 'MORNING']);
    expect(phases[0].endedAt).not.toBeNull(); // NIGHT closed
    expect(phases[1].endedAt).not.toBeNull(); // NIGHT_RESOLUTION closed (transient, never survives a commit)
    expect(phases[2].endedAt).toBeNull(); // MORNING is the new active phase
    expect(phases[2].endsAt).not.toBeNull();

    const activeCount = await prisma.gamePhase.count({ where: { gameId: game.id, endedAt: null } });
    expect(activeCount).toBe(1); // §33.3 partial unique index: at most one active phase per game
  });

  it('increments round exactly when WIN_CHECK routes back into NIGHT (OD-042)', async () => {
    const game = await seedRunningGame({
      activePhase: GamePhaseName.WIN_CHECK,
      round: 3,
      endsAt: null, // transient: always due
    });

    const result = await service.advancePhase(game.id);

    expect(result).toEqual({ advanced: true, from: 'WIN_CHECK', to: 'NIGHT', round: 4 });

    const persistedGame = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(persistedGame.round).toBe(4);

    const newActive = await prisma.gamePhase.findFirstOrThrow({
      where: { gameId: game.id, endedAt: null },
    });
    expect(newActive.phase).toBe('NIGHT');
    expect(newActive.round).toBe(4);
    expect(newActive.endsAt).not.toBeNull();
  });

  it('returns GAME_NOT_FOUND for a nonexistent game id, without touching anything', async () => {
    const result = await service.advancePhase(randomUUID());
    expect(result).toEqual({ advanced: false, reason: 'GAME_NOT_FOUND' });
  });

  it('returns GAME_NOT_RUNNING for a game still in LOBBY, without requiring any game_phases row', async () => {
    const game = await seedRunningGame({
      activePhase: GamePhaseName.LOBBY,
      round: 0,
      endsAt: null,
      status: GameStatus.LOBBY,
    });

    const result = await service.advancePhase(game.id);
    expect(result).toEqual({ advanced: false, reason: 'GAME_NOT_RUNNING' });
  });

  it('under two real concurrent advancePhase calls on the same due phase, exactly one transition happens', async () => {
    const game = await seedRunningGame({
      activePhase: GamePhaseName.DISCUSSION,
      round: 2,
      endsAt: new Date(Date.now() - 1_000), // already due
    });

    const [first, second] = await Promise.all([
      service.advancePhase(game.id),
      service.advancePhase(game.id),
    ]);

    const results = [first, second];
    const advancedCount = results.filter((r) => r.advanced).length;
    expect(advancedCount).toBe(1);

    const notDue = results.find((r) => !r.advanced);
    expect(notDue).toMatchObject({ reason: 'NOT_DUE', to: 'VOTING' });

    const persistedGame = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(persistedGame.currentPhase).toBe('VOTING');
    expect(persistedGame.round).toBe(2); // unchanged — VOTING doesn't bump the round

    const phases = await prisma.gamePhase.findMany({ where: { gameId: game.id } });
    expect(phases.map((p) => p.phase).sort()).toEqual(['DISCUSSION', 'VOTING']);
    const activeCount = phases.filter((p) => p.endedAt === null).length;
    expect(activeCount).toBe(1); // no duplicated/skipped phase row from the race
  });
});
