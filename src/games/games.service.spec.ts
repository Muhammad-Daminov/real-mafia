import 'dotenv/config';
import { randomUUID } from 'crypto';
import { ActionType, RoleCode, RulesetMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommandRequestService } from '../common/command-requests/command-request.service';
import { SchedulerService } from '../common/scheduling/scheduler.service';
import { RoleAssignmentService } from '../game-engine/role-assignment.service';
import { GameLifecycleService } from '../game-engine/game-lifecycle.service';
import { PhaseTransitionService } from '../game-engine/phase-transition.service';
import { NightResolutionService } from '../game-engine/night-actions/night-resolution.service';
import { NightActionService } from '../game-engine/night-actions/night-action.service';
import { VoteResolutionService } from '../game-engine/voting/vote-resolution.service';
import { VoteService } from '../game-engine/voting/vote.service';
import { teamForRole } from '../game-engine/roles';
import { RoomsService } from '../rooms/rooms.service';
import { RealtimeEventService } from '../common/realtime/realtime-event.service';
import { GamesService } from './games.service';
import { GameStateErrorCode, GameStateException } from './game-state.errors';

/**
 * B-R2/OD-059: `GET /games/:gameId/state`, exercised the same way
 * `rooms.service.spec.ts` exercises `RoomsService` — real Postgres, real
 * `RoomsService.createRoom`/`joinRoom`/`startGame` to produce a genuine
 * dealt game, no mocking of the write path this endpoint only reads from.
 */
