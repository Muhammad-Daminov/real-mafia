import 'dotenv/config';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL!,
    });

    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  /** B-H1: `PrismaModule` is `@Global()`, so this fires once, during
   * `app.enableShutdownHooks()`'s shutdown sequence — after every other
   * module's own destroy hook has had a chance to finish its last query
   * (Nest runs `onModuleDestroy` in reverse-registration order), not
   * racing them for the connection. */
  async onModuleDestroy() {
    await this.$disconnect();
  }
}