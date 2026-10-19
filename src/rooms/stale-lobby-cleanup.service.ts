import { randomUUID } from 'crypto';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../common/scheduling/scheduler.service';
import { RoomsService } from './rooms.service';
import { RoomException } from './rooms.errors';

/** OD-029 ("Room expiry," default "SHOULD ship"): the periodic sweep's own
 * `scheduled_tasks.kind` — registered/claimed exactly like
 * `PHASE_ADVANCE_CHECK`/`TELEGRAM_MESSAGE`, kind-scoped per OD-057. */
export const STALE_LOBBY_CLEANUP_TASK_KIND = 'STALE_LOBBY_CLEANUP';

/**
 * Used ONLY by the very first, `onApplicationBootstrap` enqueue — if this
 * process restarts (or, once a future slice actually runs more than one
 * instance, a second replica boots concurrently) while a chain is already
 * PENDING/LEASED, the dedupe key makes that second attempt a no-op
 * instead of starting a second parallel chain.
 *
 * Deliberately NOT reused by `rescheduleNextSweep`'s own enqueue call: at
 * that point *this* run's own task row is still LEASED (`pollOnce` only
 * calls `complete()` after the handler — this one — returns), so a
 * same-key `enqueue` there would just find itself and hand back its own
 * id instead of creating a future row, silently killing the chain after
 * one cycle. The reschedule call below is therefore deliberately
 * unkeyed — see its own comment for why that's still safe in practice.
 */
const RECURRING_DEDUPE_KEY = 'stale-lobby-cleanup';

/** A defensive cap, not a correctness requirement — at this app's current
 * scale a single sweep could easily process every stale room in one pass,
 * but an unbounded `findMany` here would still be the wrong default to
 * leave in place as room counts grow. Mirrors `SchedulerService`'s own
 * `DEFAULT_BATCH_SIZE` reasoning (bounded, not tuned to any real load
 * figure yet). */
const MAX_ROOMS_PER_SWEEP = 50;

function thresholdMinutes(): number {
  return Number(process.env.STALE_LOBBY_THRESHOLD_MINUTES) || 120;
}

function intervalMinutes(): number {
  return Number(process.env.STALE_LOBBY_CLEANUP_INTERVAL_MINUTES) || 5;
}

/**
 * B-H1/OD-029: a periodic sweep that cancels LOBBY rooms/games with no
 * activity for `STALE_LOBBY_THRESHOLD_MINUTES` (default 120) — through
 * `RoomsService.leaveRoom`, the exact same command path a real player
 * leaving uses (same `PLAYER_LEFT` broadcast, same host-reassignment/room-
 * closure invariants, same idempotency machinery), never a bespoke
 * "cancel room" shortcut. Never touches a RUNNING game (the query is
 * scoped to `status: 'LOBBY'` only) and never deletes a row (`leaveRoom`
 * only ever `update`s).
 *
 * "No activity" = both the game's own `createdAt` AND every active
 * player's `joinedAt` are older than the threshold — a room someone just
 * joined is never swept away even if the room itself is old. There is no
 * finer-grained "last activity" signal available (`GamePlayer` has no
 * `updatedAt`, and `isReady` toggles leave no timestamp at all) — see
 * OPEN_DECISIONS.md for this gap.
 *
 * Idempotent/safe to run twice (even concurrently): once a room's players
 * have all been removed, its `Game.status` is no longer `LOBBY`, so a
 * second sweep's own query simply stops matching it; a second sweep
 * racing a still-in-progress first one hits `leaveRoom`'s own existing
 * guards (`PLAYER_NOT_IN_GAME` for an already-removed player,
 * `ROOM_NOT_IN_LOBBY` once the room has fully closed) — both caught here
 * and logged, never left to abort the rest of the sweep.
 */
