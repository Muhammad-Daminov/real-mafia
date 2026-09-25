import { IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateUserDto {
  @IsString()
  telegramId!: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsString()
  firstName!: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsUrl()
  avatar?: string;
}