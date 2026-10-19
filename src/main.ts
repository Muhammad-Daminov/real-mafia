import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { httpCorsOptions } from './common/config/cors';
import { formatEnvIssues, validateEnv } from './common/config/env-validation';

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

async function bootstrap() {
  validateEnvOrExit();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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

  // Render (and most PaaS containers) only route traffic to a process
  // listening on all interfaces — binding to the implicit default (which
  // on some Node builds resolves to IPv6-only or localhost-only) can leave
  // the platform's own health check unable to reach the port it just
  // injected via PORT.
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

bootstrap();
