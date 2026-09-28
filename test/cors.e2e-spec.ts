import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { httpCorsOptions } from '../src/common/config/cors';

/**
 * Mirrors `main.ts`'s `app.enableCors(httpCorsOptions())` call exactly —
 * `app.init()` alone (unlike `bootstrap()`) does not run it, so it has to
 * be applied here too for this to test the real wiring, not a re-guess of it.
 *
 * Requests target `POST /auth/telegram` — the one genuinely public,
 * unauthenticated route (`AppController`'s `GET /` exists as a file but is
 * never registered in `AppModule`'s `controllers` array, a pre-existing gap
 * unrelated to this change, confirmed by the same 404 appearing on the
 * `main` branch before this slice's edits). An empty body 400s on
 * `initData` validation, which is irrelevant here — Nest's CORS middleware
 * sets the header on every response regardless of status code.
 */
describe('CORS (e2e)', () => {
  let app: INestApplication<App>;
  const originalCorsOrigins = process.env.CORS_ORIGINS;

  beforeAll(async () => {
    process.env.CORS_ORIGINS = 'https://allowed.example.com';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableCors(httpCorsOptions());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (originalCorsOrigins === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = originalCorsOrigins;
    }
  });

  it('sets Access-Control-Allow-Origin for a request from an allowed origin', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/telegram')
      .set('Origin', 'https://allowed.example.com')
      .send({});

    expect(response.headers['access-control-allow-origin']).toBe('https://allowed.example.com');
  });

  it('omits Access-Control-Allow-Origin for a request from a disallowed origin', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/telegram')
      .set('Origin', 'https://evil.example.com')
      .send({});

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never allows the literal wildcard origin', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/telegram')
      .set('Origin', '*')
      .send({});

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
