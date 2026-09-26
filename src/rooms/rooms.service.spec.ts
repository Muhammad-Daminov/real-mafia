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

  describe('listPublicRooms', () => {
    const makePublicRoom = async (
      userId: string,
      overrides: Partial<{ maxPlayers: number }> = {},
    ) => {
      const room = await createValidRoom(userId, {
        maxPlayers: overrides.maxPlayers ?? 4,
      });
      await prisma.room.update({
        where: { id: room.roomId },
        data: { visibility: 'PUBLIC' },
      });
      return room;
    };

    it('returns an empty page when there are no open public rooms', async () => {
      const page = await service.listPublicRooms({ page: 1, limit: 20 });

      expect(page.rooms).toEqual([]);
      expect(page.totalCount).toBe(0);
      expect(page.totalPages).toBe(0);
    });

    it('lists open public rooms with free slots, newest first, on a single page', async () => {
      const host = await makeUser();
      const first = await makePublicRoom(host.id);
      const second = await makePublicRoom(host.id);
      const third = await makePublicRoom(host.id);

      const page = await service.listPublicRooms({ page: 1, limit: 20 });

      expect(page.totalCount).toBe(3);
      expect(page.totalPages).toBe(1);
      expect(page.rooms.map((r) => r.roomId)).toEqual([
        third.roomId,
        second.roomId,
        first.roomId,
      ]);
      expect(page.rooms[0]).toMatchObject({
        roomId: third.roomId,
        code: third.code,
        maxPlayers: third.maxPlayers,
        rulesetMode: third.rulesetMode,
        playerCount: 1,
      });
    });

    it('never lists a PRIVATE room', async () => {
      const host = await makeUser();
      await createValidRoom(host.id); // PRIVATE by default — not made public

      const page = await service.listPublicRooms({ page: 1, limit: 20 });

      expect(page.rooms).toEqual([]);
      expect(page.totalCount).toBe(0);
    });

    it('paginates correctly across multiple pages with no gaps or overlaps', async () => {
      const host = await makeUser();
      const rooms: Awaited<ReturnType<typeof makePublicRoom>>[] = [];
      for (let i = 0; i < 5; i += 1) {
        rooms.push(await makePublicRoom(host.id));
      }
      const expectedOrder = [...rooms].reverse().map((r) => r.roomId);

      const page1 = await service.listPublicRooms({ page: 1, limit: 2 });
      const page2 = await service.listPublicRooms({ page: 2, limit: 2 });
      const page3 = await service.listPublicRooms({ page: 3, limit: 2 });

      expect(page1.totalCount).toBe(5);
      expect(page1.totalPages).toBe(3);
      expect(page1.rooms.map((r) => r.roomId)).toEqual(expectedOrder.slice(0, 2));
      expect(page2.rooms.map((r) => r.roomId)).toEqual(expectedOrder.slice(2, 4));
      expect(page3.rooms.map((r) => r.roomId)).toEqual(expectedOrder.slice(4, 5));

      const allIds = [...page1.rooms, ...page2.rooms, ...page3.rooms].map(
        (r) => r.roomId,
      );
      expect(new Set(allIds).size).toBe(5);
    });

    it('excludes a room whose game has left LOBBY', async () => {
      const host = await makeUser();
      const running = await makePublicRoom(host.id);
      await makePublicRoom(host.id);

      await prisma.game.update({
        where: { id: running.gameId },
        data: { status: 'RUNNING' },
      });

      const page = await service.listPublicRooms({ page: 1, limit: 20 });

      expect(page.totalCount).toBe(1);
      expect(page.rooms.map((r) => r.roomId)).not.toContain(running.roomId);
    });

    it('excludes a room that has no free slots', async () => {
      const host = await makeUser();
      const full = await makePublicRoom(host.id, { maxPlayers: 4 });
      const fillers = await Promise.all([makeUser(), makeUser(), makeUser()]);

      for (const filler of fillers) {
        await service.joinRoom({
          userId: filler.id,
          code: full.code,
          clientRequestId: randomUUID(),
        });
      }

      const page = await service.listPublicRooms({ page: 1, limit: 20 });

      expect(page.rooms.map((r) => r.roomId)).not.toContain(full.roomId);
    });

    it('excludes LEFT players from the displayed playerCount, freeing the room back up', async () => {
      const host = await makeUser();
      const room = await makePublicRoom(host.id, { maxPlayers: 4 });
      const fillers = await Promise.all([makeUser(), makeUser(), makeUser()]);

      for (const filler of fillers) {
        await service.joinRoom({
          userId: filler.id,
          code: room.code,
          clientRequestId: randomUUID(),
        });
      }

      // Room is now full (4/4) and should not be listed.
      let page = await service.listPublicRooms({ page: 1, limit: 20 });
      expect(page.rooms.map((r) => r.roomId)).not.toContain(room.roomId);

      await service.leaveRoom({
        userId: fillers[0].id,
        roomId: room.roomId,
        clientRequestId: randomUUID(),
      });

      page = await service.listPublicRooms({ page: 1, limit: 20 });
      const listed = page.rooms.find((r) => r.roomId === room.roomId);
      expect(listed).toBeDefined();
      expect(listed!.playerCount).toBe(3);
    });
  });

  describe('leaveRoom', () => {
    const leave = (userId: string, roomId: string) =>
      service.leaveRoom({ userId, roomId, clientRequestId: randomUUID() });

    it('sets the leaving player to LEFT and frees a slot for a new joiner', async () => {
      const host = await makeUser();
      const joiner = await makeUser();
      const backfill = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 4 });

      const joined = await service.joinRoom({
        userId: joiner.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });

      const left = await leave(joiner.id, room.roomId);

      expect(left.playerCount).toBe(1);
      expect(left.newHostPlayerId).toBeNull();
      expect(left.roomClosed).toBe(false);

      const player = await prisma.gamePlayer.findUniqueOrThrow({
        where: { id: joined.playerId },
      });
      expect(player.lifeStatus).toBe('LEFT');

      const backfilled = await service.joinRoom({
        userId: backfill.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });
      expect(backfilled.playerCount).toBe(2);
    });

    it('rejects ROOM_NOT_FOUND for an unknown room id', async () => {
      const user = await makeUser();

      await expect(leave(user.id, randomUUID())).rejects.toMatchObject({
        code: RoomErrorCode.ROOM_NOT_FOUND,
      });
    });

    it('rejects PLAYER_NOT_IN_GAME when the caller never joined', async () => {
      const host = await makeUser();
      const outsider = await makeUser();
      const room = await createValidRoom(host.id);

      await expect(leave(outsider.id, room.roomId)).rejects.toMatchObject({
        code: RoomErrorCode.PLAYER_NOT_IN_GAME,
      });
    });

    it('rejects PLAYER_NOT_IN_GAME on a second leave after already leaving', async () => {
      const host = await makeUser();
      const joiner = await makeUser();
      const room = await createValidRoom(host.id);

      await service.joinRoom({
        userId: joiner.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });
      await leave(joiner.id, room.roomId);

      await expect(leave(joiner.id, room.roomId)).rejects.toMatchObject({
        code: RoomErrorCode.PLAYER_NOT_IN_GAME,
      });
    });

    it('rejects ROOM_NOT_IN_LOBBY once the game has left LOBBY', async () => {
      const host = await makeUser();
      const room = await createValidRoom(host.id);

      await prisma.game.update({
        where: { id: room.gameId },
        data: { status: 'RUNNING' },
      });

      await expect(leave(host.id, room.roomId)).rejects.toMatchObject({
        code: RoomErrorCode.ROOM_NOT_IN_LOBBY,
      });
    });

    it('transfers host to the earliest-joined remaining player when the host leaves', async () => {
      const host = await makeUser();
      const earlier = await makeUser();
      const later = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 4 });

      await service.joinRoom({
        userId: earlier.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });
      await service.joinRoom({
        userId: later.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });

      const left = await leave(host.id, room.roomId);

      expect(left.roomClosed).toBe(false);
      expect(left.newHostPlayerId).not.toBeNull();

      const game = await prisma.game.findUniqueOrThrow({
        where: { id: room.gameId },
      });
      const newHost = await prisma.gamePlayer.findUniqueOrThrow({
        where: { id: game.hostPlayerId! },
      });
      expect(newHost.userId).toBe(earlier.id);
    });

    it('cancels the game and closes the room when the last player (host) leaves', async () => {
      const host = await makeUser();
      const room = await createValidRoom(host.id);

      const left = await leave(host.id, room.roomId);

      expect(left.roomClosed).toBe(true);
      expect(left.newHostPlayerId).toBeNull();
      expect(left.playerCount).toBe(0);

      const game = await prisma.game.findUniqueOrThrow({
        where: { id: room.gameId },
      });
      expect(game.status).toBe('CANCELLED');

      const persistedRoom = await prisma.room.findUniqueOrThrow({
        where: { id: room.roomId },
      });
      expect(persistedRoom.status).toBe('CLOSED');
    });

    it('replays the stored response for a repeated clientRequestId', async () => {
      const host = await makeUser();
      const joiner = await makeUser();
      const room = await createValidRoom(host.id);
      const clientRequestId = randomUUID();

      await service.joinRoom({
        userId: joiner.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });

      const first = await service.leaveRoom({
        userId: joiner.id,
        roomId: room.roomId,
        clientRequestId,
      });
      const second = await service.leaveRoom({
        userId: joiner.id,
        roomId: room.roomId,
        clientRequestId,
      });

      expect(second).toEqual(first);
    });

    it('under real concurrent leaves including the host, host-transfer never lands on a LEFT player', async () => {
      // A 2-leaver version of this race (host + one other, both leaving
      // concurrently) passed even with the FOR UPDATE lock deliberately
      // removed during test development — the race window is real (without
      // the lock, host-transfer can read a stale "still active" snapshot and
      // hand hostPlayerId to a player who is concurrently leaving in the same
      // instant), but two independent connections don't reliably overlap
      // enough in real wall-clock time to hit it. Higher contention — many
      // players leaving at once, one lone survivor — is what actually
      // exercises the lock, same lesson as the join-capacity and
      // host-transfer concurrency tests above.
      const LEAVER_COUNT = 9;
      const host = await makeUser();
      const survivor = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 12 });

      const others = await Promise.all(
        Array.from({ length: LEAVER_COUNT - 1 }, () => makeUser()),
      );

      // `others` join before `survivor` on purpose: this makes some of the
      // *leaving* players have earlier joinedAt than the one player who never
      // leaves, so an unserialized host-transfer read can plausibly pick a
      // concurrently-leaving "other" as next host instead of the survivor —
      // if it only ever picked the survivor regardless of timing, this test
      // couldn't distinguish locked from unlocked behavior.
      for (const other of [...others, survivor]) {
        await service.joinRoom({
          userId: other.id,
          code: room.code,
          clientRequestId: randomUUID(),
        });
      }

      const leavers = [host, ...others];
      const settled = await Promise.allSettled(
        leavers.map((leaver) => leave(leaver.id, room.roomId)),
      );

      expect(settled.every((r) => r.status === 'fulfilled')).toBe(true);

      const game = await prisma.game.findUniqueOrThrow({
        where: { id: room.gameId },
      });
      const finalHost = await prisma.gamePlayer.findUniqueOrThrow({
        where: { id: game.hostPlayerId! },
      });
      // The correctness property the lock protects: hostPlayerId must never
      // end up pointing at a player who has (or is concurrently) left.
      expect(finalHost.lifeStatus).not.toBe('LEFT');
      expect(finalHost.userId).toBe(survivor.id);

      const active = await prisma.gamePlayer.findMany({
        where: { gameId: room.gameId, lifeStatus: { not: 'LEFT' } },
      });
      expect(active).toHaveLength(1);
      expect(active[0].userId).toBe(survivor.id);
    });
  });

  describe('setReady', () => {
    it('sets the caller isReady flag', async () => {
      const host = await makeUser();
      const room = await createValidRoom(host.id);

      const result = await service.setReady({
        userId: host.id,
        roomId: room.roomId,
        clientRequestId: randomUUID(),
        isReady: true,
      });

      expect(result.isReady).toBe(true);

      const player = await prisma.gamePlayer.findUniqueOrThrow({
        where: { id: result.playerId },
      });
      expect(player.isReady).toBe(true);
    });

    it('rejects PLAYER_NOT_IN_GAME for a non-member', async () => {
      const host = await makeUser();
      const outsider = await makeUser();
      const room = await createValidRoom(host.id);

      await expect(
        service.setReady({
          userId: outsider.id,
          roomId: room.roomId,
          clientRequestId: randomUUID(),
          isReady: true,
        }),
      ).rejects.toMatchObject({ code: RoomErrorCode.PLAYER_NOT_IN_GAME });
    });

    it('rejects ROOM_NOT_IN_LOBBY once the game has left LOBBY', async () => {
      const host = await makeUser();
      const room = await createValidRoom(host.id);

      await prisma.game.update({
        where: { id: room.gameId },
        data: { status: 'RUNNING' },
      });

      await expect(
        service.setReady({
          userId: host.id,
          roomId: room.roomId,
          clientRequestId: randomUUID(),
          isReady: true,
        }),
      ).rejects.toMatchObject({ code: RoomErrorCode.ROOM_NOT_IN_LOBBY });
    });

    it('replays the stored response for a repeated clientRequestId', async () => {
      const host = await makeUser();
      const room = await createValidRoom(host.id);
      const clientRequestId = randomUUID();

      const first = await service.setReady({
        userId: host.id,
        roomId: room.roomId,
        clientRequestId,
        isReady: true,
      });
      const second = await service.setReady({
        userId: host.id,
        roomId: room.roomId,
        clientRequestId,
        isReady: true,
      });

      expect(second).toEqual(first);
    });

    it('under real concurrency, a ready-toggle racing with another player leaving leaves both operations consistent', async () => {
      const host = await makeUser();
      const joiner = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 4 });

      await service.joinRoom({
        userId: joiner.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });

      const [readyResult, leaveResult] = await Promise.all([
        service.setReady({
          userId: host.id,
          roomId: room.roomId,
          clientRequestId: randomUUID(),
          isReady: true,
        }),
        service.leaveRoom({
          userId: joiner.id,
          roomId: room.roomId,
          clientRequestId: randomUUID(),
        }),
      ]);

      expect(readyResult.isReady).toBe(true);
      expect(leaveResult.playerCount).toBe(1);

      const hostPlayer = await prisma.gamePlayer.findUniqueOrThrow({
        where: { id: readyResult.playerId },
      });
      expect(hostPlayer.isReady).toBe(true);

      const joinerPlayer = await prisma.gamePlayer.findUniqueOrThrow({
        where: { id: leaveResult.playerId },
      });
      expect(joinerPlayer.lifeStatus).toBe('LEFT');
    });
  });

  describe('transferHost', () => {
    it('transfers host to a specified target player', async () => {
      const host = await makeUser();
      const target = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 4 });

      const joined = await service.joinRoom({
        userId: target.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });

      const result = await service.transferHost({
        userId: host.id,
        roomId: room.roomId,
        clientRequestId: randomUUID(),
        targetPlayerId: joined.playerId,
      });

      expect(result.newHostPlayerId).toBe(joined.playerId);

      const game = await prisma.game.findUniqueOrThrow({
        where: { id: room.gameId },
      });
      expect(game.hostPlayerId).toBe(joined.playerId);
    });

    it('no-ops when the target is the caller themself', async () => {
      const host = await makeUser();
      const room = await createValidRoom(host.id);

      const game = await prisma.game.findUniqueOrThrow({
        where: { id: room.gameId },
      });

      const result = await service.transferHost({
        userId: host.id,
        roomId: room.roomId,
        clientRequestId: randomUUID(),
        targetPlayerId: game.hostPlayerId!,
      });

      expect(result.newHostPlayerId).toBe(game.hostPlayerId);
      expect(result.previousHostPlayerId).toBe(game.hostPlayerId);
    });

    it('rejects NOT_HOST when the caller is not the current host', async () => {
      const host = await makeUser();
      const nonHost = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 4 });

      const joined = await service.joinRoom({
        userId: nonHost.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });

      await expect(
        service.transferHost({
          userId: nonHost.id,
          roomId: room.roomId,
          clientRequestId: randomUUID(),
          targetPlayerId: joined.playerId,
        }),
      ).rejects.toMatchObject({ code: RoomErrorCode.NOT_HOST });
    });

    it('rejects TARGET_NOT_IN_GAME for an unknown target', async () => {
      const host = await makeUser();
      const room = await createValidRoom(host.id);

      await expect(
        service.transferHost({
          userId: host.id,
          roomId: room.roomId,
          clientRequestId: randomUUID(),
          targetPlayerId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: RoomErrorCode.TARGET_NOT_IN_GAME });
    });

    it('rejects TARGET_NOT_IN_GAME for a target who has already left', async () => {
      const host = await makeUser();
      const joiner = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 4 });

      const joined = await service.joinRoom({
        userId: joiner.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });
      await service.leaveRoom({
        userId: joiner.id,
        roomId: room.roomId,
        clientRequestId: randomUUID(),
      });

      await expect(
        service.transferHost({
          userId: host.id,
          roomId: room.roomId,
          clientRequestId: randomUUID(),
          targetPlayerId: joined.playerId,
        }),
      ).rejects.toMatchObject({ code: RoomErrorCode.TARGET_NOT_IN_GAME });
    });

    it('replays the stored response for a repeated clientRequestId', async () => {
      const host = await makeUser();
      const target = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 4 });
      const clientRequestId = randomUUID();

      const joined = await service.joinRoom({
        userId: target.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });

      const first = await service.transferHost({
        userId: host.id,
        roomId: room.roomId,
        clientRequestId,
        targetPlayerId: joined.playerId,
      });
      const second = await service.transferHost({
        userId: host.id,
        roomId: room.roomId,
        clientRequestId,
        targetPlayerId: joined.playerId,
      });

      expect(second).toEqual(first);
    });

    it('under real concurrent host-transfer requests from the same host, exactly one succeeds and the rest get NOT_HOST', async () => {
      // A 2-contender version of this race passed even with the FOR UPDATE
      // lock deliberately removed during test development (two independent
      // connections don't reliably overlap enough in real wall-clock time to
      // hit the race) — same lesson as the join-capacity concurrency test.
      // Higher contention is what actually exercises the lock.
      const CANDIDATE_COUNT = 10;
      const host = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 12 });

      const candidates = await Promise.all(
        Array.from({ length: CANDIDATE_COUNT }, () => makeUser()),
      );
      const joined: Awaited<ReturnType<typeof service.joinRoom>>[] = [];
      for (const candidate of candidates) {
        joined.push(
          await service.joinRoom({
            userId: candidate.id,
            code: room.code,
            clientRequestId: randomUUID(),
          }),
        );
      }

      const attempt = (targetPlayerId: string) =>
        service.transferHost({
          userId: host.id,
          roomId: room.roomId,
          clientRequestId: randomUUID(),
          targetPlayerId,
        });

      const settled = await Promise.allSettled(
        joined.map((j) => attempt(j.playerId)),
      );

      const fulfilled = settled.filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof attempt>>> =>
          r.status === 'fulfilled',
      );
      const rejected = settled.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(CANDIDATE_COUNT - 1);
      expect(
        rejected.every(
          (r) => (r.reason as RoomException).code === RoomErrorCode.NOT_HOST,
        ),
      ).toBe(true);

      const game = await prisma.game.findUniqueOrThrow({
        where: { id: room.gameId },
      });
      expect(game.hostPlayerId).toBe(fulfilled[0].value.newHostPlayerId);
    });
  });
});
