import { Controller, INestApplication, Post } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp, JSON_BODY_LIMIT } from './main';
import { HealthModule } from './health/health.module';

@Controller('test-echo')
class TestEchoController {
  @Post()
  echo() {
    return { ok: true };
  }
}

/**
 * B-H1: `configureApp` (extracted from `bootstrap()` in this same file
 * specifically so it's testable without binding a real port) applied to a
 * real `NestExpressApplication` + supertest — proves the actual response
 * headers/limits, not just that the right functions were called.
 */
describe('configureApp (B-H1: security headers, body limit)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
      controllers: [TestEchoController],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app as NestExpressApplication);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('never sends X-Powered-By', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('sends Helmet security headers (nosniff, frame-deny) without a Content-Security-Policy (pure JSON API)', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['content-security-policy']).toBeUndefined();
  });

  it('sends Cross-Origin-Resource-Policy: cross-origin, not Helmet\'s same-origin default', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('enables HSTS without preload', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['strict-transport-security']).not.toContain('preload');
  });

  it(`accepts a JSON body at the ${JSON_BODY_LIMIT} limit`, async () => {
    // ~90kb of payload, comfortably under the 100kb limit including JSON overhead.
    const body = { data: 'a'.repeat(90 * 1024) };
    await request(app.getHttpServer()).post('/test-echo').send(body).expect(201);
  });

  it(`rejects a JSON body over the ${JSON_BODY_LIMIT} limit with 413`, async () => {
    const body = { data: 'a'.repeat(150 * 1024) };
    await request(app.getHttpServer()).post('/test-echo').send(body).expect(413);
  });

  it('echoes a distinct X-Request-Id on every response', async () => {
    const first = await request(app.getHttpServer()).get('/health');
    const second = await request(app.getHttpServer()).get('/health');
    expect(first.headers['x-request-id']).toBeDefined();
    expect(second.headers['x-request-id']).toBeDefined();
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });
});
