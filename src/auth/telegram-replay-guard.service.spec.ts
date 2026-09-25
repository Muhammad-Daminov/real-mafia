import { TelegramReplayGuardService } from './telegram-replay-guard.service';
import { PrismaService } from '../prisma/prisma.service';

const redisSet = jest.fn();
const redisQuit = jest.fn().mockResolvedValue('OK');

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    set: redisSet,
    on: jest.fn(),
    quit: redisQuit,
  })),
}));

/**
 * F-03 (docs/audit/GAP_REPORT.md): a valid `initData` stays cryptographically
 * valid for the whole freshness window, so HMAC verification alone does not
 * stop replay. Master TZ §22.2 requires a replay cache alongside the HMAC and
 * freshness checks; §34 requires Redis-primary with a PostgreSQL fallback.
 */
describe('TelegramReplayGuardService', () => {
  const uniqueViolation = Object.assign(new Error('duplicate'), {
    code: 'P2002',
  });

  let create: jest.Mock;
  let deleteMany: jest.Mock;
  let prisma: PrismaService;

  const futureExpiry = () => new Date(Date.now() + 60_000);

  const buildPrisma = () => {
    create = jest.fn().mockResolvedValue({});
    deleteMany = jest.fn().mockResolvedValue({ count: 0 });

    return {
      telegramInitDataReplay: { create, deleteMany },
    } as unknown as PrismaService;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REDIS_URL;
    prisma = buildPrisma();
  });

  describe('PostgreSQL fallback (no Redis configured)', () => {
    it('allows the first use of a hash', async () => {
      const service = new TelegramReplayGuardService(prisma);

      await expect(service.claim('hash-a', futureExpiry())).resolves.toBe(true);
      expect(create).toHaveBeenCalledWith({
        data: { hash: 'hash-a', expiresAt: expect.any(Date) },
      });
    });

    it('rejects a replay of the same hash', async () => {
      create.mockRejectedValueOnce(uniqueViolation);
      const service = new TelegramReplayGuardService(prisma);

      await expect(service.claim('hash-a', futureExpiry())).resolves.toBe(
        false,
      );
    });

    it('stores only the hash, never the raw initData', async () => {
      const service = new TelegramReplayGuardService(prisma);

      await service.claim('hash-a', futureExpiry());

      const persisted = JSON.stringify(create.mock.calls[0][0]);
      expect(persisted).toContain('hash-a');
      expect(Object.keys(create.mock.calls[0][0].data).sort()).toEqual([
        'expiresAt',
        'hash',
      ]);
    });

    it('fails closed: an unexpected storage error propagates instead of allowing the request', async () => {
      create.mockRejectedValueOnce(new Error('connection refused'));
      const service = new TelegramReplayGuardService(prisma);

      await expect(service.claim('hash-a', futureExpiry())).rejects.toThrow(
        'connection refused',
      );
    });
  });

  describe('Redis primary path', () => {
    beforeEach(() => {
      process.env.REDIS_URL = 'redis://localhost:6379';
    });

    it('allows the first use when SET NX succeeds', async () => {
      redisSet.mockResolvedValueOnce('OK');
      const service = new TelegramReplayGuardService(prisma);

      await expect(service.claim('hash-a', futureExpiry())).resolves.toBe(true);
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects a replay when SET NX finds the key already present', async () => {
      redisSet.mockResolvedValueOnce(null);
      const service = new TelegramReplayGuardService(prisma);

      await expect(service.claim('hash-a', futureExpiry())).resolves.toBe(
        false,
      );
      expect(create).not.toHaveBeenCalled();
    });

    it('sets the key TTL to the remaining freshness window', async () => {
      redisSet.mockResolvedValueOnce('OK');
      const service = new TelegramReplayGuardService(prisma);

      await service.claim('hash-a', new Date(Date.now() + 60_000));

      const [key, value, pxFlag, ttlMs, nxFlag] = redisSet.mock.calls[0];
      expect(key).toContain('hash-a');
      expect(value).toBe('1');
      expect(pxFlag).toBe('PX');
      expect(ttlMs).toBeGreaterThan(0);
      expect(ttlMs).toBeLessThanOrEqual(60_000);
      expect(nxFlag).toBe('NX');
    });

    it('degrades to the PostgreSQL fallback when Redis is down (§34)', async () => {
      redisSet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const service = new TelegramReplayGuardService(prisma);

      await expect(service.claim('hash-a', futureExpiry())).resolves.toBe(true);
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('still detects a replay through the fallback when Redis is down', async () => {
      redisSet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      create.mockRejectedValueOnce(uniqueViolation);
      const service = new TelegramReplayGuardService(prisma);

      await expect(service.claim('hash-a', futureExpiry())).resolves.toBe(
        false,
      );
    });
  });

  describe('expiry handling', () => {
    it('refuses to claim an already-expired payload', async () => {
      const service = new TelegramReplayGuardService(prisma);

      await expect(
        service.claim('hash-a', new Date(Date.now() - 1_000)),
      ).resolves.toBe(false);
      expect(create).not.toHaveBeenCalled();
    });

    it('prunes expired fallback rows', async () => {
      deleteMany.mockResolvedValueOnce({ count: 3 });
      const service = new TelegramReplayGuardService(prisma);

      const now = new Date();
      await expect(service.pruneExpired(now)).resolves.toBe(3);
      expect(deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: now } },
      });
    });
  });
});
