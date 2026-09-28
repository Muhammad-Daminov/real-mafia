import { Module } from '@nestjs/common';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsService } from './dev-tools.service';
import { RoomsModule } from '../rooms/rooms.module';

/**
 * B-D1: never imported unconditionally — see `dev-tools.config.ts`'s
 * `resolveDevToolsImports`, the only call site that ever puts this module
 * into `AppModule`'s `imports` array.
 */
@Module({
  imports: [RoomsModule],
  controllers: [DevToolsController],
  providers: [DevToolsService],
})
export class DevToolsModule {}