describe('GamesService (integration, B-R2/OD-059)', () => {
  const prisma = new PrismaService();
  const commandRequests = new CommandRequestService();
  const roleAssignment = new RoleAssignmentService();
  const scheduler = new SchedulerService(prisma);
  const gameLifecycle = new GameLifecycleService(roleAssignment, scheduler);
  const realtime: { broadcastToGame: jest.Mock; sendToPlayer: jest.Mock } = {
    broadcastToGame: jest.fn(),
    sendToPlayer: jest.fn(),
  };
  const rooms = new RoomsService(
    prisma,
    commandRequests,
    gameLifecycle,
    realtime as unknown as RealtimeEventService,
  );
  const games = new GamesService(prisma);
  // B-R4: drives the real NIGHT/VOTING resolution + GAME_OVER paths
  // (NightActionService/VoteService -> PhaseTransitionService ->
  // GameLifecycleService) — same wiring as rooms.service.spec.ts's B-R3
  // death-path test.
  const nightResolution = new NightResolutionService(gameLifecycle);
  const voteResolution = new VoteResolutionService(gameLifecycle);
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

  const TEST_TELEGRAM_PREFIX = 'games-state-test-';
  let createdUserIds: string[] = [];
  let createdRoomIds: string[] = [];

  const makeUser = async () => {
    const user = await prisma.user.create({
      data: { telegramId: `${TEST_TELEGRAM_PREFIX}${randomUUID()}`, firstName: 'Test' },
    });
    createdUserIds.push(user.id);
    return user;
  };

  const createValidRoom = async (userId: string, maxPlayers = 4) => {
    const room = await rooms.createRoom({
      userId,
      clientRequestId: randomUUID(),
      maxPlayers,
      rulesetMode: RulesetMode.NORMAL,
    });
    createdRoomIds.push(room.roomId);
    return room;
  };

  afterEach(async () => {
    realtime.broadcastToGame.mockClear();
    realtime.sendToPlayer.mockClear();
    if (createdRoomIds.length) {
      const gameRows = await prisma.game.findMany({
        where: { roomId: { in: createdRoomIds } },
        select: { id: true },
      });
      if (gameRows.length) {
        await prisma.scheduledTask.deleteMany({
          where: { dedupeKey: { in: gameRows.map((g) => `phase-advance:${g.id}`) } },
        });
      }
      const gameIds = gameRows.map((g) => g.id);
      await prisma.gameAction.deleteMany({ where: { gameId: { in: gameIds } } });
      await prisma.gameVote.deleteMany({ where: { gameId: { in: gameIds } } });
      await prisma.gameResult.deleteMany({ where: { gameId: { in: gameIds } } });
      await prisma.roleAbilityUsage.deleteMany({ where: { gameId: { in: gameIds } } });
      await prisma.gameRoleAssignment.deleteMany({ where: { game: { roomId: { in: createdRoomIds } } } });
      await prisma.gamePhase.deleteMany({ where: { game: { roomId: { in: createdRoomIds } } } });
      await prisma.gamePlayer.deleteMany({ where: { game: { roomId: { in: createdRoomIds } } } });
      await prisma.game.deleteMany({ where: { roomId: { in: createdRoomIds } } });
    }
    if (createdRoomIds.length) {
      await prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } });
    }
    if (createdUserIds.length) {
      await prisma.commandRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds = [];
    createdRoomIds = [];
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a member of a still-LOBBY game gets game state with myRoleCode/myTeam null (no role dealt yet)', async () => {
    const host = await makeUser();
    const room = await createValidRoom(host.id, 8);

    const state = await games.getMyState({ gameId: room.gameId, userId: host.id });

    expect(state.gameId).toBe(room.gameId);
    expect(state.status).toBe('LOBBY');
    expect(state.currentPhase).toBe('LOBBY');
    expect(state.round).toBe(0);
    expect(state.myRoleCode).toBeNull();
    expect(state.myTeam).toBeNull();
    expect(state.teammates).toEqual([]);
  });

  it('after startGame, each player sees their own real dealt role/team, and never any other player\'s role', async () => {
    const host = await makeUser();
    const others = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const room = await createValidRoom(host.id, 8);
    for (const other of others) {
      await rooms.joinRoom({ userId: other.id, code: room.code, clientRequestId: randomUUID() });
    }

    await rooms.startGame({ userId: host.id, roomId: room.roomId, clientRequestId: randomUUID() });

    const assignments = await prisma.gameRoleAssignment.findMany({ where: { gameId: room.gameId } });
    expect(assignments).toHaveLength(4);

    for (const assignment of assignments) {
      const player = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: assignment.playerId } });
      const state = await games.getMyState({ gameId: room.gameId, userId: player.userId });

      expect(state.myRoleCode).toBe(assignment.roleCode);
      expect(state.myTeam).toBe(teamForRole(assignment.roleCode));
      expect(state.status).toBe('RUNNING');
      expect(state.currentPhase).toBe('ROLE_REVEAL');

      // No other player's role ever appears in this player's own response —
      // non-mafia callers get an empty teammates list and no roleCode beyond
      // their own anywhere in the payload.
      if (state.myTeam !== 'MAFIA') {
        expect(state.teammates).toEqual([]);
      }
      const otherAssignments = assignments.filter((a) => a.playerId !== assignment.playerId);
      const serialized = JSON.stringify(state);
      for (const other of otherAssignments) {
        if (teamForRole(other.roleCode) !== 'MAFIA' || state.myTeam !== 'MAFIA') {
          expect(serialized).not.toContain(other.playerId);
        }
      }
    }
  });

  it('a MAFIA-team caller sees its teammates (OD-025); a non-mafia caller sees an empty list', async () => {
    const host = await makeUser();
    const others = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser(), makeUser(), makeUser()]);
    const room = await createValidRoom(host.id, 8);
    for (const other of others) {
      await rooms.joinRoom({ userId: other.id, code: room.code, clientRequestId: randomUUID() });
    }

    await rooms.startGame({ userId: host.id, roomId: room.roomId, clientRequestId: randomUUID() });

    const assignments = await prisma.gameRoleAssignment.findMany({ where: { gameId: room.gameId } });
    const mafiaTeam = assignments.filter((a) => teamForRole(a.roleCode) === 'MAFIA');
    expect(mafiaTeam).toHaveLength(2);

    for (const assignment of mafiaTeam) {
      const player = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: assignment.playerId } });
      const state = await games.getMyState({ gameId: room.gameId, userId: player.userId });

      const expectedTeammates = mafiaTeam
        .filter((m) => m.playerId !== assignment.playerId)
        .map((m) => ({ playerId: m.playerId, roleCode: m.roleCode }));
      expect(state.teammates).toEqual(expect.arrayContaining(expectedTeammates));
      expect(state.teammates).toHaveLength(expectedTeammates.length);
    }

    const civilianOrTown = assignments.find((a) => teamForRole(a.roleCode) !== 'MAFIA')!;
    const townPlayer = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: civilianOrTown.playerId } });
    const townState = await games.getMyState({ gameId: room.gameId, userId: townPlayer.userId });
    expect(townState.teammates).toEqual([]);
  });

  it('throws PLAYER_NOT_IN_GAME (404) for a caller who is not a member of the game', async () => {
    const host = await makeUser();
    const outsider = await makeUser();
    const room = await createValidRoom(host.id, 8);

    await expect(games.getMyState({ gameId: room.gameId, userId: outsider.id })).rejects.toMatchObject(
      new GameStateException(GameStateErrorCode.PLAYER_NOT_IN_GAME, 'Siz bu o‘yinda emassiz'),
    );
  });

  it('throws PLAYER_NOT_IN_GAME (404) for a completely nonexistent gameId, not a different error', async () => {
    const host = await makeUser();

    await expect(
      games.getMyState({ gameId: randomUUID(), userId: host.id }),
    ).rejects.toMatchObject(new GameStateException(GameStateErrorCode.PLAYER_NOT_IN_GAME, 'Siz bu o‘yinda emassiz'));
  });

  it('phaseEndsAt reflects the active GamePhase.endsAt after startGame (ROLE_REVEAL is timed)', async () => {
    const host = await makeUser();
    const others = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const room = await createValidRoom(host.id, 8);
    for (const other of others) {
      await rooms.joinRoom({ userId: other.id, code: room.code, clientRequestId: randomUUID() });
    }

    await rooms.startGame({ userId: host.id, roomId: room.roomId, clientRequestId: randomUUID() });

    const state = await games.getMyState({ gameId: room.gameId, userId: host.id });
    expect(state.phaseEndsAt).not.toBeNull();
    expect(new Date(state.phaseEndsAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('a bot player (isBot) is treated identically to a real player — no special-casing on this read path', async () => {
    const host = await makeUser();
    const bot = await prisma.user.create({
      data: { telegramId: `-${Date.now()}9999`, firstName: 'Bot 1', isBot: true },
    });
    createdUserIds.push(bot.id);
    const others = await Promise.all([makeUser(), makeUser()]);
    const room = await createValidRoom(host.id, 8);
    await rooms.joinRoom({ userId: bot.id, code: room.code, clientRequestId: randomUUID() });
    for (const other of others) {
      await rooms.joinRoom({ userId: other.id, code: room.code, clientRequestId: randomUUID() });
    }

    await rooms.startGame({ userId: host.id, roomId: room.roomId, clientRequestId: randomUUID() });

    const botPlayer = await prisma.gamePlayer.findUniqueOrThrow({
      where: { gameId_userId: { gameId: room.gameId, userId: bot.id } },
    });
    const assignment = await prisma.gameRoleAssignment.findUniqueOrThrow({
      where: { playerId: botPlayer.id },
    });

    const state = await games.getMyState({ gameId: room.gameId, userId: bot.id });
    expect(state.myRoleCode).toBe(assignment.roleCode);
    expect(state.myPlayerId).toBe(botPlayer.id);
  });

  describe('result (B-R4)', () => {
    const forcePhaseDue = async (gameId: string) => {
      const active = await prisma.gamePhase.findFirstOrThrow({ where: { gameId, endedAt: null } });
      await prisma.gamePhase.update({ where: { id: active.id }, data: { endsAt: new Date(Date.now() - 1_000) } });
      return active;
    };

    it('is absent (undefined) while the game is RUNNING', async () => {
      const host = await makeUser();
      const others = await Promise.all([makeUser(), makeUser(), makeUser()]);
      const room = await createValidRoom(host.id, 4);
      for (const other of others) {
        await rooms.joinRoom({ userId: other.id, code: room.code, clientRequestId: randomUUID() });
      }
      await rooms.startGame({ userId: host.id, roomId: room.roomId, clientRequestId: randomUUID() });

      const state = await games.getMyState({ gameId: room.gameId, userId: host.id });

      expect(state.status).toBe('RUNNING');
      expect(state.result).toBeUndefined();
      expect(JSON.stringify(state)).not.toContain('"result"');
    });

    it('never leaks another player\'s role mid-game, including a player who already died (real night-kill path)', async () => {
      const host = await makeUser();
      const others = await Promise.all([makeUser(), makeUser(), makeUser()]);
      const room = await createValidRoom(host.id, 4);
      for (const other of others) {
        await rooms.joinRoom({ userId: other.id, code: room.code, clientRequestId: randomUUID() });
      }
      const started = await rooms.startGame({ userId: host.id, roomId: room.roomId, clientRequestId: randomUUID() });

      await forcePhaseDue(started.gameId);
      await phaseTransition.advancePhase(started.gameId); // ROLE_REVEAL -> NIGHT

      const hostPlayer = await prisma.gamePlayer.findUniqueOrThrow({
        where: { gameId_userId: { gameId: started.gameId, userId: host.id } },
      });
      const assignments = await prisma.gameRoleAssignment.findMany({ where: { gameId: started.gameId } });
      const mafia = assignments.find((a) => a.roleCode === RoleCode.MAFIA)!;
      const mafiaPlayer = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: mafia.playerId } });
      // Deliberately not the host — the host's own id/role legitimately
      // appears in its own response (myPlayerId/myRoleCode), which would
      // make the "nothing else appears" check below a false negative if
      // the victim happened to be the host itself.
      const victim = assignments.find((a) => a.roleCode === RoleCode.CIVILIAN && a.playerId !== hostPlayer.id)!;

      await nightActions.submitAction({
        userId: mafiaPlayer.userId,
        gameId: started.gameId,
        clientRequestId: randomUUID(),
        actionType: ActionType.KILL,
        targetPlayerId: victim.playerId,
      });

      await forcePhaseDue(started.gameId);
      await phaseTransition.advancePhase(started.gameId); // NIGHT -> NIGHT_RESOLUTION -> (LAST_WORD ->) MORNING

      const victimPlayer = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: victim.playerId } });
      expect(victimPlayer.lifeStatus).toBe('DEAD'); // the real death path actually ran

      const state = await games.getMyState({ gameId: started.gameId, userId: host.id });
      expect(state.status).toBe('RUNNING');
      expect(state.result).toBeUndefined();

      // Neither an alive nor a dead other player's identity appears
      // anywhere in the response — not even the night-kill victim's. This
      // (not a roleCode-string search) is the precise check: two players
      // share CIVILIAN in a 4p game, so searching for a role-code string
      // would false-fail whenever the caller's own role matches someone
      // else's.
      const serialized = JSON.stringify(state);
      for (const assignment of assignments) {
        if (assignment.playerId === state.myPlayerId) continue;
        expect(serialized).not.toContain(assignment.playerId);
      }
      expect(serialized).not.toContain(victim.playerId);
    });

    it('is present once FINISHED, with every seated player\'s role revealed, after a real night kill and a real vote execution', async () => {
      const host = await makeUser();
      const others = await Promise.all([makeUser(), makeUser(), makeUser()]);
      const room = await createValidRoom(host.id, 4);
      for (const other of others) {
        await rooms.joinRoom({ userId: other.id, code: room.code, clientRequestId: randomUUID() });
      }
      const started = await rooms.startGame({ userId: host.id, roomId: room.roomId, clientRequestId: randomUUID() });

      await forcePhaseDue(started.gameId);
      await phaseTransition.advancePhase(started.gameId); // ROLE_REVEAL -> NIGHT

      const assignments = await prisma.gameRoleAssignment.findMany({ where: { gameId: started.gameId } });
      const mafia = assignments.find((a) => a.roleCode === RoleCode.MAFIA)!;
      const mafiaPlayer = await prisma.gamePlayer.findUniqueOrThrow({ where: { id: mafia.playerId } });
      const nightVictim = assignments.find((a) => a.roleCode === RoleCode.CIVILIAN)!;

      // Real night kill.
      await nightActions.submitAction({
        userId: mafiaPlayer.userId,
        gameId: started.gameId,
        clientRequestId: randomUUID(),
        actionType: ActionType.KILL,
        targetPlayerId: nightVictim.playerId,
      });

      // Drive forward (NIGHT_RESOLUTION -> possibly LAST_WORD -> MORNING ->
      // DISCUSSION -> VOTING) one stable stop at a time, bounded so a
      // state-machine regression fails loudly instead of hanging.
      for (let i = 0; i < 5; i += 1) {
        const active = await prisma.gamePhase.findFirstOrThrow({ where: { gameId: started.gameId, endedAt: null } });
        if (active.phase === 'VOTING') break;
        await forcePhaseDue(started.gameId);
        await phaseTransition.advancePhase(started.gameId);
      }

      const votingPhase = await prisma.gamePhase.findFirstOrThrow({ where: { gameId: started.gameId, endedAt: null } });
      expect(votingPhase.phase).toBe('VOTING');

      // Real vote execution: every surviving alive player votes out the Mafia.
      const alivePlayers = await prisma.gamePlayer.findMany({
        where: { gameId: started.gameId, lifeStatus: 'ALIVE' },
      });
      for (const voter of alivePlayers) {
        await votes.castVote({
          userId: voter.userId,
          gameId: started.gameId,
          clientRequestId: randomUUID(),
          targetPlayerId: mafia.playerId,
        });
      }

      // VOTING -> VOTE_RESOLUTION (applies the execution) -> either
      // GAME_OVER directly or LAST_WORD first (a *stable*, timed phase —
      // computeNextPhase's VOTE_RESOLUTION branch routes there whenever
      // lastWordEnabled, stopping the cascade until forced again), then
      // EXECUTION (transient) -> WIN_CHECK (transient) -> GAME_OVER. Drive
      // with a bounded loop rather than assuming one call reaches the end.
      for (let i = 0; i < 5; i += 1) {
        const game = await prisma.game.findUniqueOrThrow({ where: { id: started.gameId } });
        if (game.status !== 'RUNNING') break;
        await forcePhaseDue(started.gameId);
        await phaseTransition.advancePhase(started.gameId);
      }

      const finalGame = await prisma.game.findUniqueOrThrow({ where: { id: started.gameId } });
      expect(finalGame.status).toBe('FINISHED');

      const state = await games.getMyState({ gameId: started.gameId, userId: host.id });
      expect(state.status).toBe('FINISHED');
      expect(state.result).toBeDefined();
      expect(state.result!.winnerTeam).toBe('TOWN');
      expect(new Date(state.result!.finishedAt).getTime()).toBeLessThanOrEqual(Date.now());

      expect(state.result!.players).toHaveLength(4);
      for (const assignment of assignments) {
        const entry = state.result!.players.find((p) => p.playerId === assignment.playerId)!;
        expect(entry).toBeDefined();
        expect(entry.roleCode).toBe(assignment.roleCode); // every role revealed, no exceptions
        expect(entry.team).toBe(teamForRole(assignment.roleCode));
      }

      const nightVictimEntry = state.result!.players.find((p) => p.playerId === nightVictim.playerId)!;
      expect(nightVictimEntry.lifeStatus).toBe('DEAD');
      const mafiaEntry = state.result!.players.find((p) => p.playerId === mafia.playerId)!;
      expect(mafiaEntry.lifeStatus).toBe('DEAD');
      const survivors = state.result!.players.filter(
        (p) => p.playerId !== nightVictim.playerId && p.playerId !== mafia.playerId,
      );
      expect(survivors.every((p) => p.lifeStatus === 'ALIVE')).toBe(true);

      // A non-member still gets 404, even once the game is FINISHED.
      const outsider = await makeUser();
      await expect(games.getMyState({ gameId: started.gameId, userId: outsider.id })).rejects.toMatchObject(
        new GameStateException(GameStateErrorCode.PLAYER_NOT_IN_GAME, 'Siz bu o‘yinda emassiz'),
      );
    });
  });
});
