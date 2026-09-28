import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SchedulerService } from '../scheduling/scheduler.service';
import { TelegramNotificationService } from './telegram-notification.service';
import { TELEGRAM_MESSAGE_TASK_KIND, TelegramMessageTaskPayload } from './outbox-task-kinds';

/**
 * §19/§25 (v5.0)/OD-051: TelegramNotificationService is the outbox
 * dispatcher's `TELEGRAM_MESSAGE` consumer, exercised here the same way
 * `scheduler.service.spec.ts`'s own `pollOnce` tests do — a real
 * `SchedulerService` against real Postgres, a real registered handler, only
 * the actual Telegram Bot API call mocked (no real external call in tests,
 * per this slice's test instructions).
 */
describe('TelegramNotificationService (integration)', () => {
  const prisma = new PrismaService();
  let createdTaskIds: string[] = [];
  let originalBotToken: string | undefined;
  let fetchSpy: jest.SpyInstance;

  const payload: TelegramMessageTaskPayload = {
    telegramId: 'telegram-notification-test-123',
    event: 'GAME_FINISHED',
    gameId: randomUUID(),
    winnerTeam: 'TOWN',
  };

  beforeAll(() => {
    originalBotToken = process.env.BOT_TOKEN;
    process.env.BOT_TOKEN = 'test-bot-token';
  });

  afterAll(async () => {
    process.env.BOT_TOKEN = originalBotToken;
    await prisma.$disconnect();
  });

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    if (createdTaskIds.length) {
      await prisma.scheduledTask.deleteMany({ where: { id: { in: createdTaskIds } } });
    }
    createdTaskIds = [];
  });

  const track = (id: string) => {
    createdTaskIds.push(id);
    return id;
  };

  const enqueue = (scheduler: SchedulerService, p: TelegramMessageTaskPayload = payload) =>
    prisma.$transaction((tx) =>
      scheduler.enqueue(tx, {
        kind: TELEGRAM_MESSAGE_TASK_KIND,
        payload: p as unknown as Prisma.InputJsonValue,
        runAt: new Date(Date.now() - 1_000),
      }),
    );

  /**
   * `claim()`'s `FOR UPDATE SKIP LOCKED` scan is global across the shared
   * `scheduled_tasks` table, unscoped by `kind` — by design (§19/OD-008), so
   * a single `pollOnce()` batch (size 10) can be filled by other suites'
   * concurrently-due `TELEGRAM_MESSAGE`/`PHASE_ADVANCE_CHECK` rows before
   * this test's own row is reached. Looping mirrors the real dispatcher's
   * persistent poll loop and converges quickly once the shared due-set
   * drains, rather than asserting on a single non-deterministic batch.
   */
  const pollUntilProcessed = async (scheduler: SchedulerService, taskId: string): Promise<void> => {
    for (let i = 0; i < 30; i++) {
      const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });
      if (task.status === 'DONE' || task.lastError !== null) {
        return;
      }
      await scheduler.pollOnce();
    }
    throw new Error(`pollUntilProcessed: task ${taskId} was not claimed within 30 polls`);
  };

  it('registers a handler for TELEGRAM_MESSAGE that calls the Telegram Bot API and completes the task', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);

    const scheduler = new SchedulerService(prisma);
    const service = new TelegramNotificationService(scheduler);
    service.onModuleInit();

    const taskId = track(await enqueue(scheduler));

    await pollUntilProcessed(scheduler, taskId);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-bot-token/sendMessage',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(payload.telegramId),
      }),
    );

    const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe('DONE');
  });

  it('OD-053: a 403 response (bot blocked) ends the task terminal FAILED after exactly one attempt, not the normal backoff retry', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"description":"Forbidden: bot was blocked by the user"}',
    } as Response);

    const scheduler = new SchedulerService(prisma);
    const service = new TelegramNotificationService(scheduler);
    service.onModuleInit();

    const taskId = track(await enqueue(scheduler));

    await pollUntilProcessed(scheduler, taskId);

    const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe('FAILED');
    expect(task.attemptCount).toBe(1);
    expect(task.lastError).toMatch(/Telegram sendMessage failed with status 403/);
  });

  it('a 500 Telegram response still feeds the existing fail()/backoff machinery, not a new retry mechanism', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '{"description":"Internal Server Error"}',
    } as Response);

    const scheduler = new SchedulerService(prisma);
    const service = new TelegramNotificationService(scheduler);
    service.onModuleInit();

    const taskId = track(await enqueue(scheduler));

    await pollUntilProcessed(scheduler, taskId);

    const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });
    // OD-043c/d's exact retry shape (same as any other scheduled_tasks
    // consumer): requeued PENDING with a future run_at, under max_attempts —
    // 5xx is not classified as permanent, per OD-052/OD-053.
    expect(task.status).toBe('PENDING');
    expect(task.attemptCount).toBe(1);
    expect(task.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(task.lastError).toMatch(/Telegram sendMessage failed with status 500/);
  });

  it('OD-053: a 429 response with retry_after floors the next attempt at that delay, then still retries normally', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => '{"description":"Too Many Requests","parameters":{"retry_after":37}}',
    } as Response);

    const scheduler = new SchedulerService(prisma);
    const service = new TelegramNotificationService(scheduler);
    service.onModuleInit();

    const beforePoll = Date.now();
    const taskId = track(await enqueue(scheduler));

    await pollUntilProcessed(scheduler, taskId);

    const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe('PENDING'); // retried, not terminal
    expect(task.attemptCount).toBe(1);
    // 37s floor comfortably exceeds OD-043c's base 5s backoff for attempt 1.
    expect(task.runAt.getTime()).toBeGreaterThanOrEqual(beforePoll + 37_000);
    expect(task.lastError).toMatch(/Telegram sendMessage failed with status 429/);
  });

  it('a rejected fetch call (network failure) also feeds fail(), not an unhandled rejection', async () => {
    fetchSpy.mockRejectedValue(new Error('network unreachable'));

    const scheduler = new SchedulerService(prisma);
    const service = new TelegramNotificationService(scheduler);
    service.onModuleInit();

    const taskId = track(await enqueue(scheduler));

    await pollUntilProcessed(scheduler, taskId);

    const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe('PENDING');
    expect(task.lastError).toMatch(/network unreachable/);
  });

  it('deliver rejects immediately if BOT_TOKEN is not configured, without calling fetch', async () => {
    const savedToken = process.env.BOT_TOKEN;
    delete process.env.BOT_TOKEN;
    try {
      const scheduler = new SchedulerService(prisma);
      const service = new TelegramNotificationService(scheduler);

      await expect(service.deliver(payload)).rejects.toThrow('BOT_TOKEN is not configured');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      process.env.BOT_TOKEN = savedToken;
    }
  });
});
