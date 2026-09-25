import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves a single user by their own id.
   *
   * There is deliberately no "list all users" method: the Master TZ's HTTP API
   * (§30) exposes no such endpoint, and returning other users' records to a
   * caller violates the authorization principle of §29 (authorization is always
   * resolved server-side, scoped to the caller). See docs/audit/GAP_REPORT.md F-01.
   */
  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      // Explicit projection, never raw ORM serialization (§32.2 contract rules).
      select: {
        id: true,
        telegramId: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
        createdAt: true,
      },
    });
  }

  async create(data: CreateUserDto) {
    return this.prisma.user.create({
      data,
    });
  }
}