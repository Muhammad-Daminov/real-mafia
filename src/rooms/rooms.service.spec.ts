import 'dotenv/config';
import { randomUUID } from 'crypto';
import { RoomVisibility, RulesetMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommandRequestService } from '../common/command-requests/command-request.service';
import { RoleAssignmentService } from '../game-engine/role-assignment.service';
import { GameLifecycleService } from '../game-engine/game-lifecycle.service';
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
  const roleAssignment = new RoleAssignmentService();
  const gameLifecycle = new GameLifecycleService(roleAssignment);
  const service = new RoomsService(prisma, commandRequests, gameLifecycle);

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
    overrides: Partial<{
      maxPlayers: number;
      rulesetMode: RulesetMode;
      visibility: RoomVisibility;
    }> = {},
  ) => {
    const room = await service.createRoom({
      userId,
      clientRequestId: randomUUID(),
      maxPlayers: overrides.maxPlayers ?? 4,
      rulesetMode: overrides.rulesetMode ?? RulesetMode.NORMAL,
      visibility: overrides.visibility ?? RoomVisibility.PRIVATE,
    });
    createdRoomIds.push(room.roomId);
    return room;
  };

  afterEach(async () => {
    if (createdRoomIds.length) {
      await prisma.gameRoleAssignment.deleteMany({
        where: { game: { roomId: { in: createdRoomIds } } },
      });
      await prisma.gamePhase.deleteMany({
        where: { game: { roomId: { in: createdRoomIds } } },
      });
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

    it('defaults to PRIVATE visibility when omitted (OD-039)', async () => {
      const host = await makeUser();

      const room = await service.createRoom({
        userId: host.id,
        clientRequestId: randomUUID(),
        maxPlayers: 4,
        rulesetMode: RulesetMode.NORMAL,
      });
      createdRoomIds.push(room.roomId);

      expect(room.visibility).toBe('PRIVATE');

      const persisted = await prisma.room.findUniqueOrThrow({
        where: { id: room.roomId },
      });
      expect(persisted.visibility).toBe('PRIVATE');
    });

    it('creates a PUBLIC room when visibility is explicitly requested', async () => {
      const host = await makeUser();

      const room = await createValidRoom(host.id, {
        visibility: RoomVisibility.PUBLIC,
      });

      expect(room.visibility).toBe('PUBLIC');

      const persisted = await prisma.room.findUniqueOrThrow({
        where: { id: room.roomId },
      });
      expect(persisted.visibility).toBe('PUBLIC');
    });

    describe('room code collision retry', () => {
      // Seam: spy on the existing private randomCode() method rather than
      // adding any constructor injection or test-only branch to production
      // code — production randomness (crypto.randomInt) is untouched: the
      // spy only controls which of the 5 attempts collide, the actual
      // uniqueness collision below is a real DB constraint violation
      // (rooms_code_unique_while_open), not a simulated one.
      afterEach(() => {
        jest.restoreAllMocks();
      });

      it('retries past a collision and succeeds within the 5-attempt budget', async () => {
        const host = await makeUser();
        const collidingCode = 'COLIDE';

        const seed = await prisma.room.create({
          data: { code: collidingCode, maxPlayers: 4, creatorUserId: host.id },
        });
        createdRoomIds.push(seed.id);

        const spy = jest
          .spyOn(service as unknown as { randomCode: () => string }, 'randomCode')
          .mockReturnValueOnce(collidingCode) // attempt 1: collides with the seed
          .mockReturnValueOnce(collidingCode) // attempt 2: collides again
          .mockReturnValueOnce('FREEC1'); // attempt 3: succeeds

        const room = await createValidRoom(host.id);

        expect(spy).toHaveBeenCalledTimes(3);
        expect(room.code).toBe('FREEC1');
      });

      it('fails after exhausting all 5 attempts rather than retrying forever', async () => {
        const host = await makeUser();
        const collidingCode = 'STUCK1';

        const seed = await prisma.room.create({
          data: { code: collidingCode, maxPlayers: 4, creatorUserId: host.id },
        });
        createdRoomIds.push(seed.id);

        const spy = jest
          .spyOn(service as unknown as { randomCode: () => string }, 'randomCode')
          .mockReturnValue(collidingCode); // every attempt collides

        await expect(
          service.createRoom({
            userId: host.id,
            clientRequestId: randomUUID(),
            maxPlayers: 4,
            rulesetMode: RulesetMode.NORMAL,
            visibility: RoomVisibility.PRIVATE,
          }),
        ).rejects.toMatchObject({ code: 'P2002' });

        // Exactly 5 attempts — the documented budget, not an infinite loop.
        expect(spy).toHaveBeenCalledTimes(5);

        // No orphaned room was created by the failed attempts.
        const roomCount = await prisma.room.count({
          where: { creatorUserId: host.id, code: { not: collidingCode } },
        });
        expect(roomCount).toBe(0);
      });
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

    it('rejects PLAYER_ALREADY_JOINED for a player who already left, not some other code (OD-021 default: re-join prohibited)', async () => {
      const host = await makeUser();
      const joiner = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 4 });

      await service.joinRoom({
        userId: joiner.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });

      await service.leaveRoom({
        userId: joiner.id,
        roomId: room.roomId,
        clientRequestId: randomUUID(),
      });

      const left = await prisma.gamePlayer.findUniqueOrThrow({
        where: { gameId_userId: { gameId: room.gameId, userId: joiner.id } },
      });
      expect(left.lifeStatus).toBe('LEFT');

      await expect(
        service.joinRoom({
          userId: joiner.id,
          code: room.code,
          clientRequestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: RoomErrorCode.PLAYER_ALREADY_JOINED });

      // Confirms it's rejected, not silently re-activated: still exactly one
      // GamePlayer row for this user, still LEFT.
      const players = await prisma.gamePlayer.findMany({
        where: { gameId: room.gameId, userId: joiner.id },
      });
      expect(players).toHaveLength(1);
      expect(players[0].lifeStatus).toBe('LEFT');
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
        visibility: RoomVisibility.PUBLIC,
      });
      return room;
    };

    it('is reachable end-to-end through the real create endpoint: a PUBLIC room created via createRoom appears, a PRIVATE one does not', async () => {
      const host = await makeUser();

      const publicRoom = await service.createRoom({
        userId: host.id,
        clientRequestId: randomUUID(),
        maxPlayers: 4,
        rulesetMode: RulesetMode.NORMAL,
        visibility: RoomVisibility.PUBLIC,
      });
      createdRoomIds.push(publicRoom.roomId);

      const privateRoom = await service.createRoom({
        userId: host.id,
        clientRequestId: randomUUID(),
        maxPlayers: 4,
        rulesetMode: RulesetMode.NORMAL,
        visibility: RoomVisibility.PRIVATE,
      });
      createdRoomIds.push(privateRoom.roomId);

      const page = await service.listPublicRooms({ page: 1, limit: 20 });
      const roomIds = page.rooms.map((r) => r.roomId);

      expect(roomIds).toContain(publicRoom.roomId);
      expect(roomIds).not.toContain(privateRoom.roomId);
    });

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

  describe('startGame', () => {
    const start = (userId: string, roomId: string) =>
      service.startGame({ userId, roomId, clientRequestId: randomUUID() });

    it('rejects ROOM_NOT_FOUND for an unknown room id', async () => {
      const host = await makeUser();

      await expect(start(host.id, randomUUID())).rejects.toMatchObject({
        code: RoomErrorCode.ROOM_NOT_FOUND,
      });
    });

    it('rejects NOT_HOST when the caller is not the current host', async () => {
      const host = await makeUser();
      const nonHost = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 6 });

      await service.joinRoom({
        userId: nonHost.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });

      await expect(start(nonHost.id, room.roomId)).rejects.toMatchObject({
        code: RoomErrorCode.NOT_HOST,
      });
    });

    it('rejects NOT_ENOUGH_PLAYERS below the 4-player floor (OD-040)', async () => {
      const host = await makeUser();
      const second = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 6 });

      await service.joinRoom({
        userId: second.id,
        code: room.code,
        clientRequestId: randomUUID(),
      });
      // host + second = 2, below MIN_PLAYERS_TO_START (4).

      await expect(start(host.id, room.roomId)).rejects.toMatchObject({
        code: RoomErrorCode.NOT_ENOUGH_PLAYERS,
      });
    });

    it('rejects CONFIG_INVALID when the seated count has no §13.1 row (forced via a direct DB seam — unreachable through the real API)', async () => {
      // §13.1's table covers exactly 4-24, and every reachable seated count
      // is already bounded to that range by NOT_ENOUGH_PLAYERS (>= 4) and by
      // join's capacity check (<= room.maxPlayers <= 24, enforced since the
      // create/join slice). So this condition can never actually fire through
      // POST /rooms/:id/start today — it's defense-in-depth, not a live gap.
      // To exercise the rejection path itself, seed player rows directly
      // (bypassing join's capacity check entirely) to push the seated count
      // to 25, one past the table's ceiling.
      const host = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 24 });
      const extraUsers = await Promise.all(
        Array.from({ length: 24 }, () => makeUser()),
      );

      await prisma.gamePlayer.createMany({
        data: extraUsers.map((u) => ({
          gameId: room.gameId,
          userId: u.id,
          lifeStatus: 'WAITING',
        })),
      });

      const seatedCount = await prisma.gamePlayer.count({
        where: { gameId: room.gameId, lifeStatus: { not: 'LEFT' } },
      });
      expect(seatedCount).toBe(25); // host + 24 seeded — one past the table's ceiling

      await expect(start(host.id, room.roomId)).rejects.toMatchObject({
        code: RoomErrorCode.CONFIG_INVALID,
      });

      const game = await prisma.game.findUniqueOrThrow({
        where: { id: room.gameId },
      });
      expect(game.status).toBe('LOBBY'); // rejected before any transition
    });

    it('does NOT require all players to be ready (OD-014 — display-only)', async () => {
      const host = await makeUser();
      const others = await Promise.all([makeUser(), makeUser(), makeUser()]);
      const room = await createValidRoom(host.id, { maxPlayers: 6 });

      for (const other of others) {
        await service.joinRoom({
          userId: other.id,
          code: room.code,
          clientRequestId: randomUUID(),
        });
      }
      // Nobody, including the host, ever called setReady — all isReady=false.

      const result = await start(host.id, room.roomId);

      expect(result.status).toBe('RUNNING');
    });

    it('rejects ROOM_NOT_IN_LOBBY when the game already started', async () => {
      const host = await makeUser();
      const others = await Promise.all([makeUser(), makeUser(), makeUser()]);
      const room = await createValidRoom(host.id, { maxPlayers: 6 });

      for (const other of others) {
        await service.joinRoom({
          userId: other.id,
          code: room.code,
          clientRequestId: randomUUID(),
        });
      }

      await start(host.id, room.roomId);

      await expect(start(host.id, room.roomId)).rejects.toMatchObject({
        code: RoomErrorCode.ROOM_NOT_IN_LOBBY,
      });
    });

    it('rejects ROOM_NOT_IN_LOBBY when the game was cancelled', async () => {
      const host = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 6 });

      await prisma.game.update({
        where: { id: room.gameId },
        data: { status: 'CANCELLED' },
      });

      await expect(start(host.id, room.roomId)).rejects.toMatchObject({
        code: RoomErrorCode.ROOM_NOT_IN_LOBBY,
      });
    });

    it('rejects cleanly (not a crash) when starting a room the host emptied to cancellation via leave (hostPlayerId is null)', async () => {
      // Reproduces the exact sequence from the leave/host-transfer slice:
      // the last player (host) leaves an empty lobby -> Game.status becomes
      // CANCELLED, Game.hostPlayerId becomes null, AND Room.status becomes
      // CLOSED (§8.5's mapping: CLOSED = last game FINISHED/CANCELLED and no
      // new game started).
      //
      // Turns out the short-circuit that fires first isn't ROOM_NOT_IN_LOBBY
      // (the lock/status check inside the transaction) — it's ROOM_NOT_FOUND,
      // one step earlier: resolveOpenRoomById excludes CLOSED rooms before
      // the transaction/lock is ever opened, so the hostPlayerId read is
      // unreachable regardless. Confirmed by running this test before writing
      // the assertion below, not assumed — the original expectation
      // (ROOM_NOT_IN_LOBBY) was wrong; corrected to match actual behavior
      // rather than forcing the test to match the assumption. Either way,
      // the outcome is the same property this test exists to confirm: a
      // clean, already-named rejection, never a null-reference crash.
      const host = await makeUser();
      const room = await createValidRoom(host.id, { maxPlayers: 6 });

      const left = await service.leaveRoom({
        userId: host.id,
        roomId: room.roomId,
        clientRequestId: randomUUID(),
      });
      expect(left.roomClosed).toBe(true);

      const game = await prisma.game.findUniqueOrThrow({
        where: { id: room.gameId },
      });
      expect(game.status).toBe('CANCELLED');
      expect(game.hostPlayerId).toBeNull();

      const persistedRoom = await prisma.room.findUniqueOrThrow({
        where: { id: room.roomId },
      });
      expect(persistedRoom.status).toBe('CLOSED');

      await expect(start(host.id, room.roomId)).rejects.toMatchObject({
        code: RoomErrorCode.ROOM_NOT_FOUND,
      });
    });

    it('transitions status/phase, seats players ALIVE, freezes config, and flips the room to IN_PROGRESS', async () => {
      const host = await makeUser();
      const others = await Promise.all([makeUser(), makeUser(), makeUser()]);
      const room = await createValidRoom(host.id, { maxPlayers: 8 });

      for (const other of others) {
        await service.joinRoom({
          userId: other.id,
          code: room.code,
          clientRequestId: randomUUID(),
        });
      }

      const before = new Date();
      const result = await start(host.id, room.roomId);
      const after = new Date();

      expect(result.status).toBe('RUNNING');
      expect(result.currentPhase).toBe('ROLE_REVEAL');
      expect(result.playerCount).toBe(4);
      expect(result.rulesVersion).toBe('6.0.0');
      const startedAt = new Date(result.startedAt);
      expect(startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(startedAt.getTime()).toBeLessThanOrEqual(after.getTime());

      const game = await prisma.game.findUniqueOrThrow({
        where: { id: room.gameId },
      });
      expect(game.status).toBe('RUNNING');
      expect(game.currentPhase).toBe('ROLE_REVEAL');
      expect(game.rulesVersion).toBe('6.0.0');
      expect(game.startedAt).not.toBeNull();

      const snapshot = game.configSnapshot as Record<string, unknown>;
      expect(snapshot.minPlayers).toBe(4);
      expect(snapshot.maxPlayers).toBe(24);
      expect(snapshot.lastWordEnabled).toBe(true); // NORMAL mode
      expect(snapshot.roleDistribution).toMatchObject({
        mafia: 1,
        don: 0,
        detective: 0,
        sheriff: 0,
        doctor: 1,
        bodyguard: 0,
        maniac: 0,
        journalist: 0,
        civilian: 2,
      });
      expect(snapshot.phaseDurationsSec).toMatchObject({
        ROLE_REVEAL: 15,
        NIGHT: 45,
        MORNING: 15,
        LAST_WORD: 20,
      });

      const players = await prisma.gamePlayer.findMany({
        where: { gameId: room.gameId },
      });
      expect(players).toHaveLength(4);
      expect(players.every((p) => p.lifeStatus === 'ALIVE')).toBe(true);

      const persistedRoom = await prisma.room.findUniqueOrThrow({
        where: { id: room.roomId },
      });
      expect(persistedRoom.status).toBe('IN_PROGRESS');

      // Slice 2: roles are dealt atomically with the same transition.
      const assignments = await prisma.gameRoleAssignment.findMany({
        where: { gameId: room.gameId },
      });
      expect(assignments).toHaveLength(4);
      expect(new Set(assignments.map((a) => a.playerId)).size).toBe(4);
      expect(assignments.map((a) => a.playerId).sort()).toEqual(
        players.map((p) => p.id).sort(),
      );
      expect(assignments.map((a) => a.roleCode).sort()).toEqual(
        ['CIVILIAN', 'CIVILIAN', 'DOCTOR', 'MAFIA'].sort(),
      );
    });

    it.each([4, 8, 24])(
      'deals exactly one role per player for a %i-player game, multiset matching configSnapshot.roleDistribution exactly',
      async (playerCount) => {
        const host = await makeUser();
        const others = await Promise.all(
          Array.from({ length: playerCount - 1 }, () => makeUser()),
        );
        const room = await createValidRoom(host.id, { maxPlayers: 24 });

        for (const other of others) {
          await service.joinRoom({
            userId: other.id,
            code: room.code,
            clientRequestId: randomUUID(),
          });
        }

        await start(host.id, room.roomId);

        const game = await prisma.game.findUniqueOrThrow({
          where: { id: room.gameId },
        });
        const roleDistribution = (game.configSnapshot as Record<string, unknown>)
          .roleDistribution as Record<string, number>;

        const players = await prisma.gamePlayer.findMany({
          where: { gameId: room.gameId },
        });
        const assignments = await prisma.gameRoleAssignment.findMany({
          where: { gameId: room.gameId },
        });

        // Uniqueness: every seated player has exactly one role, no omissions,
        // no duplicates.
        expect(assignments).toHaveLength(playerCount);
        expect(new Set(assignments.map((a) => a.playerId)).size).toBe(
          playerCount,
        );
        expect(assignments.map((a) => a.playerId).sort()).toEqual(
          players.map((p) => p.id).sort(),
        );

        // Distribution correctness: the dealt multiset matches the frozen
        // configSnapshot.roleDistribution exactly, per-role.
        const dealtCounts: Record<string, number> = {};
        for (const a of assignments) {
          dealtCounts[a.roleCode] = (dealtCounts[a.roleCode] ?? 0) + 1;
        }

        const roleKeyToCode: Record<string, string> = {
          mafia: 'MAFIA',
          don: 'DON',
          detective: 'DETECTIVE',
          sheriff: 'SHERIFF',
          doctor: 'DOCTOR',
          bodyguard: 'BODYGUARD',
          maniac: 'MANIAC',
          journalist: 'JOURNALIST',
          civilian: 'CIVILIAN',
        };

        for (const [key, code] of Object.entries(roleKeyToCode)) {
          expect(dealtCounts[code] ?? 0).toBe(roleDistribution[key]);
        }
      },
    );

    it('computes FAST-mode durations and disables LAST_WORD', async () => {
      const host = await makeUser();
      const others = await Promise.all([makeUser(), makeUser(), makeUser()]);
      const room = await createValidRoom(host.id, {
        maxPlayers: 8,
        rulesetMode: RulesetMode.FAST,
      });

      for (const other of others) {
        await service.joinRoom({
          userId: other.id,
          code: room.code,
          clientRequestId: randomUUID(),
        });
      }

      await start(host.id, room.roomId);

      const game = await prisma.game.findUniqueOrThrow({
        where: { id: room.gameId },
      });
      const snapshot = game.configSnapshot as Record<string, unknown>;
      expect(snapshot.lastWordEnabled).toBe(false);
      expect(snapshot.phaseDurationsSec).toMatchObject({
        ROLE_REVEAL: 10,
        NIGHT: 30,
        MORNING: 10,
        LAST_WORD: null,
      });
    });

    it('replays the stored response for a repeated clientRequestId', async () => {
      const host = await makeUser();
      const others = await Promise.all([makeUser(), makeUser(), makeUser()]);
      const room = await createValidRoom(host.id, { maxPlayers: 6 });

      for (const other of others) {
        await service.joinRoom({
          userId: other.id,
          code: room.code,
          clientRequestId: randomUUID(),
        });
      }

      const clientRequestId = randomUUID();
      const first = await service.startGame({
        userId: host.id,
        roomId: room.roomId,
        clientRequestId,
      });
      const second = await service.startGame({
        userId: host.id,
        roomId: room.roomId,
        clientRequestId,
      });

      expect(second).toEqual(first);
    });

    it('under real concurrent start attempts at the exact minimum player count, exactly one succeeds and the rest are cleanly rejected', async () => {
      // A 2-attempt version of this race passed even with the FOR UPDATE
      // lock deliberately removed during test development — same lesson as
      // the join-capacity, leave, and host-transfer concurrency tests above:
      // two independent connections don't reliably overlap. Higher
      // contention (many concurrent start calls, each with a distinct
      // clientRequestId so the idempotency path can't short-circuit the
      // race) is what actually exercises the lock.
      const ATTEMPT_COUNT = 10;
      const host = await makeUser();
      const others = await Promise.all([makeUser(), makeUser(), makeUser()]);
      const room = await createValidRoom(host.id, { maxPlayers: 6 });

      for (const other of others) {
        await service.joinRoom({
          userId: other.id,
          code: room.code,
          clientRequestId: randomUUID(),
        });
      }

      const settled = await Promise.allSettled(
        Array.from({ length: ATTEMPT_COUNT }, () => start(host.id, room.roomId)),
      );

      const fulfilled = settled.filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof start>>> =>
          r.status === 'fulfilled',
      );
      const rejected = settled.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0].value.status).toBe('RUNNING');
      expect(rejected).toHaveLength(ATTEMPT_COUNT - 1);
      expect(
        rejected.every(
          (r) =>
            (r.reason as RoomException).code === RoomErrorCode.ROOM_NOT_IN_LOBBY,
        ),
      ).toBe(true);

      const game = await prisma.game.findUniqueOrThrow({
        where: { id: room.gameId },
      });
      expect(game.status).toBe('RUNNING');

      const players = await prisma.gamePlayer.findMany({
        where: { gameId: room.gameId },
      });
      expect(players.every((p) => p.lifeStatus === 'ALIVE')).toBe(true);
      expect(players).toHaveLength(4);

      // Slice 2's atomicity guarantee: a game can never end up RUNNING
      // without roles dealt, even under this many concurrent start attempts
      // racing on the same lock — exactly one full deal, never zero, never
      // partial, never duplicated.
      const assignments = await prisma.gameRoleAssignment.findMany({
        where: { gameId: room.gameId },
      });
      expect(assignments).toHaveLength(4);
      expect(new Set(assignments.map((a) => a.playerId)).size).toBe(4);
      expect(assignments.map((a) => a.playerId).sort()).toEqual(
        players.map((p) => p.id).sort(),
      );
    });
  });
});
