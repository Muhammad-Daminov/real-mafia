import { CanActivate, Controller, ExecutionContext, INestApplication, Injectable, Post, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { UserThrottlerGuard } from './user-throttler.guard';
import { COMMAND_THROTTLER_NAME } from '../config/throttler';

const TEST_LIMIT = 3;
const TEST_TTL_MS = 60_000;

/** Stands in for `JwtGuard` — sets `req.user` from a header so each test
 * can simulate a different authenticated caller without real JWTs. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = { userId: req.headers['x-test-user-id'] };
    return true;
  }
}

@Controller('test-command')
@UseGuards(FakeAuthGuard, UserThrottlerGuard)
class TestCommandController {
  @Post()
  run() {
    return { ok: true };
  }
}

/**
 * B-H1: `UserThrottlerGuard` tracks by `req.user.userId` (set here by
 * `FakeAuthGuard`, standing in for the real `JwtGuard` every controller
 * this guard is applied to lists first) — distinct from
 * `auth.throttle.spec.ts`'s IP-tracked `/auth/telegram` limit, which this
 * mirrors structurally but is a genuinely different tracking key.
 */
describe('UserThrottlerGuard (command-endpoint rate limiting)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ name: COMMAND_THROTTLER_NAME, limit: TEST_LIMIT, ttl: TEST_TTL_MS }])],
      controllers: [TestCommandController],
      providers: [UserThrottlerGuard],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (userId: string) =>
    request(app.getHttpServer()).post('/test-command').set('X-Test-User-Id', userId).send({});

  it(`allows the first ${TEST_LIMIT} requests from one user`, async () => {
    for (let i = 0; i < TEST_LIMIT; i += 1) {
      await post('user-a').expect(201);
    }
  });

  it('rejects the request past the limit with 429 for that same user', async () => {
    for (let i = 0; i < TEST_LIMIT; i += 1) {
      await post('user-a').expect(201);
    }
    await post('user-a').expect(429);
  });

  it('tracks each user independently — a different user is unaffected by another user exhausting their own limit', async () => {
    for (let i = 0; i < TEST_LIMIT; i += 1) {
      await post('user-a').expect(201);
    }
    await post('user-a').expect(429);

    // user-b has its own, untouched budget.
    await post('user-b').expect(201);
  });
});
