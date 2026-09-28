import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RoomsModule } from './rooms/rooms.module';
import { GameEngineModule } from './game-engine/game-engine.module';
import { OutboxModule } from './common/outbox/outbox.module';

@Module({
  imports: [PrismaModule, UsersModule, AuthModule, RoomsModule, GameEngineModule, OutboxModule],
})
export class AppModule {}