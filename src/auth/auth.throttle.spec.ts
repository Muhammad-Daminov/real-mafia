import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  AUTH_TELEGRAM_RATE_LIMIT,
  AUTH_TELEGRAM_RATE_LIMIT_TTL_MS,
  AUTH_TELEGRAM_THROTTLER_NAME,
} from './auth.constants';

/**
 * F-06 (docs/audit/GAP_REPORT.md): `POST /auth/telegram` is public and
 * unauthenticated, and was previously unthrottled. Master TZ §6.3 puts a rate
 * limit immediately after authentication in the canonical command path; the
 * endpoint table carried into §30 (v5.0 §32.1) sets it at 10 req/min per IP.
 */
describe('POST /auth/telegram — rate limiting', () => {
  let app: INestApplication;
  let loginWithTelegram: jest.Mock;

  beforeEach(async () => {
    loginWithTelegram = jest.fn().mockResolvedValue({ accessToken: 'token' });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            name: AUTH_TELEGRAM_THROTTLER_NAME,
            ttl: AUTH_TELEGRAM_RATE_LIMIT_TTL_MS,
            limit: AUTH_TELEGRAM_RATE_LIMIT,
          },
        ]),
      ],
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: { loginWithTelegram } }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const post = () =>
    request(app.getHttpServer())
      .post('/auth/telegram')
      .send({ initData: 'stub' });

  it('configures the limit at 10 requests per minute', () => {
    expect(AUTH_TELEGRAM_RATE_LIMIT).toBe(10);
    expect(AUTH_TELEGRAM_RATE_LIMIT_TTL_MS).toBe(60_000);
  });

  it(`allows the first ${AUTH_TELEGRAM_RATE_LIMIT} requests from one IP`, async () => {
    for (let i = 0; i < AUTH_TELEGRAM_RATE_LIMIT; i += 1) {
      await post().expect(201);
    }

    expect(loginWithTelegram).toHaveBeenCalledTimes(AUTH_TELEGRAM_RATE_LIMIT);
  });

  it('rejects the request past the limit with 429 and does not reach the service', async () => {
    for (let i = 0; i < AUTH_TELEGRAM_RATE_LIMIT; i += 1) {
      await post().expect(201);
    }

    await post().expect(429);

    // The throttled request must be rejected before any auth work happens.
    expect(loginWithTelegram).toHaveBeenCalledTimes(AUTH_TELEGRAM_RATE_LIMIT);
  });

  it('ignores a spoofed X-Forwarded-For when no proxy is trusted', async () => {
    for (let i = 0; i < AUTH_TELEGRAM_RATE_LIMIT; i += 1) {
      await post().expect(201);
    }

    // With `trust proxy` off (the default), a caller cannot escape their own
    // bucket just by asserting a different forwarded IP.
    await request(app.getHttpServer())
      .post('/auth/telegram')
      .set('X-Forwarded-For', '203.0.113.9')
      .send({ initData: 'stub' })
      .expect(429);
  });

  it('tracks the limit per forwarded IP once a proxy hop is trusted (§6.1)', async () => {
    // Mirrors bootstrap()'s TRUST_PROXY_HOPS handling in main.ts.
    app.getHttpAdapter().getInstance().set('trust proxy', 1);

    const fromIp = (ip: string) =>
      request(app.getHttpServer())
        .post('/auth/telegram')
        .set('X-Forwarded-For', ip)
        .send({ initData: 'stub' });

    for (let i = 0; i < AUTH_TELEGRAM_RATE_LIMIT; i += 1) {
      await fromIp('198.51.100.4').expect(201);
    }

    await fromIp('198.51.100.4').expect(429);

    // A different client behind the same load balancer is unaffected.
    await fromIp('203.0.113.9').expect(201);
  });
});
