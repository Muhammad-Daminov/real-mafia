import 'dotenv/config';
import { randomUUID } from 'crypto';
import { ForbiddenException } from '@nestjs/common';
import { RulesetMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommandRequestService } from '../common/command-requests/command-request.service';
import { GameLifecycleService } from '../game-engine/game-lifecycle.service';
import { RoleAssignmentService } from '../game-engine/role-assignment.service';
import { SchedulerService } from '../common/scheduling/scheduler.service';
import { RealtimeEventService } from '../common/realtime/realtime-event.service';
import { RoomsService } from '../rooms/rooms.service';
import { DevToolsService } from './dev-tools.service';

/**
 * B-D1. Mirrors `rooms.service.spec.ts`'s wiring style (real DB, hand-wired
 * services, a mocked `RealtimeEventService`) — `DevToolsService` is
 * deliberately exercised through the *real* `RoomsService`, not a mock, so
 * this proves fill-bots goes through the actual join/ready invariants
 * (capacity, idempotency, `PLAYER_JOINED` broadcast), not a re-guess of them.
 */
describe('DevToolsService (integration, B-D1)', () => {
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
  const devTools = new DevToolsService(prisma, rooms);

  const TEST_TELEGRAM_PREFIX = 'dev-tools-test-';
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
      const games = await prisma.game.findMany({
        where: { roomId: { in: createdRoomIds } },
        select: { id: true },
      });
      const gameIds = games.map((g) => g.id);
      const botUserIds = await prisma.gamePlayer.findMany({
        where: { gameId: { in: gameIds }, user: { isBot: true } },
        select: { userId: true },
      });
      const botIds = botUserIds.map((p) => p.userId);
      await prisma.gamePlayer.deleteMany({ where: { gameId: { in: gameIds } } });
      await prisma.game.deleteMany({ where: { roomId: { in: createdRoomIds } } });
      await prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } });
      if (botIds.length) {
        // Bots joined through the real `RoomsService.joinRoom` path, which
        // records a `CommandRequest` row keyed by userId (§19 idempotency)
        // — same FK this suite's own `createdUserIds` cleanup already has
        // to clear first, below.
        await prisma.commandRequest.deleteMany({ where: { userId: { in: botIds } } });
        await prisma.user.deleteMany({ where: { id: { in: botIds } } });
      }
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

  it('joins bots through the real RoomsService.joinRoom path — real game_players rows, PLAYER_JOINED broadcast per bot', async () => {
    const host = await makeUser();
    const room = await createValidRoom(host.id, 8);

    const result = await devTools.fillBots({ code: room.code, requesterUserId: host.id, count: 2, ready: false });

    expect(result.playerCount).toBe(3); // host + 2 bots
    expect(result.players).toHaveLength(3);

    const botPlayers = await prisma.gamePlayer.findMany({
      where: { gameId: room.gameId, user: { isBot: true } },
      include: { user: true },
    });
    expect(botPlayers).toHaveLength(2);
    expect(botPlayers.every((p) => p.user.isBot)).toBe(true);
    expect(botPlayers.every((p) => p.user.telegramId.startsWith('-'))).toBe(true);

    const joinedBroadcasts = realtime.broadcastToGame.mock.calls.filter(([, event]) => event === 'PLAYER_JOINED');
    expect(joinedBroadcasts).toHaveLength(2); // one real PLAYER_JOINED per bot, same as a real player
  });

  it('sets bots ready via the real RoomsService.setReady path when ready=true', async () => {
    const host = await makeUser();
    const room = await createValidRoom(host.id, 8);

    const result = await devTools.fillBots({ code: room.code, requesterUserId: host.id, count: 2, ready: true });

    expect(result.players!.filter((p) => p.playerId !== result.players!.find((x) => x.isHost)?.playerId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ isReady: true })]),
    );
    const botPlayers = await prisma.gamePlayer.findMany({
      where: { gameId: room.gameId, user: { isBot: true } },
    });
    expect(botPlayers.every((p) => p.isReady)).toBe(true);

    const readyBroadcasts = realtime.broadcastToGame.mock.calls.filter(
      ([, event]) => event === 'PLAYER_READY_CHANGED',
    );
    expect(readyBroadcasts).toHaveLength(2);
  });

  it('bots do NOT get set ready when ready is omitted/false', async () => {
    const host = await makeUser();
    const room = await createValidRoom(host.id, 8);

    await devTools.fillBots({ code: room.code, requesterUserId: host.id, count: 1, ready: false });

    const botPlayer = await prisma.gamePlayer.findFirstOrThrow({
      where: { gameId: room.gameId, user: { isBot: true } },
    });
    expect(botPlayer.isReady).toBe(false);
  });

  it('rejects with ForbiddenException (403) for a caller who is not an active member of the room', async () => {
    const host = await makeUser();
    const outsider = await makeUser();
    const room = await createValidRoom(host.id, 8);

    await expect(
      devTools.fillBots({ code: room.code, requesterUserId: outsider.id, count: 1, ready: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const botCount = await prisma.gamePlayer.count({ where: { gameId: room.gameId, user: { isBot: true } } });
    expect(botCount).toBe(0); // no bots created for a rejected call
  });

  it('caps count at the room\'s remaining capacity instead of erroring or overfilling', async () => {
    const host = await makeUser();
    const room = await createValidRoom(host.id, 4); // 1 seat taken by host, 3 remain

    const result = await devTools.fillBots({ code: room.code, requesterUserId: host.id, count: 10, ready: false });

    expect(result.playerCount).toBe(4); // capped at maxPlayers, not 11
    const botCount = await prisma.gamePlayer.count({ where: { gameId: room.gameId, user: { isBot: true } } });
    expect(botCount).toBe(3);
  });

  it('creates zero bots (no error) when the room is already full', async () => {
    const host = await makeUser();
    const room = await createValidRoom(host.id, 4); // engine floor — smallest legal maxPlayers
    const others = await Promise.all([makeUser(), makeUser(), makeUser()]);
    for (const other of others) {
      await rooms.joinRoom({ userId: other.id, code: room.code, clientRequestId: randomUUID() });
    }

    const result = await devTools.fillBots({ code: room.code, requesterUserId: host.id, count: 5, ready: false });

    expect(result.playerCount).toBe(4);
    const botCount = await prisma.gamePlayer.count({ where: { gameId: room.gameId, user: { isBot: true } } });
    expect(botCount).toBe(0);
  });

  it('names bots sequentially ("Bot N") continuing from the existing player count', async () => {
    const host = await makeUser();
    const room = await createValidRoom(host.id, 8);

    const result = await devTools.fillBots({ code: room.code, requesterUserId: host.id, count: 2, ready: false });

    const botNames = result
      .players!.filter((p) => p.displayName.startsWith('Bot'))
      .map((p) => p.displayName)
      .sort();
    expect(botNames).toEqual(['Bot 2', 'Bot 3']); // host is player 1
  });

  it('never leaks telegramId (bot or otherwise) anywhere in the response', async () => {
    const host = await makeUser();
    const room = await createValidRoom(host.id, 8);

    const result = await devTools.fillBots({ code: room.code, requesterUserId: host.id, count: 2, ready: true });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('telegramId');
    expect(serialized).not.toContain(host.telegramId);

    const botTelegramIds = await prisma.user.findMany({
      where: { gamePlayers: { some: { gameId: room.gameId } }, isBot: true },
      select: { telegramId: true },
    });
    for (const { telegramId } of botTelegramIds) {
      expect(serialized).not.toContain(telegramId);
    }
  });
});
