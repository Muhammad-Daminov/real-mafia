import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import type { RequestWithUser } from '../../auth/types/authenticated-user';
import { NightActionService } from './night-action.service';
import { SubmitNightActionDto } from './dto/submit-night-action.dto';

/**
 * §17.1-§17.3, mirrors §30.2 chat's `/games/:gameId/...` shape. `GET .../mine`
 * is scoped to the requesting player's own submissions only (§12.7's role
 * privacy rule — never another player's action or its result).
 */
@Controller('games/:gameId/night-actions')
@UseGuards(JwtGuard)
export class NightActionsController {
  constructor(private readonly nightActionService: NightActionService) {}

  @Post()
  submit(
    @Req() req: RequestWithUser,
    @Param('gameId') gameId: string,
    @Body() dto: SubmitNightActionDto,
  ) {
    return this.nightActionService.submitAction({
      userId: req.user.userId,
      gameId,
      clientRequestId: dto.clientRequestId,
      actionType: dto.actionType,
      targetPlayerId: dto.targetPlayerId,
      targetPlayerId2: dto.targetPlayerId2 ?? null,
    });
  }

  @Get('mine')
  getMine(@Req() req: RequestWithUser, @Param('gameId') gameId: string) {
    return this.nightActionService.getMyActions({ userId: req.user.userId, gameId });
  }
}
