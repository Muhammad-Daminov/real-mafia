import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { CommandRequestService } from '../common/command-requests/command-request.service';

@Module({
  controllers: [RoomsController],
  providers: [RoomsService, CommandRequestService],
})
export class RoomsModule {}
