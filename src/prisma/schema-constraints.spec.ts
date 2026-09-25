import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

/**
 * Phase 2 schema constraints (Master TZ §8.3, §33.1, §33.3).
 *
 * These assert the raw-SQL constructs that Prisma's schema language cannot
 * express — partial unique indexes and CHECK constraints — against a real
 * PostgreSQL database. They are the only thing standing between the spec's
 * invariants and a migration that silently drops them.
 */
describe('Phase 2 schema constraints', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  /** Prefix that marks a row as this suite's disposable fixture data. */
  const TEST_USER_PREFIX = 'schema-test-';

  let userId: string;
  const createdRoomIds: string[] = [];

  const UNIQUE_VIOLATION = '23505';
  const CHECK_VIOLATION = '23514';
  const FOREIGN_KEY_VIOLATION = '23503';

  /**
   * Postgres SQLSTATE of a rejected write, or null if it was accepted.
   *
   * Asserting on the raw SQLSTATE rather than Prisma's own error codes keeps
   * these tests tied to the database constraint itself — the thing the spec
   * actually requires — instead of to the ORM's error taxonomy. Prisma
   * surfaces driver errors two different ways depending on the violation, so
   * both are unwrapped here.
   */
  const errorCodeOf = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
      await fn();
      return null;
    } catch (error) {
      const meta = (
        error as {
          meta?: { driverAdapterError?: { cause?: { code?: string } } };
        }
      ).meta;

      const sqlState = meta?.driverAdapterError?.cause?.code;
      if (sqlState) {
        return sqlState;
      }

      // Prisma normalises some violations to its own codes before the adapter
      // error is exposed; map those back to the SQLSTATEs asserted on here.
      const prismaCode = (error as { code?: string }).code;
      const normalised: Record<string, string> = {
        P2002: UNIQUE_VIOLATION,
        P2003: FOREIGN_KEY_VIOLATION,
      };

      return normalised[prismaCode ?? ''] ?? prismaCode ?? 'UNKNOWN';
    }
  };

  const newRoom = async (overrides: Record<string, unknown> = {}) => {
    const room = await prisma.room.create({
      data: {
        code: Math.random().toString(36).slice(2, 8).toUpperCase(),
        maxPlayers: 8,
        creatorUserId: userId,
        ...overrides,
      },
    });
    createdRoomIds.push(room.id);
    return room;
  };

  const newGame = (roomId: string, overrides: Record<string, unknown> = {}) =>
    prisma.game.create({ data: { roomId, ...overrides } });

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        telegramId: `${TEST_USER_PREFIX}${Date.now()}`,
        firstName: 'SchemaTest',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    // Gameplay tables are RESTRICT/never-deleted in production (§33.1); tests
    // clean up after themselves so the dev database is left as it was found.
    //
    // Every step is independently guarded: if one throws, the remaining steps
    // must still run, otherwise a mid-cleanup failure leaks rows into the dev
    // database. The user sweep is by telegramId prefix rather than by this
    // run's id so it also reclaims residue left by any earlier crashed run.
    const steps: Array<() => Promise<unknown>> = [
      () =>
        prisma.room.updateMany({
          where: { id: { in: createdRoomIds } },
          data: { activeGameId: null },
        }),
      () =>
        prisma.gamePhase.deleteMany({
          where: { game: { roomId: { in: createdRoomIds } } },
        }),
      () =>
        prisma.game.updateMany({
          where: { roomId: { in: createdRoomIds } },
          data: { hostPlayerId: null },
        }),
      () =>
        prisma.gamePlayer.deleteMany({
          where: { game: { roomId: { in: createdRoomIds } } },
        }),
      () => prisma.game.deleteMany({ where: { roomId: { in: createdRoomIds } } }),
      () => prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } }),
      () =>
        prisma.user.deleteMany({
          where: { telegramId: { startsWith: TEST_USER_PREFIX } },
        }),
    ];

    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        console.error('schema-constraints cleanup step failed:', error);
      }
    }

    await prisma.$disconnect();
  });

  describe('one active game per room (§8.3, §33.3 item 1)', () => {
    it('rejects a second active game in the same room', async () => {
      const room = await newRoom();
      await newGame(room.id, { status: 'LOBBY' });

      const code = await errorCodeOf(() =>
        newGame(room.id, { status: 'LOBBY' }),
      );

      expect(code).toBe(UNIQUE_VIOLATION);
    });

    it.each(['DRAFT', 'LOBBY', 'RUNNING', 'PAUSED'])(
      'treats %s as active for the purposes of the constraint',
      async (status) => {
        const room = await newRoom();
        await newGame(room.id, { status });

        const code = await errorCodeOf(() =>
          newGame(room.id, { status: 'LOBBY' }),
        );

        expect(code).toBe(UNIQUE_VIOLATION);
      },
    );

    it.each(['FINISHED', 'CANCELLED'])(
      'allows a new game once the previous one is %s',
      async (status) => {
        const room = await newRoom();
        await newGame(room.id, { status });

        const code = await errorCodeOf(() =>
          newGame(room.id, { status: 'LOBBY' }),
        );

        expect(code).toBeNull();
      },
    );

    it('allows concurrent active games in different rooms', async () => {
      const roomA = await newRoom();
      const roomB = await newRoom();

      await newGame(roomA.id, { status: 'RUNNING' });
      const code = await errorCodeOf(() =>
        newGame(roomB.id, { status: 'RUNNING' }),
      );

      expect(code).toBeNull();
    });
  });

  describe('room code uniqueness among open rooms (§33.3 item 8)', () => {
    it('rejects a duplicate code while the original room is not CLOSED', async () => {
      const room = await newRoom();

      const code = await errorCodeOf(() => newRoom({ code: room.code }));

      expect(code).toBe(UNIQUE_VIOLATION);
    });

    it('releases the code back into the pool once the room is CLOSED (§8.5)', async () => {
      const room = await newRoom();
      await prisma.room.update({
        where: { id: room.id },
        data: { status: 'CLOSED', codeReleasedAt: new Date() },
      });

      const code = await errorCodeOf(() => newRoom({ code: room.code }));

      expect(code).toBeNull();
    });
  });

  describe('one active phase per game (§33.3 item 2)', () => {
    it('rejects a second unfinished phase for the same game', async () => {
      const room = await newRoom();
      const game = await newGame(room.id);
      await prisma.gamePhase.create({
        data: { gameId: game.id, phase: 'NIGHT', round: 1 },
      });

      const code = await errorCodeOf(() =>
        prisma.gamePhase.create({
          data: { gameId: game.id, phase: 'VOTING', round: 1 },
        }),
      );

      expect(code).toBe(UNIQUE_VIOLATION);
    });

    it('allows the next phase once the previous one has ended', async () => {
      const room = await newRoom();
      const game = await newGame(room.id);
      const phase = await prisma.gamePhase.create({
        data: { gameId: game.id, phase: 'NIGHT', round: 1 },
      });
      await prisma.gamePhase.update({
        where: { id: phase.id },
        data: { endedAt: new Date() },
      });

      const code = await errorCodeOf(() =>
        prisma.gamePhase.create({
          data: { gameId: game.id, phase: 'MORNING', round: 1 },
        }),
      );

      expect(code).toBeNull();
    });
  });

  describe('player count bounds (§8.1, §13.1)', () => {
    it.each([3, 25, 0, -1])('rejects maxPlayers = %i', async (maxPlayers) => {
      const code = await errorCodeOf(() => newRoom({ maxPlayers }));

      expect(code).toBe(CHECK_VIOLATION);
    });

    it.each([4, 12, 24])('accepts maxPlayers = %i', async (maxPlayers) => {
      const code = await errorCodeOf(() => newRoom({ maxPlayers }));

      expect(code).toBeNull();
    });
  });

  describe('game membership (§8.4)', () => {
    it('rejects the same user joining one game twice', async () => {
      const room = await newRoom();
      const game = await newGame(room.id);
      await prisma.gamePlayer.create({ data: { gameId: game.id, userId } });

      const code = await errorCodeOf(() =>
        prisma.gamePlayer.create({ data: { gameId: game.id, userId } }),
      );

      expect(code).toBe(UNIQUE_VIOLATION);
    });
  });

  describe('User identity is UUID (F-05 conversion)', () => {
    it('generates a UUID primary key, not an integer', async () => {
      expect(userId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('generates version 7 UUIDs for new users', async () => {
      // Prisma's `@default(uuid(7))` generates client-side, so this holds even
      // though PostgreSQL 16 has no native uuidv7().
      const versionNibble = userId.charAt(14);
      expect(versionNibble).toBe('7');
    });

    it('generates version 7 UUIDs across every gameplay table too', async () => {
      const room = await newRoom();
      const game = await newGame(room.id);
      const player = await prisma.gamePlayer.create({
        data: { gameId: game.id, userId },
      });
      const phase = await prisma.gamePhase.create({
        data: { gameId: game.id, phase: 'NIGHT', round: 1 },
      });

      // All five id-bearing models share one generation strategy; a stray v4
      // here would mean a model was missed when they were aligned.
      for (const id of [room.id, game.id, player.id, phase.id]) {
        expect(id.charAt(14)).toBe('7');
      }
    });

    it('keeps id generation client-side, with no DB-side default', async () => {
      const rows = await prisma.$queryRaw<
        Array<{ table_name: string; column_default: string | null }>
      >`
        SELECT table_name, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'id'
          AND table_name IN ('User', 'rooms', 'games', 'game_players', 'game_phases')
      `;

      expect(rows).toHaveLength(5);
      for (const row of rows) {
        expect(row.column_default).toBeNull();
      }
    });

    it('stores the column as a real uuid type', async () => {
      const rows = await prisma.$queryRaw<Array<{ data_type: string }>>`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'User' AND column_name = 'id'
      `;

      expect(rows[0].data_type).toBe('uuid');
    });

    it('links uuid foreign keys from both referencing tables', async () => {
      const room = await newRoom();
      const game = await newGame(room.id);
      const player = await prisma.gamePlayer.create({
        data: { gameId: game.id, userId },
      });

      expect(room.creatorUserId).toBe(userId);
      expect(player.userId).toBe(userId);
    });

    it('rejects a foreign key pointing at a non-existent user', async () => {
      const code = await errorCodeOf(() =>
        newRoom({ creatorUserId: '99999999-9999-4999-8999-999999999999' }),
      );

      expect(code).toBe(FOREIGN_KEY_VIOLATION);
    });
  });

  describe('dead progression fields are gone (F-05)', () => {
    it.each(['level', 'xp', 'gamesPlayed', 'gamesWon'])(
      'no longer has a %s column',
      async (column) => {
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*)::int AS count FROM information_schema.columns
          WHERE table_name = 'User' AND column_name = ${column}
        `;

        expect(Number(rows[0].count)).toBe(0);
      },
    );
  });

  describe('referential durability (§33.1 delete policy)', () => {
    it('refuses to delete a room that still has games (RESTRICT)', async () => {
      const room = await newRoom();
      await newGame(room.id);

      const code = await errorCodeOf(() =>
        prisma.room.delete({ where: { id: room.id } }),
      );

      expect(code).not.toBeNull();
    });
  });
});
