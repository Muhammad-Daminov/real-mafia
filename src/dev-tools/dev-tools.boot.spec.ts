import 'dotenv/config';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { resolveDevToolsImports } from './dev-tools.config';

/**
 * Registers just enough for `JwtGuard` (`AuthGuard('jwt')`) to find its
 * passport strategy — `JwtStrategy` has no constructor dependencies of its
 * own (reads `JWT_SECRET` from `process.env` directly), so this avoids
 * pulling in the real `AuthModule`'s `ThrottlerModule.forRoot(...)`, whose
 * default in-memory storage starts an un-`.unref()`'d cleanup
 * `setInterval` that outlives `app.close()` and was leaving this spec's
 * Jest worker unable to exit — irrelevant to what this spec actually
 * verifies (route presence/absence), so sidestepped rather than worked
 * around.
 */
@Module({ providers: [JwtStrategy] })
class TestAuthStrategyModule {}

/**
 * B-D1: proves the actual route table, not just `resolveDevToolsImports`'s
 * return value in isolation (`dev-tools.config.spec.ts`). Builds a testing
 * module the same way `app.module.ts` builds its real one —
 * `imports: [...staticModules, ...resolveDevToolsImports()]` — using only
 * `PrismaModule` (for `RoomsModule`'s transitive `PrismaService` need) and
 * `TestAuthStrategyModule` (below — just enough for `JwtGuard` to find the
 * `jwt` passport strategy) as the static half, instead of the full
 * `AppModule`, which would drag in `UsersModule`/`OutboxModule`/etc. for
 * no benefit here.
 *
 * `resolveDevToolsImports()` is a plain function — called fresh per test
 * with different env, no module re-require/cache surgery needed. (An
 * earlier version of this test tried re-`require`-ing `AppModule` itself
 * per scenario; that broke Nest's DI because `jest.resetModules()`-style
 * cache eviction can't reliably distinguish "this project's own files"
 * from "node_modules" inside Jest's own module registry, so `@nestjs/*`
 * classes ended up duplicated across requires. Exercising the function
 * directly avoids the whole problem.)
 */
describe('DevToolsModule (boot / route-table, B-D1)', () => {
  const originalEnabled = process.env.DEV_TOOLS_ENABLED;
  const originalNodeEnv = process.env.NODE_ENV;
  let app: INestApplication | null = null;

  afterEach(async () => {
    if (app) {
      // `app.close()` alone does not disconnect `PrismaService` (it has no
      // `OnModuleDestroy` hook — same as the plain `new PrismaService()` +
      // manual `$disconnect()` in `afterAll` every other integration spec
      // in this codebase already needs), so do it explicitly here — this
      // is the first spec in this codebase to boot a full Nest
      // application rather than instantiating services directly, so this
      // gap was never hit before.
      await app.get(PrismaService).$disconnect();
      await app.close();
      app = null;
    }
    if (originalEnabled === undefined) {
      delete process.env.DEV_TOOLS_ENABLED;
    } else {
      process.env.DEV_TOOLS_ENABLED = originalEnabled;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  function setEnv(env: { DEV_TOOLS_ENABLED?: string; NODE_ENV?: string }): void {
    if (env.DEV_TOOLS_ENABLED === undefined) {
      delete process.env.DEV_TOOLS_ENABLED;
    } else {
      process.env.DEV_TOOLS_ENABLED = env.DEV_TOOLS_ENABLED;
    }
    if (env.NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = env.NODE_ENV;
    }
  }

  async function bootWith(env: { DEV_TOOLS_ENABLED?: string; NODE_ENV?: string }) {
    setEnv(env);
    const moduleFixture = await Test.createTestingModule({
      imports: [PrismaModule, TestAuthStrategyModule, ...resolveDevToolsImports()],
    }).compile();
    const nestApp = moduleFixture.createNestApplication();
    await nestApp.init();
    return nestApp;
  }

  it('the route is absent (404) when DEV_TOOLS_ENABLED is unset', async () => {
    app = await bootWith({ DEV_TOOLS_ENABLED: undefined, NODE_ENV: 'development' });

    const response = await request(app.getHttpServer()).post('/dev/rooms/ABCDEF/fill-bots').send({ count: 1 });

    expect(response.status).toBe(404);
  });

  it('the route exists (guard rejects with 401, not 404) when DEV_TOOLS_ENABLED=true and NODE_ENV is not production', async () => {
    app = await bootWith({ DEV_TOOLS_ENABLED: 'true', NODE_ENV: 'development' });

    const response = await request(app.getHttpServer()).post('/dev/rooms/ABCDEF/fill-bots').send({ count: 1 });

    // No Authorization header — JwtGuard rejects with 401, which only
    // happens if the route/controller is actually registered. A 404 here
    // would mean the module silently failed to load.
    expect(response.status).toBe(401);
  });

  it('boot fails fast when NODE_ENV=production and DEV_TOOLS_ENABLED is set at all', async () => {
    setEnv({ DEV_TOOLS_ENABLED: 'true', NODE_ENV: 'production' });

    expect(() =>
      Test.createTestingModule({ imports: [PrismaModule, TestAuthStrategyModule, ...resolveDevToolsImports()] }),
    ).toThrow(/DEV_TOOLS_ENABLED/);
  });
});
