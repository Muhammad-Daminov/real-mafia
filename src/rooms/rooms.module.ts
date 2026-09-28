import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { CommandRequestService } from '../common/command-requests/command-request.service';
import { GameEngineModule } from '../game-engine/game-engine.module';
import { RealtimeModule } from '../common/realtime/realtime.module';

@Module({
  imports: [GameEngineModule, RealtimeModule],
  controllers: [RoomsController],
  providers: [RoomsService, CommandRequestService],
})
export class RoomsModule {}
