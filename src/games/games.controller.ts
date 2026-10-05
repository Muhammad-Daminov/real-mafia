import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import type { RequestWithUser } from '../auth/types/authenticated-user';
import { GamesService } from './games.service';

/** §30.1/OD-037: `bearer`-authenticated only, same as every other endpoint. */
@Controller('games')
@UseGuards(JwtGuard)
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get(':gameId/state')
  getMyState(@Req() req: RequestWithUser, @Param('gameId') gameId: string) {
    return this.games.getMyState({ gameId, userId: req.user.userId });
  }
}
