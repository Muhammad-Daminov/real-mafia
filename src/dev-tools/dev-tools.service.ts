import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService, type RoomSummary } from '../rooms/rooms.service';

export interface FillBotsInput {
  code: string;
  requesterUserId: string;
  count: number;
  ready: boolean;
}

/**
 * B-D1: negative `telegramId` — outside Telegram's real id space (always
 * positive), so a bot can never collide with, or be mistaken for, a real
 * account by anything that only sees the id. `User.isBot` (schema column)
 * is the authoritative, non-parsing signal every "skip bots" check
 * actually filters on (outbox enqueue, etc.) — this range is a second,
 * belt-and-suspenders guarantee, not the sole one.
 */
function generateBotTelegramId(): string {
  return `-${Date.now()}${randomInt(1000, 9999)}`;
}

@Injectable()
export class DevToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
  ) {}

  /**
   * Fills a LOBBY room with synthetic ("bot") players for solo testing.
   * Scope is filling the lobby only — no night-action/vote automation.
   *
   * Membership check reuses `RoomsService.getRoomByCode`'s own gate
   * (OD-055): `players` is present only for an active member of the
   * room's game — "host or not", exactly this task's requirement — so a
   * non-member gets the same 403 either way, no bespoke check needed.
   *
   * Each bot is created as a real `User` row and seated through the real
   * `RoomsService.joinRoom` (and, if `ready`, `setReady`) path — the same
   * transaction, capacity check, idempotency key, and `PLAYER_JOINED`
   * broadcast a real player gets. No direct `game_players` write.
   */
  async fillBots(input: FillBotsInput): Promise<RoomSummary> {
    const before = await this.rooms.getRoomByCode(input.code, input.requesterUserId);

    if (!before.players) {
      throw new ForbiddenException('Siz bu xonaning aʻzosi emassiz');
    }

    const available = Math.max(before.maxPlayers - before.playerCount, 0);
    const effectiveCount = Math.min(input.count, available);

    for (let i = 1; i <= effectiveCount; i++) {
      const bot = await this.prisma.user.create({
        data: {
          telegramId: generateBotTelegramId(),
          firstName: `Bot ${before.playerCount + i}`,
          isBot: true,
        },
      });

      const joined = await this.rooms.joinRoom({
        userId: bot.id,
        code: input.code,
        clientRequestId: randomUUID(),
      });

      if (input.ready) {
        await this.rooms.setReady({
          userId: bot.id,
          roomId: joined.roomId,
          clientRequestId: randomUUID(),
          isReady: true,
        });
      }
    }

    return this.rooms.getRoomByCode(input.code, input.requesterUserId);
  }
}
