import { IsNotEmpty, IsString } from 'class-validator';

/** Master TZ §15.2 / §30.1. The room code is a route param, not body. */
export class JoinRoomDto {
  @IsNotEmpty()
  @IsString()
  clientRequestId!: string;
}