@Injectable()
export class StaleLobbyCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StaleLobbyCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
    private readonly rooms: RoomsService,
  ) {}

  /**
   * `async`/awaited on purpose — Nest's lifecycle runner awaits
   * `onApplicationBootstrap` if it returns a promise, so `app.init()`
   * doesn't resolve until this enqueue has actually committed. A
   * fire-and-forget (`void this.prisma.$transaction(...)`) version of
   * this raced test teardown (`app.close()`/`$disconnect()`) in exactly
   * the way `dev-tools.boot.spec.ts` boots and tears down a fresh module
   * per test case — caught by that spec failing with a connection-pool
   * timeout once this slice's own `RoomsModule` changes were in place.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.scheduler.registerHandler(STALE_LOBBY_CLEANUP_TASK_KIND, async () => {
      await this.runSweep();
    });

    await this.prisma.$transaction((tx) =>
      this.scheduler.enqueue(tx, {
        kind: STALE_LOBBY_CLEANUP_TASK_KIND,
        payload: {},
        runAt: new Date(),
        dedupeKey: RECURRING_DEDUPE_KEY,
      }),
    );
  }

  async runSweep(): Promise<void> {
    await this.cancelStaleLobbies();
    await this.logAbandonedRunningGames();
    await this.rescheduleNextSweep();
  }

  async cancelStaleLobbies(): Promise<void> {
    const staleBefore = new Date(Date.now() - thresholdMinutes() * 60_000);

    const candidates = await this.prisma.game.findMany({
      where: { status: 'LOBBY', createdAt: { lt: staleBefore } },
      take: MAX_ROOMS_PER_SWEEP,
      select: {
        id: true,
        roomId: true,
        createdAt: true,
        players: {
          where: { lifeStatus: { not: 'LEFT' } },
          select: { userId: true, joinedAt: true },
        },
      },
    });

    for (const game of candidates) {
      const lastActivityAt = game.players.reduce(
        (latest, player) => (player.joinedAt > latest ? player.joinedAt : latest),
        game.createdAt,
      );

      // Someone joined (or the room was created) within the window —
      // not actually idle, regardless of how old the row itself is.
      if (lastActivityAt >= staleBefore) {
        continue;
      }

      for (const player of game.players) {
        try {
          await this.rooms.leaveRoom({
            userId: player.userId,
            roomId: game.roomId,
            clientRequestId: randomUUID(),
          });
        } catch (error) {
          // PLAYER_NOT_IN_GAME (already removed by an earlier/concurrent
          // sweep) and ROOM_NOT_IN_LOBBY (the room already fully closed)
          // are the expected idempotency cases — logged and skipped, not
          // treated as a sweep-ending failure. Anything else is also only
          // logged: one room's unexpected error must not abort the rest
          // of the batch.
          const code = error instanceof RoomException ? error.code : 'UNKNOWN';
          this.logger.warn(`stale-lobby cleanup: leaveRoom failed for game ${game.id} (${code})`);
        }
      }
    }

    if (candidates.length > 0) {
      this.logger.log(`stale-lobby cleanup: swept ${candidates.length} idle LOBBY game(s)`);
    }
  }

  /**
   * Task item 4: "a RUNNING game where every human player is gone is out
   * of scope: only log a warning count, do not act." `connectionStatus`
   * (the only schema field that could express "gone" for a RUNNING game —
   * `lifeStatus` cannot reach `LEFT` post-LOBBY, OD-021) is never written
   * anywhere in this codebase today (confirmed by grep), so this count is
   * always 0 in practice until a later slice wires real disconnect
   * tracking into it — logged here as a stated, visible gap (OPEN_DECISIONS.md),
   * not silently assumed to be meaningful yet.
   */
  async logAbandonedRunningGames(): Promise<void> {
    const runningGames = await this.prisma.game.findMany({
      where: { status: 'RUNNING' },
      select: {
        players: {
          where: { user: { isBot: false } },
          select: { connectionStatus: true },
        },
      },
    });

    const abandonedCount = runningGames.filter(
      (game) => game.players.length > 0 && game.players.every((p) => p.connectionStatus === 'DISCONNECTED'),
    ).length;

    if (abandonedCount > 0) {
      this.logger.warn(`stale-lobby cleanup: ${abandonedCount} RUNNING game(s) with every human player disconnected (not acted on)`);
    }
  }

  /**
   * No `dedupeKey` here, deliberately (see `RECURRING_DEDUPE_KEY`'s own
   * comment for why reusing it would kill the chain). The one case this
   * leaves unguarded — a lease-timeout double-claim of the *same* task row
   * (OD-043b, requires this sweep to run longer than the 30s lease) running
   * the handler twice concurrently, each rescheduling once — is bounded,
   * not a runaway: it produces at most one extra pending task for that one
   * cycle (each of which still only reschedules once on its own next turn),
   * and `cancelStaleLobbies`'s own idempotency means an extra sweep is
   * harmless regardless. In this app's actual (single-instance) deployment
   * model, a real restart stops the old process entirely before the new one
   * starts (`SchedulerService.onModuleDestroy` already waits for the
   * in-flight poll), so there is no overlapping-boot window to race either.
   */
  private async rescheduleNextSweep(): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.scheduler.enqueue(tx, {
        kind: STALE_LOBBY_CLEANUP_TASK_KIND,
        payload: {},
        runAt: new Date(Date.now() + intervalMinutes() * 60_000),
      }),
    );
  }
}
