import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import type { RequestWithUser } from '../auth/types/authenticated-user';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';
import { ListPublicRoomsDto } from './dto/list-public-rooms.dto';
import { LeaveRoomDto } from './dto/leave-room.dto';
import { SetReadyDto } from './dto/set-ready.dto';
import { TransferHostDto } from './dto/transfer-host.dto';
import { StartGameDto } from './dto/start-game.dto';

/** Master TZ §30.1/OD-037: all endpoints are `bearer` — authenticated only. */
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
      visibility: dto.visibility,
    });
  }

  // Registered before `:code` — Nest/Express match routes in declaration
  // order, and `:code` would otherwise greedily swallow the literal
  // "public" segment as a room code.
  @Get('public')
  listPublic(@Query() query: ListPublicRoomsDto) {
    return this.roomsService.listPublicRooms({
      page: query.page,
      limit: query.limit,
    });
  }

  @Get(':code')
  getByCode(@Req() req: RequestWithUser, @Param('code') code: string) {
    return this.roomsService.getRoomByCode(code, req.user.userId);
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

  @Post(':id/leave')
  leave(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: LeaveRoomDto,
  ) {
    return this.roomsService.leaveRoom({
      userId: req.user.userId,
      roomId: id,
      clientRequestId: dto.clientRequestId,
    });
  }

  @Post(':id/ready')
  setReady(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: SetReadyDto,
  ) {
    return this.roomsService.setReady({
      userId: req.user.userId,
      roomId: id,
      clientRequestId: dto.clientRequestId,
      isReady: dto.isReady,
    });
  }

  @Post(':id/host-transfer')
  transferHost(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: TransferHostDto,
  ) {
    return this.roomsService.transferHost({
      userId: req.user.userId,
      roomId: id,
      clientRequestId: dto.clientRequestId,
      targetPlayerId: dto.targetPlayerId,
    });
  }

  @Post(':id/start')
  start(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: StartGameDto,
  ) {
    return this.roomsService.startGame({
      userId: req.user.userId,
      roomId: id,
      clientRequestId: dto.clientRequestId,
    });
  }
}
