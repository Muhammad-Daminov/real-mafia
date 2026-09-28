import 'dotenv/config';
import { randomUUID } from 'crypto';
import { ActionType, GamePhaseName, GameStatus, LifeStatus, Prisma, RoleCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../common/scheduling/scheduler.service';
import { RoleAssignmentService } from './role-assignment.service';
import { GameLifecycleService, PhaseDurationsSec } from './game-lifecycle.service';
import { PhaseTransitionService } from './phase-transition.service';
import { phaseAdvanceDedupeKey } from './scheduled-task-kinds';
import { NightResolutionService } from './night-actions/night-resolution.service';
import { VoteResolutionService } from './voting/vote-resolution.service';
import { RealtimeEventService } from '../common/realtime/realtime-event.service';

/**
 * §10.2/§10.3/§19: PhaseTransitionService is the phase state machine's
 * correctness boundary. These tests build a RUNNING game directly via Prisma
 * (bypassing RoomsService/StartGame, same style as game-lifecycle.service.spec)
 * so each test can pin the active phase and its `ends_at` precisely.
 */
describe('PhaseTransitionService (integration)', () => {
  const prisma = new PrismaService();
  const scheduler = new SchedulerService(prisma);
  const gameLifecycle = new GameLifecycleService(new RoleAssignmentService(), scheduler);
  const nightResolution = new NightResolutionService(gameLifecycle);
  const voteResolution = new VoteResolutionService(gameLifecycle);
  const realtime: { broadcastToGame: jest.Mock; sendToPlayer: jest.Mock } = {
    broadcastToGame: jest.fn(),
    sendToPlayer: jest.fn(),
  };
  const service = new PhaseTransitionService(
    prisma,
    gameLifecycle,
    scheduler,
    nightResolution,
    voteResolution,
    realtime as unknown as RealtimeEventService,
  );

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

  interface SeedPlayerSpec {
    roleCode: RoleCode;
    lifeStatus?: LifeStatus;
  }

  /**
   * §17: a RUNNING game already in NIGHT with real players/roles seated, for
   * tests exercising night-resolution wiring rather than pure phase timing.
   */
  const seedNightGameWithRoles = async (
    players: SeedPlayerSpec[],
    opts: { endsAt: Date; lastWordEnabled?: boolean; round?: number } = { endsAt: new Date(Date.now() + 60_000) },
  ) => {
    const game = await seedRunningGame({
      activePhase: GamePhaseName.NIGHT,
      round: opts.round ?? 1,
      endsAt: opts.endsAt,
      lastWordEnabled: opts.lastWordEnabled,
    });

    const nightPhase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId: game.id, endedAt: null } });

    const gamePlayers: { id: string; roleCode: RoleCode }[] = [];
    for (const spec of players) {
      const user = await makeUser();
      const gp = await prisma.gamePlayer.create({
        data: { gameId: game.id, userId: user.id, lifeStatus: spec.lifeStatus ?? LifeStatus.ALIVE },
      });
      await prisma.gameRoleAssignment.create({
        data: { gameId: game.id, playerId: gp.id, roleCode: spec.roleCode },
      });
      gamePlayers.push({ ...gp, roleCode: spec.roleCode });
    }

    return { game, nightPhase, gamePlayers };
  };

  const submitAction = async (
    gameId: string,
    phaseId: string,
    actorPlayerId: string,
    actionType: ActionType,
    targetPlayerId: string,
    actionSlot = 0,
  ) => {
    await prisma.gameAction.create({
      data: { gameId, phaseId, actorPlayerId, actionType, actionSlot, targetPlayerId },
    });
  };

  /**
   * §16: a RUNNING game already in VOTING with plain (roleless) players
   * seated — voting has no role restriction, unlike night actions.
   */
  const seedVotingGameWithPlayers = async (
    count: number,
    opts: { endsAt: Date; lastWordEnabled?: boolean; round?: number } = { endsAt: new Date(Date.now() + 60_000) },
  ) => {
    const game = await seedRunningGame({
      activePhase: GamePhaseName.VOTING,
      round: opts.round ?? 1,
      endsAt: opts.endsAt,
      lastWordEnabled: opts.lastWordEnabled,
    });

    const votingPhase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId: game.id, endedAt: null } });

    const gamePlayers: { id: string }[] = [];
    for (let i = 0; i < count; i += 1) {
      const user = await makeUser();
      const gp = await prisma.gamePlayer.create({
        data: { gameId: game.id, userId: user.id, lifeStatus: LifeStatus.ALIVE },
      });
      gamePlayers.push({ id: gp.id });
    }

    return { game, votingPhase, gamePlayers };
  };

  /** Same as `seedVotingGameWithPlayers`, but seats real roles — needed for tests where the win evaluator must see a real roster. */
  const seedVotingGameWithRoles = async (
    players: SeedPlayerSpec[],
    opts: { endsAt: Date; lastWordEnabled?: boolean; round?: number } = { endsAt: new Date(Date.now() + 60_000) },
  ) => {
    const game = await seedRunningGame({
      activePhase: GamePhaseName.VOTING,
      round: opts.round ?? 1,
      endsAt: opts.endsAt,
      lastWordEnabled: opts.lastWordEnabled,
    });

    const votingPhase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId: game.id, endedAt: null } });

    const gamePlayers: { id: string; roleCode: RoleCode }[] = [];
    for (const spec of players) {
      const user = await makeUser();
      const gp = await prisma.gamePlayer.create({
        data: { gameId: game.id, userId: user.id, lifeStatus: spec.lifeStatus ?? LifeStatus.ALIVE },
      });
      await prisma.gameRoleAssignment.create({
        data: { gameId: game.id, playerId: gp.id, roleCode: spec.roleCode },
      });
      gamePlayers.push({ ...gp, roleCode: spec.roleCode });
    }

    return { game, votingPhase, gamePlayers };
  };

  const castVote = async (gameId: string, phaseId: string, voterPlayerId: string, targetPlayerId: string) => {
    await prisma.gameVote.create({ data: { gameId, phaseId, voterPlayerId, targetPlayerId } });
  };

  afterEach(async () => {
    realtime.broadcastToGame.mockClear();
    realtime.sendToPlayer.mockClear();
    if (createdGameIds.length) {
      await prisma.scheduledTask.deleteMany({
        where: { dedupeKey: { in: createdGameIds.map(phaseAdvanceDedupeKey) } },
      });
      await prisma.gameAction.deleteMany({ where: { gameId: { in: createdGameIds } } });
      await prisma.gameVote.deleteMany({ where: { gameId: { in: createdGameIds } } });
      await prisma.gameResult.deleteMany({ where: { gameId: { in: createdGameIds } } });
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

    // §19/OD-043: the transition is self-perpetuating — landing on MORNING
    // (a stable, timed phase) must enqueue the next check.
    const nextTask = await prisma.scheduledTask.findFirstOrThrow({
      where: { dedupeKey: phaseAdvanceDedupeKey(game.id) },
    });
    expect(nextTask.status).toBe('PENDING');
    expect(nextTask.runAt.getTime()).toBe(phases[2].endsAt!.getTime());
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

  describe('night-action resolution wiring (§17.4/§10.2)', () => {
    it('an unprotected kill is applied: victim becomes DEAD and the game routes to LAST_WORD', async () => {
      // Two spare Civilians beyond the kill target keep Town ahead of Mafia
      // post-kill (townAlive=2 > mafiaAlive=1) so §16.1's win evaluator
      // doesn't end the game mid-test — this block tests resolution wiring,
      // not win-condition truth (that has its own dedicated spec).
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DON }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: true },
      );
      const [don, civilian] = gamePlayers;
      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civilian.id);

      const result = await service.advancePhase(game.id);

      expect(result).toEqual({ advanced: true, from: 'NIGHT', to: 'LAST_WORD', round: 1 });

      const victim = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: civilian.id } });
      expect(victim.lifeStatus).toBe('DEAD');

      const action = await prisma.gameAction.findFirstOrThrow({
        where: { gameId: game.id, actorPlayerId: don.id },
      });
      expect(action.result).toBeNull(); // KILL itself has no §17.5 private-result payload
    });

    it('no deaths (fully protected) routes straight to MORNING, skipping LAST_WORD', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DON }, { roleCode: RoleCode.DOCTOR }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: true },
      );
      const [don, doctor, civilian] = gamePlayers;
      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civilian.id);
      await submitAction(game.id, nightPhase.id, doctor.id, ActionType.PROTECT, civilian.id);

      const result = await service.advancePhase(game.id);

      expect(result).toEqual({ advanced: true, from: 'NIGHT', to: 'MORNING', round: 1 });

      const victim = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: civilian.id } });
      expect(victim.lifeStatus).toBe('ALIVE');

      const doctorAction = await prisma.gameAction.findFirstOrThrow({
        where: { gameId: game.id, actorPlayerId: doctor.id },
      });
      expect(doctorAction.result).toEqual({ applied: true });
    });

    it('deaths occurring with lastWordEnabled=false route straight to MORNING (§10.4 Fast Mode default)', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DON }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false },
      );
      const [don, civilian] = gamePlayers;
      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civilian.id);

      const result = await service.advancePhase(game.id);

      expect(result).toEqual({ advanced: true, from: 'NIGHT', to: 'MORNING', round: 1 });
      const victim = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: civilian.id } });
      expect(victim.lifeStatus).toBe('DEAD');
    });

    it('a Sheriff shot increments the SHERIFF_SHOOT usage counter at resolution, not at submission', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.SHERIFF }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false },
      );
      const [sheriff, civilian] = gamePlayers;
      await submitAction(game.id, nightPhase.id, sheriff.id, ActionType.SHOOT, civilian.id);

      const before = await prisma.roleAbilityUsage.findUnique({
        where: {
          gameId_playerId_ability: { gameId: game.id, playerId: sheriff.id, ability: 'SHERIFF_SHOOT' },
        },
      });
      expect(before).toBeNull();

      await service.advancePhase(game.id);

      const after = await prisma.roleAbilityUsage.findUniqueOrThrow({
        where: {
          gameId_playerId_ability: { gameId: game.id, playerId: sheriff.id, ability: 'SHERIFF_SHOOT' },
        },
      });
      expect(after.usedCount).toBe(1);
    });

    it('advances NIGHT early once every alive role with a usable ability has submitted (OD-044c)', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DON }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() + 60_000), lastWordEnabled: false }, // NOT yet due by timer
      );
      const [don, civilian] = gamePlayers;

      const beforeSubmit = await service.advancePhase(game.id);
      expect(beforeSubmit).toMatchObject({ advanced: false, reason: 'NOT_DUE' });

      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civilian.id);

      const afterSubmit = await service.advancePhase(game.id);
      expect(afterSubmit).toEqual({ advanced: true, from: 'NIGHT', to: 'MORNING', round: 1 });
    });

    it('does not advance early while an alive role with a usable ability has not yet submitted', async () => {
      const { game } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DON }, { roleCode: RoleCode.DOCTOR }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() + 60_000) },
      );

      const result = await service.advancePhase(game.id);
      expect(result).toMatchObject({ advanced: false, reason: 'NOT_DUE' });
    });

    it('a Sheriff who already spent SHOOT is excluded from the early-completion expected set', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.SHERIFF }, { roleCode: RoleCode.DON }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() + 60_000), lastWordEnabled: false },
      );
      const [sheriff, don, civilian] = gamePlayers;
      await prisma.roleAbilityUsage.create({
        data: { gameId: game.id, playerId: sheriff.id, ability: 'SHERIFF_SHOOT', usedCount: 1 },
      });

      // Sheriff has nothing left to submit; only Don's KILL is still outstanding.
      const stillWaiting = await service.advancePhase(game.id);
      expect(stillWaiting).toMatchObject({ advanced: false, reason: 'NOT_DUE' });

      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civilian.id);

      const result = await service.advancePhase(game.id);
      expect(result).toEqual({ advanced: true, from: 'NIGHT', to: 'MORNING', round: 1 });
    });

    it('early-completion and a concurrent timeout-driven advance never double-resolve the same NIGHT round', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DON }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false }, // also due by timer
      );
      const [don, civilian] = gamePlayers;
      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civilian.id);

      const [first, second] = await Promise.all([
        service.advancePhase(game.id),
        service.advancePhase(game.id),
      ]);

      const advancedCount = [first, second].filter((r) => r.advanced).length;
      expect(advancedCount).toBe(1);

      const victim = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: civilian.id } });
      expect(victim.lifeStatus).toBe('DEAD'); // exactly one death write, not applied twice

      const killAction = await prisma.gameAction.findFirstOrThrow({
        where: { gameId: game.id, actorPlayerId: don.id },
      });
      const abilityRows = await prisma.roleAbilityUsage.findMany({ where: { gameId: game.id } });
      expect(abilityRows).toHaveLength(0); // KILL isn't a counted ability; sanity check no stray increments
      expect(killAction).toBeTruthy();

      const phases = await prisma.gamePhase.findMany({ where: { gameId: game.id } });
      expect(phases.map((p) => p.phase).sort()).toEqual(['MORNING', 'NIGHT', 'NIGHT_RESOLUTION']);
    });

    it('a night-triggered LAST_WORD routes to MORNING at its own timeout (not an execution)', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DON }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: true },
      );
      const [don, civilian] = gamePlayers;
      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civilian.id);

      const first = await service.advancePhase(game.id);
      expect(first).toEqual({ advanced: true, from: 'NIGHT', to: 'LAST_WORD', round: 1 });

      const lastWordPhase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId: game.id, endedAt: null } });
      await prisma.gamePhase.update({ where: { id: lastWordPhase.id }, data: { endsAt: new Date(Date.now() - 1_000) } });

      const second = await service.advancePhase(game.id);
      expect(second).toEqual({ advanced: true, from: 'LAST_WORD', to: 'MORNING', round: 1 });
    });
  });

  describe('vote resolution wiring (§16/§10.4)', () => {
    it('a clear plurality executes the target immediately at VOTE_RESOLUTION and stops at LAST_WORD', async () => {
      const { game, votingPhase, gamePlayers } = await seedVotingGameWithPlayers(3, {
        endsAt: new Date(Date.now() - 1_000),
        lastWordEnabled: true,
      });
      const [a, b, target] = gamePlayers;
      await castVote(game.id, votingPhase.id, a.id, target.id);
      await castVote(game.id, votingPhase.id, b.id, target.id);

      const result = await service.advancePhase(game.id);

      expect(result).toEqual({ advanced: true, from: 'VOTING', to: 'LAST_WORD', round: 1 });

      const victim = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: target.id } });
      expect(victim.lifeStatus).toBe('DEAD'); // §10.4: already DEAD on LAST_WORD entry
    });

    it('a vote-triggered LAST_WORD routes to WIN_CHECK -> NIGHT (round+1) at its own timeout, not MORNING', async () => {
      const { game, votingPhase, gamePlayers } = await seedVotingGameWithPlayers(3, {
        endsAt: new Date(Date.now() - 1_000),
        lastWordEnabled: true,
      });
      const [a, b, target] = gamePlayers;
      await castVote(game.id, votingPhase.id, a.id, target.id);
      await castVote(game.id, votingPhase.id, b.id, target.id);

      const first = await service.advancePhase(game.id);
      expect(first).toEqual({ advanced: true, from: 'VOTING', to: 'LAST_WORD', round: 1 });

      const lastWordPhase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId: game.id, endedAt: null } });
      await prisma.gamePhase.update({ where: { id: lastWordPhase.id }, data: { endsAt: new Date(Date.now() - 1_000) } });

      const second = await service.advancePhase(game.id);
      // LAST_WORD -> EXECUTION (transient) -> WIN_CHECK (transient) -> NIGHT (round+1, OD-042)
      expect(second).toEqual({ advanced: true, from: 'LAST_WORD', to: 'NIGHT', round: 2 });
    });

    it('an execution with lastWordEnabled=false cascades straight through to NIGHT (round+1) in one call', async () => {
      const { game, votingPhase, gamePlayers } = await seedVotingGameWithPlayers(3, {
        endsAt: new Date(Date.now() - 1_000),
        lastWordEnabled: false,
      });
      const [a, b, target] = gamePlayers;
      await castVote(game.id, votingPhase.id, a.id, target.id);
      await castVote(game.id, votingPhase.id, b.id, target.id);

      const result = await service.advancePhase(game.id);

      expect(result).toEqual({ advanced: true, from: 'VOTING', to: 'NIGHT', round: 2 });

      const victim = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: target.id } });
      expect(victim.lifeStatus).toBe('DEAD');
    });

    it('an exact tie for the top spot produces no execution and cascades straight to NIGHT (OD-018)', async () => {
      const { game, votingPhase, gamePlayers } = await seedVotingGameWithPlayers(2, {
        endsAt: new Date(Date.now() - 1_000),
        lastWordEnabled: true,
      });
      const [x, y] = gamePlayers;
      await castVote(game.id, votingPhase.id, x.id, x.id);
      await castVote(game.id, votingPhase.id, y.id, y.id);

      const result = await service.advancePhase(game.id);

      expect(result).toEqual({ advanced: true, from: 'VOTING', to: 'NIGHT', round: 2 });

      const players = await prisma.gamePlayer.findMany({ where: { gameId: game.id } });
      expect(players.every((p) => p.lifeStatus === 'ALIVE')).toBe(true);
    });

    it('advances VOTING early once every alive player has voted (§10.2)', async () => {
      const { game, votingPhase, gamePlayers } = await seedVotingGameWithPlayers(2, {
        endsAt: new Date(Date.now() + 60_000), // NOT yet due by timer
        lastWordEnabled: false,
      });
      const [a, b] = gamePlayers;

      const beforeVotes = await service.advancePhase(game.id);
      expect(beforeVotes).toMatchObject({ advanced: false, reason: 'NOT_DUE' });

      await castVote(game.id, votingPhase.id, a.id, b.id);
      const oneVoted = await service.advancePhase(game.id);
      expect(oneVoted).toMatchObject({ advanced: false, reason: 'NOT_DUE' });

      await castVote(game.id, votingPhase.id, b.id, a.id);
      const allVoted = await service.advancePhase(game.id);
      expect(allVoted).toEqual({ advanced: true, from: 'VOTING', to: 'NIGHT', round: 2 });
    });

    it('early-completion and a concurrent timeout-driven advance never double-resolve the same VOTING round', async () => {
      const { game, votingPhase, gamePlayers } = await seedVotingGameWithPlayers(3, {
        endsAt: new Date(Date.now() - 1_000), // also due by timer
        lastWordEnabled: false,
      });
      const [a, b, target] = gamePlayers;
      await castVote(game.id, votingPhase.id, a.id, target.id);
      await castVote(game.id, votingPhase.id, b.id, target.id);

      const [first, second] = await Promise.all([
        service.advancePhase(game.id),
        service.advancePhase(game.id),
      ]);

      const advancedCount = [first, second].filter((r) => r.advanced).length;
      expect(advancedCount).toBe(1);

      const victim = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: target.id } });
      expect(victim.lifeStatus).toBe('DEAD'); // exactly one death write, not applied twice

      const phases = await prisma.gamePhase.findMany({ where: { gameId: game.id } });
      expect(phases.map((p) => p.phase).sort()).toEqual(['EXECUTION', 'NIGHT', 'VOTE_RESOLUTION', 'VOTING', 'WIN_CHECK'].sort());
    });
  });

  describe('win evaluator wiring (§16, full cycle)', () => {
    it('a night kill that wipes out Town ends the game at NIGHT_RESOLUTION, skipping LAST_WORD even when enabled', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DON }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: true },
      );
      const [don, civilian] = gamePlayers;
      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civilian.id);

      const result = await service.advancePhase(game.id);

      // hasWinner is checked before deathsOccurred/lastWordEnabled in
      // computeNextPhase's NIGHT_RESOLUTION branch (phase-graph.ts) — a
      // winning kill jumps straight to GAME_OVER, never through LAST_WORD.
      expect(result).toEqual({ advanced: true, from: 'NIGHT', to: 'GAME_OVER', round: 1 });

      const persistedGame = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
      expect(persistedGame.status).toBe('FINISHED');
      expect(persistedGame.finishedAt).not.toBeNull();

      const gameResult = await prisma.gameResult.findUniqueOrThrow({ where: { gameId: game.id } });
      expect(gameResult.winnerTeam).toBe('MAFIA');

      const phases = await prisma.gamePhase.findMany({ where: { gameId: game.id } });
      expect(phases.map((p) => p.phase).sort()).toEqual(['GAME_OVER', 'NIGHT', 'NIGHT_RESOLUTION'].sort());
    });

    it('an execution that removes the last Mafia-aligned player ends the game at WIN_CHECK with a TOWN win', async () => {
      const { game, votingPhase, gamePlayers } = await seedVotingGameWithRoles(
        [{ roleCode: RoleCode.MAFIA }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false },
      );
      const [mafia, civilian] = gamePlayers;
      await castVote(game.id, votingPhase.id, civilian.id, mafia.id);

      const result = await service.advancePhase(game.id);

      expect(result).toEqual({ advanced: true, from: 'VOTING', to: 'GAME_OVER', round: 1 });

      const victim = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: mafia.id } });
      expect(victim.lifeStatus).toBe('DEAD');

      const persistedGame = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
      expect(persistedGame.status).toBe('FINISHED');

      const gameResult = await prisma.gameResult.findUniqueOrThrow({ where: { gameId: game.id } });
      expect(gameResult.winnerTeam).toBe('TOWN');

      const phases = await prisma.gamePhase.findMany({ where: { gameId: game.id } });
      expect(phases.map((p) => p.phase).sort()).toEqual(
        ['EXECUTION', 'GAME_OVER', 'VOTE_RESOLUTION', 'VOTING', 'WIN_CHECK'].sort(),
      );
    });

    it('a PHASE_ADVANCE_CHECK firing against an already-GAME_OVER game no-ops safely, without erroring or double-transitioning', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DON }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false },
      );
      const [don, civilian] = gamePlayers;
      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civilian.id);

      const first = await service.advancePhase(game.id);
      expect(first).toEqual({ advanced: true, from: 'NIGHT', to: 'GAME_OVER', round: 1 });

      const phasesAfterFirst = await prisma.gamePhase.findMany({ where: { gameId: game.id } });

      // Simulates the scheduler's PHASE_ADVANCE_CHECK task (queued against
      // this game's pre-GAME_OVER `ends_at`) firing after the game already
      // ended — the exact scenario §19's dangling-task concern describes.
      const second = await service.advancePhase(game.id);

      expect(second).toEqual({ advanced: false, reason: 'GAME_NOT_RUNNING' });

      const phasesAfterSecond = await prisma.gamePhase.findMany({ where: { gameId: game.id } });
      expect(phasesAfterSecond).toHaveLength(phasesAfterFirst.length); // no new phase row, no double-transition

      const gameResults = await prisma.gameResult.findMany({ where: { gameId: game.id } });
      expect(gameResults).toHaveLength(1); // still exactly one result row
    });
  });

  describe('realtime delivery (§20, OD-047)', () => {
    it('broadcasts PHASE_CHANGED with {from, to, round} on a real transition', async () => {
      const game = await seedRunningGame({
        activePhase: GamePhaseName.WIN_CHECK,
        round: 3,
        endsAt: null,
      });

      await service.advancePhase(game.id);

      expect(realtime.broadcastToGame).toHaveBeenCalledWith(game.id, 'PHASE_CHANGED', {
        from: 'WIN_CHECK',
        to: 'NIGHT',
        round: 4,
      });
    });

    it('does not broadcast anything when advancePhase is a NOT_DUE no-op', async () => {
      const game = await seedRunningGame({
        activePhase: GamePhaseName.NIGHT,
        round: 1,
        endsAt: new Date(Date.now() + 60_000),
      });

      const result = await service.advancePhase(game.id);

      expect(result).toMatchObject({ advanced: false, reason: 'NOT_DUE' });
      expect(realtime.broadcastToGame).not.toHaveBeenCalled();
    });

    it('broadcasts GAME_FINISHED with the winnerTeam once the game ends, after PHASE_CHANGED', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DON }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false },
      );
      const [don, civilian] = gamePlayers;
      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civilian.id);

      await service.advancePhase(game.id);

      expect(realtime.broadcastToGame).toHaveBeenNthCalledWith(1, game.id, 'PHASE_CHANGED', {
        from: 'NIGHT',
        to: 'GAME_OVER',
        round: 1,
      });
      expect(realtime.broadcastToGame).toHaveBeenNthCalledWith(2, game.id, 'GAME_FINISHED', {
        winnerTeam: 'MAFIA',
      });
    });

    it('fires no realtime event when the transaction rolls back, even though a write already ran inside it', async () => {
      const brokenNightResolution = {
        resolveRound: jest.fn().mockRejectedValue(new Error('simulated failure after write')),
      };
      const brokenService = new PhaseTransitionService(
        prisma,
        gameLifecycle,
        scheduler,
        brokenNightResolution as unknown as NightResolutionService,
        voteResolution,
        realtime as unknown as RealtimeEventService,
      );

      const { game } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DON }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false },
      );

      // GameLifecycleService.transitionPhase (the NIGHT -> NIGHT_RESOLUTION
      // write) runs and completes *before* the broken resolveRound call
      // throws — proving the eventual rollback, not just "no write attempted."
      await expect(brokenService.advancePhase(game.id)).rejects.toThrow('simulated failure after write');

      const persisted = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
      expect(persisted.currentPhase).toBe('NIGHT'); // rolled back to its pre-call value
      expect(persisted.round).toBe(1);

      const activePhase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId: game.id, endedAt: null } });
      expect(activePhase.phase).toBe('NIGHT'); // the NIGHT_RESOLUTION row never survived the rollback

      expect(realtime.broadcastToGame).not.toHaveBeenCalled();
      expect(realtime.sendToPlayer).not.toHaveBeenCalled();
    });
  });

  describe('private night-action result delivery (§17.5, OD-048)', () => {
    it('sends each actor their own private result event with the persisted payload shape, post-commit', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [
          { roleCode: RoleCode.DON },
          { roleCode: RoleCode.MAFIA },
          { roleCode: RoleCode.DOCTOR },
          { roleCode: RoleCode.DETECTIVE },
          { roleCode: RoleCode.SHERIFF },
          { roleCode: RoleCode.BODYGUARD },
          { roleCode: RoleCode.JOURNALIST },
          { roleCode: RoleCode.CIVILIAN },
          { roleCode: RoleCode.CIVILIAN },
        ],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false },
      );
      const [don, mafia, doctor, detective, sheriff, bodyguard, journalist, civ1, civ2] = gamePlayers;

      await submitAction(game.id, nightPhase.id, don.id, ActionType.CHECK, sheriff.id, 1);
      await submitAction(game.id, nightPhase.id, doctor.id, ActionType.PROTECT, civ1.id);
      await submitAction(game.id, nightPhase.id, detective.id, ActionType.INVESTIGATE, mafia.id);
      await submitAction(game.id, nightPhase.id, sheriff.id, ActionType.SHOOT, civ2.id);
      await submitAction(game.id, nightPhase.id, bodyguard.id, ActionType.GUARD, civ1.id);
      await prisma.gameAction.create({
        data: {
          gameId: game.id,
          phaseId: nightPhase.id,
          actorPlayerId: journalist.id,
          actionType: ActionType.INVESTIGATE_PAIR,
          actionSlot: 0,
          targetPlayerId: mafia.id,
          targetPlayerId2: civ1.id,
        },
      });

      const result = await service.advancePhase(game.id);
      expect(result).toEqual({ advanced: true, from: 'NIGHT', to: 'MORNING', round: 1 }); // civ2 dies, no win yet

      expect(realtime.sendToPlayer).toHaveBeenCalledWith(game.id, don.id, 'DON_CHECK_RESULT', { isSheriff: true });
      expect(realtime.sendToPlayer).toHaveBeenCalledWith(game.id, doctor.id, 'DOCTOR_PROTECT_RESULT', { applied: true });
      expect(realtime.sendToPlayer).toHaveBeenCalledWith(game.id, detective.id, 'DETECTIVE_RESULT', { flag: 'MAFIA' });
      expect(realtime.sendToPlayer).toHaveBeenCalledWith(game.id, sheriff.id, 'SHERIFF_RESULT', { died: true });
      expect(realtime.sendToPlayer).toHaveBeenCalledWith(game.id, bodyguard.id, 'GUARD_CONSUMED', { consumed: false });
      expect(realtime.sendToPlayer).toHaveBeenCalledWith(game.id, journalist.id, 'JOURNALIST_RESULT', {
        relation: 'DIFFERENT_TEAM',
      });
      expect(realtime.sendToPlayer).toHaveBeenCalledTimes(6); // no event for KILL (none submitted here) or for any non-actor
    });

    it("never sends a night-action player's private event to a different player (scoping)", async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DETECTIVE }, { roleCode: RoleCode.MAFIA }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false },
      );
      const [detective, mafia] = gamePlayers;
      await submitAction(game.id, nightPhase.id, detective.id, ActionType.INVESTIGATE, mafia.id);

      await service.advancePhase(game.id);

      for (const call of realtime.sendToPlayer.mock.calls) {
        const [, targetPlayerId, eventName] = call;
        if (eventName === 'DETECTIVE_RESULT') {
          expect(targetPlayerId).toBe(detective.id); // never mafia.id or any other player
        }
      }
    });

    it('a result computed and written mid-transaction never fires if a later write in the same transaction fails (rollback proof)', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DON }, { roleCode: RoleCode.DETECTIVE }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false },
      );
      const [don, detective] = gamePlayers;
      await submitAction(game.id, nightPhase.id, detective.id, ActionType.INVESTIGATE, don.id);
      // No KILL submitted: this test isolates the private-result write from
      // the deaths/PHASE_CHANGED path already covered by the earlier
      // "fires no realtime event when the transaction rolls back" test.

      const originalTransitionPhase = gameLifecycle.transitionPhase.bind(gameLifecycle);
      let transitionPhaseCalls = 0;
      const transitionPhaseSpy = jest
        .spyOn(gameLifecycle, 'transitionPhase')
        .mockImplementation(async (...args: Parameters<typeof originalTransitionPhase>) => {
          transitionPhaseCalls += 1;
          // 1st call: the real NIGHT -> NIGHT_RESOLUTION write (lets
          // NightResolutionService run for real and write the Detective's
          // result). 2nd call: NIGHT_RESOLUTION -> MORNING — throw here,
          // *after* the result was already computed and written, to prove a
          // later failure in the same transaction rolls the earlier write
          // back too, not just that an early failure prevents it.
          if (transitionPhaseCalls === 2) {
            throw new Error('simulated failure on the second transitionPhase call');
          }
          return originalTransitionPhase(...args);
        });

      try {
        await expect(service.advancePhase(game.id)).rejects.toThrow(
          'simulated failure on the second transitionPhase call',
        );
      } finally {
        transitionPhaseSpy.mockRestore();
      }

      const persistedGame = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
      expect(persistedGame.currentPhase).toBe('NIGHT'); // rolled back, including the 1st (successful) write

      const action = await prisma.gameAction.findFirstOrThrow({
        where: { gameId: game.id, actorPlayerId: detective.id },
      });
      expect(action.result).toBeNull(); // the computed result never survived the rollback

      expect(realtime.sendToPlayer).not.toHaveBeenCalled();
      expect(realtime.broadcastToGame).not.toHaveBeenCalled();
    });
  });

  describe('MULTIPLE_DEATHS delivery (§17.5, OD-050)', () => {
    it('broadcasts MULTIPLE_DEATHS with the full dead-player list when two independent kills land the same night', async () => {
      // Don's mafia KILL and the Maniac's independent KILL each land on a
      // different civilian: two unrelated deaths, the case §17.5 names.
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [
          { roleCode: RoleCode.DON },
          { roleCode: RoleCode.MANIAC },
          { roleCode: RoleCode.CIVILIAN },
          { roleCode: RoleCode.CIVILIAN },
          { roleCode: RoleCode.CIVILIAN },
        ],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false },
      );
      const [don, maniac, civ1, civ2] = gamePlayers;
      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civ1.id);
      await submitAction(game.id, nightPhase.id, maniac.id, ActionType.KILL, civ2.id);

      const result = await service.advancePhase(game.id);
      expect(result).toEqual({ advanced: true, from: 'NIGHT', to: 'MORNING', round: 1 });

      expect(realtime.broadcastToGame).toHaveBeenCalledWith(game.id, 'MULTIPLE_DEATHS', {
        deaths: expect.arrayContaining([civ1.id, civ2.id]),
      });
      const [, , payload] = realtime.broadcastToGame.mock.calls.find((c) => c[1] === 'MULTIPLE_DEATHS')!;
      expect((payload as { deaths: string[] }).deaths).toHaveLength(2); // no role field, no duplicates (OD-024/OD-050)
    });

    it('does not broadcast MULTIPLE_DEATHS when exactly one player dies (OD-050)', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DON }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false },
      );
      const [don, civilian] = gamePlayers;
      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civilian.id);

      const result = await service.advancePhase(game.id);
      expect(result).toEqual({ advanced: true, from: 'NIGHT', to: 'MORNING', round: 1 });

      expect(realtime.broadcastToGame).not.toHaveBeenCalledWith(game.id, 'MULTIPLE_DEATHS', expect.anything());
    });

    it('does not broadcast MULTIPLE_DEATHS when nobody dies that night', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [{ roleCode: RoleCode.DON }, { roleCode: RoleCode.DOCTOR }, { roleCode: RoleCode.CIVILIAN }],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false },
      );
      const [don, doctor, civilian] = gamePlayers;
      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civilian.id);
      await submitAction(game.id, nightPhase.id, doctor.id, ActionType.PROTECT, civilian.id);

      await service.advancePhase(game.id);

      expect(realtime.broadcastToGame).not.toHaveBeenCalledWith(game.id, 'MULTIPLE_DEATHS', expect.anything());
    });

    it('a rollback after the deaths were computed and written fires no MULTIPLE_DEATHS event', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [
          { roleCode: RoleCode.DON },
          { roleCode: RoleCode.MANIAC },
          { roleCode: RoleCode.CIVILIAN },
          { roleCode: RoleCode.CIVILIAN },
          { roleCode: RoleCode.CIVILIAN },
        ],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false },
      );
      const [don, maniac, civ1, civ2] = gamePlayers;
      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civ1.id);
      await submitAction(game.id, nightPhase.id, maniac.id, ActionType.KILL, civ2.id);

      const originalTransitionPhase = gameLifecycle.transitionPhase.bind(gameLifecycle);
      let transitionPhaseCalls = 0;
      const transitionPhaseSpy = jest
        .spyOn(gameLifecycle, 'transitionPhase')
        .mockImplementation(async (...args: Parameters<typeof originalTransitionPhase>) => {
          transitionPhaseCalls += 1;
          // 1st call: real NIGHT -> NIGHT_RESOLUTION write, lets
          // NightResolutionService apply both deaths for real. 2nd call:
          // NIGHT_RESOLUTION -> MORNING — throw here, after the deaths were
          // already written, to prove a later failure rolls them back too.
          if (transitionPhaseCalls === 2) {
            throw new Error('simulated failure after deaths were written');
          }
          return originalTransitionPhase(...args);
        });

      try {
        await expect(service.advancePhase(game.id)).rejects.toThrow('simulated failure after deaths were written');
      } finally {
        transitionPhaseSpy.mockRestore();
      }

      const victim1 = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: civ1.id } });
      const victim2 = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: civ2.id } });
      expect(victim1.lifeStatus).toBe('ALIVE'); // rolled back
      expect(victim2.lifeStatus).toBe('ALIVE');

      expect(realtime.broadcastToGame).not.toHaveBeenCalled();
      expect(realtime.sendToPlayer).not.toHaveBeenCalled();
    });

    it('delivers MULTIPLE_DEATHS via broadcastToGame (public, game-wide), never sendToPlayer (scoping)', async () => {
      const { game, nightPhase, gamePlayers } = await seedNightGameWithRoles(
        [
          { roleCode: RoleCode.DON },
          { roleCode: RoleCode.MANIAC },
          { roleCode: RoleCode.CIVILIAN },
          { roleCode: RoleCode.CIVILIAN },
          { roleCode: RoleCode.CIVILIAN },
        ],
        { endsAt: new Date(Date.now() - 1_000), lastWordEnabled: false },
      );
      const [don, maniac, civ1, civ2] = gamePlayers;
      await submitAction(game.id, nightPhase.id, don.id, ActionType.KILL, civ1.id);
      await submitAction(game.id, nightPhase.id, maniac.id, ActionType.KILL, civ2.id);

      await service.advancePhase(game.id);

      // §20's `game:{gameId}` room already reaches every connected player
      // (proven at the transport level by realtime.gateway.spec.ts, phase 1);
      // this asserts only that MULTIPLE_DEATHS is routed through that public
      // mechanism, never `sendToPlayer`'s single-recipient one.
      const sendToPlayerNames = realtime.sendToPlayer.mock.calls.map((c) => c[2]);
      expect(sendToPlayerNames).not.toContain('MULTIPLE_DEATHS');
      expect(realtime.broadcastToGame).toHaveBeenCalledWith(game.id, 'MULTIPLE_DEATHS', expect.anything());
    });
  });
});
