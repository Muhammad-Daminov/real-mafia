import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RoomsModule } from './rooms/rooms.module';
import { GameEngineModule } from './game-engine/game-engine.module';
import { OutboxModule } from './common/outbox/outbox.module';
import { resolveDevToolsImports } from './dev-tools/dev-tools.config';

@Module({
  // B-D1: `resolveDevToolsImports()` returns `[DevToolsModule]` only when
  // `DEV_TOOLS_ENABLED === 'true'` and `NODE_ENV !== 'production'`,
  // otherwise `[]` — DevToolsModule (and its `/dev/rooms/:code/fill-bots`
  // route) then simply doesn't exist in the module graph. Throws at
  // import time (before `main.ts` ever calls `app.listen()`) if
  // `DEV_TOOLS_ENABLED` is set at all while `NODE_ENV=production`.
  imports: [
    PrismaModule,
    UsersModule,
    AuthModule,
    RoomsModule,
    GameEngineModule,
    OutboxModule,
    ...resolveDevToolsImports(),
  ],
})
export class AppModule {}