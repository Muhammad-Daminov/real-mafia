import { createHash } from 'crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { LaunchTokenService } from './launch-token.service';
import {
  LAUNCH_TOKEN_TTL_SECONDS,
  LaunchTokenErrorCode,
} from './launch-token.errors';
import { PrismaService } from '../prisma/prisma.service';

/**
 * F-04 (docs/audit/GAP_REPORT.md) / Master TZ §22.2.
 *
 * The Mini App must not be able to assert "I belong to Room X" on its own. The
 * launch token is the server-minted proof of where a session was launched
 * from: opaque, <=15 min TTL, single-use.
 *
 * Error codes per OD-035 (docs/decisions/OPEN_DECISIONS.md).
 */
describe('LaunchTokenService', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  const service = new LaunchTokenService(prisma as unknown as PrismaService);

  const TEST_PREFIX = 'launch-token-test-';

  let userId: string;
  let otherUserId: string;
  let roomId: string;
  const createdRoomIds: string[] = [];

  const codeOf = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
      await fn();
      return null;
    } catch (error) {
      const response = (error as { getResponse?: () => unknown }).getResponse?.();
      return (response as { code?: string })?.code ?? 'UNKNOWN';
    }
  };

  const statusOf = async (fn: () => Promise<unknown>): Promise<number | null> => {
    try {
      await fn();
      return null;
    } catch (error) {
      return (error as { getStatus?: () => number }).getStatus?.() ?? null;
    }
  };

  const newUser = async () => {
    const user = await prisma.user.create({
      data: {
        telegramId: `${TEST_PREFIX}${Math.random().toString(36).slice(2)}`,
        firstName: 'LaunchTokenTest',
      },
    });
    return user.id;
  };

  beforeAll(async () => {
    userId = await newUser();
    otherUserId = await newUser();

    const room = await prisma.room.create({
      data: {
        code: Math.random().toString(36).slice(2, 8).toUpperCase(),
        maxPlayers: 8,
        creatorUserId: userId,
      },
    });
    roomId = room.id;
    createdRoomIds.push(room.id);
  });

  afterAll(async () => {
    const steps: Array<() => Promise<unknown>> = [
      () => prisma.gameLaunchToken.deleteMany({ where: { roomId: { in: createdRoomIds } } }),
      () =>
        prisma.gameLaunchToken.deleteMany({
          where: { consumedByUserId: { in: [userId, otherUserId] } },
        }),
      () => prisma.gameLaunchToken.deleteMany({ where: { roomId: null } }),
      () => prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } }),
      () =>
        prisma.user.deleteMany({
          where: { telegramId: { startsWith: TEST_PREFIX } },
        }),
    ];

    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        console.error('launch-token cleanup step failed:', error);
      }
    }

    await prisma.$disconnect();
  });

  describe('issuing (§22.2)', () => {
    it('mints an opaque, high-entropy token', async () => {
      const { token } = await service.issue({ roomId });

      // Opaque: no room id, no user id, nothing decodable from the string.
      expect(token).not.toContain(roomId);
      expect(token).not.toContain(userId);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    });

    it('issues a distinct token every time', async () => {
      const a = await service.issue({ roomId });
      const b = await service.issue({ roomId });

      expect(a.token).not.toBe(b.token);
    });

    it('never stores the raw token, only its hash', async () => {
      const { token } = await service.issue({ roomId });

      const rows = await prisma.gameLaunchToken.findMany({
        where: { roomId },
      });
      const serialised = JSON.stringify(rows);

      expect(serialised).not.toContain(token);
      expect(serialised).toContain(
        createHash('sha256').update(token).digest('hex'),
      );
    });

    it('sets a TTL no longer than the 15 minute ceiling', async () => {
      const before = Date.now();
      const { expiresAt } = await service.issue({ roomId });
      const after = Date.now();

      // expiresAt is computed inside issue() from its own Date.now() call,
      // taken some time after `before` was captured — bracket with `after`
      // too instead of comparing against a single pre-call timestamp, or
      // any elapsed time between the two reads reads as TTL overrun.
      expect(expiresAt.getTime()).toBeGreaterThan(before);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(
        after + LAUNCH_TOKEN_TTL_SECONDS * 1000,
      );
      expect(LAUNCH_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(15 * 60);
    });

    it('refuses at the database level to store a TTL beyond 15 minutes', async () => {
      const now = new Date();

      // Bypasses the service entirely: even a caller that ignores
      // LAUNCH_TOKEN_TTL_SECONDS cannot persist an over-long token.
      const attempt = prisma.gameLaunchToken.create({
        data: {
          tokenHash: createHash('sha256').update(`oversized-${Math.random()}`).digest('hex'),
          roomId,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 16 * 60 * 1000),
        },
      });

      await expect(attempt).rejects.toThrow();
    });

    it('allows a token with no room (public room browser path, §22.2)', async () => {
      const { token } = await service.issue({});

      const result = await service.consume({ token, userId });
      expect(result.roomId).toBeNull();
    });
  });

  describe('consuming — success path', () => {
    it('resolves the token to its room and binds it to the user', async () => {
      const { token } = await service.issue({ roomId });

      const result = await service.consume({ token, userId });

      expect(result.roomId).toBe(roomId);
    });

    it('records the consumption (single-use bookkeeping)', async () => {
      const { token } = await service.issue({ roomId });
      await service.consume({ token, userId });

      const row = await prisma.gameLaunchToken.findUnique({
        where: { tokenHash: createHash('sha256').update(token).digest('hex') },
      });

      expect(row?.usedAt).toBeInstanceOf(Date);
      expect(row?.consumedByUserId).toBe(userId);
    });

    it('accepts a matching expected room id', async () => {
      const { token } = await service.issue({ roomId });

      const result = await service.consume({ token, userId, expectedRoomId: roomId });
      expect(result.roomId).toBe(roomId);
    });
  });

  describe('consuming — rejections (OD-035)', () => {
    it('rejects an unknown token with LAUNCH_TOKEN_NOT_FOUND / 404', async () => {
      const call = () => service.consume({ token: 'not-a-real-token', userId });

      expect(await codeOf(call)).toBe(LaunchTokenErrorCode.NOT_FOUND);
      expect(await statusOf(call)).toBe(404);
    });

    it('rejects a second use with LAUNCH_TOKEN_ALREADY_USED / 409', async () => {
      const { token } = await service.issue({ roomId });
      await service.consume({ token, userId });

      const call = () => service.consume({ token, userId });

      expect(await codeOf(call)).toBe(LaunchTokenErrorCode.ALREADY_USED);
      expect(await statusOf(call)).toBe(409);
    });

    it('rejects an expired token with LAUNCH_TOKEN_EXPIRED / 410', async () => {
      const { token } = await service.issue({ roomId });

      // Age the token past its TTL without waiting 15 real minutes. Both
      // timestamps have to move together: the ttl-ceiling CHECK constraint
      // rejects an expiry that is more than 15 minutes after creation, so
      // backdating expiresAt alone is (correctly) refused by the database.
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);

      await prisma.gameLaunchToken.update({
        where: { tokenHash: createHash('sha256').update(token).digest('hex') },
        data: { createdAt: thirtyMinutesAgo, expiresAt: twentyMinutesAgo },
      });

      const call = () => service.consume({ token, userId });

      expect(await codeOf(call)).toBe(LaunchTokenErrorCode.EXPIRED);
      expect(await statusOf(call)).toBe(410);
    });

    it('rejects a room mismatch with LAUNCH_TOKEN_ROOM_MISMATCH / 409', async () => {
      const otherRoom = await prisma.room.create({
        data: {
          code: Math.random().toString(36).slice(2, 8).toUpperCase(),
          maxPlayers: 6,
          creatorUserId: userId,
        },
      });
      createdRoomIds.push(otherRoom.id);

      const { token } = await service.issue({ roomId });
      const call = () =>
        service.consume({ token, userId, expectedRoomId: otherRoom.id });

      expect(await codeOf(call)).toBe(LaunchTokenErrorCode.ROOM_MISMATCH);
      expect(await statusOf(call)).toBe(409);
    });

    it('treats a roomless token as a mismatch when a specific room is expected', async () => {
      const { token } = await service.issue({});

      const code = await codeOf(() =>
        service.consume({ token, userId, expectedRoomId: roomId }),
      );

      expect(code).toBe(LaunchTokenErrorCode.ROOM_MISMATCH);
    });

    it('does not consume the token when it is rejected for a room mismatch', async () => {
      const { token } = await service.issue({ roomId });
      const hash = createHash('sha256').update(token).digest('hex');

      await codeOf(() =>
        service.consume({ token, userId, expectedRoomId: otherUserId }),
      );

      const row = await prisma.gameLaunchToken.findUnique({
        where: { tokenHash: hash },
      });
      expect(row?.usedAt).toBeNull();
    });
  });

  describe('single-use under concurrency', () => {
    it('lets exactly one of two simultaneous consumers win', async () => {
      const { token } = await service.issue({ roomId });

      const results = await Promise.allSettled([
        service.consume({ token, userId }),
        service.consume({ token, userId: otherUserId }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    });
  });

  describe('possession is not authorization (§22.2)', () => {
    it('returns only the room id, never a membership or permission claim', async () => {
      const { token } = await service.issue({ roomId });

      const result = await service.consume({ token, userId });

      // A consumed token resolves *where* the session launched from and
      // nothing else. Join still runs full validation (§15.2).
      expect(Object.keys(result).sort()).toEqual(['roomId']);
    });
  });
});
