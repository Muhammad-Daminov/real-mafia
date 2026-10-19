import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { httpCorsOptions } from './common/config/cors';
import { formatEnvIssues, validateEnv } from './common/config/env-validation';
import { requestLoggerMiddleware } from './common/logging/request-logger.middleware';

/** B-H1: JSON/urlencoded body cap (task: "e.g. 100kb") — set explicitly via
 * `useBodyParser` rather than relying on body-parser's own default (which
 * happens to already be 100kb, but an implicit default isn't a documented
 * intentional limit). `NestFactory.create`'s own automatic parser
 * registration is turned off below (`bodyParser: false`) so this is the
 * only JSON parser in the chain, not a second one stacked on top of it. */
export const JSON_BODY_LIMIT = '100kb';

/**
 * B-H1: runs before `AppModule` is ever instantiated — a bad/missing
 * `DATABASE_URL` or a too-short `JWT_SECRET` fails here instead of
 * surfacing as a confusing downstream connection error or a silently weak
 * token later. Never logs a value, only variable names (see
 * `env-validation.ts`'s own docstring).
 */
function validateEnvOrExit(): void {
  const logger = new Logger('Bootstrap');
  const { errors, warnings } = validateEnv(process.env);

  if (warnings.length > 0) {
    logger.warn(`Environment warnings (app will still start):\n${formatEnvIssues(warnings)}`);
  }

  if (errors.length > 0) {
    logger.error(`Refusing to start — invalid environment configuration:\n${formatEnvIssues(errors)}`);
    process.exit(1);
  }
}

/**
 * B-H1: every process-wide middleware/pipe/header concern this slice adds
 * or confirms, extracted out of `bootstrap()` so it's callable (and its
 * effects on a live app testable via supertest) without also binding a
 * real port — `bootstrap()` below is the one real caller, a test is the
 * other. Does NOT call `app.listen()` — that stays the caller's job.
 */
export function configureApp(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { extended: true, limit: JSON_BODY_LIMIT });

  // B-H1: security headers. `contentSecurityPolicy`/`crossOriginResourcePolicy`
  // are explicitly relaxed — this process serves a pure JSON API (and
  // Socket.IO's own polling/upgrade handshake) to a cross-origin Mini App
  // frontend, never HTML, so Helmet's HTML-oriented CSP defaults have
  // nothing to protect and `crossOriginResourcePolicy: 'same-origin'`
  // (Helmet's own default) would otherwise risk a browser blocking the
  // frontend's own cross-origin fetches. HSTS stays at Helmet's default
  // (enabled, `preload` false) — "do not enable HSTS preload" is this
  // slice's own explicit instruction, satisfied by never passing
  // `preload: true`, not by disabling HSTS outright.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  // Helmet's own `hidePoweredBy` middleware already strips this; disabling
  // it at the Express `Settings` level too is the belt-and-suspenders,
  // dependency-independent way to satisfy "disable x-powered-by" literally.
  app.disable('x-powered-by');

  // B-H1: one log line per request, with a request id — never headers,
  // body, or query string (see the middleware's own docstring).
  app.use(requestLoggerMiddleware);

  // Mini App frontend origin allow-list (common/config/cors.ts) — the same
  // list the /game Socket.IO gateway's own `cors` option reads, so HTTP and
  // websocket origins can't drift apart.
  app.enableCors(httpCorsOptions());

  // Per-IP rate limiting (§6.3) reads the client IP, but behind the load
  // balancer of §6.1 every request otherwise appears to come from the LB.
  // The number of trusted proxy hops is deployment topology, which is not yet
  // decided (Phase 20 / OD-009), so this stays opt-in: unset means "no proxy",
  // which is the correct behaviour for a directly-exposed process.
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS);

  if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
    app.set('trust proxy', trustProxyHops);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // B-H1: Render sends SIGTERM on restart/redeploy. Without this, Nest
  // never listens for it at all — the process would be killed outright,
  // mid-request and mid-scheduled-task, instead of letting each module's
  // own `OnModuleDestroy`/`onApplicationShutdown` hook run first
  // (`SchedulerService` stops polling and lets its current `pollOnce`
  // finish; `PrismaService` disconnects; the HTTP/Socket.IO server stops
  // accepting new connections and closes existing ones) — see those
  // services' own docstrings for what "cleanly" means for each.
  app.enableShutdownHooks();
}

async function bootstrap() {
  validateEnvOrExit();

  // `bodyParser: false` — this app registers its own (`useBodyParser`,
  // inside `configureApp`, with an explicit size limit) instead of Nest's
  // automatic unlimited-by-default-options one, so there is exactly one
  // JSON parser in the middleware chain, not two stacked on each other.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  configureApp(app);

  // Render (and most PaaS containers) only route traffic to a process
  // listening on all interfaces — binding to the implicit default (which
  // on some Node builds resolves to IPv6-only or localhost-only) can leave
  // the platform's own health check unable to reach the port it just
  // injected via PORT.
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

// `require.main === module` — only auto-run when this file is the actual
// process entry point (`node dist/src/main`, `nest start`), never when a
// test (or anything else) imports `configureApp`/`JSON_BODY_LIMIT` from it,
// which would otherwise try to boot a second real app and bind a second
// real port as a side effect of that import.
if (require.main === module) {
  bootstrap();
}
