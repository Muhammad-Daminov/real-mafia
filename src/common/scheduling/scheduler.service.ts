import { randomUUID } from 'crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma, ScheduledTask, ScheduledTaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * §19/§21 (v5.0)/OD-008/OD-043: generic scheduled-task worker infrastructure.
 *
 * This is shared infra, not a game-engine concept — `kind` and `payload` are
 * opaque strings/JSON to this service. Consumers (today: the phase-transition
 * engine; later: the outbox dispatcher, §19/§25) register a handler for their
 * own `kind` via `registerHandler` and enqueue their own tasks via `enqueue`.
 * This module never imports from `game-engine`, `economy`, `store`,
 * `payments`, or `referral` — the dependency edge runs one way, a consumer
 * importing `common/scheduling`, exactly as I-33 already requires for
 * `game-engine -> economy` (just generalized: shared infra must stay ignorant
 * of every domain that depends on it, not only the economy-side ones I-33
 * names explicitly).
 *
 * OD-043's operational parameters: 1s poll interval, 30s lease, bounded
 * exponential backoff with jitter (base 5s, cap 5min) on `fail`, 10 max
 * attempts before a task moves to the terminal `FAILED` status.
 */
export interface EnqueueInput {
  kind: string;
  payload: Prisma.InputJsonValue;
  runAt: Date;
  /**
   * Optional idempotency key (e.g. `"phase-advance:<gameId>"`). If an
   * PENDING/LEASED task already holds this key, `enqueue` returns its id
   * instead of creating a duplicate — see `scheduled_tasks_dedupe_key_while_active`.
   * Race-safety note: this only prevents duplicates from concurrent callers
   * if those callers already serialize on some other lock relevant to the
   * key (e.g. two calls enqueueing "phase-advance:<gameId>" are already
   * serialized by the `games` row lock both hold). The partial unique index
   * is the backstop for the case where they don't.
   */
  dedupeKey?: string;
  maxAttempts?: number;
}

export type TaskHandler = (payload: Prisma.JsonValue) => Promise<void>;

/**
 * OD-053: the minimal hook a consumer can throw to mark its own task
 * permanently non-retryable (e.g. Telegram 400/403 — bot blocked, chat not
 * found) without inventing a second retry mechanism alongside `fail()`'s
 * existing backoff/`maxAttempts` machinery. `pollOnce` recognizes this type
 * and routes to `failPermanently` instead of `fail` — every other consumer
 * (today: `PHASE_ADVANCE_CHECK`) is entirely unaffected since they never
 * throw it.
 */
export class PermanentTaskError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'PermanentTaskError';
  }
}

/**
 * OD-053: the minimal hook a consumer can throw to supply a lower bound for
 * the next retry's `runAt` (e.g. Telegram 429's `retry_after`), without
 * replacing `fail()`'s own backoff calculation — `fail` still runs its usual
 * exponential-backoff-with-jitter computation and simply takes the later of
 * the two.
 */
export class RetryAfterError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = 'RetryAfterError';
  }
}

const POLL_INTERVAL_MS = 1_000; // OD-043a
const LEASE_DURATION_MS = 30_000; // OD-043b
const BACKOFF_BASE_MS = 5_000; // OD-043c
const BACKOFF_CAP_MS = 300_000; // OD-043c
const BACKOFF_JITTER_RATIO = 0.2; // OD-043c: +/-20%
const DEFAULT_MAX_ATTEMPTS = 10; // OD-043d
const DEFAULT_BATCH_SIZE = 10;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

