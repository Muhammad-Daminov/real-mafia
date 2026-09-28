import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import type { RequestWithUser } from '../../auth/types/authenticated-user';
import { VoteService } from './vote.service';
import { CastVoteDto } from './dto/cast-vote.dto';

/**
 * §16/OD-018/OD-020, mirrors §30.2 chat's `/games/:gameId/...` shape. Unlike
 * night-actions' `mine`-scoped read, this game's tally read is
 * OD-020(a)-public — every current-round vote, not just the caller's own.
 */
@Controller('games/:gameId/votes')
@UseGuards(JwtGuard)
export class VotingController {
  constructor(private readonly voteService: VoteService) {}

  @Post()
  cast(@Req() req: RequestWithUser, @Param('gameId') gameId: string, @Body() dto: CastVoteDto) {
    return this.voteService.castVote({
      userId: req.user.userId,
      gameId,
      clientRequestId: dto.clientRequestId,
      targetPlayerId: dto.targetPlayerId,
    });
  }

  @Get()
  getTally(@Req() req: RequestWithUser, @Param('gameId') gameId: string) {
    return this.voteService.getCurrentTally({ userId: req.user.userId, gameId });
  }
}
