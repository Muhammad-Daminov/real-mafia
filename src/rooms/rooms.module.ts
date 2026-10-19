import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { CommandRequestService } from '../common/command-requests/command-request.service';
import { GameEngineModule } from '../game-engine/game-engine.module';
import { RealtimeModule } from '../common/realtime/realtime.module';
import { commandThrottlerOptions } from '../common/config/throttler';
import { UserThrottlerGuard } from '../common/guards/user-throttler.guard';

@Module({
  // B-H1: `ThrottlerModule.forRoot` isn't `@Global()` — this module needs
  // its own registration (same per-module shape `AuthModule` already uses
  // for its stricter `/auth/telegram` limit) so `RoomsController`'s
  // `UserThrottlerGuard` has `THROTTLER_OPTIONS`/storage to inject.
  imports: [GameEngineModule, RealtimeModule, ThrottlerModule.forRoot(commandThrottlerOptions())],
  controllers: [RoomsController],
  providers: [RoomsService, CommandRequestService, UserThrottlerGuard],
  // B-D1: DevToolsModule injects RoomsService to join synthetic bot players
  // through the real join/ready path (fill-bots), rather than writing to
  // game_players directly.
  exports: [RoomsService],
})
export class RoomsModule {}
