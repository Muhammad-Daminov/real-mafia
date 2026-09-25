import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Single-use guard for Telegram `initData` payloads (Master TZ §22.2, v5.0 §29.3).
 *
 * A valid `initData` stays cryptographically valid for the whole freshness
 * window, so HMAC verification alone does not stop the same payload being
 * replayed within that window. This service makes the first use of a given
 * initData `hash` succeed and every later use fail, for the duration of the
 * window.
 *
 * Storage follows the spec's Redis-primary / PostgreSQL-fallback pattern (§34):
 * Redis is the fast path, but a Redis outage degrades to a PostgreSQL unique
 * insert rather than disabling the guard. Failing open is not an option here —
 * this is a security control, so a total storage failure rejects the request.
 *
 * Only the `hash` is ever stored; the raw initData is never persisted (§22.2).
 */
@Injectable()
export class TelegramReplayGuardService implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramReplayGuardService.name);
  private readonly redis: Redis | null;

  constructor(private readonly prisma: PrismaService) {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
      this.logger.warn(
        'REDIS_URL sozlanmagan — initData replay guard PostgreSQL fallback rejimida ishlaydi',
      );
      this.redis = null;
      return;
    }

    this.redis = new Redis(redisUrl, {
      // Fail fast instead of queueing auth requests behind a dead Redis:
      // the PostgreSQL fallback is there to absorb the outage.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    });

    this.redis.on('error', (error: Error) => {
      this.logger.warn(`Redis xatosi, fallback ishlatiladi: ${error.message}`);
    });
  }

  /**
   * Claims this initData hash for single use.
   *
   * @returns `true` if this is the first use (request may proceed),
   *          `false` if the hash was already used (replay — reject).
   * @throws if neither Redis nor PostgreSQL can record the claim, so that a
   *         storage outage can never silently disable replay protection.
   */
  async claim(hash: string, expiresAt: Date): Promise<boolean> {
    const ttlMs = expiresAt.getTime() - Date.now();

    // Already outside its freshness window — the caller's freshness check
    // should have rejected it first; treat as not claimable.
    if (ttlMs <= 0) {
      return false;
    }

    if (this.redis) {
      try {
        const result = await this.redis.set(
          this.redisKey(hash),
          '1',
          'PX',
          ttlMs,
          'NX',
        );

        return result === 'OK';
      } catch (error) {
        this.logger.warn(
          `Redis replay guard ishlamadi, PostgreSQL fallback: ${
            (error as Error).message
          }`,
        );
      }
    }

    return this.claimInPostgres(hash, expiresAt);
  }

  private async claimInPostgres(
    hash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    try {
      await this.prisma.telegramInitDataReplay.create({
        data: { hash, expiresAt },
      });

      return true;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        return false;
      }

      throw error;
    }
  }

  /**
   * Removes expired fallback rows. Redis expires its own keys; the PostgreSQL
   * fallback table needs sweeping, which belongs to the janitor worker (§35)
   * once that phase lands. Exposed here so the janitor can call it.
   */
  async pruneExpired(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.telegramInitDataReplay.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    return count;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private redisKey(hash: string): string {
    return `auth:tg:initdata:${hash}`;
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }
}
