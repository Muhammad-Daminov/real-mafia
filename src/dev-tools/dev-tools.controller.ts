import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import type { RequestWithUser } from '../auth/types/authenticated-user';
import { DevToolsService } from './dev-tools.service';
import { FillBotsDto } from './dto/fill-bots.dto';

/**
 * B-D1: dev-only. This controller is only ever registered when
 * `DevToolsModule` is included — see `dev-tools.config.ts`'s
 * `resolveDevToolsImports` (gated by `DEV_TOOLS_ENABLED` + `NODE_ENV`,
 * never reachable in production).
 */
@Controller('dev/rooms')
@UseGuards(JwtGuard)
export class DevToolsController {
  constructor(private readonly devTools: DevToolsService) {}

  @Post(':code/fill-bots')
  fillBots(@Req() req: RequestWithUser, @Param('code') code: string, @Body() dto: FillBotsDto) {
    return this.devTools.fillBots({
      code,
      requesterUserId: req.user.userId,
      count: dto.count,
      ready: dto.ready ?? false,
    });
  }
}
