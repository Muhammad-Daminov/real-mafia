import 'dotenv/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CommandRequestService } from '../common/command-requests/command-request.service';
import { SchedulerService } from '../common/scheduling/scheduler.service';
import { RoleAssignmentService } from '../game-engine/role-assignment.service';
import { GameLifecycleService } from '../game-engine/game-lifecycle.service';
import { RealtimeEventService } from '../common/realtime/realtime-event.service';
import { RoomsService } from './rooms.service';
import { StaleLobbyCleanupService, STALE_LOBBY_CLEANUP_TASK_KIND } from './stale-lobby-cleanup.service';

/**
 * B-H1/OD-029: against a real PostgreSQL database (not mocked), same
 * convention `rooms.service.spec.ts` already established — this is
 * exactly the "does `leaveRoom`'s real transaction/invariants actually
 * cascade a room to CANCELLED/CLOSED" question a mock cannot answer.
 */
describe('StaleLobbyCleanupService (integration)', () => {
  const prisma = new PrismaService();
  const realtime: { broadcastToGame: jest.Mock; sendToPlayer: jest.Mock } = {
    broadcastToGame: jest.fn(),
    sendToPlayer: jest.fn(),
  };
  const roleAssignment = new RoleAssignmentService();
  const scheduler = new SchedulerService(prisma);
  const gameLifecycle = new GameLifecycleService(roleAssignment, scheduler);
  const commandRequests = new CommandRequestService();
  const rooms = new RoomsService(prisma, commandRequests, gameLifecycle, realtime as unknown as RealtimeEventService);
  const cleanup = new StaleLobbyCleanupService(prisma, scheduler, rooms);

  const TEST_TELEGRAM_PREFIX = 'stale-lobby-cleanup-test-';
  const originalThreshold = process.env.STALE_LOBBY_THRESHOLD_MINUTES;
  let createdUserIds: string[] = [];
  let createdRoomIds: string[] = [];
  let createdTaskIds: string[] = [];

  beforeAll(() => {
    // Fixed, small threshold so the test doesn't depend on the real
    // 120-minute default — "stale" here means "older than 10 minutes".
    process.env.STALE_LOBBY_THRESHOLD_MINUTES = '10';
  });

  afterAll(async () => {
    process.env.STALE_LOBBY_THRESHOLD_MINUTES = originalThreshold;
    await prisma.$disconnect();
  });

  afterEach(async () => {
    if (createdTaskIds.length) {
      await prisma.scheduledTask.deleteMany({ where: { id: { in: createdTaskIds } } });
    }
    if (createdRoomIds.length) {
      await prisma.gamePlayer.deleteMany({ where: { game: { roomId: { in: createdRoomIds } } } });
      await prisma.game.deleteMany({ where: { roomId: { in: createdRoomIds } } });
      await prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } });
    }
    if (createdUserIds.length) {
      await prisma.commandRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds = [];
    createdRoomIds = [];
    createdTaskIds = [];
  });

  const STALE_AT = () => new Date(Date.now() - 20 * 60_000); // 20min ago, older than the 10min threshold
  const FRESH_AT = () => new Date(Date.now() - 1 * 60_000); // 1min ago, well under the threshold

  const makeUser = async () => {
    const user = await prisma.user.create({
      data: { telegramId: `${TEST_TELEGRAM_PREFIX}${randomUUID()}`, firstName: 'Test' },
    });
    createdUserIds.push(user.id);
    return user;
  };

  /** Bypasses `RoomsService.createRoom`/`joinRoom` on purpose — this test
   * needs direct control over `createdAt`/`joinedAt`/`status` to simulate
   * staleness, which the real command path (correctly) always stamps with
   * "now". */
  const makeRoomWithPlayers = async (opts: {
    gameStatus: 'LOBBY' | 'RUNNING';
    gameCreatedAt: Date;
    hostUserId: string;
    players: { userId: string; joinedAt: Date }[];
  }) => {
    const room = await prisma.room.create({
      data: { code: randomUUID().slice(0, 6).toUpperCase(), maxPlayers: 10, creatorUserId: opts.hostUserId },
    });
    createdRoomIds.push(room.id);

    const game = await prisma.game.create({
      data: { roomId: room.id, status: opts.gameStatus, createdAt: opts.gameCreatedAt },
    });

    const createdPlayers: Awaited<ReturnType<typeof prisma.gamePlayer.create>>[] = [];
    for (const p of opts.players) {
      const player = await prisma.gamePlayer.create({
        data: { gameId: game.id, userId: p.userId, joinedAt: p.joinedAt, lifeStatus: 'ALIVE' },
      });
      createdPlayers.push(player);
    }

    const host = createdPlayers[0]!;
    await prisma.game.update({ where: { id: game.id }, data: { hostPlayerId: host.id } });
    await prisma.room.update({ where: { id: room.id }, data: { activeGameId: game.id } });

    return { room, game, players: createdPlayers };
  };

  it('cancels an idle LOBBY room (every player leaves, room closes) but leaves a fresh LOBBY room and a RUNNING game untouched', async () => {
    const staleHost = await makeUser();
    const staleGuest = await makeUser();
    const { room: staleRoom, game: staleGame } = await makeRoomWithPlayers({
      gameStatus: 'LOBBY',
      gameCreatedAt: STALE_AT(),
      hostUserId: staleHost.id,
      players: [
        { userId: staleHost.id, joinedAt: STALE_AT() },
        { userId: staleGuest.id, joinedAt: STALE_AT() },
      ],
    });

    const freshHost = await makeUser();
    const { room: freshRoom, game: freshGame } = await makeRoomWithPlayers({
      gameStatus: 'LOBBY',
      gameCreatedAt: FRESH_AT(),
      hostUserId: freshHost.id,
      players: [{ userId: freshHost.id, joinedAt: FRESH_AT() }],
    });

    const runningHost = await makeUser();
    const { game: runningGame } = await makeRoomWithPlayers({
      gameStatus: 'RUNNING',
      gameCreatedAt: STALE_AT(), // old, but RUNNING — must never be touched
      hostUserId: runningHost.id,
      players: [{ userId: runningHost.id, joinedAt: STALE_AT() }],
    });

    await cleanup.cancelStaleLobbies();

    const staleRoomAfter = await prisma.room.findUniqueOrThrow({ where: { id: staleRoom.id } });
    const staleGameAfter = await prisma.game.findUniqueOrThrow({ where: { id: staleGame.id } });
    const staleHostPlayer = await prisma.gamePlayer.findUniqueOrThrow({
      where: { gameId_userId: { gameId: staleGame.id, userId: staleHost.id } },
    });
    const staleGuestPlayer = await prisma.gamePlayer.findUniqueOrThrow({
      where: { gameId_userId: { gameId: staleGame.id, userId: staleGuest.id } },
    });
    expect(staleRoomAfter.status).toBe('CLOSED');
    expect(staleGameAfter.status).toBe('CANCELLED');
    expect(staleHostPlayer.lifeStatus).toBe('LEFT');
    expect(staleGuestPlayer.lifeStatus).toBe('LEFT');

    const freshRoomAfter = await prisma.room.findUniqueOrThrow({ where: { id: freshRoom.id } });
    const freshGameAfter = await prisma.game.findUniqueOrThrow({ where: { id: freshGame.id } });
    expect(freshRoomAfter.status).toBe('OPEN');
    expect(freshGameAfter.status).toBe('LOBBY');

    const runningGameAfter = await prisma.game.findUniqueOrThrow({ where: { id: runningGame.id } });
    expect(runningGameAfter.status).toBe('RUNNING');
  });

  it('is idempotent: calling cancelStaleLobbies twice on the same stale room does not error and leaves it correctly closed', async () => {
    const host = await makeUser();
    const guest = await makeUser();
    const { room, game } = await makeRoomWithPlayers({
      gameStatus: 'LOBBY',
      gameCreatedAt: STALE_AT(),
      hostUserId: host.id,
      players: [
        { userId: host.id, joinedAt: STALE_AT() },
        { userId: guest.id, joinedAt: STALE_AT() },
      ],
    });

    await cleanup.cancelStaleLobbies();
    await expect(cleanup.cancelStaleLobbies()).resolves.toBeUndefined(); // must not throw

    const roomAfter = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    const gameAfter = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(roomAfter.status).toBe('CLOSED');
    expect(gameAfter.status).toBe('CANCELLED');
  });

  it('does not sweep a LOBBY room whose room/game is old but someone joined within the threshold window', async () => {
    const host = await makeUser();
    const recentJoiner = await makeUser();
    const { game } = await makeRoomWithPlayers({
      gameStatus: 'LOBBY',
      gameCreatedAt: STALE_AT(), // room itself is old
      hostUserId: host.id,
      players: [
        { userId: host.id, joinedAt: STALE_AT() },
        { userId: recentJoiner.id, joinedAt: FRESH_AT() }, // but someone just joined
      ],
    });

    await cleanup.cancelStaleLobbies();

    const gameAfter = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(gameAfter.status).toBe('LOBBY'); // untouched — not actually idle
  });

  it('runSweep reschedules itself — a future PENDING task of the same kind exists afterward', async () => {
    scheduler.registerHandler(STALE_LOBBY_CLEANUP_TASK_KIND, async () => {}); // OD-057: claim() needs a registered handler to even look

    const before = Date.now();
    await cleanup.runSweep();

    const pending = await prisma.scheduledTask.findMany({
      where: { kind: STALE_LOBBY_CLEANUP_TASK_KIND, status: 'PENDING', runAt: { gt: new Date(before) } },
    });
    createdTaskIds.push(...pending.map((t) => t.id));

    expect(pending.length).toBeGreaterThanOrEqual(1);
  });

  it('logAbandonedRunningGames resolves without throwing and never mutates anything (connectionStatus is never written anywhere today, so the count is always 0 — see OPEN_DECISIONS.md)', async () => {
    const host = await makeUser();
    const { game } = await makeRoomWithPlayers({
      gameStatus: 'RUNNING',
      gameCreatedAt: STALE_AT(),
      hostUserId: host.id,
      players: [{ userId: host.id, joinedAt: STALE_AT() }],
    });

    await expect(cleanup.logAbandonedRunningGames()).resolves.toBeUndefined();

    const gameAfter = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(gameAfter.status).toBe('RUNNING'); // "do not act" — confirmed unchanged
  });
});
