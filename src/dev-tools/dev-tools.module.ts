import { Module } from '@nestjs/common';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsService } from './dev-tools.service';
import { BotPlayersService } from './bots/bot-players.service';
import { RoomsModule } from '../rooms/rooms.module';
import { GameEngineModule } from '../game-engine/game-engine.module';
import { SchedulingModule } from '../common/scheduling/scheduling.module';

/**
 * B-D1/B-D2: never imported unconditionally — see `dev-tools.config.ts`'s
 * `resolveDevToolsImports`, the only call site that ever puts this module
 * into `AppModule`'s `imports` array. `BotPlayersService` (B-D2) needs
 * `GameEngineModule` (for `NightActionService`/`VoteService`, the real
 * submission paths) and `SchedulingModule` (the same generic
 * `SchedulerService` `game-engine` itself already uses for
 * `PHASE_ADVANCE_CHECK`) — both are Nest singletons, so importing them
 * here shares the same instances `game-engine` already registered its own
 * handler on, not a second copy.
 */
@Module({
  imports: [RoomsModule, GameEngineModule, SchedulingModule],
  controllers: [DevToolsController],
  providers: [DevToolsService, BotPlayersService],
})
export class DevToolsModule {}
