import 'dotenv/config';
import { randomUUID } from 'crypto';
import { RulesetMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommandRequestService } from '../common/command-requests/command-request.service';
import { RoomsService } from './rooms.service';
import { RoomErrorCode, RoomException } from './rooms.errors';

/**
 * F-04's follow-on slice (docs/audit/GAP_REPORT.md) / Master TZ §15.1-15.2,
 * §19, §22.1. Runs against a real PostgreSQL database — not mocked — because
 * the whole point of this slice is the `SELECT games FOR UPDATE` row-lock
 * discipline, which a mock cannot exercise.
 */
describe('RoomsService (integration)', () => {
  const prisma = new PrismaService();
  const commandRequests = new CommandRequestService();
  const service = new RoomsService(prisma, commandRequests);

  const TEST_TELEGRAM_PREFIX = 'rooms-test-';
  let createdUserIds: string[] = [];
  let createdRoomIds: string[] = [];

  const makeUser = async () => {
    const user = await prisma.user.create({
      data: {
        telegramId: `${TEST_TELEGRAM_PREFIX}${randomUUID()}`,
        firstName: 'Test',
      },
    });
    createdUserIds.push(user.id);
    return user;
  };

  const createValidRoom = async (
    userId: string,
    overrides: Partial<{ maxPlayers: number; rulesetMode: RulesetMode }> = {},
  ) => {
    const room = await service.createRoom({
      userId,
      clientRequestId: randomUUID(),
      maxPlayers: overrides.maxPlayers ?? 4,
      rulesetMode: overrides.rulesetMode ?? RulesetMode.NORMAL,
    });
    createdRoomIds.push(room.roomId);
    return room;
  };

  afterEach(async () => {
    if (createdRoomIds.length) {
      await prisma.gamePlayer.deleteMany({
        where: { game: { roomId: { in: createdRoomIds } } },
      });
      await prisma.game.deleteMany({
        where: { roomId: { in: createdRoomIds } },
      });
      await prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } });
    }

    if (createdUserIds.length) {
      await prisma.commandRequest.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }

    createdRoomIds = [];
    createdUserIds = [];
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('createRoom', () => {
    it('creates a Room + first Game (LOBBY) and seats the creator as host', async () => {
      const host = await makeUser();

      const room = await createValidRoom(host.id, {
        maxPlayers: 6,
        rulesetMode: RulesetMode.FAST,
      });

      expect(room.code).toMatch(/^[23456789A-HJ-NP-Z]{6}$/);
      expect(room.maxPlayers).toBe(6);
      expect(room.rulesetMode).toBe(RulesetMode.FAST);

      const game = await prisma.game.findUniqueOrThrow({
        where: { id: room.gameId },
        include: { host: true, players: true },
      });

      expect(game.status).toBe('LOBBY');
      expect(game.players).toHaveLength(1);
      expect(game.host?.userId).toBe(host.id);
      expect(game.players[0].userId).toBe(host.id);

      const persistedRoom = await prisma.room.findUniqueOrThrow({
        where: { id: room.roomId },
      });
      expect(persistedRoom.activeGameId).toBe(room.gameId);
    });

    it('replays the stored response for a repeated clientRequestId instead of creating a second room', async () => {
      const host = await makeUser();
      const clientRequestId = randomUUID();

      const first = await service.createRoom({
        userId: host.id,
        clientRequestId,
        maxPlayers: 5,
        rulesetMode: RulesetMode.NORMAL,
      });
      createdRoomIds.push(first.roomId);

      const second = await service.createRoom({
        userId: host.id,
        clientRequestId,
        maxPlayers: 5,
        rulesetMode: RulesetMode.NORMAL,
      });

      expect(second).toEqual(first);

      const roomCount = await prisma.room.count({
        where: { creatorUserId: host.id },
      });
      expect(roomCount).toBe(1);
    });

    it('under two real concurrent requests with the same clientRequestId, exactly one Room is created and both responses are identical', async () => {
      const host = await makeUser();
      const clientRequestId = randomUUID();

      const attempt = () =>
        service.createRoom({
          userId: host.id,
          clientRequestId,
          maxPlayers: 6,
          rulesetMode: RulesetMode.NORMAL,
        });

      const [first, second] = await Promise.all([attempt(), attempt()]);
      createdRoomIds.push(first.roomId);

      expect(second).toEqual(first);

      const roomCount = await prisma.room.count({
        where: { creatorUserId: host.id },
      });
      expect(roomCount).toBe(1);
    });

    it('rejects HOST_ALREADY_HOSTING when the user already hosts an IN_PROGRESS room', async () => {
      const host = await makeUser();
      const running = await createValidRoom(host.id);

      // No slice yet transitions a Room to IN_PROGRESS (that's StartGame,
      // later phase) — force the state directly to exercise this guard.
      await prisma.room.update({
        where: { id: running.roomId },
        data: { status: 'IN_PROGRESS' },
      });

      await expect(
        service.createRoom({
          userId: host.id,
          clientRequestId: randomUUID(),
          maxPlayers: 4,
          rulesetMode: RulesetMode.NORMAL,
        }),
      ).rejects.toMatchObject({ code: RoomErrorCode.HOST_ALREADY_HOSTING });
    });
  });

  describe('getRoomByCode', () => {
    it('resolves an open room by its code', async () => {
      const host = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 8 });

      const summary = await service.getRoomByCode(room.code);

      expect(summary.roomId).toBe(room.roomId);
      expect(summary.maxPlayers).toBe(8);
      expect(summary.playerCount).toBe(1);
      expect(summary.gameStatus).toBe('LOBBY');
    });

    it('rejects ROOM_NOT_FOUND for an unknown code', async () => {
      await expect(service.getRoomByCode('ZZZZZZ')).rejects.toMatchObject({
        code: RoomErrorCode.ROOM_NOT_FOUND,
      });
    });

    it('treats a CLOSED room as not found', async () => {
      const host = await makeUser();
      const room = await createValidRoom(host.id);

      await prisma.room.update({
        where: { id: room.roomId },
        data: { status: 'CLOSED' },
      });

      await expect(service.getRoomByCode(room.code)).rejects.toMatchObject({
        code: RoomErrorCode.ROOM_NOT_FOUND,
      });
    });
  });

  describe('joinRoom', () => {
    it('seats a second player and increments playerCount', async () => {
      const host = await makeUser();
      const joiner = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 4 });

      const result = await service.joinRoom({
        userId: joiner.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });

      expect(result.playerCount).toBe(2);

      const players = await prisma.gamePlayer.findMany({
        where: { gameId: room.gameId },
      });
      expect(players).toHaveLength(2);
      expect(players.map((p) => p.userId)).toContain(joiner.id);
    });

    it('rejects ROOM_NOT_FOUND for an unknown code', async () => {
      const joiner = await makeUser();

      await expect(
        service.joinRoom({
          userId: joiner.id,
          code: 'ZZZZZZ',
          clientRequestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: RoomErrorCode.ROOM_NOT_FOUND });
    });

    it('rejects GAME_NOT_JOINABLE once the game has left LOBBY', async () => {
      const host = await makeUser();
      const joiner = await makeUser();
      const room = await createValidRoom(host.id);

      await prisma.game.update({
        where: { id: room.gameId },
        data: { status: 'RUNNING' },
      });

      await expect(
        service.joinRoom({
          userId: joiner.id,
          code: room.code,
          clientRequestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: RoomErrorCode.GAME_NOT_JOINABLE });
    });

    it('replays the stored response for a repeated clientRequestId instead of joining twice', async () => {
      const host = await makeUser();
      const joiner = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 4 });
      const clientRequestId = randomUUID();

      const first = await service.joinRoom({
        userId: joiner.id,
        code: room.code,
        clientRequestId,
      });

      const second = await service.joinRoom({
        userId: joiner.id,
        code: room.code,
        clientRequestId,
      });

      expect(second).toEqual(first);

      const players = await prisma.gamePlayer.findMany({
        where: { gameId: room.gameId },
      });
      expect(players).toHaveLength(2);
    });

    it('under two real concurrent requests with the same clientRequestId, exactly one join is recorded and both responses are identical', async () => {
      const host = await makeUser();
      const joiner = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 4 });
      const clientRequestId = randomUUID();

      const attempt = () =>
        service.joinRoom({ userId: joiner.id, code: room.code, clientRequestId });

      const [first, second] = await Promise.all([attempt(), attempt()]);

      expect(second).toEqual(first);

      const players = await prisma.gamePlayer.findMany({
        where: { gameId: room.gameId, userId: joiner.id },
      });
      expect(players).toHaveLength(1);
    });

    it('rejects PLAYER_ALREADY_JOINED when the same player retries with a different clientRequestId', async () => {
      const host = await makeUser();
      const joiner = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 4 });

      await service.joinRoom({
        userId: joiner.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });

      await expect(
        service.joinRoom({
          userId: joiner.id,
          code: room.code,
          clientRequestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: RoomErrorCode.PLAYER_ALREADY_JOINED });

      const players = await prisma.gamePlayer.findMany({
        where: { gameId: room.gameId, userId: joiner.id },
      });
      expect(players).toHaveLength(1);
    });

    it('rejects GAME_FULL once the game is at capacity', async () => {
      const host = await makeUser();
      const filler1 = await makeUser();
      const filler2 = await makeUser();
      const filler3 = await makeUser();
      const joiner = await makeUser();
      // maxPlayers: 4 (the schema's floor) -> host + 3 fillers fills it exactly.
      const room = await createValidRoom(host.id, { maxPlayers: 4 });

      for (const filler of [filler1, filler2, filler3]) {
        await service.joinRoom({
          userId: filler.id,
          code: room.code,
          clientRequestId: randomUUID(),
        });
      }

      await expect(
        service.joinRoom({
          userId: joiner.id,
          code: room.code,
          clientRequestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: RoomErrorCode.GAME_FULL });
    });

    it(
      'under real concurrent requests for the last slot, exactly one join succeeds and the rest get GAME_FULL',
      async () => {
        const CONTENDER_COUNT = 10;
        const host = await makeUser();
        // maxPlayers: 24 (the schema's ceiling) -> fill 23 seats, leaving
        // exactly one slot. A high contender count against a wide-open race
        // window is what makes this test actually exercise the lock: with
        // only two contenders, two independent connections frequently don't
        // overlap enough in real wall-clock time to hit the race at all, so
        // the test would pass "by luck" whether or not the lock exists.
        const fillers = await Promise.all(
          Array.from({ length: 22 }, () => makeUser()),
        );
        const contenders = await Promise.all(
          Array.from({ length: CONTENDER_COUNT }, () => makeUser()),
        );
        const room = await createValidRoom(host.id, { maxPlayers: 24 });

        for (const filler of fillers) {
          await service.joinRoom({
            userId: filler.id,
            code: room.code,
            clientRequestId: randomUUID(),
          });
        }

        const attempt = (userId: string) =>
          service.joinRoom({
            userId,
            code: room.code,
            clientRequestId: randomUUID(),
          });

        const settled = await Promise.allSettled(
          contenders.map((c) => attempt(c.id)),
        );

        const fulfilled = settled.filter(
          (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof attempt>>> =>
            r.status === 'fulfilled',
        );
        const rejected = settled.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(CONTENDER_COUNT - 1);
        expect(fulfilled[0].value.playerCount).toBe(24);
        expect(
          rejected.every(
            (r) => (r.reason as RoomException).code === RoomErrorCode.GAME_FULL,
          ),
        ).toBe(true);

        // The database, not just the responses, must reflect exactly 24
        // seats (host + 22 fillers + the one winning contender) — never 25.
        const players = await prisma.gamePlayer.findMany({
          where: { gameId: room.gameId },
        });
        expect(players).toHaveLength(24);
      },
      30000,
    );
  });
});