/** OD-043c: bounded exponential backoff with jitter. `attemptCount` is the count *before* this failure. */
export function backoffDelayMs(attemptCount: number): number {
  const exponential = BACKOFF_BASE_MS * 2 ** Math.max(0, attemptCount - 1);
  const capped = Math.min(exponential, BACKOFF_CAP_MS);
  const jitter = capped * BACKOFF_JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly handlers = new Map<string, TaskHandler>();
  private readonly workerId = randomUUID();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * §6.2/OD-012: the eventual `PROCESS_ROLE=api|worker` split means an
   * api-only replica shouldn't run this loop. That topology switch isn't
   * built yet anywhere in this codebase (no other code reads `PROCESS_ROLE`
   * either), so today's single-process default is to run it; a future
   * api-only replica opts out by setting `PROCESS_ROLE=api`.
   */
  onApplicationBootstrap(): void {
    if (process.env.PROCESS_ROLE === 'api') {
      return;
    }
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  registerHandler(kind: string, handler: TaskHandler): void {
    if (this.handlers.has(kind)) {
      throw new Error(`SchedulerService: a handler is already registered for kind "${kind}"`);
    }
    this.handlers.set(kind, handler);
  }

  start(intervalMs: number = POLL_INTERVAL_MS): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Precondition (like `RoleAssignmentService.dealRoles`/
   * `GameLifecycleService.transitionPhase`): `tx` must be a transaction the
   * caller already holds a relevant lock inside, both so the enqueue commits
   * atomically with whatever deadline it corresponds to, and so the dedupe
   * check above is race-free against concurrent callers sharing that lock.
   */
  async enqueue(tx: Prisma.TransactionClient, input: EnqueueInput): Promise<string> {
    if (input.dedupeKey) {
      const existing = await tx.scheduledTask.findFirst({
        where: {
          dedupeKey: input.dedupeKey,
          status: { in: [ScheduledTaskStatus.PENDING, ScheduledTaskStatus.LEASED] },
        },
        select: { id: true },
      });

      if (existing) {
        return existing.id;
      }
    }

    await tx.$executeRaw`SAVEPOINT scheduled_task_enqueue`;

    try {
      const created = await tx.scheduledTask.create({
        data: {
          kind: input.kind,
          payload: input.payload,
          runAt: input.runAt,
          dedupeKey: input.dedupeKey,
          maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        },
      });

      await tx.$executeRaw`RELEASE SAVEPOINT scheduled_task_enqueue`;
      return created.id;
    } catch (error) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT scheduled_task_enqueue`;

      if (isUniqueViolation(error) && input.dedupeKey) {
        const existing = await tx.scheduledTask.findFirstOrThrow({
          where: {
            dedupeKey: input.dedupeKey,
            status: { in: [ScheduledTaskStatus.PENDING, ScheduledTaskStatus.LEASED] },
          },
          select: { id: true },
        });
        return existing.id;
      }

      throw error;
    }
  }

  /**
   * §19/OD-008: `SELECT ... FOR UPDATE SKIP LOCKED` against due PENDING tasks
   * and expired-lease LEASED tasks, atomically marking the claimed batch
   * leased to `this.workerId`. Two workers polling concurrently never claim
   * the same row — `SKIP LOCKED` makes the second worker's scan skip past
   * whatever the first is already holding, rather than blocking on it.
   */
  async claim(batchSize: number = DEFAULT_BATCH_SIZE): Promise<ScheduledTask[]> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const due = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM scheduled_tasks
        WHERE (status = 'PENDING' AND run_at <= ${now})
           OR (status = 'LEASED' AND lease_expires_at <= ${now})
        ORDER BY run_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      if (due.length === 0) {
        return [];
      }

      const ids = due.map((row) => row.id);
      const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);

      await tx.scheduledTask.updateMany({
        where: { id: { in: ids } },
        data: {
          status: ScheduledTaskStatus.LEASED,
          leaseOwner: this.workerId,
          leaseExpiresAt,
          attemptCount: { increment: 1 },
        },
      });

      return tx.scheduledTask.findMany({ where: { id: { in: ids } } });
    });
  }

  async complete(taskId: string): Promise<void> {
    await this.prisma.scheduledTask.update({
      where: { id: taskId },
      data: { status: ScheduledTaskStatus.DONE, leaseOwner: null, leaseExpiresAt: null },
    });
  }

  /**
   * OD-043c/d: retries with backoff until `maxAttempts`, then moves to the
   * terminal FAILED status. `minRunAt` (OD-053) is an optional lower bound on
   * the next attempt — e.g. Telegram 429's `retry_after` — applied on top of
   * (never instead of) the usual backoff computation.
   */
  async fail(taskId: string, errorMessage: string, minRunAt?: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });

      if (task.attemptCount >= task.maxAttempts) {
        await tx.scheduledTask.update({
          where: { id: taskId },
          data: {
            status: ScheduledTaskStatus.FAILED,
            lastError: errorMessage,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        return;
      }

      const backoffRunAt = new Date(Date.now() + backoffDelayMs(task.attemptCount));
      const runAt = minRunAt && minRunAt.getTime() > backoffRunAt.getTime() ? minRunAt : backoffRunAt;

      await tx.scheduledTask.update({
        where: { id: taskId },
        data: {
          status: ScheduledTaskStatus.PENDING,
          runAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: errorMessage,
        },
      });
    });
  }

  /** OD-053: terminal FAILED immediately, bypassing `maxAttempts` — for errors a consumer knows will never succeed on retry. */
  async failPermanently(taskId: string, errorMessage: string): Promise<void> {
    await this.prisma.scheduledTask.update({
      where: { id: taskId },
      data: {
        status: ScheduledTaskStatus.FAILED,
        lastError: errorMessage,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  async pollOnce(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;

    try {
      const tasks = await this.claim();

      for (const task of tasks) {
        const handler = this.handlers.get(task.kind);

        if (!handler) {
          await this.fail(task.id, `No handler registered for kind "${task.kind}"`);
          continue;
        }

        try {
          await handler(task.payload);
          await this.complete(task.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          if (error instanceof PermanentTaskError) {
            this.logger.warn(
              `Task ${task.id} (${task.kind}) failed permanently (status ${error.statusCode ?? 'n/a'})`,
            );
            await this.failPermanently(task.id, message);
            continue;
          }

          if (error instanceof RetryAfterError) {
            this.logger.warn(
              `Task ${task.id} (${task.kind}) failed, retrying after ${error.retryAfterMs}ms`,
            );
            await this.fail(task.id, message, new Date(Date.now() + error.retryAfterMs));
            continue;
          }

          this.logger.warn(`Task ${task.id} (${task.kind}) failed: ${message}`);
          await this.fail(task.id, message);
        }
      }
    } finally {
      this.polling = false;
    }
  }
}
