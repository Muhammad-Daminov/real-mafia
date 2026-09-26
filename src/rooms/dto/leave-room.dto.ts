import { IsNotEmpty, IsString } from 'class-validator';

/** Master TZ §15.3 / OD-037. The room id is a route param, not body. */
export class LeaveRoomDto {
  @IsNotEmpty()
  @IsString()
  clientRequestId!: string;
}
