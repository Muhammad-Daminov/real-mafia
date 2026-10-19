import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { TelegramModule } from './telegram.module';

/**
 * B-T2: `POST /telegram/webhook` exercised end to end (real guard, real
 * controller, real service, real global `ValidationPipe` config — same
 * `whitelist`/`forbidNonWhitelisted`/`transform` `main.ts` applies) —
 * only the actual Telegram Bot API call (`global.fetch`) is mocked, same
 * convention `common/outbox/telegram-notification.service.spec.ts`
 * already established. No DB dependency — `TelegramModule` has none.
 */
describe('TelegramWebhookController (e2e)', () => {
  let app: INestApplication<App>;
  let fetchSpy: jest.SpyInstance;

  const originalEnv = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    MINI_APP_URL: process.env.MINI_APP_URL,
  };

  const SECRET = 'test-webhook-secret';
  const MINI_APP_URL = 'https://mini-app.example.com';

  beforeAll(async () => {
    process.env.BOT_TOKEN = 'test-bot-token';
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    process.env.MINI_APP_URL = MINI_APP_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TelegramModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.BOT_TOKEN = originalEnv.BOT_TOKEN;
    process.env.TELEGRAM_WEBHOOK_SECRET = originalEnv.TELEGRAM_WEBHOOK_SECRET;
    process.env.MINI_APP_URL = originalEnv.MINI_APP_URL;
  });

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const startMessage = (overrides: Partial<Record<string, unknown>> = {}) => ({
    update_id: Math.floor(Math.random() * 1_000_000_000),
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 555, type: 'private' },
      from: { id: 555, is_bot: false },
      text: '/start',
      ...overrides,
    },
  });

  it('401s when the secret header is missing', async () => {
    const response = await request(app.getHttpServer())
      .post('/telegram/webhook')
      .send(startMessage());

    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('401s when the secret header is wrong', async () => {
    const response = await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', 'wrong-secret')
      .send(startMessage());

    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses every request (401) when TELEGRAM_WEBHOOK_SECRET is unset — fails closed, not open', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    try {
      const response = await request(app.getHttpServer())
        .post('/telegram/webhook')
        .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
        .send(startMessage());

      expect(response.status).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    }
  });

  it('a valid /start sends one sendMessage with a web_app button pointing at MINI_APP_URL', async () => {
    const response = await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send(startMessage());

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bottest-bot-token/sendMessage');
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe(555);
    expect(body.reply_markup.inline_keyboard[0][0]).toEqual({
      text: "O'ynash",
      web_app: { url: MINI_APP_URL },
    });
  });

  it('"/start <payload>" is handled the same as a bare /start', async () => {
    const response = await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send(startMessage({ text: '/start room_ABC123' }));

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a duplicate update_id sends only once', async () => {
    const message = startMessage();

    const first = await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send(message);
    const second = await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send(message);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('an unknown update type (no message) is a 200 no-op', async () => {
    const response = await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send({ update_id: 42, edited_message: { text: 'hi' } });

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a message with non-/start text is a 200 no-op', async () => {
    const response = await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send(startMessage({ text: 'hello there' }));

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never sends to a bot sender', async () => {
    const response = await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send(startMessage({ from: { id: 999, is_bot: true } }));

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never sends to a negative (group/channel) chat id', async () => {
    const response = await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send(startMessage({ chat: { id: -100123, type: 'supergroup' } }));

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores an update older than the staleness window', async () => {
    const response = await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send(startMessage({ date: Math.floor(Date.now() / 1000) - 3600 }));

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still returns 200 when sendMessage fails', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Server Error' } as Response);

    const response = await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send(startMessage());

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('still returns 200 when the send itself throws (network failure)', async () => {
    fetchSpy.mockRejectedValue(new Error('network unreachable'));

    const response = await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send(startMessage());

    expect(response.status).toBe(200);
  });

  it('an arbitrary Telegram update shape is never rejected by the global ValidationPipe (whitelist/forbidNonWhitelisted)', async () => {
    const response = await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send({
        update_id: 7,
        callback_query: { id: 'abc', data: 'x' },
        some_future_field_this_frontend_has_never_heard_of: { nested: true },
      });

    expect(response.status).toBe(200);
  });
});
