import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();