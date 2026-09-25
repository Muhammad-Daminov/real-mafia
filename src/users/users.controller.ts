import {
  Controller,
  Get,
  NotFoundException,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtGuard } from '../auth/guards/jwt.guard';
import type { RequestWithUser } from '../auth/types/authenticated-user';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Returns only the authenticated caller's own profile.
   *
   * The id is taken from the verified JWT (`request.user`), never from a route
   * or query parameter, so there is no IDOR surface here — Master TZ §29.
   */
  @Get('me')
  @UseGuards(JwtGuard)
  async findMe(@Req() req: RequestWithUser) {
    const user = await this.usersService.findById(req.user.userId);

    if (!user) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }

    return user;
  }
}
