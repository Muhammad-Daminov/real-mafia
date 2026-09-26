import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import type { RequestWithUser } from '../auth/types/authenticated-user';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';

/** Master TZ §30.1: all three endpoints are `bearer` — authenticated only. */
@Controller('rooms')
@UseGuards(JwtGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  create(@Req() req: RequestWithUser, @Body() dto: CreateRoomDto) {
    return this.roomsService.createRoom({
      userId: req.user.userId,
      clientRequestId: dto.clientRequestId,
      maxPlayers: dto.maxPlayers,
      rulesetMode: dto.rulesetMode,
    });
  }

  @Get(':code')
  getByCode(@Param('code') code: string) {
    return this.roomsService.getRoomByCode(code);
  }

  @Post(':code/join')
  join(
    @Req() req: RequestWithUser,
    @Param('code') code: string,
    @Body() dto: JoinRoomDto,
  ) {
    return this.roomsService.joinRoom({
      userId: req.user.userId,
      code,
      clientRequestId: dto.clientRequestId,
    });
  }
}
