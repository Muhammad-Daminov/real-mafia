import 'dotenv/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SchedulerService, backoffDelayMs } from './scheduler.service';

/**
 * §19/OD-008/OD-043: SchedulerService is the generic scheduled-task worker
 * infrastructure — these tests exercise it standalone, with no game-engine
 * involvement at all (a bare `kind`/`payload` pair), proving the module is
 * genuinely domain-agnostic.
 */
describe('SchedulerService (integration)', () => {
  const prisma = new PrismaService();
  let createdTaskIds: string[] = [];

  const TEST_KIND = 'TEST_TASK';

  afterEach(async () => {
    if (createdTaskIds.length) {
      await prisma.scheduledTask.deleteMany({ where: { id: { in: createdTaskIds } } });
    }
    createdTaskIds = [];
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const track = (id: string) => {
    createdTaskIds.push(id);
    return id;
  };

  it('enqueue inserts a PENDING task with attempt_count 0', async () => {
    const scheduler = new SchedulerService(prisma);
    const runAt = new Date(Date.now() + 60_000);

    const taskId = await prisma.$transaction((tx) =>
      scheduler.enqueue(tx, { kind: TEST_KIND, payload: { n: 1 }, runAt }),
    );
    track(taskId);

    const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe('PENDING');
    expect(task.attemptCount).toBe(0);
    expect(task.maxAttempts).toBe(10); // OD-043d default
    expect(task.kind).toBe(TEST_KIND);
    expect(task.runAt.getTime()).toBe(runAt.getTime());
  });

  it('enqueue with a dedupeKey is idempotent: a second call while the first is still PENDING/LEASED returns the same task', async () => {
    const scheduler = new SchedulerService(prisma);
    const dedupeKey = `test-dedupe:${randomUUID()}`;
    const runAt = new Date(Date.now() + 60_000);

    const firstId = await prisma.$transaction((tx) =>
      scheduler.enqueue(tx, { kind: TEST_KIND, payload: {}, runAt, dedupeKey }),
    );
    track(firstId);

    const secondId = await prisma.$transaction((tx) =>
      scheduler.enqueue(tx, {
        kind: TEST_KIND,
        payload: {},
        runAt: new Date(Date.now() + 120_000),
        dedupeKey,
      }),
    );

    expect(secondId).toBe(firstId);

    const count = await prisma.scheduledTask.count({ where: { dedupeKey } });
    expect(count).toBe(1); // no duplicate piled up
  });

  it('enqueue with a dedupeKey creates a new task once the previous one reached a terminal status', async () => {
    const scheduler = new SchedulerService(prisma);
    const dedupeKey = `test-dedupe:${randomUUID()}`;

    const firstId = await prisma.$transaction((tx) =>
      scheduler.enqueue(tx, { kind: TEST_KIND, payload: {}, runAt: new Date(), dedupeKey }),
    );
    track(firstId);
    await scheduler.complete(firstId);

    const secondId = await prisma.$transaction((tx) =>
      scheduler.enqueue(tx, { kind: TEST_KIND, payload: {}, runAt: new Date(), dedupeKey }),
    );
    track(secondId);

    expect(secondId).not.toBe(firstId);

    const count = await prisma.scheduledTask.count({ where: { dedupeKey } });
    expect(count).toBe(2);
  });

  it('claim only returns due PENDING tasks, marks them LEASED, and increments attempt_count', async () => {
    const scheduler = new SchedulerService(prisma);

    const dueId = await prisma.$transaction((tx) =>
      scheduler.enqueue(tx, { kind: TEST_KIND, payload: {}, runAt: new Date(Date.now() - 1_000) }),
    );
    track(dueId);
    const notYetDueId = await prisma.$transaction((tx) =>
      scheduler.enqueue(tx, { kind: TEST_KIND, payload: {}, runAt: new Date(Date.now() + 60_000) }),
    );
    track(notYetDueId);

    const claimed = await scheduler.claim(10);
    const claimedIds = claimed.map((t) => t.id);

    expect(claimedIds).toContain(dueId);
    expect(claimedIds).not.toContain(notYetDueId);

    const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: dueId } });
    expect(task.status).toBe('LEASED');
    expect(task.attemptCount).toBe(1);
    expect(task.leaseOwner).not.toBeNull();
    expect(task.leaseExpiresAt).not.toBeNull();
  });

  it('under two SchedulerService instances (simulated separate workers) polling the same due task, exactly one claims it — SKIP LOCKED proven, not assumed', async () => {
    const workerA = new SchedulerService(prisma);
    const workerB = new SchedulerService(prisma);

    const taskId = await prisma.$transaction((tx) =>
      workerA.enqueue(tx, { kind: TEST_KIND, payload: {}, runAt: new Date(Date.now() - 1_000) }),
    );
    track(taskId);

    const [claimedA, claimedB] = await Promise.all([workerA.claim(10), workerB.claim(10)]);

    const aHasIt = claimedA.some((t) => t.id === taskId);
    const bHasIt = claimedB.some((t) => t.id === taskId);

    // exactly one of the two claimed it — never both, never neither
    expect(aHasIt !== bHasIt).toBe(true);

    const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe('LEASED');
    expect(task.attemptCount).toBe(1); // claimed exactly once, not twice
  });

  it('a crashed worker (claims but never completes/fails) leaves the task reclaimable once its lease expires', async () => {
    const scheduler = new SchedulerService(prisma);

    const taskId = await prisma.$transaction((tx) =>
      scheduler.enqueue(tx, { kind: TEST_KIND, payload: {}, runAt: new Date(Date.now() - 1_000) }),
    );
    track(taskId);

    const firstClaim = await scheduler.claim(10);
    expect(firstClaim.map((t) => t.id)).toContain(taskId);

    // Immediately after claiming, the lease hasn't expired yet — a second
    // worker must not be able to reclaim it.
    const tooEarly = await scheduler.claim(10);
    expect(tooEarly.map((t) => t.id)).not.toContain(taskId);

    // Simulate the crash: fast-forward past lease_expires_at directly in the
    // DB (the "crashed worker" never calls complete/fail).
    await prisma.scheduledTask.update({
      where: { id: taskId },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    const reclaimed = await scheduler.claim(10);
    expect(reclaimed.map((t) => t.id)).toContain(taskId);

    const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe('LEASED');
    expect(task.attemptCount).toBe(2); // claimed twice: original + reclaim
  });

  it('complete marks the task DONE and clears the lease', async () => {
    const scheduler = new SchedulerService(prisma);

    const taskId = await prisma.$transaction((tx) =>
      scheduler.enqueue(tx, { kind: TEST_KIND, payload: {}, runAt: new Date(Date.now() - 1_000) }),
    );
    track(taskId);
    await scheduler.claim(10);

    await scheduler.complete(taskId);

    const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe('DONE');
    expect(task.leaseOwner).toBeNull();
    expect(task.leaseExpiresAt).toBeNull();
  });

  it('fail re-queues as PENDING with a future run_at when under max_attempts (OD-043c backoff)', async () => {
    const scheduler = new SchedulerService(prisma);

    const taskId = await prisma.$transaction((tx) =>
      scheduler.enqueue(tx, { kind: TEST_KIND, payload: {}, runAt: new Date(Date.now() - 1_000) }),
    );
    track(taskId);
    await scheduler.claim(10); // attemptCount -> 1

    const beforeFail = Date.now();
    await scheduler.fail(taskId, 'boom');

    const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe('PENDING');
    expect(task.leaseOwner).toBeNull();
    expect(task.leaseExpiresAt).toBeNull();
    expect(task.lastError).toBe('boom');
    expect(task.runAt.getTime()).toBeGreaterThan(beforeFail); // pushed into the future
  });

  it('fail moves the task to FAILED (terminal) once attempt_count reaches max_attempts (OD-043d)', async () => {
    const scheduler = new SchedulerService(prisma);

    const taskId = await prisma.$transaction((tx) =>
      scheduler.enqueue(tx, {
        kind: TEST_KIND,
        payload: {},
        runAt: new Date(Date.now() - 1_000),
        maxAttempts: 1,
      }),
    );
    track(taskId);
    await scheduler.claim(10); // attemptCount -> 1 === maxAttempts

    await scheduler.fail(taskId, 'still broken');

    const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe('FAILED');
    expect(task.lastError).toBe('still broken');
  });

  it('registerHandler refuses a second registration for the same kind', () => {
    const scheduler = new SchedulerService(prisma);
    scheduler.registerHandler('DUPLICATE_KIND', async () => {});
    expect(() => scheduler.registerHandler('DUPLICATE_KIND', async () => {})).toThrow();
  });

  it('pollOnce claims a due task, dispatches it to its registered handler, and marks it complete', async () => {
    const scheduler = new SchedulerService(prisma);
    const kind = `TEST_DISPATCH_${randomUUID()}`;
    const seen: unknown[] = [];

    scheduler.registerHandler(kind, async (payload) => {
      seen.push(payload);
    });

    const taskId = await prisma.$transaction((tx) =>
      scheduler.enqueue(tx, {
        kind,
        payload: { hello: 'world' },
        runAt: new Date(Date.now() - 1_000),
      }),
    );
    track(taskId);

    await scheduler.pollOnce();

    expect(seen).toEqual([{ hello: 'world' }]);

    const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe('DONE');
  });

  it('pollOnce fails a task with no registered handler instead of dropping it silently', async () => {
    const scheduler = new SchedulerService(prisma);

    const taskId = await prisma.$transaction((tx) =>
      scheduler.enqueue(tx, {
        kind: `NO_HANDLER_${randomUUID()}`,
        payload: {},
        runAt: new Date(Date.now() - 1_000),
      }),
    );
    track(taskId);

    await scheduler.pollOnce();

    const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe('PENDING'); // requeued via fail(), under max_attempts
    expect(task.lastError).toMatch(/No handler registered/);
  });

  describe('backoffDelayMs (OD-043c)', () => {
    it('grows exponentially and is capped at 5 minutes', () => {
      // Strip jitter's effect by checking bounds rather than exact values.
      expect(backoffDelayMs(1)).toBeGreaterThanOrEqual(4_000);
      expect(backoffDelayMs(1)).toBeLessThanOrEqual(6_000);

      expect(backoffDelayMs(2)).toBeGreaterThanOrEqual(8_000);
      expect(backoffDelayMs(2)).toBeLessThanOrEqual(12_000);

      expect(backoffDelayMs(10)).toBeLessThanOrEqual(360_000); // capped at 5min + jitter headroom
    });
  });
});
