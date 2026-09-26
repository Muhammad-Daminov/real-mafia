import { IsNotEmpty, IsString } from 'class-validator';

/** Master TZ §10.2/§13.2 / OD-040. The room id is a route param, not body. */
export class StartGameDto {
  @IsNotEmpty()
  @IsString()
  clientRequestId!: string;
}
