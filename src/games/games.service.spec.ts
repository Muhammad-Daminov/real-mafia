import 'dotenv/config';
import { randomUUID } from 'crypto';
import { RulesetMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommandRequestService } from '../common/command-requests/command-request.service';
import { SchedulerService } from '../common/scheduling/scheduler.service';
import { RoleAssignmentService } from '../game-engine/role-assignment.service';
import { GameLifecycleService } from '../game-engine/game-lifecycle.service';
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
});
